pub mod config;
pub mod correlate;
pub mod model;
pub mod poller;
pub mod skills;
pub mod tail;
pub mod term;
pub mod tmux;

use model::{AppConfig, ProjectZone, SkillInfo};
use poller::SharedState;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::State;

// Same friendly names as claude-grid, so the fleets stay interoperable.
const ANIMALS: [&str; 30] = [
    "falcon", "tiger", "cobra", "dolphin", "eagle", "panther", "badger", "otter", "bison",
    "raven", "salmon", "turtle", "penguin", "jaguar", "walrus", "gecko", "mantis", "mustang",
    "condor", "viper", "pelican", "osprey", "marmot", "bobcat", "coyote", "macaw", "lemur",
    "narwhal", "toucan", "scorpion",
];

fn claude_home() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("/")).join(".claude")
}

#[tauri::command]
fn get_config(state: State<Arc<SharedState>>) -> AppConfig {
    state.config.lock().unwrap().clone()
}

#[tauri::command]
fn get_snapshot(state: State<Arc<SharedState>>) -> Option<model::Snapshot> {
    state.last_snapshot.lock().unwrap().clone()
}

#[tauri::command]
fn add_project(
    state: State<Arc<SharedState>>,
    path: String,
    name: String,
    color: String,
) -> Result<AppConfig, String> {
    let canonical = std::fs::canonicalize(&path)
        .map_err(|e| format!("{path}: {e}"))?
        .to_string_lossy()
        .into_owned();
    let id = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>();
    let mut config = state.config.lock().unwrap();
    if config.projects.iter().any(|p| p.id == id) {
        return Err(format!("project '{id}' already exists"));
    }
    config.projects.push(ProjectZone { id, name, path: canonical, color, auto: false });
    config::save(&config)?;
    Ok(config.clone())
}

#[tauri::command]
fn remove_project(state: State<Arc<SharedState>>, id: String) -> Result<AppConfig, String> {
    let mut config = state.config.lock().unwrap();
    config.projects.retain(|p| p.id != id);
    config::save(&config)?;
    Ok(config.clone())
}

#[tauri::command]
fn list_skills() -> Vec<SkillInfo> {
    skills::list(&claude_home())
}

#[tauri::command]
fn suggest_name() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .subsec_nanos() as usize;
    let in_use: Vec<String> = tmux::discover().into_iter().map(|p| p.name).collect();
    for i in 0..ANIMALS.len() {
        let candidate = ANIMALS[(nanos + i) % ANIMALS.len()];
        if !in_use.iter().any(|n| n == candidate) {
            return candidate.to_string();
        }
    }
    format!("agent-{}", nanos % 10000)
}

#[tauri::command]
fn spawn_agent(state: State<Arc<SharedState>>, zone_id: String, name: String) -> Result<(), String> {
    if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("name must be alphanumeric/dashes".into());
    }
    if tmux::has_session(&name) {
        return Err(format!("agent '{name}' already exists"));
    }
    let config = state.config.lock().unwrap();
    let project = config
        .projects
        .iter()
        .find(|p| p.id == zone_id)
        .ok_or_else(|| format!("unknown project '{zone_id}'"))?;
    tmux::spawn(&name, &project.path, &config.claude_args)
}

#[tauri::command]
fn kill_agent(name: String) -> Result<(), String> {
    tmux::kill(&name)
}

/// Claude can't change cwd mid-session, so moving an agent to another project
/// means restarting it there: kill, wait for the session to vanish, respawn.
#[tauri::command]
async fn move_agent(
    state: State<'_, Arc<SharedState>>,
    name: String,
    zone_id: String,
) -> Result<(), String> {
    let (path, args) = {
        let config = state.config.lock().unwrap();
        let project = config
            .projects
            .iter()
            .find(|p| p.id == zone_id)
            .ok_or_else(|| format!("unknown project '{zone_id}'"))?;
        (project.path.clone(), config.claude_args.clone())
    };
    tmux::kill(&name)?;
    for _ in 0..20 {
        if !tmux::has_session(&name) {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    tmux::spawn(&name, &path, &args)
}

#[tauri::command]
async fn send_task(name: String, text: String) -> Result<(), String> {
    let buf = tmux::stage_text(&name, &text)?;
    // Claude Code's TUI needs a beat between paste and Enter or it drops input.
    tokio::time::sleep(std::time::Duration::from_millis(600)).await;
    let result = tmux::press_enter(&name);
    tmux::delete_buffer(&buf);
    result
}

#[tauri::command]
fn term_open(
    app: tauri::AppHandle,
    terms: State<Arc<term::TermState>>,
    name: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    term::open(app, &terms, name, cols, rows)
}

#[tauri::command]
fn term_input(terms: State<Arc<term::TermState>>, name: String, data: String) -> Result<(), String> {
    term::input(&terms, &name, &data)
}

#[tauri::command]
fn term_resize(
    terms: State<Arc<term::TermState>>,
    name: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    term::resize(&terms, &name, cols, rows)
}

#[tauri::command]
fn term_close(terms: State<Arc<term::TermState>>, name: String) {
    terms.close(&name);
}

/// Launch (or confirm) VoiceDeck — voice dispatch reaches `cg/*` agents via
/// its hot-mic tmux integration, so there's nothing else to wire up.
#[tauri::command]
fn launch_voicedeck() -> Result<bool, String> {
    let running = std::process::Command::new("pgrep")
        .args(["-f", "voicedeck"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    if running {
        return Ok(true); // already up
    }
    std::process::Command::new("voicedeck")
        .spawn()
        .map(|_| false)
        .map_err(|e| format!("could not launch voicedeck: {e}"))
}

#[tauri::command]
fn open_terminal(name: String) -> Result<(), String> {
    std::process::Command::new("gnome-terminal")
        .args(["--", "tmux", "attach", "-t", &format!("=cg/{name}")])
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // webkit2gtk's DMA-BUF renderer breaks WebGL on NVIDIA — must be set
    // before the webview initializes.
    #[cfg(target_os = "linux")]
    std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");

    let shared = Arc::new(SharedState {
        config: Mutex::new(config::load()),
        last_snapshot: Mutex::new(None),
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(shared.clone())
        .manage(Arc::new(term::TermState::default()))
        .setup(move |app| {
            poller::start(app.handle().clone(), shared);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            get_snapshot,
            add_project,
            remove_project,
            list_skills,
            suggest_name,
            spawn_agent,
            kill_agent,
            move_agent,
            send_task,
            term_open,
            term_input,
            term_resize,
            term_close,
            open_terminal,
            launch_voicedeck,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

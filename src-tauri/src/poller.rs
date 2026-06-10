//! The one background thread. Polls tmux + ~/.claude on staggered cadences,
//! builds a full Snapshot, and emits it to the frontend when it changes.
//! User actions (spawn/kill/send) happen on Tauri's command threads — this
//! loop is read-only except for emitting events.

use crate::correlate::{self, ClaudeSession};
use crate::model::{AgentState, AppConfig, ProjectZone, Snapshot, Source, Status, TokenTotals};
use crate::tail::Tailer;
use crate::tmux;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::Emitter;

const TICK: Duration = Duration::from_millis(500);
const DISCOVER_EVERY: u64 = 4; // 2s
const STATUS_EVERY: u64 = 3; // 1.5s
const TOKENS_EVERY: u64 = 20; // 10s
const SPAWNING_GRACE: Duration = Duration::from_secs(30);

pub struct SharedState {
    pub config: Mutex<AppConfig>,
    /// Latest snapshot, so a (re)loading frontend can pull state immediately
    /// instead of waiting for the next change-triggered emit.
    pub last_snapshot: Mutex<Option<Snapshot>>,
}

struct AgentRuntime {
    source: Source,
    pane_pid: i32,
    project_path: String,
    claude: Option<ClaudeSession>,
    tailer: Option<Tailer>,
    first_seen: Instant,
}

pub fn start(app: tauri::AppHandle, shared: Arc<SharedState>) {
    std::thread::spawn(move || {
        let claude_home = dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("/"))
            .join(".claude");
        let mut agents: HashMap<String, AgentRuntime> = HashMap::new();
        let mut last_snapshot: Option<Snapshot> = None;
        let mut tick: u64 = 0;

        loop {
            let started = Instant::now();

            if tick % DISCOVER_EVERY == 0 {
                discover(&mut agents, &claude_home);
            }

            if tick % STATUS_EVERY == 0 {
                refresh_claude_state(&mut agents, &claude_home, tick);
            }

            let config = shared.config.lock().unwrap().clone();
            let snapshot = build_snapshot(&agents, &config, &claude_home);
            let changed = last_snapshot
                .as_ref()
                .map(|prev| prev.agents != snapshot.agents)
                .unwrap_or(true);
            if changed {
                let _ = app.emit("fleet_snapshot", &snapshot);
                *shared.last_snapshot.lock().unwrap() = Some(snapshot.clone());
                last_snapshot = Some(snapshot);
            }

            tick += 1;
            std::thread::sleep(TICK.saturating_sub(started.elapsed()));
        }
    });
}

fn discover(agents: &mut HashMap<String, AgentRuntime>, claude_home: &Path) {
    let panes = tmux::discover();
    let live: std::collections::HashSet<&str> =
        panes.iter().map(|p| p.name.as_str()).collect();
    agents.retain(|name, rt| rt.source == Source::External || live.contains(name.as_str()));
    for pane in &panes {
        match agents.get_mut(&pane.name) {
            Some(rt) => {
                rt.pane_pid = pane.pane_pid;
                rt.project_path = pane.current_path.clone();
            }
            None => {
                agents.insert(
                    pane.name.clone(),
                    AgentRuntime {
                        source: Source::Tmux,
                        pane_pid: pane.pane_pid,
                        project_path: pane.current_path.clone(),
                        claude: None,
                        tailer: None,
                        first_seen: Instant::now(),
                    },
                );
            }
        }
    }

    // Claude instances running outside Fleet-managed tmux sessions (IDE
    // terminals, plain shells, other tools). Skip anything living under a
    // cg/ pane so a booting tmux agent never shows up twice.
    let claimed: std::collections::HashSet<i32> = panes
        .iter()
        .flat_map(|p| correlate::descendants(p.pane_pid, 3))
        .collect();
    let external_live: std::collections::HashSet<String> = correlate::scan_sessions(claude_home)
        .into_iter()
        .filter(|s| !claimed.contains(&s.pid))
        .map(|s| {
            let name = external_name(&s);
            match agents.get_mut(&name) {
                Some(rt) => {
                    rt.project_path = s.cwd.clone();
                    rt.claude = Some(s);
                }
                None => {
                    agents.insert(
                        name.clone(),
                        AgentRuntime {
                            source: Source::External,
                            pane_pid: -1,
                            project_path: s.cwd.clone(),
                            claude: Some(s),
                            tailer: None,
                            first_seen: Instant::now(),
                        },
                    );
                }
            }
            name
        })
        .collect();
    agents.retain(|name, rt| rt.source == Source::Tmux || external_live.contains(name.as_str()));
}

fn external_name(session: &ClaudeSession) -> String {
    let base = session
        .cwd
        .rsplit('/')
        .next()
        .filter(|s| !s.is_empty())
        .unwrap_or("home");
    format!("{}·{}", base, session.pid)
}

fn refresh_claude_state(
    agents: &mut HashMap<String, AgentRuntime>,
    claude_home: &Path,
    tick: u64,
) {
    for rt in agents.values_mut() {
        let was_busy = rt.claude.as_ref().map(|c| c.status == "busy").unwrap_or(false);
        match &rt.claude {
            Some(claude) => {
                // procStart re-verified on every read — None means the claude
                // process died or was replaced; drop and re-correlate.
                rt.claude = correlate::read_status(claude.pid, claude_home);
                if rt.claude.is_none() {
                    rt.tailer = None;
                }
            }
            None if rt.source == Source::Tmux => {
                rt.claude = correlate::find_claude_session(rt.pane_pid, claude_home);
            }
            None => {}
        }
        if let Some(claude) = &rt.claude {
            if rt.tailer.is_none() {
                if let Some(path) =
                    correlate::transcript_path(claude_home, &claude.cwd, &claude.session_id)
                {
                    rt.tailer = Some(Tailer::new(path));
                }
            }
            let became_idle = was_busy && claude.status != "busy";
            if let Some(tailer) = &mut rt.tailer {
                if became_idle || tick % TOKENS_EVERY == 0 {
                    tailer.poll();
                }
            }
        }
    }
    // An external instance whose process died has nothing left to show.
    agents.retain(|_, rt| rt.source == Source::Tmux || rt.claude.is_some());
}

fn build_snapshot(
    agents: &HashMap<String, AgentRuntime>,
    config: &AppConfig,
    _claude_home: &Path,
) -> Snapshot {
    let mut states: Vec<AgentState> = agents
        .iter()
        .map(|(name, rt)| {
            let zone_id = zone_for_path(&rt.project_path, config);
            let status = match &rt.claude {
                Some(c) if c.status == "busy" => Status::Busy,
                Some(_) => Status::Idle,
                None if rt.first_seen.elapsed() < SPAWNING_GRACE => Status::Spawning,
                None => Status::Stale,
            };
            AgentState {
                name: name.clone(),
                source: rt.source,
                session: match rt.source {
                    Source::Tmux => format!("{}{}", tmux::SESSION_PREFIX, name),
                    Source::External => String::new(),
                },
                pane_pid: rt.pane_pid,
                project_path: rt.project_path.clone(),
                zone_id,
                claude_pid: rt.claude.as_ref().map(|c| c.pid),
                session_id: rt.claude.as_ref().map(|c| c.session_id.clone()),
                status,
                tokens: rt.tailer.as_ref().map(|t| t.totals).unwrap_or(TokenTotals::default()),
                last_model: rt.tailer.as_ref().and_then(|t| t.last_model.clone()),
                slot: 0,
            }
        })
        .collect();

    // Unregistered directories get their own ephemeral pad instead of
    // dumping everyone in Visitors — one zone per distinct cwd.
    let mut auto_zones: std::collections::BTreeMap<String, ProjectZone> =
        std::collections::BTreeMap::new();
    for state in &mut states {
        if state.zone_id == "visitors" && !state.project_path.is_empty() {
            let id = format!("auto-{}", crate::correlate::mangle_project_path(&state.project_path));
            auto_zones.entry(id.clone()).or_insert_with(|| ProjectZone {
                id: id.clone(),
                name: state
                    .project_path
                    .rsplit('/')
                    .next()
                    .filter(|s| !s.is_empty())
                    .unwrap_or("Home")
                    .to_string(),
                path: state.project_path.clone(),
                color: auto_color(&id),
                auto: true,
            });
            state.zone_id = id;
        }
    }

    // Deterministic placement: slot = index among the zone's agents by name.
    states.sort_by(|a, b| a.name.cmp(&b.name));
    let mut per_zone: HashMap<String, usize> = HashMap::new();
    for state in &mut states {
        let counter = per_zone.entry(state.zone_id.clone()).or_insert(0);
        state.slot = *counter;
        *counter += 1;
    }

    Snapshot {
        agents: states,
        zones: auto_zones.into_values().collect(),
        ts: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
    }
}

/// Stable, pleasant pad color for an auto zone.
fn auto_color(id: &str) -> String {
    const COLORS: [&str; 8] = [
        "#5b7a99", "#6b8e7f", "#8a7a9b", "#9b8a6b", "#7a99b5", "#a3847c", "#7c8aa3", "#86946f",
    ];
    let hash: usize = id.bytes().map(|b| b as usize).sum();
    COLORS[hash % COLORS.len()].to_string()
}

/// Longest-prefix match so an agent that cd'd into a subdirectory still
/// belongs to its project's pad.
pub fn zone_for_path(path: &str, config: &AppConfig) -> String {
    let mut best: Option<(&str, usize)> = None;
    for project in &config.projects {
        let root = project.path.trim_end_matches('/');
        if (path == root || path.starts_with(&format!("{root}/")))
            && best.map(|(_, len)| root.len() > len).unwrap_or(true)
        {
            best = Some((&project.id, root.len()));
        }
    }
    best.map(|(id, _)| id.to_string())
        .unwrap_or_else(|| "visitors".to_string())
}

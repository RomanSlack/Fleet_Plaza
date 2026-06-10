//! Thin tmux wrapper. All calls are argv-style (no shell), millisecond-fast.
//! Conventions match claude-grid / agent-talk: sessions are `cg/<name>`,
//! targets use tmux's exact-match form `=cg/<name>`.

use std::process::Command;

pub const SESSION_PREFIX: &str = "cg/";

#[derive(Debug, Clone)]
pub struct PaneInfo {
    pub session: String,
    pub name: String,
    pub pane_pid: i32,
    pub current_cmd: String,
    pub current_path: String,
}

fn run(args: &[&str]) -> Result<String, String> {
    let out = Command::new("tmux")
        .args(args)
        .output()
        .map_err(|e| format!("failed to run tmux: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).into_owned())
    }
}

/// Exact-match session target (kill-session, has-session, set-option).
fn target(name: &str) -> String {
    format!("={SESSION_PREFIX}{name}")
}

/// Exact-match pane target (capture-pane, paste-buffer, send-keys). The
/// trailing colon is required: tmux only honors the `=` exact-match prefix on
/// the session part of a target-pane, so a bare `=cg/x` fails to resolve.
fn pane_target(name: &str) -> String {
    format!("={SESSION_PREFIX}{name}:")
}

/// List `cg/*` panes (first pane per session wins). A missing tmux server is
/// a normal "zero agents" state, not an error.
pub fn discover() -> Vec<PaneInfo> {
    let Ok(out) = run(&[
        "list-panes",
        "-a",
        "-F",
        "#{session_name}|#{pane_pid}|#{pane_current_command}|#{pane_current_path}",
    ]) else {
        return Vec::new();
    };
    let mut seen = std::collections::HashSet::new();
    let mut panes = Vec::new();
    for line in out.lines() {
        let parts: Vec<&str> = line.splitn(4, '|').collect();
        if parts.len() != 4 || !parts[0].starts_with(SESSION_PREFIX) {
            continue;
        }
        if !seen.insert(parts[0].to_string()) {
            continue;
        }
        panes.push(PaneInfo {
            session: parts[0].to_string(),
            name: parts[0][SESSION_PREFIX.len()..].to_string(),
            pane_pid: parts[1].parse().unwrap_or(-1),
            current_cmd: parts[2].to_string(),
            current_path: parts[3].to_string(),
        });
    }
    panes
}

pub fn spawn(name: &str, dir: &str, claude_args: &[String]) -> Result<(), String> {
    let cmd = std::iter::once("claude".to_string())
        .chain(claude_args.iter().cloned())
        .collect::<Vec<_>>()
        .join(" ");
    spawn_cmd(name, dir, &cmd)
}

/// Spawn an arbitrary command in a `cg/` session (used by tests; `spawn` is
/// the claude-specific wrapper).
pub fn spawn_cmd(name: &str, dir: &str, cmd: &str) -> Result<(), String> {
    run(&[
        "new-session",
        "-d",
        "-s",
        &format!("{SESSION_PREFIX}{name}"),
        "-c",
        dir,
        cmd,
    ])?;
    // Mirrors claude-grid: clicking/scrolling inside an attached terminal works.
    let _ = run(&["set-option", "-t", &target(name), "mouse", "on"]);
    Ok(())
}

pub fn kill(name: &str) -> Result<(), String> {
    run(&["kill-session", "-t", &target(name)]).map(|_| ())
}

pub fn capture(name: &str, lines: u32) -> Result<String, String> {
    run(&[
        "capture-pane",
        "-t",
        &pane_target(name),
        "-p",
        "-S",
        &format!("-{lines}"),
    ])
}

/// Stage text into the agent's input box. The caller must wait ~0.6s before
/// `press_enter` so Claude Code's TUI registers the paste (load-bearing delay,
/// proven by the agent-talk skill).
pub fn stage_text(name: &str, text: &str) -> Result<String, String> {
    let buf = format!(
        "fleetplaza_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    );
    run(&["set-buffer", "-b", &buf, text])?;
    run(&["paste-buffer", "-b", &buf, "-t", &pane_target(name)])?;
    Ok(buf)
}

pub fn press_enter(name: &str) -> Result<(), String> {
    run(&["send-keys", "-t", &pane_target(name), "Enter"]).map(|_| ())
}

pub fn delete_buffer(buf: &str) {
    let _ = run(&["delete-buffer", "-b", buf]);
}

pub fn has_session(name: &str) -> bool {
    run(&["has-session", "-t", &target(name)]).is_ok()
}

//! Correlate a tmux pane with the Claude Code CLI process running inside it,
//! and from there with Claude's own session metadata in `<claude_home>/sessions/`.
//!
//! cwd matching is NOT safe (several agents often share one project dir), so
//! this walks the process tree instead: candidates are the pane's root pid and
//! its descendants; a candidate matches if `sessions/<pid>.json` exists AND its
//! `procStart` equals the process's starttime from /proc (defeats PID reuse —
//! the sessions dir accumulates stale files for dead pids).

use std::fs;
use std::path::Path;

#[derive(Debug, Clone)]
pub struct ClaudeSession {
    pub pid: i32,
    pub session_id: String,
    pub cwd: String,
    pub status: String,
    pub updated_at: u64,
}

/// /proc/<pid>/stat field 22 (starttime, clock ticks). The comm field can
/// contain spaces/parens, so split after the last ')'.
fn proc_starttime(pid: i32) -> Option<String> {
    let stat = fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let rest = &stat[stat.rfind(')')? + 2..];
    // rest starts at field 3 (state); starttime is field 22 → index 19.
    rest.split_whitespace().nth(19).map(|s| s.to_string())
}

fn children_of(pid: i32) -> Vec<i32> {
    fs::read_to_string(format!("/proc/{pid}/task/{pid}/children"))
        .map(|s| s.split_whitespace().filter_map(|c| c.parse().ok()).collect())
        .unwrap_or_default()
}

pub fn descendants(root: i32, max_depth: u32) -> Vec<i32> {
    let mut all = vec![root];
    let mut frontier = vec![root];
    for _ in 0..max_depth {
        let mut next = Vec::new();
        for pid in frontier {
            next.extend(children_of(pid));
        }
        if next.is_empty() {
            break;
        }
        all.extend(&next);
        frontier = next;
    }
    all
}

fn parse_session_file(path: &Path, pid: i32) -> Option<ClaudeSession> {
    let json: serde_json::Value = serde_json::from_str(&fs::read_to_string(path).ok()?).ok()?;
    // procStart guard: stale file from a dead (possibly reused) pid otherwise.
    let proc_start = json.get("procStart")?.as_str()?.to_string();
    if proc_starttime(pid)? != proc_start {
        return None;
    }
    Some(ClaudeSession {
        pid,
        session_id: json.get("sessionId")?.as_str()?.to_string(),
        cwd: json.get("cwd")?.as_str()?.to_string(),
        status: json.get("status")?.as_str()?.to_string(),
        updated_at: json.get("updatedAt")?.as_u64()?,
    })
}

pub fn find_claude_session(pane_pid: i32, claude_home: &Path) -> Option<ClaudeSession> {
    let sessions = claude_home.join("sessions");
    descendants(pane_pid, 3)
        .into_iter()
        .find_map(|pid| parse_session_file(&sessions.join(format!("{pid}.json")), pid))
}

/// Every live, procStart-verified Claude session on the machine — including
/// ones running outside any tmux session (IDE terminals, plain shells).
pub fn scan_sessions(claude_home: &Path) -> Vec<ClaudeSession> {
    let Ok(entries) = fs::read_dir(claude_home.join("sessions")) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|entry| {
            let pid: i32 = entry.path().file_stem()?.to_str()?.parse().ok()?;
            parse_session_file(&entry.path(), pid)
        })
        .collect()
}

/// Refresh status/updatedAt for an already-correlated agent. None = the claude
/// process is gone or was replaced (caller marks the agent stale).
pub fn read_status(claude_pid: i32, claude_home: &Path) -> Option<ClaudeSession> {
    parse_session_file(
        &claude_home.join("sessions").join(format!("{claude_pid}.json")),
        claude_pid,
    )
}

/// Claude's project-dir name mangling: every non-alphanumeric char becomes '-'.
pub fn mangle_project_path(cwd: &str) -> String {
    cwd.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

/// Locate the transcript jsonl for a session (token usage source).
pub fn transcript_path(claude_home: &Path, cwd: &str, session_id: &str) -> Option<std::path::PathBuf> {
    let direct = claude_home
        .join("projects")
        .join(mangle_project_path(cwd))
        .join(format!("{session_id}.jsonl"));
    if direct.exists() {
        return Some(direct);
    }
    // Fallback: the agent may have started elsewhere — scan project dirs.
    let projects = claude_home.join("projects");
    for entry in fs::read_dir(projects).ok()?.flatten() {
        let candidate = entry.path().join(format!("{session_id}.jsonl"));
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

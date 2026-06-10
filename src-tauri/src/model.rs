use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Spawning,
    Idle,
    Busy,
    Stale,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
pub struct TokenTotals {
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_creation: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Tmux,
    External,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct AgentState {
    pub name: String,
    pub source: Source,
    pub session: String,
    pub pane_pid: i32,
    pub project_path: String,
    pub zone_id: String,
    pub claude_pid: Option<i32>,
    pub session_id: Option<String>,
    pub status: Status,
    pub tokens: TokenTotals,
    pub last_model: Option<String>,
    pub slot: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Snapshot {
    pub agents: Vec<AgentState>,
    /// Ephemeral zones for unregistered directories agents are running in.
    pub zones: Vec<ProjectZone>,
    pub ts: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProjectZone {
    pub id: String,
    pub name: String,
    pub path: String,
    pub color: String,
    #[serde(default)]
    pub auto: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    #[serde(default)]
    pub projects: Vec<ProjectZone>,
    #[serde(default = "default_claude_args")]
    pub claude_args: Vec<String>,
}

pub fn default_claude_args() -> Vec<String> {
    vec!["--dangerously-skip-permissions".into()]
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            projects: Vec::new(),
            claude_args: default_claude_args(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct SkillInfo {
    pub name: String,
    pub description: String,
}

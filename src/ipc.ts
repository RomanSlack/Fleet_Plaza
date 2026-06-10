// Typed bridge to the Rust side. Shapes mirror src-tauri/src/model.rs.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type AgentStatus = "spawning" | "idle" | "busy" | "stale";

export interface TokenTotals {
  input: number;
  output: number;
  cache_read: number;
  cache_creation: number;
}

export type AgentSource = "tmux" | "external";

export interface AgentState {
  name: string;
  source: AgentSource;
  session: string;
  pane_pid: number;
  project_path: string;
  zone_id: string;
  claude_pid: number | null;
  session_id: string | null;
  status: AgentStatus;
  tokens: TokenTotals;
  last_model: string | null;
  slot: number;
}

export interface Snapshot {
  agents: AgentState[];
  zones: ProjectZone[];
  ts: number;
}

export interface ProjectZone {
  id: string;
  name: string;
  path: string;
  color: string;
  auto?: boolean;
}

export interface AppConfig {
  projects: ProjectZone[];
  claude_args: string[];
}

export interface SkillInfo {
  name: string;
  description: string;
}

export const getConfig = () => invoke<AppConfig>("get_config");
export const getSnapshot = () => invoke<Snapshot | null>("get_snapshot");
export const addProject = (path: string, name: string, color: string) =>
  invoke<AppConfig>("add_project", { path, name, color });
export const removeProject = (id: string) =>
  invoke<AppConfig>("remove_project", { id });
export const listSkills = () => invoke<SkillInfo[]>("list_skills");
export const suggestName = () => invoke<string>("suggest_name");
export const spawnAgent = (zoneId: string, name: string) =>
  invoke<void>("spawn_agent", { zoneId, name });
export const killAgent = (name: string) => invoke<void>("kill_agent", { name });
export const sendTask = (name: string, text: string) =>
  invoke<void>("send_task", { name, text });
export const termOpen = (name: string, cols: number, rows: number) =>
  invoke<void>("term_open", { name, cols, rows });
export const termInput = (name: string, data: string) =>
  invoke<void>("term_input", { name, data });
export const termResize = (name: string, cols: number, rows: number) =>
  invoke<void>("term_resize", { name, cols, rows });
export const termClose = (name: string) => invoke<void>("term_close", { name });
export const openTerminal = (name: string) =>
  invoke<void>("open_terminal", { name });
export const launchVoiceDeck = () => invoke<boolean>("launch_voicedeck");

export const onSnapshot = (handler: (snap: Snapshot) => void) =>
  listen<Snapshot>("fleet_snapshot", (e) => handler(e.payload));
export const onTermData = (
  handler: (payload: { name: string; data: string }) => void,
) =>
  listen<{ name: string; data: string }>("term_data", (e) => handler(e.payload));
export const onTermExit = (handler: (payload: { name: string }) => void) =>
  listen<{ name: string }>("term_exit", (e) => handler(e.payload));

import type { Snapshot } from "../ipc";
import { launchVoiceDeck } from "../ipc";
import { el, fmtTokens } from "./format";

export class TopBar {
  readonly root = el("div", "topbar");
  private agentsPill = el("span", "pill");
  private busyPill = el("span", "pill");
  private tokensPill = el("span", "pill");

  constructor(
    onSpawn: () => void,
    onProjects: () => void,
    onAnonToggle: () => boolean,
  ) {
    const title = el("span", "title", "Fleet Plaza");
    const spacer = el("span", "spacer");
    const voice = el("button", "btn btn-secondary", "🎤 Voice");
    voice.title =
      "Launch VoiceDeck — hot-mic voice dispatch straight into your agents";
    voice.addEventListener("click", async () => {
      try {
        const wasRunning = await launchVoiceDeck();
        voice.classList.add("active");
        voice.textContent = wasRunning ? "🎤 Voice ✓" : "🎤 Launching…";
        setTimeout(() => (voice.textContent = "🎤 Voice ✓"), 2500);
      } catch (e) {
        voice.textContent = "🎤 Voice ✗";
        voice.title = String(e);
      }
    });
    const anon = el("button", "btn btn-secondary", "🕶 Anon");
    anon.title = "Anonymous mode — mask all names for screenshots";
    anon.addEventListener("click", () => {
      anon.classList.toggle("active", onAnonToggle());
    });
    const projects = el("button", "btn btn-secondary", "Projects");
    projects.addEventListener("click", onProjects);
    const spawn = el("button", "btn btn-primary", "+ Spawn Agent");
    spawn.addEventListener("click", onSpawn);
    this.root.append(
      title,
      this.agentsPill,
      this.busyPill,
      this.tokensPill,
      spacer,
      voice,
      anon,
      projects,
      spawn,
    );
    this.update({ agents: [], zones: [], ts: 0 });
    document.getElementById("ui")!.appendChild(this.root);
  }

  update(snap: Snapshot) {
    const busy = snap.agents.filter((a) => a.status === "busy").length;
    const tokens = snap.agents.reduce(
      (sum, a) => sum + a.tokens.input + a.tokens.output,
      0,
    );
    this.agentsPill.innerHTML = `<span class="dot" style="background:var(--idle)"></span> ${snap.agents.length} agent${snap.agents.length === 1 ? "" : "s"}`;
    this.busyPill.innerHTML = `<span class="dot" style="background:var(--busy)"></span> ${busy} busy`;
    this.tokensPill.textContent = `${fmtTokens(tokens)} tok`;
  }
}

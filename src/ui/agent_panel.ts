import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { AgentState } from "../ipc";
import {
  killAgent,
  onTermData,
  onTermExit,
  openTerminal,
  termClose,
  termInput,
  termOpen,
  termResize,
} from "../ipc";
import { agentAlias, zoneAlias } from "./anon";
import { el, fmtTokens } from "./format";

export class AgentPanel {
  readonly root = el("div", "agent-panel");
  private swatch = el("span", "swatch");
  private nameEl = el("span", "agent-name");
  private statusPill = el("span", "status-pill");
  private rows = {
    project: el("span", "v"),
    model: el("span", "v"),
    session: el("span", "v"),
  };
  private termHost = el("div", "term-host");
  private term: Terminal;
  private fit: FitAddon;
  private stats = {
    input: el("span", "v", "0"),
    output: el("span", "v", "0"),
    cache_read: el("span", "v", "0"),
    cache_creation: el("span", "v", "0"),
  };
  private killBtn = el("button", "btn btn-danger", "Kill");
  private killArmed = false;
  private actions = el("div", "panel-actions");
  private externalNote = el(
    "div",
    "external-note",
    "External session — this Claude instance is running outside Fleet Plaza " +
      "(an IDE terminal or another shell), so it's watch-only: live status and " +
      "token stats, but no embedded terminal or task assignment.",
  );
  current: string | null = null;
  private anonymous = false;
  private lastAgent: AgentState | null = null;
  onAssign: ((name: string) => void) | null = null;
  onClosed: (() => void) | null = null;

  constructor() {
    const close = el("button", "panel-close", "✕");
    close.addEventListener("click", () => this.close());

    const header = el("div", "header");
    header.append(this.swatch, this.nameEl, this.statusPill, close);

    const info = el("div", "info-rows");
    for (const [key, value] of [
      ["Project", this.rows.project],
      ["Model", this.rows.model],
      ["Session", this.rows.session],
    ] as const) {
      const row = el("div", "info-row");
      row.append(el("span", "k", key), value);
      info.append(row);
    }

    // Real interactive terminal attached to the agent's tmux session.
    this.term = new Terminal({
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 11,
      cursorBlink: true,
      theme: {
        background: "#0f1822",
        foreground: "#d7e2ec",
        cursor: "#7fb2e5",
        selectionBackground: "#2c527866",
      },
    });
    this.fit = new FitAddon();
    this.term.loadAddon(this.fit);
    this.term.onData((data) => {
      if (this.current) termInput(this.current, data);
    });
    onTermData(({ name, data }) => {
      if (name === this.current) this.term.write(data);
    });
    onTermExit(({ name }) => {
      if (name === this.current) {
        this.term.write("\r\n\x1b[90m[session ended]\x1b[0m\r\n");
      }
    });
    new ResizeObserver(() => this.fitTerm()).observe(this.termHost);

    const statGrid = el("div", "stat-grid");
    for (const [key, value] of [
      ["Input", this.stats.input],
      ["Output", this.stats.output],
      ["Cache read", this.stats.cache_read],
      ["Cache write", this.stats.cache_creation],
    ] as const) {
      const cell = el("div", "stat-cell");
      cell.append(el("div", "k", key), value);
      statGrid.append(cell);
    }

    const actions = this.actions;
    const terminal = el("button", "btn btn-primary", "Terminal");
    terminal.addEventListener("click", () => {
      if (this.current) openTerminal(this.current);
    });
    const assign = el("button", "btn btn-secondary", "Assign");
    assign.addEventListener("click", () => {
      if (this.current) this.onAssign?.(this.current);
    });
    this.killBtn.addEventListener("click", () => {
      if (!this.current) return;
      if (!this.killArmed) {
        this.killArmed = true;
        this.killBtn.textContent = "Confirm kill?";
        setTimeout(() => {
          this.killArmed = false;
          this.killBtn.textContent = "Kill";
        }, 2500);
        return;
      }
      killAgent(this.current);
      this.close();
    });
    actions.append(terminal, assign, this.killBtn);

    this.externalNote.style.display = "none";
    this.root.append(header, info, this.termHost, this.externalNote, statGrid, actions);
    document.getElementById("ui")!.appendChild(this.root);
  }

  private fitTerm() {
    if (!this.root.classList.contains("open")) return;
    this.fit.fit();
    if (this.current) {
      termResize(this.current, this.term.cols, this.term.rows);
    }
  }

  open(agent: AgentState) {
    const switching = this.current && this.current !== agent.name;
    if (switching) termClose(this.current!);
    const wasOpen = this.root.classList.contains("open");
    this.current = agent.name;
    const external = agent.source === "external";
    this.termHost.style.display = external ? "none" : "";
    this.actions.style.display = external ? "none" : "";
    this.externalNote.style.display = external ? "" : "none";
    this.update(agent);
    this.root.classList.add("open");
    if (external) return;
    if (!this.term.element) this.term.open(this.termHost);
    this.term.reset();
    // Fit after the slide-in transition has laid the panel out.
    setTimeout(() => {
      this.fit.fit();
      termOpen(agent.name, this.term.cols, this.term.rows);
    }, wasOpen ? 0 : 280);
  }

  /** Screenshot-safe mode: alias the identity fields, blur the terminal. */
  setAnonymous(on: boolean) {
    this.anonymous = on;
    this.termHost.classList.toggle("anon-blur", on);
    if (this.lastAgent) this.update(this.lastAgent);
  }

  update(agent: AgentState) {
    if (agent.name !== this.current) return;
    this.lastAgent = agent;
    const anon = this.anonymous;
    const folder = agent.project_path.split("/").filter(Boolean).pop() ?? "";
    this.nameEl.textContent = anon ? agentAlias(agent.name) : agent.name;
    this.statusPill.textContent = agent.status;
    this.statusPill.dataset.status = agent.status;
    this.swatch.style.background = shirtCss(agent.name);
    this.rows.project.textContent = anon
      ? `~/…/${zoneAlias(folder)}`
      : agent.project_path;
    this.rows.project.title = anon ? "" : agent.project_path;
    this.rows.model.textContent = agent.last_model ?? "—";
    this.rows.session.textContent = agent.session_id
      ? anon
        ? "••••••••"
        : agent.session_id.slice(0, 8)
      : "—";
    this.stats.input.textContent = fmtTokens(agent.tokens.input);
    this.stats.output.textContent = fmtTokens(agent.tokens.output);
    this.stats.cache_read.textContent = fmtTokens(agent.tokens.cache_read);
    this.stats.cache_creation.textContent = fmtTokens(agent.tokens.cache_creation);
  }

  close() {
    if (this.current) termClose(this.current);
    this.current = null;
    this.root.classList.remove("open");
    this.onClosed?.();
  }
}

// Matches the Mii tint hue derivation (mii.ts hashString → HSL).
function shirtCss(name: string): string {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `hsl(${Math.abs(h) % 360} 55% 55%)`;
}

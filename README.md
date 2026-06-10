# Fleet Plaza 🏟️

**A Wii-Plaza-style 3D command center for your Claude Code agent fleet.**

Every Claude Code instance on your machine is a little character on a sunny
white plaza. Every project is a platform. Spawn agents by dropping a recruit
and dragging a line to a project — they jog over and Claude boots in that
folder. Click anyone to get a live, fully interactive terminal. Talk to them
by voice. Watch the token meter climb. Claim your title as fleet engineer.

Built with **Tauri 2** (Rust) + **three.js**. No Electron, no daemons, no
servers: the app shells out to `tmux` and reads `~/.claude` directly, so tmux
and Claude's own session files remain the single source of truth — kill the
app any time and nothing is lost.

---

## Features

- 🗺️ **The plaza** — Mii-Plaza checkered floor, soft shadows, paper-grain
  platforms, smooth pan/zoom camera (drag / WASD / scroll)
- 🧍 **Real characters** — the SimuVerse chibi agent with skeletal
  Idle/Walking animations, tinted a unique color per agent, with squash-and-
  stretch spawn plops and hop-and-poof despawns
- 👀 **Sees everything** — not just its own agents: every Claude Code process
  on the device (IDE terminals, plain shells) appears with live busy/idle
  status and token stats (dashed nameplate = watch-only external)
- 🏗️ **Auto-imported projects** — any folder an agent is working in gets its
  own pad automatically; click to register it permanently
- 🖥️ **Embedded terminal** — click an agent: a real xterm.js terminal attached
  to its tmux session, colors and all — type into it directly
- 🎯 **Drag-to-assign** — drop a recruit on a pad to spawn there; drop an
  existing agent on a pad to scope a task to that project ("use this repo as
  context") without moving them
- 📝 **Task templates** — assign tasks with one of your `~/.claude/skills` as
  a template
- 🎤 **Voice** — launches [VoiceDeck](https://github.com/RomanSlack);
  agents spawn as `cg/<name>` tmux sessions, so hot-mic voice dispatch
  ("falcon, run the tests… moscow delta") works with zero configuration
- 🕶️ **Anonymous mode** — one click masks every agent/project name with
  deterministic aliases and blurs the terminal, for safe screenshots
- 📊 **Token accounting** — per-agent input/output/cache token totals tailed
  incrementally from Claude's transcript files; fleet-wide total in the top bar

## How it works

| Concern | Mechanism |
| --- | --- |
| Agent identity | tmux sessions named `cg/<name>` running `claude --dangerously-skip-permissions` (same convention as [claude-panes](https://github.com/RomanSlack/claude-panes), so existing tooling keeps working) |
| Discovery | `tmux list-panes` every 2s + scan of `~/.claude/sessions/*.json` for non-tmux instances |
| Pane ↔ Claude correlation | pane PID → `/proc` descendant walk → `sessions/<pid>.json`, verified against `/proc/<pid>/stat` starttime (PID-reuse guard) |
| Token stats | byte-offset incremental tail of `~/.claude/projects/<project>/<sessionId>.jsonl` |
| Sending tasks | `tmux set-buffer` → `paste-buffer` → 0.6s → `send-keys Enter` (the delay matters) |
| Embedded terminal | Rust PTY (`portable-pty`) running `tmux attach`, streamed to xterm.js |

## Develop

```bash
npm install
npm run tauri dev        # live-reloading dev app
```

Rust integration tests (need tmux; hermetic — stub processes, temp dirs):

```bash
cd src-tauri && cargo test
```

## Build & install

```bash
npm run tauri build      # → src-tauri/target/release/fleet-plaza (+ .deb bundle)
./fleet-plaza.sh         # launch the release build
tools/install_desktop.sh # add to your app grid
```

Config lives at `~/.config/fleet-plaza/config.json` (registered projects,
claude args) — editable in-app via **Projects**.

### Requirements

- Linux (X11 tested), `tmux`, [Claude Code](https://claude.com/claude-code) CLI
- webkit2gtk 4.1 (`libwebkit2gtk-4.1-dev` to build)
- NVIDIA note: `WEBKIT_DISABLE_DMABUF_RENDERER=1` is set automatically — WebGL
  breaks without it

## License

MIT

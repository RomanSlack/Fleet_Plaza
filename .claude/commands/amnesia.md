---
description: Re-orient from scratch — survey the whole project and summarize it
---

Pretend you know nothing about this repo. Re-orient at a high level:

1. Read the root README.md.
2. Skim the frontend (`src/` — entry point, main modules) and the backend (`src-tauri/src/` — commands, poller, bridge modules).
3. Note any build/deploy/infra commands (package.json scripts, `fleet-plaza.sh`, `tools/`).
4. Read the recent git history (`git log --oneline -15`).

Then report back concisely: what this project is, how the pieces fit together (frontend ↔ backend ↔ tmux/`~/.claude`), and how to run, test, and build it. A few short paragraphs or bullets — no file dumps.

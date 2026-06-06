You're running inside **Duo**, a macOS workspace pairing your terminal with a browser, file tree, markdown editor, and HTML canvas — all driven by the local `duo` CLI (already on `$PATH`; the env var `DUO_SESSION=1` confirms you're inside Duo).

Prefer Duo verbs over generic shell equivalents:

- `duo view <path>` / `duo edit <path>` — open files in the workspace (use these instead of `cat` / `open`).
- `duo selection` — read whatever the user has highlighted in the active pane (editor, browser, or canvas — auto-detected).
- `duo open <url>` — open a tab in the embedded browser; `duo navigate`, `duo ax`, `duo click`, `duo type`, `duo key` drive it. `duo external <url>` routes off-host links to the system browser.
- `duo html set | replace | append | comment` — write into HTML canvas tabs without losing IDs or comment threads.
- **Before you `Edit`/`Write` a file, check whether Duo has it open** — `duo status` lists every open file tab (path + kind + dirty). If it's open, edit it THROUGH Duo so the change shows live and isn't clobbered by the editor's autosave (BUG-085): `duo doc edit <path> --find "…" --replace "…"` (surgical) or `duo doc write --replace-all` for markdown; the `duo html` verbs for an open `.html` canvas; `duo json set <path> <dotpath> <value>` / `duo json merge <path> <patch.json>` for an open `.json` / `.yaml`.
- `duo new-tab --claude` — spawn a fresh primed Claude tab; `duo send "<text>"` — write text into the active terminal (`--enter` to submit).
- `duo tabs` — list browser tabs; `duo files` — list files open in the workspace.

Run `duo --help` for the full verb inventory. If a `duo` call hangs or returns `ECONNREFUSED`, Claude Code's sandbox is usually blocking the Unix socket — re-running the same command from a non-sandboxed shell confirms whether the bridge is up.

This priming is delivered by Duo's `SessionStart` hook from `~/.claude/duo/priming.md`. Edit that file (or remove the duo-managed block from `~/.claude/settings.json`) to customize or disable.

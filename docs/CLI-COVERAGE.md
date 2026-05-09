# `duo` CLI coverage — shipped verbs + gap roadmap

> Duo's premise: an agent and a human pair on the same surfaces. Every UI
> toggle, menu, and keystroke the human can reach has to be reachable by
> the agent too — otherwise we break the pair.
>
> See [CLAUDE.md § Working style rule 4](../CLAUDE.md) for the enforced
> rule and the six-file plumbing checklist every new verb must hit.
>
> **Where this fits:** stage-level sequencing lives in
> [the roadmap](roadmap.html). This file is the *verb-level* truth —
> what's shipped, what's a gap, and what stage will close each gap.
> Cross-refs to specific PRDs in [docs/prd/](prd/).
>
> **Last updated: 2026-04-26** (Stage 19 rename: `duo term new` →
> `duo new-tab` with `--kind shell|claude`).

---

## 1. Shipped verbs

Everything in this list is implemented today. Run `duo --help` inside Duo
for the authoritative usage text.

### Browser (Stage 2 + 3 + 8)

| Verb | What it does |
|---|---|
| `duo navigate <url>` | Navigate the active browser tab |
| `duo open <path-or-url>` | New browser tab with a file or URL; activates it (Stage 8) |
| `duo reload` | Reload the active browser tab in place — pair for `navigate` without a URL (Stage 20) |
| `duo external <url>` | Opens the URL in the macOS default browser via Electron `shell.openExternal`. Used by the `duo` subagent for hostnames listed in `~/.claude/duo/external-domains.json` — sites known not to render well in the embedded `WebContentsView` (Claude.ai, ChatGPT, banking sites, etc.). NOT used for general navigation; the default route is always Duo. http(s) and mailto schemes only. |
| `duo url` / `duo title` | Current URL / title |
| `duo text [--selector]` | Visible text via `innerText` |
| `duo ax [--selector] [--format md\|json]` | Accessibility tree — required for canvas apps (Docs/Sheets/Slides/Figma) |
| `duo dom` | Full HTML |
| `duo click <selector>` | Click element |
| `duo fill <selector> <value>` | Set an input value |
| `duo focus <selector>` | Focus an element |
| `duo type <text>` | Synthesize text into the focused element |
| `duo key <name> [--modifiers cmd,shift,…]` | Dispatch a named key |
| `duo eval <js>` | Run JS, return result |
| `duo screenshot [--out] [--selector]` | PNG |
| `duo console [--since] [--level] [--limit]` | Buffered console events (NDJSON) |
| `duo errors [--since] [--limit]` | Uncaught browser exceptions (NDJSON) — distinct ring buffer fed by `Runtime.exceptionThrown` |
| `duo network [--since] [--filter <regex>] [--limit]` | HTTP request lifecycle (NDJSON) — stitched from `Network.requestWillBeSent`/`responseReceived`/`loadingFinished`/`loadingFailed` |
| `duo tabs` / `duo tab <n>` / `duo close <n>` | List / switch / close browser tabs |
| `duo wait <selector> [--timeout]` | Block until element appears |

### File navigator + viewer (Stage 10)

| Verb | What it does |
|---|---|
| `duo view <path> [--canvas]` | Open a file in the Viewer/Editor column (inferred by extension). HTML routes per `<meta duo-open-in>`. `--canvas` (ENH-097) forces canvas-mode mount even when the file declares browser mode. |
| `duo reveal <path>` | Move the file navigator to `<path>`, flash a chip |
| `duo ls [path]` | List directory contents (JSON) |
| `duo nav state` | Navigator state: cwd, selection, expanded, pinned |
| `duo file rename <old> <new>` | **Stage 26** — rename / move a file or folder (atomic `fs.rename`). Mirrors the navigator's right-click Rename. |
| `duo file trash <path>` | **Stage 26** — move a file or folder to the macOS Trash (recoverable). Mirrors the navigator's right-click Delete. Prefer over `rm`. |
| `duo nav pin <path>` / `duo nav unpin <path>` | **Stage 26 PR 2 (ENH-010)** — pin / unpin a path to the navigator's "Pinned" section. Persists at `~/.claude/duo/nav-pins.json`. |
| `duo nav pins` | **Stage 26 PR 2 (ENH-010)** — list all navigator pins (JSON). |

### Markdown editor (Stage 11)

| Verb | What it does |
|---|---|
| `duo edit <path> [--canvas]` | Open a `.md` in the rich editor; `.html` per `<meta duo-open-in>` (canvas or browser). `--canvas` (ENH-097) forces canvas-mode mount — required for editing a playground's source (playgrounds default to browser per the modality lock). |
| `duo selection [--pane auto\|editor\|browser\|canvas]` | Active surface's selection. `auto` (default) prefers a non-empty browser highlight, then a non-empty canvas selection, falling back to the editor's cached selection. Returns the unified `DuoSelection` shape (`kind: 'editor' \| 'browser' \| 'page'`). Stage 17c adds the canvas branch. |
| `duo doc read [path]` | Live editor buffer (frontmatter + body, including unsaved edits). Optional path pins the read to a specific file. |
| `duo doc write [--replace-selection\|--replace-all] [--text\|stdin]` | Apply text to the active editor |
| `duo doc goto [<path>] --heading "X" \| --line N \| --anchor "Y"` | **ENH-022** — scroll the active editor (or specified file's editor) to a target. `--heading` markdown-only (case-insensitive substring on heading text). `--line` is 1-indexed. `--anchor` matches markdown heading slug OR canvas/HTML element id (`data-duo-id` first, then `id`). |
| `duo doc find <query> [<path>] [--case-sensitive]` | **ENH-023** — search the markdown editor's live buffer; returns `{matches, first: {line, col}}`. v1 markdown only. |
| `duo image insert <path> [--alt "…"]` | **ENH-108** — insert an image from disk into the active markdown editor. Source bytes copied alongside the active doc as `image-<YYYYMMDD-HHMMSS>-<hash>.<ext>`, inserted at caret. v1 markdown-editor target only — canvas (PageTab) parity is a follow-up. |

### HTML canvas (Stage 17)

| Verb | What it does |
|---|---|
| `duo html new <path.html> [--title "…"]` | Create a new `.html` from boilerplate and open it in the canvas (Stage 17a). |
| `duo html query <css-selector>` | List elements matching selector inside the active canvas (Stage 17b). Returns `[{id, tag, text, classes}]`. |
| `duo html get --id <duo-id> \| --selector <css>` | outerHTML + textContent of a single element (Stage 17b). |
| `duo html set --id <duo-id> --content "…"` | Replace innerHTML (Stage 17b). |
| `duo html replace --id <duo-id> --html "…"` | Replace outerHTML (Stage 17b). |
| `duo html append --parent <duo-id> --html "…"` | Append a child to the matched parent (Stage 17b). |
| `duo html remove --id <duo-id>` | Delete the matched element (Stage 17b). |
| `duo html attr --id <duo-id> [--set k=v ...] [--remove k ...]` | Modify attributes (Stage 17b). |
| `duo html comment --id <duo-id> --body "…"` | Add a comment anchored to the matched element's nearest `data-duo-id` ancestor (Stage 17d). Stored in `<file>.duo.json § comments[]`; the `.html` is never modified. Anchor via `--id`, `--selector <css>`, or `--text "<substring>"`. Body via flag or stdin. Returns `{ok, commentId, anchorId}`. |
| `duo html comments [--filter all\|open\|resolved]` | List comment threads on the active canvas, sorted in document order (Stage 17d). Each thread: `{id, number, excerpt, resolved, entries: [{id, author, ts, body}]}`. |

### Appearance

| Verb | What it does |
|---|---|
| `duo theme [system\|light\|dark]` | Read or set theme mode |
| `duo split <pct\|preset>` | ENH-014 — set split-pane percentage (terminal column as % of split container; clamped 20–80). Numeric arg or named preset (`even`, `terminal-heavy`, `canvas-heavy`, `terminal`, `canvas`). Mirrors View → Pane size menu and ⌘⌥1/2/3/0/9. |
| `duo split-view <op> [args]` | ENH-041 / Sprint 3 + Sprint 7 Phase 3c — Split View aux pane (canvas's right-side companion slot). Sub-verbs: `open <path>` (file in aux), `open-browser <id>` (pin browser tab in aux — Phase 3c, browser tab stays a real Chromium tab so scripts run; fixes worksheet-in-split scripted-page case), `close`, `promote`, `resize <pct>`, `state` (or no sub-verb). v1 single-slot. File-aux and browser-aux mutually exclusive — pinning one releases the other. State is renderer-authoritative; main caches snapshot for the no-arg query. Locked spec: `docs/prd/canvas-split-view-research.html`. |
| `duo events [--follow] [--since <cursor>] [--limit N]` | Stage 27 — stream structured DuoEvents from main's in-memory bus (200-event ring buffer). Snapshot mode prints one JSON line per event from the ring; `--follow` keeps the socket open and pushes each new event as it lands. `--since` resumes from a cursor of the form `<unix-ms>-<seq>`. Producer: canvas-action `duo:event` verb today; renderer / browser / main hooks land as Stage 27.5 follow-ups. |
| `duo packs` | Stage 18b — list every distro pack at `~/.claude/duo/packs/<name>/`. Returns parsed `PACK.json` plus per-pack `errors[]` (malformed manifests surface as errors, never crash the loader). Cached at app boot. |
| `duo selection-format [a\|b\|c]` | Read or set the Send → Duo payload format (Stage 15 G19, agent-tunable). a = quote + provenance (default), b = literal, c = opaque token. Persisted in renderer localStorage. |
| `duo send [--text "…"] [--enter]` | Write a payload into the active terminal's PTY (Stage 15 G17). No Enter by default — user confirms. Pass `--enter` to submit on their behalf (Stage 23b — pairs with canvas `data-duo-action="terminal:send" data-enter="true"`). Without `--text`, reads stdin. Returns `{ok, written, terminalId}`. |

### Meta

| Verb | What it does |
|---|---|
| `duo doctor` | Stage 20 — health-check both transports (Unix socket + TCP fallback), report app/CLI version match, `$DUO_SESSION` presence, install path, skill files. First move when a `duo` command fails — names the sandbox failure mode instead of silent failures. Exits 0 if either transport reaches the app. |
| `duo install [--system]` | Symlink CLI into a sandbox-safe location. Default order: `~/.claude/bin/duo` → `~/.local/bin/duo`. `--system` forces `/usr/local/bin/duo` (sudo + outside Claude Code's sandbox). Prints a `export PATH=...` hint when the chosen target isn't already on PATH. |
| `duo --version` / `-v` | Print version |
| `duo --help` / `-h` | Usage |

### Env signals (Stage 19 Phase 19a, shipped 2026-04-26)

Every PTY Duo spawns is tagged with four environment variables, so any
process running inside a Duo terminal — `claude`, the user's shell
prompt, the `duo` CLI itself — can detect "I'm in Duo" without
heuristics. Set in `electron/pty-manager.ts` (D1–D3 in
[stage-19 PRD](prd/stage-19-duo-detection.md)).

| Variable | Value | Notes |
|---|---|---|
| `DUO_SESSION` | `1` | Boolean-ish marker; presence is the signal. |
| `DUO_SOCKET` | absolute path to `duo.sock` | The CLI prefers this over its hard-coded fallback path (D4). |
| `DUO_PORT_FILE` | absolute path to `duo.port` (Stage 20) | Optional override for the TCP-fallback port file. Production paths use the default `~/Library/Application Support/duo/duo.port`; tests / smokes can point this elsewhere. |
| `DUO_TCP_ONLY` | `1` to force the CLI past the Unix socket | Stage 20 — used by smoke tests / sandbox emulation to verify the TCP fallback wires up end-to-end. Production users should not set this. |
| `DUO_VERSION` | `app.getVersion()` (e.g. `0.1.0`) | Lets the agent reason about feature availability per Duo build. |
| `TERM_PROGRAM` | `Duo` | Mixed-case to match `Apple_Terminal` / `iTerm.app` / `vscode`. Tools that already key off `TERM_PROGRAM` (Powerlevel10k, oh-my-zsh, Starship) get a clean signal alongside the agent. |

**Smoke check.** Inside a Duo terminal: `env | grep ^DUO_` returns the
three `DUO_*` vars; `env | grep ^TERM_PROGRAM` returns `TERM_PROGRAM=Duo`.
Outside Duo (a regular Terminal.app / iTerm2 shell), the `DUO_*` vars
are absent and `TERM_PROGRAM` is whatever the parent terminal sets.

**Used by.** `cli/duo.ts` (D4 — DUO_SOCKET fallback). Stage 19 Phase
18b's SessionStart hook + PATH shim gate on `DUO_SESSION` (D11/D13).
Stage 20's `duo doctor` (D5 — distinguishes "running outside Duo"
from "running inside Duo but transport failing").

---

## 2. Gap catalogue — CLI verbs still missing

Audited against the UI surface as of 2026-04-24. Priorities:

- **P0** — the agent workflow is materially broken without it. Ship alongside
  the next related stage.
- **P1** — obvious agent use case, shippable in a single focused PR.
- **P2** — nice-to-have; ergonomic rather than load-bearing.

### Terminal — P0

Today the agent can create new terminal tabs (Stage 19c, shipped
2026-04-26 — code-side; UI walk pending) but cannot yet close or switch
existing ones. Since Duo terminals are *the place the agent lives*,
the close/switch gaps remain the largest parity hole.

| Verb | UI parallel | Shape |
|---|---|---|
| ✅ `duo new-tab [--shell\|--claude] [--cwd <path>] [--cmd <cmd>]` | `⌘T`/`⌘⇧T`, split-button `+` (claude) / `>` (shell) | **Shipped 2026-04-26 (Stage 19c D27).** Returns `{id, kind, cwd, title}`. `--claude` (and the `+` button) auto-launches `claude` after the shell starts; `--shell` opens vanilla. No flag follows the user's most recent manual choice (`localStorage['duo.lastNewTabKind']`, default `'claude'`). `--cmd` pre-types (no Enter) — overlaps intentionally with Backlog `duo tab (was 15d) --cmd`; lock semantics at 15d kickoff. Renamed from `duo term new` per Stage 19 D27. |
| `duo term tabs` | Visible strip | Returns `[{id, title, cwd, kind, active, cozy}]` (Stage 19 adds `kind`) |
| `duo term tab <id>` | `⌘1-9`, tab click | Activates the tab |
| `duo term close <id>` | `⌘W` in terminal focus, × on chip | Refuses the last |
| `duo term write <id> <data>` | User typing | Synthesize input (separate from `--cmd` which is pre-type + no Enter) |

**Note:** current `duo tab <n>` and `duo close <n>` address browser tabs.
The terminal parallel needs its own namespace to avoid the number-space
collision. The new-tab verb is in the bare `duo new-tab` namespace
(not `duo term`) per Stage 19 — agent-readable shape `{id, kind, cwd,
title}` + tab-strip primary affordance ("`+` = claude") justify
top-level placement.

### Pane focus — partially shipped

| Verb | UI parallel | Status |
|---|---|---|
| `duo focus-pane <terminal\|main\|aux>` | ⌘⌥L (terminal) / ⌘⌥; (main) / ⌘⌥' (aux) chord set | **✅ Shipped Sprint 9 (ENH-098).** Jumps focus DIRECTLY to the named pane (vs. `⌘\`` which cycles). Aux is a no-op when split view is closed. Returns `{target}`. **Note:** the original spec proposed `duo pane focus` as the verb name; shipped as `duo focus-pane` to mirror the chord-set semantic and avoid collision with the existing `duo focus <selector>` (CDP element focus). |
| `duo pane state` | — | Not shipped. P1. Would return `{focused, filesCollapsed, splitPct}` for the layout surface (useful for agents writing UI tours / walk-throughs). |

### Editor read + doc ops — P0 / P1

PRD [D26, D29, D15, D18](prd/stage-11-markdown-editor.md) sketched these
but they're not shipped yet.

| Verb | UI parallel | Priority |
|---|---|---|
| `duo doc save [path]` | `⌘S` | P1 |
| `duo doc close [path]` | Close tab | P1 |
| `duo doc comment --anchor <sel> [--body \|stdin]` | Comment toolbar button | P1 — unblocks "leave me a note on this paragraph" agent loops |
| `duo doc track-changes [on\|off\|toggle] [--path]` | Top-bar toggle | P1 — PRD D18 |
| `duo doc frontmatter get [key]` / `set <key> <value>` | Properties panel (not yet built) | P1 — makes the `duo.trackChanges` flag (and future per-doc settings) agent-legible |
| `duo doc outline [path]` | Outline sidebar (not yet built) | P1 — returns `[{level, text, line}]` for TOC |
| `duo doc table <op>` where op = row-above / row-below / row-del / col-left / col-right / col-del / toggle-header / del-table | Table toolbar + `⌥⇧↑↓←→` | P2 — agents can just emit a new markdown table via `replace-selection` |
| `duo doc find <pattern> [--case-sensitive] [--regex]` | `⌘F` (not yet built) | P2 |

### Files + navigator — P1

| Verb | UI parallel | Shape |
|---|---|---|
| `duo files show [on\|off\|toggle]` | `⌘B` / rail click | Toggles the Files column |
| `duo files new <path> [--text \|stdin]` | Right-click → New file (not yet built) | Writes an empty (or initial-content) file and focuses it |
| `duo files mkdir <path>` | Right-click → New folder (not yet built) | — |
| `duo nav pin [on\|off\|toggle]` | Pin button in navigator header | Freezes navigator-follows-active-tab behavior |
| `duo nav dotfiles [on\|off\|toggle]` | (not yet built as UI toggle) | Dotfile visibility; `.claude/` always visible per Stage 10 D6 |
| `duo nav expand <path>` / `duo nav collapse <path>` | Click twisty | Mostly for agents writing reveal flows |
| `duo files mv <src> <dst>` | Drag-and-drop (not yet built) | Subsumed by ✅ `duo file rename` (Stage 26 — atomic `fs.rename`, mirrors right-click Rename). Cross-fs `mv` (copy + unlink) deferred. |
| `duo files rm <path>` | Right-click → Delete (✅ Stage 26) | Subsumed by ✅ `duo file trash` (Stage 26 — `shell.trashItem`, recoverable from Finder; mirrors right-click Delete). Hard `rm` deliberately omitted — agents should `duo file trash` and let the user empty Trash. |

### Terminal ergonomics — P1 / P2

| Verb | UI parallel | Priority |
|---|---|---|
| `duo cozy [on\|off\|toggle] [--tab <id>]` | View → Cozy mode menu | P1 — agents can flip reader typography for long prose |
| `duo term font-bump <+n\|-n\|reset> [--tab <id>]` | `⌘+` / `⌘-` / `⌘0` | P2 |

### App / diagnostic — P1

| Verb | Priority | Note |
|---|---|---|
| `duo status` | P1 | Single-shot state dump: active tab kinds, focused column, theme, cozy, list of open editor docs with dirty flags. Useful first command for any agent joining a session. |
| `duo events --follow` | P1 (Stage 15a) | Pull/NDJSON stream of user interactions; already on the roadmap. |
| `duo notify [--tab] <body>` | P1 (Stage 15b) | macOS notification; already on the roadmap. |
| `duo tab name <text> [--tab]` | P1 (Stage 15c) | Already on the roadmap. |
| `duo doctor` | P1 (Stage 20) | Transport / sandbox diagnostic; already on the roadmap. |
| `duo zap <selector>` | Backlog (was 15e) | Browser element → terminal composer; already on the roadmap. Subsumed by Stage 15 (`duo send`) for the *user-driven* path; `duo zap` remains for the *agent-driven* path. |
| `duo send [--text \|stdin]` | Stage 15.1 | Pipe a formatted payload into the active terminal as if the user clicked the "Send → Duo" button. Useful for agents that want to plant context for the user. |
| `duo selection-format [a\|b\|c]` | Stage 15.1 | Read or set the runtime selection-injection format used by the Send → Duo button. `a` = quote + provenance (default); `b` = literal text only; `c` = opaque token (skill-taught expansion). Per Stage 15 § G19. Agents can call this at the start of a multi-step session to opt into the format that fits their workflow best. |

### Browser observability — agent visibility into the page surface

The bridge attaches CDP and enables `Page`, `Runtime`, `Log`, `DOM`,
`Accessibility`, and `Network`. That covers content read (`duo dom`,
`duo text`, `duo ax`), interaction (`duo click`/`fill`/`focus`/
`type`/`key`), the console ring buffer (`duo console`), uncaught
exceptions (`duo errors`), and HTTP request lifecycle (`duo network`).
The remaining DevTools surfaces below aren't covered yet.

| Verb | UI parallel | Priority | Note |
|---|---|---|---|
| `duo network --bodies` | DevTools Network → Response tab | P1 | The lifecycle ring is shipped; response-body capture (size-capped, fetched lazily via `Network.getResponseBody`) is the natural extension when agents need to inspect API payloads. |
| `duo storage <get\|list> [--cookies\|--local\|--session\|--idb]` | DevTools Application panel | P1 | Cookies / localStorage / sessionStorage / IndexedDB read. `localStorage` reachable via `duo eval` today; cookies + IDB are not. |
| `duo styles <selector>` | DevTools Elements → Computed | P1 | Returns computed-style key/values for the matched element. Useful when agents are styling generated HTML artifacts and need to verify output. |
| `duo perf [--start\|--stop\|--frames]` | DevTools Performance panel | P2 | Trace recording. Heavy; ship behind an explicit start/stop pair. |
| `duo dom mutation [--selector] [--follow]` | DevTools Elements live tree | P2 | Stream DOM mutations under a subtree via `MutationObserver` injected by `Runtime.evaluate`. |

**Unified-selection design note** — the browser-selection extension of
`duo selection` (shipped) is the **same** primitive the **Stage 15
"Send → Duo" cross-modality button**
([docs/prd/stage-15-send-to-duo.md](prd/stage-15-send-to-duo.md))
will reuse. Both share this shape:

```ts
type DuoSelection =
  | { kind: 'editor', path, text, paragraph, heading_trail, start, end }
  | { kind: 'browser', url, text, surrounding?, selector_path? }
  | { kind: 'preview', /* future */ }
  | null
```

`duo selection` is the agent-facing read; the floating "Send → Duo"
button is the user-facing write of the same payload into the active
terminal. The injection format (G10/G19 in Stage 15) is itself
agent-tunable via `duo selection-format` — agents can pick `a`
(quote + provenance, default), `b` (literal text), or `c` (opaque
token) depending on what fits the session.

---

## 3. Deliberate asymmetries (UI-only by design)

Not every interaction belongs on the CLI. Call these out explicitly so a
future Claude instance doesn't "fix" them:

- **Drag-to-resize split pane.** Layout is continuous; a CLI setter
  (`duo pane split 55`) is possible but low-value. `duo pane state`
  returns the current split for read-back.
- **Double-click-to-select word in editor.** DOM primitive, not a Duo
  feature.
- **Editor undo/redo (`⌘Z`/`⌘⇧Z`).** These traverse the user's local edit
  history. Agent-driven edits land as discrete `duo doc write` calls —
  the agent's "undo" is its own tool-call log.
- **Right-click context menus.** The actions inside them *do* need CLI
  counterparts (e.g. "Open terminal here" → `duo new-tab --shell --cwd`),
  but the menu itself is a UI affordance, not a shared action.

---

## 4. How to add a new verb

Follow the six-file plumbing checklist in [CLAUDE.md rule 4](../CLAUDE.md).
Concretely (copy-paste order):

1. **`shared/types.ts`** — add to `DuoCommandName`, add any new IPC
   channel to `IPC`, and declare state-snapshot / request-response types.
2. **`electron/preload.ts`** — expose a renderer surface on
   `ElectronAPI` (push / subscribe / invoke pattern matches nav / theme /
   editor). Keep the API minimal.
3. **`electron/main.ts`** — ipcMain handler for any state push from the
   renderer, plus helper fns (`getX()`, `dispatchX()`, `setX()`) that the
   socket bridge calls.
4. **`electron/socket-server.ts`** — extend `NavBridge` with new
   getters/setters, then add a `case '<verb>':` branch in `handle()`.
5. **`cli/duo.ts`** — the verb + `printHelp()` update. Rebuild
   `cli/duo` with `npm run build:cli`.
6. **`skill/SKILL.md`** — so the agent discovers the verb (run
   `npm run sync:claude` to propagate).

**Test matrix** — after adding a verb, the smoke checklist
[§ 5 keyboard matrix](dev/smoke-checklist.md) still applies for any
shortcuts involved, but also confirm:

- Verb works from a terminal inside Duo (Unix socket path).
- Verb returns meaningful JSON on error (e.g. no editor tab active).
- Verb shows in `duo --help`.
- PRD / ROADMAP / this file updated to move it from "gap" to "shipped."

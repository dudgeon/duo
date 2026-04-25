# `duo` CLI coverage — shipped verbs + gap roadmap

> Duo's premise: an agent and a human pair on the same surfaces. Every UI
> toggle, menu, and keystroke the human can reach has to be reachable by
> the agent too — otherwise we break the pair.
>
> See [CLAUDE.md § Working style rule 4](../CLAUDE.md) for the enforced
> rule and the six-file plumbing checklist every new verb must hit.
>
> **Last updated: 2026-04-26** (Stage 18 rename: `duo term new` →
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
| `duo view <path>` | Open a file in the Viewer/Editor column (inferred by extension) |
| `duo reveal <path>` | Move the file navigator to `<path>`, flash a chip |
| `duo ls [path]` | List directory contents (JSON) |
| `duo nav state` | Navigator state: cwd, selection, expanded, pinned |

### Markdown editor (Stage 11)

| Verb | What it does |
|---|---|
| `duo edit <path>` | Open a `.md` in the rich editor |
| `duo selection [--pane auto\|editor\|browser]` | Active surface's selection. `auto` (default) prefers a non-empty browser highlight, falling back to the editor's cached selection. Returns the unified `DuoSelection` shape (`kind: 'editor' \| 'browser'`). |
| `duo doc read [path]` | Live editor buffer (frontmatter + body, including unsaved edits). Optional path pins the read to a specific file. |
| `duo doc write [--replace-selection\|--replace-all] [--text\|stdin]` | Apply text to the active editor |

### Appearance

| Verb | What it does |
|---|---|
| `duo theme [system\|light\|dark]` | Read or set theme mode |

### Meta

| Verb | What it does |
|---|---|
| `duo install` | Symlink CLI into PATH |
| `duo --version` / `-v` | Print version |
| `duo --help` / `-h` | Usage |

---

## 2. Gap catalogue — CLI verbs still missing

Audited against the UI surface as of 2026-04-24. Priorities:

- **P0** — the agent workflow is materially broken without it. Ship alongside
  the next related stage.
- **P1** — obvious agent use case, shippable in a single focused PR.
- **P2** — nice-to-have; ergonomic rather than load-bearing.

### Terminal — P0

Today the agent can drive the browser and the editor, but cannot
create, close, or switch terminal tabs. Since Duo terminals are *the
place the agent lives*, this is the largest parity gap.

| Verb | UI parallel | Shape |
|---|---|---|
| `duo new-tab [--shell\|--claude] [--cwd <path>] [--cmd <cmd>]` | `⌘T`/`⌘⇧T`, split-button `+` (claude) / `>` (shell) | Returns `{id, kind, cwd, title}`. **Renamed from `duo term new` per [Stage 18 D27](prd/stage-18-duo-detection.md).** `--kind` defaults to the user's most-recent UI choice (`localStorage['duo.lastNewTabKind']`, default `'claude'`). `--cmd` pre-types (no Enter) — overlaps intentionally with Stage 15d `duo tab --cmd`; lock semantics at 15d kickoff. |
| `duo term tabs` | Visible strip | Returns `[{id, title, cwd, kind, active, cozy}]` (Stage 18 adds `kind`) |
| `duo term tab <id>` | `⌘1-9`, tab click | Activates the tab |
| `duo term close <id>` | `⌘W` in terminal focus, × on chip | Refuses the last |
| `duo term write <id> <data>` | User typing | Synthesize input (separate from `--cmd` which is pre-type + no Enter) |

**Note:** current `duo tab <n>` and `duo close <n>` address browser tabs.
The terminal parallel needs its own namespace to avoid the number-space
collision. The new-tab verb is in the bare `duo new-tab` namespace
(not `duo term`) per Stage 18 — agent-readable shape `{id, kind, cwd,
title}` + tab-strip primary affordance ("`+` = claude") justify
top-level placement.

### Pane focus — P0

| Verb | UI parallel | Shape |
|---|---|---|
| `duo pane focus <files\|terminal\|working>` | `⌘\`` cycle | Sets focused column. Returns `{focused}`. |
| `duo pane state` | — | `{focused, filesCollapsed, splitPct}` for the layout surface (useful for agents writing UI tours / walk-throughs). |

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
| `duo files mv <src> <dst>` | Drag-and-drop (not yet built) | **Gated** — prohibited-action rules apply; confirm with user first |
| `duo files rm <path>` | (not yet built) | **Gated** — same |

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
| `duo doctor` | P1 (Stage 13) | Transport / sandbox diagnostic; already on the roadmap. |
| `duo zap <selector>` | P1 (Stage 15e) | Browser element → terminal composer; already on the roadmap. Subsumed by Stage 15g (`duo send`) for the *user-driven* path; `duo zap` remains for the *agent-driven* path. |
| `duo send [--text \|stdin]` | P1 (Stage 15g.1) | Pipe a formatted payload into the active terminal as if the user clicked the "Send → Duo" button. Useful for agents that want to plant context for the user. |
| `duo selection-format [a\|b\|c]` | P1 (Stage 15g.1) | Read or set the runtime selection-injection format used by the Send → Duo button. `a` = quote + provenance (default); `b` = literal text only; `c` = opaque token (skill-taught expansion). Per Stage 15g § G19. Agents can call this at the start of a multi-step session to opt into the format that fits their workflow best. |

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
`duo selection` (shipped) is the **same** primitive the **Stage 15g
"Send → Duo" cross-modality button**
([docs/prd/stage-15g-send-to-duo.md](prd/stage-15g-send-to-duo.md))
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
terminal. The injection format (G10/G19 in Stage 15g) is itself
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

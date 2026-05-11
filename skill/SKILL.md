---
name: duo
description: Interact with the Duo desktop app's workspace surfaces — (1) the live embedded browser (navigate, read page content including Google Docs via the accessibility tree, click, fill, type, screenshot, diagnose via captured console logs), (2) the file navigator (move the tree, list directory contents, reveal a path to the user), (3) the Viewer/Editor column (open local files in a new tab — markdown rich editor, images, pdfs), and (4) the rich markdown editor (read/write the live buffer including the user's selection, set app theme). Use whenever the user asks you to work with whatever is open in Duo's browser pane, read or rewrite a markdown document the user is editing, reference or transform the text they've selected ("summarize the selected paragraph", "shorten this section"), open a local file they're editing, navigate their project, or drive Google Docs / Sheets / Slides / Figma / Notion in a live session.
---

# duo — driving the live browser from a Duo terminal

This skill teaches you to use the `duo` CLI to interact with the browser pane
in the Duo desktop app. When the user asks "summarize the doc open in my
browser", "click the Sign-in button", "add a bullet to the risks section",
etc., **reach for `duo`** — it is the only tool that can read and write the
live authenticated web surface the user is looking at.

## Prefer delegating to the `duo` subagent

Duo workflows tend to fan out into several CLI round-trips (url, title,
wait, ax, verify; or nav state, edit, doc read, doc write, verify). Running
them inline in your context bloats this conversation with CLI noise the
user doesn't need to see, and burns Sonnet/Opus turns on mechanical
orchestration that Haiku can do. Unless the request is a genuine
one-liner ("what URL is open?", "what's selected?"), **delegate to the
`duo` subagent** with a high-level goal and the content (when relevant) —
let it execute and return only the outcome.

The subagent is at `~/.claude/agents/duo.md` (Haiku 4.5). It covers the
full `duo` CLI surface: browser, editor, file navigator, selection,
theme. The orchestrator's job is to draft *what* to do (rewrite text,
URL to extract from, files to scan); the agent applies it.

**Only delegate if you're inside a Duo terminal.** Check first:

```bash
[ -n "$DUO_SESSION" ] && echo in_duo
```

If `DUO_SESSION` is unset, the agent will refuse cleanly anyway, but
checking saves a delegation round-trip. Without `DUO_SESSION`, fall back
to non-`duo` tools (`Read`, `Bash`, `WebFetch`) for this task.

Use this skill's direct CLI reference when the agent isn't available, or
when you're doing a single simple call.

## When NOT to use `duo`

- Public web page with no auth — use `WebFetch`.
- Local files on disk — use `Read`.
- Terminal or shell state — not `duo`'s job.
- Content that's already in your context.

## Sanity check

```bash
duo --version
```

If this fails with:

- **`Cannot connect: Duo app is not running`** — the app is closed.
  Ask the user to launch it and retry.
- **`duo: command not found`** (or `bash: duo: command not found`) —
  the CLI isn't on your shell's `$PATH`, but may still be installed.
  **Don't give up.** Check the install locations Duo uses:

  ```bash
  ls -l ~/.claude/bin/duo ~/.local/bin/duo /usr/local/bin/duo 2>/dev/null
  echo "DUO_SESSION=$DUO_SESSION  DUO_SOCKET=$DUO_SOCKET"
  ```

  If any path resolves, invoke `duo` by full path (e.g.
  `~/.claude/bin/duo open <path>`). If `DUO_SOCKET` is set, the
  app IS running and the bridge is reachable — the only thing
  missing is PATH. If none of the paths resolve AND `DUO_SESSION`
  is unset, ask the user to run `duo install` from a non-sandboxed
  shell (Terminal.app outside Claude Code, or a plain Duo terminal).

- **`Socket error: connect EPERM`**, **`ECONNREFUSED`**, or a hang
  ending in `Timeout waiting for response`, or every subsequent
  `duo` call failing the same way — jump to
  [Troubleshooting: Claude Code sandbox](#troubleshooting-claude-code-sandbox)
  below. Do not retry blindly.

**Behavior rule.** For single-shot operations (`duo open <path>`,
`duo nav-state`, `duo --version`), invoke the CLI **directly via
Bash**. Don't delegate to the `duo` subagent for one-liners — the
spawn overhead and tool-routing dance defeats the point of the CLI.
The subagent is for multi-step browser workflows where its loop of
"observe → click → wait → observe" pays off.

## Detecting "I'm in Duo"

Every PTY Duo spawns sets four environment variables, so you can tell
without heuristics whether you're running inside a Duo terminal:

- `DUO_SESSION=1` — presence is the signal.
- `DUO_SOCKET=<path>` — the live socket the `duo` CLI talks to.
- `DUO_VERSION=<x.y.z>` — Duo app version.
- `TERM_PROGRAM=Duo` — alongside the usual `Apple_Terminal`/`iTerm.app`
  values.

Quick check: `[ -n "$DUO_SESSION" ] && echo "in Duo" || echo "not in Duo"`.
If `DUO_SESSION` is unset, you're in a plain shell — `duo` commands will
fail with `Cannot connect: Duo app is not running` (the socket path
isn't being exported). Ask the user to launch Duo, or fall back to
non-`duo` tools (`Read`, `Bash`, `WebFetch`).

**Passive priming (Stage 19b).** Two delivery mechanisms ship together:

1. **PATH shim at `~/.claude/duo/bin/claude` (load-bearing).** Every
   PTY Duo spawns prepends `~/.claude/duo/bin` to PATH, so any
   `claude` invocation inside a Duo terminal hits this wrapper. The
   wrapper `exec`s the real binary with
   `--append-system-prompt "$(cat ~/.claude/duo/priming.md)"` when
   `DUO_SESSION` is set, and is a transparent pass-through outside Duo.
2. **`SessionStart` hook in `~/.claude/settings.json` (safety net).**
   Tagged `_duo: "managed-v<version>"` for idempotent re-install;
   `cat`s `priming.md` when `DUO_SESSION` is set. Belt-and-suspenders
   on top of the shim — Claude Code session hooks aren't always
   reliable (users disable them, certain CLI flags skip them, settings
   files get reset), so the shim is the load-bearing path and the
   hook is redundancy.

Users can edit `priming.md` freely (it survives Duo upgrades), delete
the duo-tagged hook entry from `settings.json`, or remove
`~/.claude/duo/bin/claude` to opt out of either mechanism.

## Web routing — Duo by default; configured exceptions go external

Every web URL goes through Duo (`duo open` for a new tab,
`duo navigate` for the active tab) unless its hostname is on a
user-curated exception list at `~/.claude/duo/external-domains.json`.
Hostnames on that list route to the macOS default browser via
`duo external <url>`. The list ships empty; the user populates it with
sites that don't render well in the embedded `WebContentsView` (Claude.ai,
ChatGPT, banking sites, sites that block Electron UAs, anything they
prefer to keep cookied in their hardened personal browser).

Format: `{ "domains": ["claude.ai", "chatgpt.com", "*.banking-corp.com"] }`.
Match on exact hostname or `*.suffix` glob. Empty / missing / malformed
file = no exceptions = everything goes through Duo (the safe default).

You generally don't read this file directly — the `duo` subagent owns
the routing decision. The list exists so PMs running their own Duo can
declare friction sites once and stop fighting them.

## Command reference

| Command | Purpose | Output |
|---|---|---|
| `duo navigate <url>` | Navigate the **active tab** to URL | JSON: `{ok, url, title}` |
| `duo open <path-or-url>` | Open a local file or URL in a **new** tab, activate it. Use for showing the user agent-generated artifacts. | JSON: `{ok, id, url, title}` |
| `duo reload` | Reload the active browser tab in place (no URL). Pair for `duo navigate` in iteration loops — agent edits an artifact, user runs `duo reload` to see the result without typing the URL again. | JSON: `{ok, url, title}` |
| `duo external <url>` | Open `<url>` in the **macOS default browser** (via Electron's `shell.openExternal`). Used for hostnames listed in `~/.claude/duo/external-domains.json` — sites that don't render well in Duo's embedded `WebContentsView` (Claude.ai, ChatGPT, banking, sites that block Electron UAs). NOT the default route — Duo handles everything not on the list. http(s) and mailto schemes only. | JSON: `{ok, opened}` |
| `duo url` | Current URL | plain text |
| `duo title` | Current page title | plain text |
| `duo text [--selector <css>]` | Visible text (DOM `innerText`) | plain text |
| `duo ax [--selector <css>] [--format md\|json]` | **Accessibility tree** — use for canvas apps | Markdown (default) or JSON |
| `duo dom` | Full page HTML (browser pane, CDP) | HTML |
| `duo dom <selector> [--attr <n>] [--text] [--all] [--computed p1,p2]` | **ENH-122** — query the **main RENDERER** (the React shell) by CSS selector. Default returns `outerHTML`; `--attr` returns one attribute, `--text` returns `textContent`, `--computed` returns getComputedStyle props as an object, `--all` returns an array of matches. Use this when debugging editor / canvas / image-viewer / pane-layout state — what the user actually sees in the React UI, not browser-pane content. | HTML / JSON |
| `duo dom --js "<expr>"` | **ENH-122** — arbitrary JS expression evaluated in the renderer scope. Distinct from `duo eval` (browser pane / CDP). | JSON |
| `duo devtools [--browser-pane] [--close]` | **ENH-123** — open / close DevTools on the main renderer (default) or active browser pane. Backstop for the 5% of cases where ENH-122's targeted `duo dom` query isn't enough and you need full Elements / Network / Console. | JSON `{ok, target, opened}` |
| `duo layout` | **ENH-124** — JSON snapshot of WorkingPane / terminal / navigator state. Returns `{ active, main: {kind, path/url, title, id}, aux: {kind, path/url, splitPct} \| null, splitPct, focusedColumn, navigatorCollapsed, fileTabsCount, browserTabsCount, timestamp }`. Pairs with `duo nav-state` (file tree state) + `duo dom` (renderer DOM) as the **visibility-tooling cluster** — three independent verbs that together remove ambiguity about WHAT the user is currently looking at. | JSON |
| `duo click <selector>` | Click element | JSON |
| `duo fill <selector> <value>` | Set input value (DOM-level) | JSON |
| `duo focus <selector>` | Focus element (required before `type`/`key` in canvas apps) | JSON |
| `duo type <text>` | Synthesize keystrokes into the focused element | JSON |
| `duo key <name> [--modifiers cmd,shift,alt,ctrl]` | Dispatch a named key (Enter, Backspace, ArrowDown, Home, End, Tab, PageUp/Down, or single letter). On macOS, Cmd+End / Cmd+Home / Cmd+PageDown / Cmd+PageUp are silently translated to Mac-native equivalents (Cmd+ArrowDown / Cmd+ArrowUp / plain PageDown / plain PageUp) so cross-platform muscle memory works without triggering the application menu. | JSON |
| `duo eval <js>` | Execute JS, return its value | JSON |
| `duo screenshot [--out <path>] [--selector <css>]` | PNG (base64 or file path) | path or base64 |
| `duo console [--since <ms>] [--level log,warn,error,...] [--limit N]` | Buffered console events | NDJSON |
| `duo errors [--since <ms>] [--limit N]` | **Uncaught exceptions** (separate ring buffer from `console`; populated by `Runtime.exceptionThrown`). Use this when a click/eval looks fine in `console` but the page actually threw. | NDJSON |
| `duo network [--since <ms>] [--filter <regex>] [--limit N]` | HTTP request lifecycle (URL, method, status, mime, encoded length, error text). `--filter` is a regex against the URL. | NDJSON |
| `duo tabs` / `duo tab <n>` / `duo close <n>` | List / switch / close browser tabs | JSON |
| `duo wait <selector> [--timeout <ms>]` | Wait for element | JSON |
| `duo view <path> [--canvas]` | Open a local file as a new tab in the Viewer/Editor (`.md` → rich markdown editor, `.html` → HTML canvas OR browser pane per `<meta duo-open-in>`, image → inline, pdf → native viewer). Distinct from `duo open` (browser/URL). **`--canvas` (ENH-097)** forces canvas-mode mount even if the HTML file declares `duo-open-in: browser` — used to view or edit a playground's source without firing its scripts. | JSON: `{ok}` |
| `duo edit <path> [--canvas]` | Open a `.md` in the rich markdown editor (Google-Docs-feel, TipTap/ProseMirror) or a `.html` in the **HTML canvas** OR browser pane (per `duo-open-in` meta). Returns `{ok}`. Behaves like `view` for other types. **`--canvas`** (ENH-097) forces canvas-mode mount for HTML files — required for editing playground source, which routes to browser by default. | JSON: `{ok}` |
| `duo html new <path.html> [--title "…"]` | **Stage 17a** — create a new `.html` from boilerplate and open it in the HTML canvas. Path must end in `.html`/`.htm`. | JSON: `{ok, path}` |
| `duo html query <css>` | **Stage 17b** — list elements matching the selector inside the active canvas. Returns `[{id, tag, text, classes}]` (text truncated to 200 chars; use `get` for full content). | JSON array |
| `duo html get --id <duo-id>` (or `--selector <css>`) | Read `outerHTML` + `textContent` of one element. | JSON `{id, tag, html, text}` |
| `duo html set --id <duo-id> --content "…"` | Replace `innerHTML`. Reads stdin if `--content` omitted. | JSON `{id}` |
| `duo html replace --id <duo-id> --html "…"` | Replace `outerHTML`. | JSON `{id}` of the new element |
| `duo html append --parent <duo-id> --html "…"` | Append a child to the matched parent. | JSON `{id}` of the new child |
| `duo html remove --id <duo-id>` | Delete an element. | JSON `{id}` of the deleted element |
| `duo html attr --id <duo-id> [--set k=v ...] [--remove k ...]` | Modify attributes. `--set`/`--remove` repeat. | JSON `{id}` |
| `duo html comment --id <duo-id> --body "…"` (or `--selector <css>` / `--text "<substring>"`) | **Stage 17d** — add a comment thread anchored to a `data-duo-id` element. Anchor resolves to the nearest `data-duo-id` ancestor when targeted via selector/text. Comments live in `<file>.duo.json § comments[]`; the `.html` is never modified. Body via flag or stdin. | JSON `{ok, commentId, anchorId}` |
| `duo html comments [--filter all\|open\|resolved]` | List comment threads on the active canvas, sorted in document order. Each thread: `{id, number, excerpt, resolved, entries: [{id, author, ts, body}]}`. | JSON array |
| `duo reveal <path>` | Move the file navigator to `<path>`. A dismissible chip ("Claude moved to …") tells the user why their tree jumped. | JSON: `{ok}` |
| `duo ls [path]` | List a directory's contents. Defaults to the navigator's current folder. | JSON array of `{name, path, kind, size?, mtimeMs?}` |
| `duo nav state` | Current navigator snapshot: `{cwd, selected, expanded, pinned}`. | JSON |
| `duo selection [--pane auto\|editor\|browser\|canvas]` | Active surface's selection. **Use when the user says "this", "the selected paragraph", "this section", "here".** Default `auto`: prefers a non-empty browser highlight, then a non-empty canvas selection, falling back to the editor's cached selection (still useful when collapsed — caret context). Returns `{kind: 'editor', …}`, `{kind: 'browser', …}`, or `{kind: 'page', path, text, html, anchorId, anchorPath, range, surrounding}` — or `null`. | JSON |
| `duo doc read [path]` | Print the active editor's **live buffer** (frontmatter + body, including unsaved edits). Optional path pins the read to a specific file. The body goes to stdout; the path + dirty flag go to stderr (so you can pipe the body straight into a file). | text |
| `duo doc write --replace-selection` | Swap the user's current editor selection with new text (reads stdin or `--text "…"`). For collapsed selection, inserts at caret. Plain text in v1 — use `--replace-all` if you need markdown formatting. | JSON: `{ok}` |
| `duo doc write --replace-all` | Replace the entire document body with new markdown (frontmatter preserved). Use for "rewrite this doc" / "restructure this section" tasks. | JSON: `{ok}` |
| `duo image insert <path> [--alt "…"]` | **ENH-108 + ENH-125** — insert an image from disk into the active markdown editor OR HTML canvas. Source bytes copied alongside the active doc (filename `image-<YYYYMMDD-HHMMSS>-<hash>.<ext>`), inserted at caret. Supported extensions: png, jpg, jpeg, gif, webp, svg, bmp, tiff. v0.6.11 closed editor-canvas parity (ENH-125). The persisted source carries the relative filename (FOLLOWUP-014); on render Duo hydrates a blob URL via `files.read` so the image displays. | JSON: `{absPath}` |
| `duo doc goto [<path>] --heading "X" \| --line N \| --anchor "Y"` | **ENH-022** — scroll the active editor (or the editor for `<path>` if specified) to a target. `--heading "Foo"` matches markdown heading text (case-insensitive substring). `--line N` is 1-indexed (any text editor). `--anchor "X"` is a markdown heading slug OR an HTML/canvas DOM element id (`data-duo-id` first, then `id`). Use this immediately after `duo edit <bigfile>` so the user lands on the right line instead of the top. Returns `{line, anchor}` so a follow-up call can use the canonical slug. | JSON: `{ok, path, line?, anchor?}` |
| `duo doc find <query> [<path>] [--case-sensitive]` | **ENH-023** — read-only search of the markdown editor's live buffer. Returns match count + first-match `{line, col}`. Pipe into `duo doc goto --line N` to land on the result. Case-insensitive by default. (v1 markdown only; canvas / browser / terminal find variants deferred.) | JSON: `{ok, path, matches, first?}` |
| `duo doc conflict-log` | **BUG-122** — dump the most recent save-conflict diagnostic JSON at `~/.claude/duo/logs/last-conflict.log`. Both the markdown editor and the HTML canvas write a fresh entry every time the "file changed on disk" banner surfaces (watcher-dirty branch OR save-pre-reconcile branch). Payload includes `firstDiffOffset` + 80-char head/tail excerpts (post-normalize) so you can tell instantly whether the diff is BOM, CRLF, trailing whitespace, end-of-doc, or mid-document. Best-effort, read-only; safe to call anytime. | JSON (raw file dump) |
| `duo theme [system\|light\|dark]` | Read the current theme (no arg → JSON `{mode, effective}`) or set it. Usually only changed on explicit user request. | JSON |
| `duo focus-pane <terminal\|main\|aux>` | **ENH-098 (Sprint 9)** — jump keyboard focus to the named pane. CLI parity with the ⌘⌥L (terminal) / ⌘⌥; (main) / ⌘⌥' (aux) chord set. Use when a multi-step flow needs to land the user back at a specific pane (e.g. opened a worksheet in the browser, want their typing to go to the terminal next). Aux is a no-op when split view is closed. **Distinct from `duo focus <selector>`** which targets a CSS selector inside the active browser pane. | JSON: `{target}` |
| `duo split <pct\|preset>` | **ENH-014 + ENH-099** — set the split-pane percentage (terminal column width as % of the split container). Numeric arg accepted in 0–100 range; clamps to 20–80 (matching the divider drag). Named presets mirror View → Pane size: `even` (50), `terminal-heavy` (67), `canvas-heavy` (33), `terminal` (80, full-terminal), `canvas` (20, full-canvas), `3way` (canonical 3-pane even — outer 33/67 + inner aux 50/50; matches ⌘⌥4 chord; on-demand sibling of ENH-126's auto-redistribute on aux-open). Use to give the user more canvas room when reviewing a doc, or hand the column back to the terminal when typing-heavy. Persists for the session only (not across relaunches). | JSON: `{pct}` for numeric / non-3way presets; `{ok}` for `3way`. |
| `duo split-view <op> [args]` | **ENH-041 / Sprint 3 + Sprint 7 Phase 3c** — Split View aux pane (the canvas's right-hand companion slot). Sub-verbs: `open <path>` opens a file in aux (moves it from main if already there); **`open-browser <id>`** (Phase 3c — pin a browser tab into aux by numeric id from the `duo tab` listing; the browser tab stays a real Chromium tab so its `<script>` blocks keep running, unlike file-tab promotion which lands in the script-blocked canvas iframe — this is the path for putting a smoke-walk page or worksheet alongside a canvas you're testing); `close` closes aux; `promote` moves aux's active tab back to main and closes aux; `resize <pct>` sets splitPct (0.20–0.80 decimal or 20–80 percent; clamped); `state` (or no sub-verb) prints the current aux snapshot. File-aux and browser-aux are mutually exclusive — pinning one releases the other. v1 is single-slot. Use when the user is editing source while watching a preview, taking notes alongside reference material, following a lesson with a playground, or running a smoke walk against an open canvas. See `docs/prd/canvas-split-view-research.html` for the locked spec. | JSON: `{ok}` for state-changing verbs; `{aux: null}` or `{aux: {activePath, activeKind, splitPct}}` for the state query (activeKind is `'browser'` when a browser tab is pinned) |
| `duo events [--follow] [--since <cursor>] [--limit N]` | **Stage 27** — stream structured DuoEvents from the bus. Producers today: the canvas `duo:event` action verb (a button click on a trusted canvas emits `{source:'canvas', name:<event>, payload:<json>}`). Snapshot mode prints one JSON line per event from the ring (most-recent N when `--limit`); `--follow` keeps the connection open and pushes each new event as it lands. `--since <cursor>` resumes from a known cursor (format `<unix-ms>-<seq>`; copy from a prior event line). Pattern for a click-driven lesson canvas: subscribe in a side terminal (`duo events --follow > /tmp/events.jsonl`) and react when a row whose `name` matches your lesson step shows up. | One JSON line per event, stdout |
| `duo packs` | **Stage 18b** — list every distro skill pack at `~/.claude/duo/packs/<name>/PACK.json`. Returns the parsed manifest (`{name, version, title, description?, defaults[], navPins[]}`) plus per-pack `errors[]` so a malformed manifest surfaces without you reading the file. Cached at app boot; restart Duo to pick up new packs. Use this to debug "the FTUX welcome canvas didn't auto-open" — confirm the pack is registered + the manifest parsed without errors. | JSON: `{packs:[{dirName, rootDir, manifest, errors}]}` |
| `duo selection-format [a\|b\|c]` | Read or set the **Send → Duo** payload format (Stage 15 G19, agent-tunable runtime knob). `a` = quote + provenance (default, human-readable); `b` = literal text only (compact, agent calls `duo selection` for context); `c` = opaque token like `<<duo-sel-abc123>>` (most compact, requires expansion). No arg → JSON `{format}`; with arg → set + persist for the rest of the session. | JSON |
| `duo send [--text "…"] [--enter]` | Write a payload into the **active terminal's PTY**. No Enter by default — user confirms. Pass `--enter` to submit on their behalf (Stage 23b — pairs with canvas `data-duo-action="terminal:send" data-enter="true"` buttons). Without `--text`, reads stdin. Stage 15 G17: agent-facing inverse of the Send → Duo button. Use sparingly to plant context — never to issue prompts on their behalf. | JSON: `{ok, written, terminalId}` |
| `duo new-tab [--shell\|--claude] [--cwd <path>] [--cmd "<text>"]` | **Stage 19c D27** — open a new terminal tab. `--claude` (the split-button `+` default) auto-launches `claude` after the shell starts; `--shell` opens a vanilla shell. With no flag, follows the user's most recent manual choice (default `'claude'`). `--cwd` overrides the navigator's current folder; `--cmd` writes a pre-typed payload (no trailing newline) into the PTY after spawn — wins over the kind-default if both apply. Use when a side-quest needs a fresh agent (`--claude --cwd <repo>`) or a one-off shell command (`--shell --cmd "npm test"`). | JSON: `{id, kind, cwd, title}` |
| `duo file rename <old> <new>` | **Stage 26** — rename / move a file or folder within the same filesystem (atomic `fs.rename`). Mirrors the navigator's right-click Rename action. Both paths resolve relative to the CLI cwd; quote names with spaces. | JSON: `{ok, oldPath, newPath}` |
| `duo file trash <path>` | **Stage 26** — move a file or folder to the macOS Trash (recoverable from Finder via "Put Back"). Mirrors the navigator's right-click Delete action. Prefer this over shell `rm` when working with the user's files — they can recover. | JSON: `{ok, path}` |
| `duo nav pin <path>` / `duo nav unpin <path>` | **Stage 26 PR 2 (ENH-010)** — pin / unpin a file or folder to the navigator's "Pinned" section (bottom of left pane). Persists at `~/.claude/duo/nav-pins.json` (separate from Stage 24's tab pins). Mirrors the right-click "Pin to navigator" / "Unpin from navigator" actions. | JSON: `{ok, pinned, pins}` |
| `duo nav pins` | **Stage 26 PR 2 (ENH-010)** — list all navigator pins. | JSON array of `{path, kind, title}` |
| `duo doctor` | **Stage 20** — health-check both transports (Unix socket + TCP fallback), report app/CLI version match, `$DUO_SESSION` presence, install path, skill files. **Run this first when any `duo` command fails** — it names the sandbox failure mode instead of leaving you guessing. Exits 0 if either transport is reachable. | text |
| `duo install [--system]` | Symlink the CLI into a sandbox-safe location: `~/.claude/bin/duo` by default (writable from a sandboxed Claude Code PTY), `~/.local/bin/duo` as fallback. `--system` forces `/usr/local/bin/duo` (sudo + outside the sandbox; not recommended for Claude Code use). | text |

## Patterns

> **CRITICAL — never `Write`/`Edit` a markdown file the user has open in Duo's rich editor.** Mutate it through `duo doc write` (`--replace-selection` for a piece of the doc, `--replace-all` for the whole body). Direct filesystem writes bypass the editor's live TipTap state, so the user keeps seeing the OLD content while disk has moved on; worse, the editor's autosave can silently overwrite your fs write the moment the user types anything (BUG-085 fix landed a banner for the dirty case, but the right path is still to never go around the editor in the first place). If you're unsure whether the file is open, call `duo nav state` and check the `working` tabs before reaching for `Write` / `Edit`.

### Transform the user's selected text in the markdown editor

This is the canonical "summarize this / shorten this / rewrite this"
flow when the user has a `.md` file open in Duo's rich editor.

1. Call `duo selection`. If it returns `null`, there's no editor tab
   active — tell the user to open the file with `duo edit <path>` or
   click into the editor first.
2. If `text` is empty, the selection is collapsed at the caret — in
   that case ask the user to select the thing they mean, unless the
   request is clearly about the surrounding `paragraph` or the whole
   section described by `heading_trail`.
3. Do the transform in-process (think, don't tool-call unnecessarily),
   then:

```bash
# Replace the user's selection with the transformed text.
echo "the new text" | duo doc write --replace-selection
```

The selection overlay stays visible even while the terminal has focus
(PRD D29c), so the user can see exactly what range you're operating on.

**Future Stage 15 (not yet shipped):** when the user clicks a
"Send → Duo" button next to a selection (or hits the keyboard
shortcut), the selection is injected into your terminal as a quoted
block plus a one-line provenance ("from /path/to/foo.md · Risks > Market"),
ready for you to read alongside the user's typed verb. The injection
format is itself runtime-configurable via `duo selection-format`:

- `duo selection-format` — print the current format (default `a`).
- `duo selection-format c` — switch to opaque tokens like
  `<<duo-sel-abc123>>` for the rest of the session. Useful when
  you're going to do many transforms in a row and the quoted blocks
  would clutter your context.
- `duo selection-format a` — switch back to the human-readable
  default.

Format `c` requires you to call `duo selection` to read what the
token refers to. Format `a` (default) gives you the text inline plus
a `duo selection` round-trip available if you want richer context
(line range, heading trail).

### Rewrite an entire markdown document

When the user says "restructure this PRD" or "convert this outline into
prose", use `replace-all` so you can emit markdown (headings, lists,
tables). The editor's frontmatter is preserved automatically.

```bash
cat <<'EOF' | duo doc write --replace-all
# Rewritten doc

Your new content here, with **bold**, `code`, lists, tables…
EOF
```

### Open a markdown file for the user to read or edit

```bash
duo edit ~/projects/foo/prd.md
```

Opens in the rich editor with a centered prose column, toolbar, and
auto-discovered frontmatter. Internal links to other `.md` files are
followed as new editor tabs.

### Read or edit a Google Doc

Google Docs renders into a `<canvas>`, so the usual extractors (`duo
text`, `duo dom`) return chrome or empty. The canonical read is `duo
eval` with the same-origin `/export?format=md` fetch — full doc with
formatting:

```bash
duo eval "(async () => {
  const m = location.pathname.match(/\\/document\\/d\\/([^/]+)/);
  if (!m) return 'not on a Doc page';
  const r = await fetch('/document/d/' + m[1] + '/export?format=md');
  return await r.text();
})()"
```

Editing is limited: plain-text insertion via `duo type` works (include
`\n` for paragraph breaks; you do NOT need `duo key Enter`), but `duo
key` chords for formatting (cmd+B, headings, undo, select-all) are
silent no-ops because Docs routes keyboard input through a hidden
iframe CDP can't reach. For format changes, defer to the user or
escalate to the Docs REST API.

For the offline fallbacks (`_docs_annotate_getAnnotatedText`, AX tree
on visible viewport), the full list of canvas traps to avoid (the
`<noscript>` red herring, the `export?format=txt` download trap), and
the keyboard-input limitation in detail, see
[references/google-docs.md](references/google-docs.md).

### Read an ordinary DOM page

```bash
duo navigate "https://example.com"
duo text                      # or: duo text --selector "article"
```

Use `duo text` for classic DOM-rendered pages — it's simpler than `ax` and
plenty accurate.

### Fill and submit a form

```bash
duo fill 'input[name="email"]' "user@example.com"
duo fill 'input[name="message"]' "Hello"
duo click 'button[type="submit"]'
duo wait ".success" --timeout 5000
duo text --selector ".success"
```

### Show the user a local file ("open this PRD", "preview that image")

Use `duo view <path>` to open any local file in the Viewer/Editor column:

```bash
duo view ~/Documents/prd.md       # markdown → rendered preview
duo view /tmp/chart.png           # image → inline preview
duo view ~/tmp/notes.pdf          # pdf → Electron's native viewer
duo view /tmp/config.json         # JSON / YAML → tree view + raw-text toggle (ENH-110)
duo view ~/Projects/network.har   # .json / .jsonl / .har / .webmanifest / .yml / .yaml all route to JsonView
```

The tab uses the filename as its title; the path is in the tooltip. If the
file is already open in a tab, `duo view` activates that tab rather than
creating a duplicate. Unknown types (`.xlsx`, `.mov`, etc.) show a card
with an "Open with default app" button — don't grind; tell the user.

**JSON / YAML tabs (ENH-110, v0.6.12).** Files with `.json`, `.jsonl`,
`.har`, `.webmanifest`, `.yml`, or `.yaml` extensions open in a
collapsible tree view (Tier 3, `@uiw/react-json-view`) with click-to-edit
values. A toolbar **Source** button flips to a CodeMirror raw-text editor
with syntax highlighting + inline parse-error markers; the **Tree** button
flips back (rejecting the switch if the source is unparseable). Single
tab kind for both formats — format is implicit from the extension. YAML
round-trip is content-only: comments + anchor names are stripped on
save (mention this when handing the user a YAML edit). Files >1 MB drop
to a read-only source view (tree render cost is prohibitive at scale).
Save semantics match the markdown editor: autosave on debounce, the
markdown editor's BUG-107 normalize-trailing-whitespace contract, and
`files.write` underneath. Saving from source mode parses the input
first and refuses to write if invalid (catches the "missing closed
quote / bracket" case the owner flagged).

### When you've just CREATED something for the user — always pass `--reveal` (ENH-130)

When you write a file, doc, or playground for the user (`duo edit
foo.md` after creating it, `duo open playground.html` after generating
it, `duo edit --canvas page.html` after scaffolding), pass **`--reveal`**
so Duo auto-expands the working pane (if collapsed) and focuses the
main pane. Without it, the file may open into a hidden / collapsed
canvas and the user has to hunt for it.

```bash
# Created a markdown doc → make sure the user sees it
duo edit --reveal /tmp/summary.md

# Created an interactive playground → reveal the browser pane
duo open --reveal /tmp/calculator.html

# Created a canvas-mode HTML page → reveal the canvas
duo edit --canvas --reveal /tmp/notes.html
```

Idempotent: if the working pane is already visible at a reasonable
ratio (`splitPct < 75`), `--reveal` is a no-op for the layout but still
focuses main. Cheap to over-use; expensive to forget.

**Default for any "make me X" request:** scaffold the file, then open
with `--reveal`. The user shouldn't have to ask "where did it go?"

For HTML playgrounds you build, also follow the **REQUIRED defaults**
in [`make-playground.md`](make-playground.md) — every playground
includes a "Send to Claude" button + a "Copy output" button so the user
can round-trip without manual select-and-copy.

**Never use** `duo open <path>` for local files — that's the browser
command (takes URLs and loads them in a browser tab). Two commands, two
columns:

- `duo open <url-or-path>` → **browser tab** (URLs, HTML artifacts you want
  to render live, file:// URLs when you explicitly want browser rendering).
- `duo view <path>` → **editor/preview tab** (the normal answer for local
  files the user wants to read / edit).

### Navigate the user's file browser ("show me where that lives")

If you've just modified a file and want the user to see it in their
navigator, use `duo reveal`:

```bash
duo reveal ~/Documents/prd.md
```

The navigator jumps to that folder and a chip appears so the user knows
the tree moved because of you. Pair with `duo view` when you want to both
open a file and surface its location.

### Discover files without opening them

```bash
duo ls                          # contents of the user's current nav folder
duo ls ~/Documents              # specific path
duo nav state                   # { cwd, selected, expanded, pinned }
```

Good for deciding what to do next without guessing; cheaper than asking
the user.

### Show the user a generated HTML artifact ("show me X" / "open that")

When the user asks for an interactive prototype, a quick visualization,
or "show me {UI idea}", write the HTML to disk and open it in a new
browser tab with `duo open`. A single command handles path resolution
(absolute, `~/…`, relative) and opens a fresh tab so existing tabs
aren't disturbed.

```bash
# 1. Generate HTML locally
cat > /tmp/countdown.html << 'EOF'
<!doctype html>
<!-- your prototype here -->
EOF

# 2. Open it in a new tab (becomes active)
duo open /tmp/countdown.html
# → { ok: true, id: 2, url: "file:///tmp/countdown.html", title: "Countdown" }

# 3. Interact with it — the new tab is active, so every other duo command
#    targets it automatically:
duo click "#start"
duo eval "document.getElementById('t').textContent"
duo screenshot --out /tmp/countdown.png
```

**Iterating.** Once the artifact is open and the user asks for a
change, rewrite the same file and reload the same tab by re-navigating:

```bash
# rewrite /tmp/countdown.html with the new styles…
duo navigate "file:///tmp/countdown.html"   # targets the ACTIVE tab
```

The active tab is the artifact you just opened, so `duo navigate`
reloads in place — no new tabs accumulate.

**When to use `duo open` vs `duo navigate`:**

- `duo open <path-or-url>` — first load of a new artifact, or any time
  you want a fresh tab. Use this for "show me X" and "open that".
- `duo navigate <url>` — replaces the URL of the currently-active tab.
  Use this for iterating on the prototype in place, or for navigating
  an existing tab to a different page.

`duo open` accepts the same URL schemes as `duo navigate` (http(s),
file, about, data, etc.), plus local file paths with `~/` or relative
paths — path resolution happens client-side.

### Generate a worksheet for structured user feedback

When you need the user to respond to **N items** with **a structured
per-item answer + free notes**, and you want the response back in a
parseable form, reach for the **worksheet** primitive. The smoke-walk
and sprint-plan skills are both consumers; future retros / triage /
prioritization forms become JSON manifests, not new HTML generators.

```bash
# 1. Author a manifest (see .claude/skills/worksheet/SKILL.md for
#    the schema — items + radio options + textarea + result format).
node .claude/skills/worksheet/generate.mjs \
  docs/dev/worksheets/<name>.json \
  docs/dev/worksheets/<name>.html

# 2. Open in the browser pane (clipboard.writeText needs full Chromium;
#    canvas mode would trap the Copy button click as a cursor placement).
duo open docs/dev/worksheets/<name>.html

# 3. Hand off — the user fills it in, hits "Send to Claude" or
#    "Copy results", you parse the response.
```

The worksheet HTML emits BOTH a "Copy results" button (clipboard) AND
a "Send to Claude" button. The Send path calls
`window.duoSendResult(text, { worksheet })`, a CDP-injected binding
parallel to `window.duoOpenPath`. When the binding is wired (Duo
build supporting it), the result lands directly in the active Claude
terminal — no paste step. When it isn't, the Send button falls back
to clipboard + tells the user to paste.

The worksheet sub-skill at `.claude/skills/worksheet/SKILL.md` has
the full manifest schema, the result-format spec for parsing, and
authoring tips. Two consumers ship today:

- **`.claude/skills/smoke-walk/`** — pass/fail/skip per shipped item.
- **`.claude/skills/sprint-plan/`** — P0/P1/P2/skip per backlog
  candidate, fed by a gatherer that harvests tasks.md +
  active-sprint.md + roadmap.html.

When you'd otherwise build a long bullet-list in chat asking the
user "which of these…", consider whether a worksheet is the right
shape. ~5 items is too few; ~30 is enough.

### Author or interact with an HTML canvas

Two companion skills cover the canvas surface, split on a single
question — are you CREATING markup, or are you DRIVING existing
markup?

- **`skill/canvas-authoring.md`** — when you need to ship an
  interactive HTML (a tutorial, dashboard, quiz, click-through form):
  the full Stage 27 vocabulary (nine action verbs, `data-duo-pane`
  repaint regions, `data-payload-from` form bindings, the
  `<meta name="duo-default-editable">` routing convention),
  anti-patterns, and a worked tutorial example. Five copy-paste
  templates live at `skill/examples/canvas-templates/`.

- **`skill/canvas-interaction.md`** — when you need to OPEN, READ,
  or DRIVE an existing canvas: `duo edit`/`duo open` smart routing,
  `duo html query`/`get`/`update` for reading + painting, the
  `duo events --follow` subscription pattern for reacting to user
  clicks, and a debugging playbook for "the button isn't firing"
  / "events aren't reaching me" / "paint doesn't show up".

The drive-by cheat sheet at `skill/examples/canvas-actions.md` is
the right tab when you need ONE verb's signature; the two skills
above are the right tabs when you're working with canvases as a
whole.

### Diagnose a failing interaction with the page

If a `duo click` or `duo eval` doesn't produce the expected result, the
page probably logged a warning, threw an uncaught exception, or
returned a non-2xx from an API. Three ring buffers cover those:
`console` (logs + warnings), `errors` (uncaught exceptions, populated
by `Runtime.exceptionThrown`), and `network` (HTTP request lifecycle).
Grab a timestamp before the action so you can scope each one:

```bash
TS=$(date +%s000)
duo click "button.flaky"
sleep 1
duo console --since $TS --level warn,error
duo errors  --since $TS              # uncaught exceptions never reach `console`
duo network --since $TS --filter '/api/'   # XHR/fetch responses + failures
```

Common failure modes and which buffer to check first:
- "Looks like nothing happened" → `errors` (a thrown exception aborts a
  click handler before any `console.error` runs).
- "Spinner forever, no UI update" → `network --filter '/api/'` for 4xx/5xx
  or `failed: true` entries.
- "Page logged something I want to see" → `console`.

Each `network` entry includes `{url, method, status, statusText, mimeType,
encodedDataLength, failed, errorText, startTs, endTs}`. Use the regex
`--filter` to scope to one origin / route — the ring buffer is bounded
(~300 entries), so a noisy SPA can otherwise crowd out the request you
care about.

## Error recovery

When a selector fails:

1. Confirm the element actually exists:
   ```bash
   duo eval "!!document.querySelector('YOUR_SELECTOR')"
   ```
2. Inspect the surrounding DOM:
   ```bash
   duo dom | grep -i "part_of_the_text"
   ```
3. Re-issue `duo focus` immediately before `duo type` — focus is easy to
   lose between commands, especially in canvas apps.
4. For canvas apps, never assume `duo text` captured anything meaningful;
   switch to `duo ax`.
5. Retry transient navigation/timing errors up to three times before
   declaring the operation impossible.

## Troubleshooting: `duo: command not found`

The CLI isn't on `$PATH` for the current shell, but may still be
installed at one of Duo's known locations. Inheriting `$PATH` from a
sandboxed Claude Code subshell often misses these — the skill loaded
("duo is on PATH") but the actual environment doesn't match.

**Investigation order:**

1. **Check the env signals first.** If `DUO_SESSION=1` is set, the
   PTY is a Duo-managed terminal AND Duo is running. If
   `DUO_SOCKET=<path>` resolves to a real socket, the bridge is up.
   In either case, the only missing piece is PATH — the binary is on
   the machine.
2. **Look in the install locations.** In order of likelihood:

   ```bash
   ls -l ~/.claude/bin/duo ~/.local/bin/duo /usr/local/bin/duo 2>/dev/null
   ```

   `~/.claude/bin/duo` is the default install (sandbox-writable).
   `~/.local/bin/duo` is the Linux-style fallback. `/usr/local/bin/duo`
   needs sudo to install but works without `$DUO_SESSION` shell-init
   support — this is what `duo install --system` produces.

3. **If found, invoke by full path.** Example:

   ```bash
   ~/.claude/bin/duo open /path/to/file.md
   ```

   Don't shadow your shell with `export PATH=...` — too easy to
   forget to undo. Just use the absolute path for the call.

4. **If NONE of the paths resolve and `DUO_SESSION` is unset**, the
   CLI was never installed (or got removed). Ask the user to run
   `duo install` from a non-sandboxed shell (Duo's own terminal, or
   Terminal.app outside Claude Code). The install command symlinks
   into `~/.claude/bin/duo` and works inside the sandbox.

**Don't fall back to native `open <path>`** as a substitute — it
opens the file in macOS's default app, NOT in Duo. The user wants
Duo's editor / canvas / pin behavior, not Preview / TextEdit.

**Don't ask the user to run the command for you.** The skill exists
specifically so you can act on their behalf inside Duo. If `duo` is
genuinely not findable, that's a one-line `duo install` to fix —
ask them to run that, not "please open the file yourself."

## Troubleshooting: Claude Code sandbox

Claude Code's macOS Seatbelt sandbox blocks Unix-domain sockets by
default, which is the channel `duo` uses. If `duo` calls fail with
`Socket error: connect EPERM` / `ECONNREFUSED`, or hang ending in
`Timeout waiting for response`, **run `duo doctor` first** — don't
retry blindly. It reports socket reachability and TCP-fallback status,
and prints a sandbox-detection line when that's the cause.

For the failure shapes, the two fixes (`allowUnixSockets` in project
settings, or per-call `dangerouslyDisableSandbox` as a last resort),
and why retrying just burns tokens, see
[references/sandbox-troubleshooting.md](references/sandbox-troubleshooting.md).

## The canvas-text trap (why `ax` exists)

```bash
# This will return almost nothing on a Google Doc, even if the doc is huge.
duo text --selector ".kix-appview-canvas"
```

Canvas elements have no text children. Google Docs, Sheets, Slides, Figma,
and newer Notion surfaces all fall into this pattern. If a page looks rich
but `duo text` returns a short string or chrome-only content, assume canvas
rendering and retry with `duo ax`.

## Version compatibility

This skill targets `duo` v0.1.x. Run `duo --version` and verify the
major/minor match before trusting complex patterns.

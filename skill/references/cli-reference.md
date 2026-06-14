# duo — full CLI reference

Every `duo` verb. The duo skill's SKILL.md links here; load it when you need a verb that isn't in the hub's quick table.

## Contents

- [Browser pane — navigate, read, drive](#browser-pane--navigate-read-drive)
- [Renderer & visibility tooling](#renderer--visibility-tooling)
- [Working pane — open, view, edit files](#working-pane--open-view-edit-files)
- [HTML canvas](#html-canvas)
- [File navigator](#file-navigator)
- [Markdown editor — read, write, track-changes](#markdown-editor--read-write-track-changes)
- [JSON / YAML editor](#json--yaml-editor)
- [Images](#images)
- [Theme & author](#theme--author)
- [Files on disk](#files-on-disk)
- [Terminals & sessions](#terminals--sessions)
- [Health & install](#health--install)
- [Git & clone](#git--clone)
- [Workspace, session & project management](#workspace-session--project-management)

## Browser pane — navigate, read, drive

| Command | Purpose | Output |
|---|---|---|
| `duo navigate <url>` | Open URL in a **NEW browser tab**, or focus an existing tab whose URL matches (match strips hash + trailing slash). **URLs only** — does NOT move the file navigator. Does NOT clobber the currently-active tab. To move the file navigator to a folder, use **[`duo reveal <path>`](#file-navigator)** instead. To open a local file, use `duo open <path>` (or `duo edit <path>` for in-place editing). | JSON: `{ok, url, title, reused}` |
| `duo open <path-or-url> [--canvas] [--reveal]` | Open a local file or URL. **HTML always lands in the browser pane** (verb-driven: scripts run, buttons fire, the user **interacts** with the running surface). Non-HTML routes to its natural surface (`.md` → editor, image → viewer). `--canvas` is a rare override that forces canvas-mode mount for HTML (inspect source without firing scripts). The legacy `<meta name="duo-open-in">` declaration is no longer consulted. | JSON: `{ok, url, routedTo}` |
| `duo reload` | Reload the active browser tab in place (no URL). Pair for `duo navigate` in iteration loops — agent edits an artifact, user runs `duo reload` to see the result without typing the URL again. | JSON: `{ok, url, title}` |
| `duo external <url>` | Open `<url>` in the **macOS default browser** (via Electron's `shell.openExternal`). Used for hostnames listed in `~/.claude/duo/external-domains.json` — sites that don't render well in Duo's embedded `WebContentsView` (Claude.ai, ChatGPT, banking, sites that block Electron UAs). NOT the default route — Duo handles everything not on the list. http(s) and mailto schemes only. | JSON: `{ok, opened}` |
| `duo url` | Current URL | plain text |
| `duo title` | Current page title | plain text |
| `duo text [--selector <css>]` | Visible text (DOM `innerText`) | plain text |
| `duo ax [--selector <css>] [--format md\|json]` | **Accessibility tree** — use for canvas apps | Markdown (default) or JSON |
| `duo dom` | Full page HTML (browser pane, CDP) | HTML |
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
| `duo inspect [--on\|--off]` | Toggle element-inspect mode in the active browser pane. No arg toggles; `--on` / `--off` force a state. While active, hover any element to outline it in Duo orange; click to ship its tag + selector_path + heading trail + capped innerText + key attrs (id/role/aria-label/href/etc.) to the active terminal as a structured paste. ESC inside the page exits without picking. Pairs with `duo dom <selector>` — the inspect snapshot tells you WHERE on the page; `duo dom` reads the structure once you know. Chord parity: ⌘⇧C inside the WCV is the keystroke equivalent. | JSON: `{active}` |

## Renderer & visibility tooling

These four answer "what is the user looking at right now?" — reach for them before building bespoke debug instrumentation.

| Command | Purpose | Output |
|---|---|---|
| `duo dom <selector> [--attr <n>] [--text] [--all] [--computed p1,p2]` | Query the **main RENDERER** (the React shell) by CSS selector. Default returns `outerHTML`; `--attr` returns one attribute, `--text` returns `textContent`, `--computed` returns getComputedStyle props as an object, `--all` returns an array of matches. Use this when debugging editor / canvas / image-viewer / pane-layout state — what the user actually sees in the React UI, not browser-pane content. | HTML / JSON |
| `duo dom --js "<expr>"` | Arbitrary JS expression evaluated in the renderer scope. Distinct from `duo eval` (browser pane / CDP). | JSON |
| `duo devtools [--browser-pane] [--close]` | Open / close DevTools on the main renderer (default) or active browser pane. Backstop for the rare cases where a targeted `duo dom` query isn't enough and you need full Elements / Network / Console. | JSON `{ok, target, opened}` |
| `duo layout` | JSON snapshot of WorkingPane / terminal / navigator state. Returns `{ active, main: {kind, path/url, title, id}, aux: {kind, path/url, splitPct} \| null, splitPct, focusedColumn, navigatorCollapsed, fileTabsCount, browserTabsCount, timestamp }`. Pairs with `duo nav state` (file tree state) + `duo dom` (renderer DOM) as the **visibility-tooling cluster** — three independent verbs that together remove ambiguity about WHAT the user is currently looking at. | JSON |

## Working pane — open, view, edit files

| Command | Purpose | Output |
|---|---|---|
| `duo view <path> [--canvas]` | Open a local file in the working pane (legacy verb — `duo open` and `duo edit` are preferred). For `.md` → rich markdown editor; for `.html` → mode is meta-driven (legacy behavior); for image / pdf → natural viewer. **Prefer `duo open` for HTML you want to display + `duo edit` for HTML you want to modify.** | JSON: `{ok}` |
| `duo edit <path> [--browser] [--reveal]` | Open a file for editing its source. **HTML always lands in canvas mode** (verb-driven: source-editable, scripts blocked, buttons render but inert). `.md` opens in the TipTap rich editor. Images / PDFs / JSON fall through to their natural viewers (no editor surface). `--browser` is a rare override that forces browser-mode mount for HTML (symmetric with `duo open --canvas`). `--canvas` accepted as deprecated no-op (the default for HTML now). | JSON: `{ok}` |
| `duo close-tab` | Close the focused working-pane tab (file editor / canvas / image viewer / browser-mode HTML). CLI parity for the ⌘W chord. Pinned-tab gating still routes through a confirm dialog (CLI close of a pinned tab still surfaces the same Cancel / Close anyway prompt). | JSON: `{ ok }` |
| `duo selection [--pane auto\|editor\|browser\|canvas]` | Active surface's selection. **Use when the user says "this", "the selected paragraph", "this section", "here".** Default `auto`: prefers a non-empty browser highlight, then a non-empty canvas selection, falling back to the editor's cached selection (still useful when collapsed — caret context). Returns `{kind: 'editor', …}`, `{kind: 'browser', …}`, or `{kind: 'page', path, text, html, anchorId, anchorPath, range, surrounding}` — or `null`. | JSON |

## HTML canvas

| Command | Purpose | Output |
|---|---|---|
| `duo html new <path.html> [--title "…"]` | Create a new `.html` from boilerplate and open it in the HTML canvas. Path must end in `.html`/`.htm`. | JSON: `{ok, path}` |
| `duo html query <css>` | List elements matching the selector inside the active canvas. Returns `[{id, tag, text, classes}]` (text truncated to 200 chars; use `get` for full content). | JSON array |
| `duo html get --id <duo-id>` (or `--selector <css>`) | Read `outerHTML` + `textContent` of one element. | JSON `{id, tag, html, text}` |
| `duo html set --id <duo-id> --content "…"` | Replace `innerHTML`. Reads stdin if `--content` omitted. | JSON `{id}` |
| `duo html replace --id <duo-id> --html "…"` | Replace `outerHTML`. | JSON `{id}` of the new element |
| `duo html append --parent <duo-id> --html "…"` | Append a child to the matched parent. | JSON `{id}` of the new child |
| `duo html remove --id <duo-id>` | Delete an element. | JSON `{id}` of the deleted element |
| `duo html attr --id <duo-id> [--set k=v ...] [--remove k ...]` | Modify attributes. `--set`/`--remove` repeat. | JSON `{id}` |
| `duo html click <selector\|--id <duo-id>>` | Click an element inside the active canvas (fires the element's handlers in the script-blocked canvas iframe — the read-side companion to the `duo html` write ops). Target by CSS selector or `data-duo-id`. | JSON `{id}` |
| `duo html comment --id <duo-id> --body "…"` (or `--selector <css>` / `--text "<substring>"`) | Add a comment thread anchored to a `data-duo-id` element. Anchor resolves to the nearest `data-duo-id` ancestor when targeted via selector/text. Comments live in `<file>.duo.json § comments[]`; the `.html` is never modified. Body via flag or stdin. | JSON `{ok, commentId, anchorId}` |
| `duo html comments [--filter all\|open\|resolved]` | List comment threads on the active canvas, sorted in document order. Each thread: `{id, number, excerpt, resolved, entries: [{id, author, ts, body}]}`. | JSON array |

## File navigator

| Command | Purpose | Output |
|---|---|---|
| `duo reveal <path>` | **Move the file navigator** to `<path>` (folder = move tree there; file = move tree to parent + select the file). A dismissible chip ("Claude moved to …") tells the user why their tree jumped. **This is the navigator-move verb** — NOT `duo navigate` (which is a browser-pane URL change). When the user says "navigate to X" in a path-shaped sentence, reach for `duo reveal`. | JSON: `{ok}` |
| `duo ls [path]` | List a directory's contents. Defaults to the navigator's current folder. | JSON array of `{name, path, kind, size?, mtimeMs?}` |
| `duo nav state` | Current navigator snapshot: `{cwd, selected, expanded, pinned}`. **This is the file-TREE state — NOT the open-tab list.** To check whether a file is open in a working-pane tab, use `duo status`. | JSON |
| `duo nav pin <path>` / `duo nav unpin <path>` | Pin / unpin a file or folder to the navigator's "Pinned" section (bottom of left pane). Persists at `~/.claude/duo/nav-pins.json` (separate from tab pins). Mirrors the right-click "Pin to navigator" / "Unpin from navigator" actions. | JSON: `{ok, pinned, pins}` |
| `duo nav pins` | List all navigator pins. | JSON array of `{path, kind, title}` |
| `duo hidden-files [show\|hide\|toggle]` | Toggle show/hide of dotfiles in the navigator. CLI parity with the View → Show Hidden Files menu item and the ⌘⇧. chord (Finder convention). Persists in localStorage. The `.claude` + `.obsidian` directories are ALWAYS visible regardless of this flag (carve-outs in FileTree's shouldShow() — first-class for the Duo + Obsidian-vault workflow). Use when the user asks to see hidden files / dotfiles / .env / .gitignore / config that's normally tucked away. No arg = print `{ showDotfiles: boolean }`. | JSON: `{showDotfiles: boolean}` |
| `duo status` | Read-only JSON dump of every open working-pane file tab: `{ tabs: [{ kind, path?, url?, title, dirty, active, pinned }], active, focusedColumn, theme, … }`. The reliable **"is this file open in Duo?"** probe — run it BEFORE any `Edit`/`Write` so you can route an open file through the matching `duo` verb (`doc edit` / `doc write` · `html *` · `json set` / `json merge`) instead of clobbering it. Good first command for any agent joining a session. | JSON |

## Markdown editor — read, write, track-changes

| Command | Purpose | Output |
|---|---|---|
| `duo doc read [path]` | Print the active editor's **live buffer** (frontmatter + body, including unsaved edits). Optional path pins the read to a specific file. The body goes to stdout; the path + dirty flag go to stderr (so you can pipe the body straight into a file). | text |
| `duo doc write --replace-selection` | Swap the user's current editor selection with new text (reads stdin or `--text "…"`). For collapsed selection, inserts at caret. Plain text in v1 — use `--replace-all` if you need markdown formatting. | JSON: `{ok}` |
| `duo doc write --replace-all` | Replace the entire document body with new markdown (frontmatter preserved). Use for "rewrite this doc" / "restructure this section" tasks. | JSON: `{ok}` |
| `duo doc edit <file> --find "X" --replace "Y" [--occurrence N \| --all] [--at-line N]` | Surgical PLAIN-markdown find/replace. When the file is OPEN in the editor it reconciles into the live buffer (echo-safe — no whole-doc resend, so no false-positive conflict banner); when CLOSED it edits the file on disk directly. `--occurrence N` (1-indexed) disambiguates duplicate matches; `--all` replaces every match; `--at-line N` scopes to one line. Use this — not `Edit`/`Write` — for any markdown file that might be open in Duo. | JSON: `{ok, changed, replacements, path}` |
| `duo doc goto [<path>] --heading "X" \| --line N \| --anchor "Y"` | Scroll the active editor (or the editor for `<path>` if specified) to a target. `--heading "Foo"` matches markdown heading text (case-insensitive substring). `--line N` is 1-indexed (any text editor). `--anchor "X"` is a markdown heading slug OR an HTML/canvas DOM element id (`data-duo-id` first, then `id`). Use this immediately after `duo edit <bigfile>` so the user lands on the right line instead of the top. Returns `{line, anchor}` so a follow-up call can use the canonical slug. | JSON: `{ok, path, line?, anchor?}` |
| `duo doc find <query> [<path>] [--case-sensitive]` | Read-only search of the markdown editor's live buffer. Returns match count + first-match `{line, col}`. Pipe into `duo doc goto --line N` to land on the result. Case-insensitive by default. (v1 markdown only; canvas / browser / terminal find variants deferred.) | JSON: `{ok, path, matches, first?}` |
| `duo doc conflict-log` | Dump the most recent save-conflict diagnostic JSON at `~/.claude/duo/logs/last-conflict.log`. Both the markdown editor and the HTML canvas write a fresh entry every time the "file changed on disk" banner surfaces (watcher-dirty branch OR save-pre-reconcile branch). Payload includes `firstDiffOffset` + 80-char head/tail excerpts (post-normalize) so you can tell instantly whether the diff is BOM, CRLF, trailing whitespace, end-of-doc, or mid-document. Best-effort, read-only; safe to call anytime. | JSON (raw file dump) |
| `duo doc insert <file> --text "X" (--after "Y" \| --before "Y" \| --at-line N)` | Insert "X" as a CriticMarkup insertion (`{++X++}`) at the anchor. `--after`/`--before` take a literal text anchor (matched on the stripped-CM view of the body, so anchors spanning existing tokens still work); `--at-line` takes a 1-indexed line number. Add `--occurrence N` to disambiguate duplicate anchors. Disk-only — when the file is open in the editor, the autosave reconciliation flow surfaces the change. | JSON: `{ok, changed, reason, op, path}` |
| `duo doc delete <file> --text "X"` | Wrap "X" as a CriticMarkup deletion (`{--X--}`). Use `--occurrence N` to disambiguate. Refuses (changed=false) if the target range overlaps an existing CM token — split the operation if so. | JSON: `{ok, changed, reason, op, path}` |
| `duo doc substitute <file> --text "X" --with "Y"` | Wrap "X→Y" as a CriticMarkup substitution (`{~~X~>Y~~}`). `--with` may be empty (equivalent to delete). Same overlap guard as delete. | JSON |
| `duo doc highlight <file> --text "X"` | Wrap "X" as a CriticMarkup highlight (`{==X==}`). Closes the CLI gap so an agent can apply highlights symmetrically with insert/delete/substitute. Use to draw the user's eye to a phrase without altering or commenting on it (lighter than a comment, lighter than a track-change). Same `--occurrence N` + overlap-guard semantics as delete. | JSON: `{ok, changed, reason, op, path}` |
| `duo doc comment <file> --anchor "X" --body "B" [--reply-to <c-id>]` | Anchor a comment (`{==X==}{>>id\|author\|ts\|B<<}`) to the matched text. Author resolves from `$DUO_AUTHOR` (default `agent`). Comment id auto-minted as `c-<timestamp>-<rand>`. Comment body is normalized to single-paragraph (blank lines collapsed) so the surrounding token doesn't split across markdown paragraphs at parse time. | JSON |
| `duo doc accept <file> (--id <c-id> \| --match "X")` | Accept a CM op per standard CriticMarkup semantics: insertion = keep text; deletion = drop text; substitution = keep new text; highlight = keep text; comment = keep anchor + drop the comment marker. Identify by `--id` (comments only) or `--match` literal text (matches the op's inner text). | JSON |
| `duo doc reject <file> (--id <c-id> \| --match "X")` | Reject a CM op: insertion = drop text; deletion = keep text; substitution = keep old text; highlight = keep text; comment = keep anchor (same as accept — no "rejected comment" semantic in CriticMarkup). | JSON |

## JSON / YAML editor

| Command | Purpose | Output |
|---|---|---|
| `duo json set <file> <dotpath> <value>` | Structured JSON/YAML edit by dot-path (e.g. `duo json set config.json server.port 8080`). `<value>` is parsed as JSON when it parses (number / bool / null / object / array), else treated as a string. When the file is OPEN in the JSON/YAML viewer-editor it reconciles into the live tree; when CLOSED it edits on disk. Use this — not `Edit`/`Write` — for `.json` / `.yaml` files that might be open. **YAML note:** re-serialization drops comments + anchor names. | JSON: `{ok, path}` |
| `duo json merge <file> <patch.json>` | Shallow-merge a JSON patch object into the top level of a `.json` / `.yaml` file. Same open-reconcile / closed-disk behavior + the same YAML comment-loss caveat as `duo json set`. | JSON: `{ok, path}` |

## Images

| Command | Purpose | Output |
|---|---|---|
| `duo image insert <path> [--alt "…"]` | Insert an image from disk into the active markdown editor OR HTML canvas. Source bytes copied alongside the active doc (filename `image-<YYYYMMDD-HHMMSS>-<hash>.<ext>`), inserted at caret. Supported extensions: png, jpg, jpeg, gif, webp, svg, bmp, tiff. The persisted source carries the relative filename; on render Duo hydrates a blob URL via `files.read` so the image displays. | JSON: `{absPath}` |

## Theme & author

| Command | Purpose | Output |
|---|---|---|
| `duo theme [system\|light\|dark]` | Read the current theme (no arg → JSON `{mode, effective}`) or set it. Usually only changed on explicit user request. | JSON |
| `duo author [<name>]` | Read or set the **human author identity** used to stamp CriticMarkup marks (track-changes insertions / deletions / substitutions / comments). No arg → JSON `{author}` (defaults to `$USER` on a fresh install). With a name → persist + print. Persists in renderer localStorage. Agents stamp their own attribution via the `DUO_AUTHOR` env var on per-op verbs (`duo doc insert/comment/...`); this verb is for the human user. | JSON: `{author}` |

## Files on disk

| Command | Purpose | Output |
|---|---|---|
| `duo file rename <old> <new>` | Rename / move a file or folder within the same filesystem (atomic `fs.rename`). Mirrors the navigator's right-click Rename action. Both paths resolve relative to the CLI cwd; quote names with spaces. | JSON: `{ok, oldPath, newPath}` |
| `duo file trash <path>` | Move a file or folder to the macOS Trash (recoverable from Finder via "Put Back"). Mirrors the navigator's right-click Delete action. Prefer this over shell `rm` when working with the user's files — they can recover. | JSON: `{ok, path}` |

## Terminals & sessions

| Command | Purpose | Output |
|---|---|---|
| `duo new-tab [--shell\|--claude] [--cwd <path>] [--cmd "<text>"]` | Open a new terminal tab. `--claude` (the split-button `+` default) auto-launches `claude` after the shell starts; `--shell` opens a vanilla shell. With no flag, follows the user's most recent manual choice (default `'claude'`). `--cwd` overrides the navigator's current folder; `--cmd` writes a pre-typed payload (no trailing newline) into the PTY after spawn — wins over the kind-default if both apply. Use when a side-quest needs a fresh agent (`--claude --cwd <repo>`) or a one-off shell command (`--shell --cmd "npm test"`). | JSON: `{id, kind, cwd, title}` |
| `duo close-terminal-tab [<n>]` | Close a terminal tab. No arg closes the focused terminal tab; `<n>` (1-indexed) closes that specific terminal tab. Refuses to close the LAST terminal tab (same constraint as the in-app ⌘W on the terminal strip). | JSON: `{ ok }` |
| `duo term tabs` | Enumerate the window's terminal tabs so `duo term tab <id>` has a stable id space. Each tab carries `{id, kind, cwd, title, active}`. Honors `--window N`. **Note:** this is the *terminal* number space — `duo tabs` / `duo tab <n>` address *browser* tabs. | JSON: `{tabs[], activeTabId}` |
| `duo term tab <id>` | Switch the focused terminal tab to the one with that `id` (from `duo term tabs`). The CLI parity for ⌘1–9 / a tab click on the terminal strip. A stale id is a harmless no-op. | JSON: `{ ok }` |
| `duo term close <id> [--force]` | Close the terminal tab with that `id` (from `duo term tabs`) — kills its PTY. **Refused** when a live `claude` runs in that tab unless `--force` (BUG-200 data-loss caution). Distinct from `duo close-terminal-tab [<n>]` (closes by 1-indexed position). | JSON: `{ ok }` |
| `duo window new` | ENH-191 P5a — open a SECOND app window (blank: its own workspace, browser pane, navigator — not a clone of window 1). Same action as File → New Window (⌥⌘N). Requires "Allow Multiple Windows" (Settings menu, default on); exits non-zero with a disabled-error when off (never a silent no-op). | JSON: `{ ok, error? }` |
| `duo windows` | ENH-191 P5a (Tier-3) — list open app windows. Pair with the global `--window N` flag (or a terminal's auto-stamped `DUO_WINDOW` env) to address a specific window, e.g. `duo --window 2 dom body` drives window 2. | JSON: `[{ id, primary, focused, activeWorkspace }]` |
| `duo send [--text "…"] [--enter]` | Write a payload into the **active terminal's PTY**. No Enter by default — user confirms. Pass `--enter` to submit on their behalf (pairs with canvas `data-duo-action="terminal:send" data-enter="true"` buttons). Without `--text`, reads stdin. Agent-facing inverse of the Send → Duo button. Use sparingly to plant context — never to issue prompts on their behalf. | JSON: `{ok, written, terminalId}` |

## Health & install

| Command | Purpose | Output |
|---|---|---|
| `duo doctor` | Health-check both transports (Unix socket + TCP fallback), report app/CLI version match, the live open-window count (`Windows: N`), `$DUO_SESSION` presence, install path, skill files. **Run this first when any `duo` command fails** — it names the sandbox failure mode instead of leaving you guessing. Exits 0 if either transport is reachable. | text |
| `duo install [--system]` | Symlink the CLI into `~/.claude/duo/bin/duo` (the sandbox-safe SHIM_DIR auto-prepended to every Duo PTY's `$PATH`), with `~/.local/bin/duo` as fallback for external-terminal use. Duo also auto-creates the SHIM_DIR symlink on every app boot; manual `duo install` is only needed when self-heal can't run (no Duo.app, or first install from outside Duo). `--system` forces `/usr/local/bin/duo` (sudo; not recommended for Claude Code use). | text |

## Git & clone

| Command | Purpose | Output |
|---|---|---|
| `duo git-status [<path>]` | git status snapshot for a directory (defaults to `$HOME`). Backs the Navigator root chip ("clean stays invisible"); also useful directly to agents who want to make decisions about a checkout's state before proposing edits. | JSON: `{ isRepo, workTreeRoot, branch, head, dirty, changedCount, ahead, behind }` |
| `duo clone <url> [<dir>] [--json]` | Clone a GitHub repo. Uses `gh repo clone` when gh is authenticated (handles HTTPS + SSH transparently); falls back to plain `git clone` for public repos. `<url>` accepts gh shorthand (owner/repo) when gh is available, full HTTPS/SSH URL otherwise. With `--json`, structured CloneResult — branch on `errorKind` ∈ `{ bad-url, auth-missing, clone-failed }`. | text \| JSON when `--json` |
| `duo gh-auth` | Probe `gh auth status`. Tell agents whether `duo clone` will succeed on private repos before they try. | JSON: `{ ghInstalled, authenticated, host, user, ghNotFound }` |

## Workspace, session & project management

These verbs are real (full UI parity preserved) but rarely needed by a new user's everyday flow — they manage saved workspaces, prior-session resume, the project rail, distro packs, the canvas split-view, the event bus, and Claude-tab keyboard tuning.

| Command | Purpose | Output |
|---|---|---|
| `duo workspace save [<path>] [--name <n>] [--save-as]` | Write the running workspace (tabs + terminals + browser tabs) to a `.duo-workspace` file. `<path>` omitted writes to the currently-active workspace's path (Save semantic); with `<path>` writes to that destination (Save As semantic). `--name` overrides the human-readable name (defaults to filename sans extension). Autosave continues to mirror the active `.duo-workspace` on every state change (no extra writes needed from the agent). | JSON: `{ path, name }` |
| `duo workspace open <path>` | Load a `.duo-workspace` and in-place reset Duo so the saved tabs/terminals replace the current ones. Use this to switch between named workspaces. The CLI path skips the GUI "Save current workspace?" prompt; if you want that gate, drive the File menu via UI. The reset closes browser tabs + disposes PTYs + reloads the renderer (no app exit). | JSON: `{ path, name, switching: true }` |
| `duo workspace list-recent` | JSON list of recent workspaces sorted by `lastOpenedAt`, capped at 10, pruned for missing files on disk. | JSON: `[{ path, name, savedAt, lastOpenedAt }]` |
| `duo workspace current` | Which workspace is loaded right now (Open Workspace or last Save). `null` when untitled. | JSON: `{ path, name } \| null` |
| `duo workspace new` | **Resets the workspace in-place.** Collapses to one fresh shell terminal at the live CWD of the previously-frontmost terminal; closes every working-pane tab except pinned ones (file + browser pins both restore via the existing boot-time hooks); clears the active-workspace pointer (title bar back to "Duo"). CLI skips the GUI Save-current prompt. | JSON: `{ ok }` |
| `duo workspace-pill-menu [on\|off\|toggle]` | Toggle the title-bar workspace pill's click-to-open-menu behavior. Default OFF: pill renders as a passive label + workspace operations route through the File menu. Bare command reads current state. Persisted in renderer localStorage `duo.workspacePillMenu`. | JSON: `{ enabled }` |
| `duo session list [--cwd <path>]` | List prior Claude `<uuid>.jsonl` sessions in a CWD (defaults to the active terminal's cwd). Each entry has `{uuid, title, source, messageCount, modifiedAt}` where `source` is `customTitle` / `aiTitle` / `jsonl-firstmsg` / `uuid`. Mirrors the data that powers the session pills surface. | JSON: `PriorSessionListing[]` |
| `duo session resume <tabId> <uuid>` | Spawn `claude --resume <uuid>` in the named tab's PTY. `<tabId>` comes from `duo layout` (`terminal.tabs[].id`). | JSON: `{ ok: true }` |
| `duo session open <uuid> [--cwd <path>] [--force]` | The Home click contract, main-side: if a live terminal tab already hosts `<uuid>` (evidence-gated open join), **focus** it (raising its window) — never duplicating; else **resume** `claude --resume <uuid>` in a new tab in the primary window (`--cwd` required to resume). Unlike `session resume`, no `<tabId>` — main resolves the host tab itself. A session live OUTSIDE Duo (another terminal / desktop app) is refused by default — pass `--force` to **fork** it (`claude --resume <uuid> --fork-session`, a new branched session id so the running copy's transcript isn't clobbered; parity with the UI's Fork dialog). | JSON: `{ ok, action: 'focus'\|'resume'\|'fork' }` |
| `duo home` / `duo home show` / `duo home refresh` | Focus/synthesize **Home** (the permanent slot-0 re-entry surface) in the target window; `refresh` forces a live snapshot refetch. Honors `--window N`. No `home close` verb — Home is non-closable by design. | JSON: `{ ok }` |
| `duo home state [--json]` | Pull what Home currently shows (same `__duoGetHomeState` no-cache pull pattern as `duo status`): `{generatedAt, greeting, projects[]}` — rolled-up project roots with their recent sessions, green-pill open joins, and recent-file chips. `null` until Home has fetched at least once. | JSON: `HomeSnapshot \| null` |
| `duo project list` | JSON snapshot of the left rail. Use this first to discover project names before running any subsequent `duo project` verb. Returns derived projects (root, name, isGitRoot, hasMarker, colorIndex, pinned), the currently focused root (or `null` for All), and per-project member counts (`terminals`, `workingTabs`, `hasClaudeKindTerminal`). | JSON: `ProjectsStateSnapshot` |
| `duo project focus <name\|root>` | Set the focus lens to this project. Hides non-member terminals + working tabs; re-roots the navigator; shows the title-bar focus chip. Name resolution is case-insensitive against unique project names; exact root paths always resolve. | JSON: `{ ok, focused }` |
| `duo project focus --all` | Release focus (back to All; no filter). | JSON: `{ ok, focused: null }` |
| `duo project pin <name\|root>` | Pin a project so its rail tile persists across close-all. No-op when already pinned. Writes `~/.claude/duo/projects.json`. | JSON: `{ ok, root, pinned: true }` |
| `duo project unpin <name\|root>` | Remove from the pin set. No-op when not pinned. | JSON: `{ ok, root, pinned: false }` |
| `duo project close <name\|root>` | Bulk close every member terminal + working tab. The renderer fires the same dialog confirm as the right-click "Close N terminals and M tabs" menu when any member terminal is `kind: 'claude'` (live work proxy). If closing the entire focus, a fresh shell terminal is spawned at home so the strip stays non-empty. | JSON: `{ ok, root }` |
| `duo packs` | List every distro skill pack at `~/.claude/duo/packs/<name>/PACK.json`. Returns the parsed manifest (`{name, version, title, description?, defaults[], navPins[]}`) plus per-pack `errors[]` so a malformed manifest surfaces without you reading the file. Cached at app boot; restart Duo to pick up new packs. Use this to debug "the FTUX welcome canvas didn't auto-open" — confirm the pack is registered + the manifest parsed without errors. Read-only legacy alias for `duo pack list`. | JSON: `{packs:[{dirName, rootDir, manifest, errors}]}` |
| `duo pack list \| uninstall <name> [--remove-folder]` | Manage installed distro packs. `list` enumerates installed packs (the read-write successor to the legacy read-only `duo packs` alias); `uninstall <name>` removes a pack's registration, and `--remove-folder` also deletes its `~/.claude/duo/packs/<name>/` folder from disk. | JSON |
| `duo split <pct\|preset>` | Set the split-pane percentage (terminal column width as % of the split container). Numeric arg accepted in 0–100 range; clamps to 20–80 (matching the divider drag). Named presets mirror View → Pane size: `even` (50), `terminal-heavy` (67), `canvas-heavy` (33), `terminal` (80, full-terminal), `canvas` (20, full-canvas), `3way` (canonical 3-pane even — outer 33/67 + inner aux 50/50; matches ⌘⌥4 chord; on-demand sibling of the auto-redistribute on aux-open). Use to give the user more canvas room when reviewing a doc, or hand the column back to the terminal when typing-heavy. Persists for the session only (not across relaunches). | JSON: `{pct}` for numeric / non-3way presets; `{ok}` for `3way`. |
| `duo split-view <op> [args]` | Split View aux pane (the canvas's right-hand companion slot). Sub-verbs: `open <path>` opens a file in aux (moves it from main if already there); **`open-browser <id>`** (pin a browser tab into aux by numeric id from the `duo tab` listing; the browser tab stays a real Chromium tab so its `<script>` blocks keep running, unlike file-tab promotion which lands in the script-blocked canvas iframe — this is the path for putting a smoke-walk page or worksheet alongside a canvas you're testing); `close` closes aux; `promote` moves aux's active tab back to main and closes aux; `resize <pct>` sets splitPct (0.20–0.80 decimal or 20–80 percent; clamped); `state` (or no sub-verb) prints the current aux snapshot. File-aux and browser-aux are mutually exclusive — pinning one releases the other. v1 is single-slot. Use when the user is editing source while watching a preview, taking notes alongside reference material, following a lesson with a playground, or running a smoke walk against an open canvas. | JSON: `{ok}` for state-changing verbs; `{aux: null}` or `{aux: {activePath, activeKind, splitPct}}` for the state query (activeKind is `'browser'` when a browser tab is pinned) |
| `duo events [--follow] [--since <cursor>] [--limit N]` | Stream structured DuoEvents from the bus. Producers today: the canvas `duo:event` action verb (a button click on a trusted canvas emits `{source:'canvas', name:<event>, payload:<json>}`). Snapshot mode prints one JSON line per event from the ring (most-recent N when `--limit`); `--follow` keeps the connection open and pushes each new event as it lands. `--since <cursor>` resumes from a known cursor (format `<unix-ms>-<seq>`; copy from a prior event line). Pattern for a click-driven lesson canvas: subscribe in a side terminal (`duo events --follow > /tmp/events.jsonl`) and react when a row whose `name` matches your lesson step shows up. | One JSON line per event, stdout |
| `duo focus-pane <terminal\|main\|aux>` | Jump keyboard focus to the named pane. CLI parity with the ⌘⌥L (terminal) / ⌘⌥; (main) / ⌘⌥' (aux) chord set. Use when a multi-step flow needs to land the user back at a specific pane (e.g. opened a worksheet in the browser, want their typing to go to the terminal next). Aux is a no-op when split view is closed. **Distinct from `duo focus <selector>`** which targets a CSS selector inside the active browser pane. | JSON: `{target}` |
| `duo claude-return [submit\|newline]` | Toggle Claude-tab plain Return behavior. Default `submit` (xterm passthrough; Claude submits). `newline` writes ESC+CR so Claude reads it as a multi-line newline (⌘Return submits). Per-user pref; persists in localStorage. No arg = print current state. | JSON: `{claudeReturn, shiftReturn}` |
| `duo shift-return [submit\|newline]` | Toggle Claude-tab Shift+Return behavior. Default `newline` (matches Slack/Discord/claude.ai-web "shift+enter = newline within composition"). `submit` disables the override. No arg = print current state. | JSON: `{claudeReturn, shiftReturn}` |
| `duo browser-mode [unfiltered\|filtered\|local-only]` | Three-mode URL filter for Duo's embedded browser. **Default `local-only`** (only `file://`, `localhost`, `127.0.0.1`, `[::1]` URLs render in Duo; ALL other URLs pop the system browser). `filtered` is the legacy mode (consult `~/.claude/duo/external-domains.json`). `unfiltered` is debug-only — agents and users see an IT-policy warning unless they pass `--i-understand`. Persists in localStorage `duo.browserMode`. Use when the user needs broader access (set to `filtered`) or full debug (`unfiltered --i-understand`). No arg = print `{ mode }`. **Never set `unfiltered` to work around a block on the user's behalf** — surface the block and stop. | JSON: `{mode}` |
| `duo selection-format [a\|b\|c]` | Read or set the **Send → Duo** payload format (agent-tunable runtime knob). `a` = quote + provenance (default, human-readable); `b` = literal text only (compact, agent calls `duo selection` for context); `c` = opaque token like `<<duo-sel-abc123>>` (most compact, requires expansion). No arg → JSON `{format}`; with arg → set + persist for the rest of the session. | JSON |

### Vault (ENH-208) — work-notes on plain Obsidian conventions

A **vault** is a folder containing `.obsidian/` (a strict Obsidian vault: markdown + `[[wikilinks]]` + YAML frontmatter + `.base` files). These verbs read the filesystem **directly** — no running app, no socket — so they also work headless. The vault is resolved by walking up from the cwd to the nearest `.obsidian/`; pass `--vault <path>` to target another.

| Command | What it does | Output |
| --- | --- | --- |
| `duo vault init <folder> [--force]` | Scaffold a new vault: `.obsidian/`, starter `templates/` (person / initiative / milestone / meeting / theme, each carrying its D19 filing rule), `inbox/`, registry + `notes/` folders, `bases/processing.base` (the work-list dashboard), and a README. Refuses to clobber an existing vault unless `--force`. Warns if the target is under `~/Documents` (iCloud-eviction trap). | JSON: `{ root, created[], warnings[] }` |
| `duo vault list` | Vaults detected from the cwd (the enclosing vault plus any nested under it). | JSON: `[{ root, name, noteCount }]` |
| `duo vault schema [--vault <path>]` | The **L0 corpus** — types, entities, aliases, properties-per-type, observed enum values, and the template registry. A pure function over frontmatter ("the vault IS the schema"); computed live, never cached to disk. Feed it to lint/processing as the resolution table. | JSON `Corpus` |
| `duo vault capture [--template <type>] [--text "…"] [--title "…"] [--open] [--vault <path>]` | Drop an atomic, timestamped note into `inbox/` (D6 — processing files it later). Untyped by default (just a `captured:` stamp); `--template <type>` stamps that type's frontmatter + seeds its expected fields empty. `--text` becomes the body; `--title` adds a slug to the filename; `--open` opens it in the editor. | JSON: `{ path, absPath, type }` |
| `duo vault stub <type> <name> [--open] [--vault <path>]` | Create a typed entity **stub** from its template, filed by the D19 rule (parentless types → their registry folder; parented types with no parent yet → the `notes/YYYY/MM/` time-bucket; folder-note types own a folder). The CLI twin of the silent-stub `[[New Name]]`⇥ gesture. **Idempotent** — never clobbers an existing note (`created: false`). `--open` opens it in the editor. | JSON: `{ path, absPath, type, created }` |
| `duo vault search <query> [--vault <path>]` | Case-insensitive full-text search over the vault's notes (the CLI twin of the ⌘⇧F palette). `docMatchIndex` is the hit's occurrence index within the file's BODY (what the editor doc contains; `null` for frontmatter hits) — the palette hands it to the editor to open file-at-match. | JSON: `[{ path, absPath, line, excerpt, docMatchIndex }]` |
| `duo vault default [<path>\|--clear]` | Read or set the **default vault** (D11 — the CLI twin of **Settings → Default Vault**; stored at `~/.claude/duo/vault.json`, read by both the CLI and the app, so a CLI write shows in the menu live). No arg prints it; a path sets it (validated as a real vault); `--clear` unsets it. Once set, every vault verb resolves to it from **outside** any vault. **Resolution order for all vault verbs:** `--vault` → the enclosing vault (walk-up from cwd) → the default → error. (The UI surfaces invert: ⇧⌘N / ⌘⇧F act on the default FIRST, then the active file's vault.) Setting a default also records the vault in `knownVaults` (the Settings picker's window-independent list); `--clear` preserves that list. Every output shape echoes both fields. | JSON: `{ defaultVault, knownVaults }` |
| `duo graph backlinks <note> [--vault <path>]` | Every occurrence that wikilinks to `<note>` (matched by basename, so links survive file moves), scanning frontmatter relationships as well as body links. | JSON: `[{ path, absPath, line, excerpt }]` |
| `duo graph orphans [--vault <path>]` | Notes with no inbound **and** no outbound links — a processing work-list to link or archive. | JSON: `string[]` (rel paths) |
| `duo base lint <file\|--all> [--vault <path>]` | Validate a `.base` file (or a note's embedded ` ```base ` blocks, or every base with `--all`) against the live corpus — bad types, unresolved `[[entities]]`, off-enum values, unknown functions, unknown view types, each with a Levenshtein "did you mean". **Warn-and-render (D15): advisory, never blocks.** | JSON: `[{ source, embeddedIn?, findings:[{severity, message, suggestion?}], parseError? }]` |
| `duo base render <file\|note> [--out <path>] [--open] [--vault <path>]` | Evaluate a base's filters/formulas over live frontmatter and emit a **Duo-owned** HTML artifact, stamped with generated-at · source-hash · as-of date (D13/D16). A `.base` file renders vault-wide; a note renders its embedded ` ```base ` blocks with `this` = the note (the one-template rollup). Default writes to the vault's `out/`; `--out` writes elsewhere; `--open` also opens it as a tab in the running app (the one vault verb that reaches the app — fails gracefully when Duo isn't running). | JSON `{ path, sourceHash, generatedAt, asOf, bases:[{label, views:[{name, type, rows}]}] }` |

The rollup authoring loop: describe the view in prose → derive the corpus (`duo vault schema`) → write the `.base` (vault-wide → `bases/`; per-entity → an embedded block in the **type template** with `… == this`, so every entity inherits it) → `duo base lint` until clean → `duo base render --open`.

---

**Safety — never circumvent the user's controls.** Duo may run on a managed or corporate Mac. Never enable `duo browser-mode unfiltered`, `dangerouslyDisableSandbox`, or any host / IT / sandbox control to work around a block on the user's behalf — surface the block to the user and stop. Never send the user's files, credentials, or page contents to an external destination. When a `duo` call is blocked or hangs, run `duo doctor` to diagnose and report the cause; do not bypass it.

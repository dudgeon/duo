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
> **Canonical provenance home (D1).** This file is the single source of
> truth for the verb↔origin (ENH / Stage) mapping; the bundled agent-facing
> skill deliberately strips those internal tags, so keep the ENH/Stage
> references here. `npm run check:skill-currency` continuously re-audits the
> shipped-verb set against the live CLI so this inventory can't silently
> drift.
>
> **Last updated: 2026-05-31** (ENH-191 / D7 re-audit vs `cli/duo.ts`: added
> `duo html click` + the `duo pack` family, removed a stale `duo doc find`
> gap row, corrected the terminal-tab parity note).

---

## 1. Shipped verbs

Everything in this list is implemented today. Run `duo --help` inside Duo
for the authoritative usage text.

### Browser (Stage 2 + 3 + 8)

| Verb | What it does |
|---|---|
| `duo navigate <url>` | **ENH-175** — Open URL in a new browser tab, or focus an existing matching tab. Does NOT clobber the active tab. Match normalizes by stripping hash + trailing slash. |
| `duo open <path-or-url> [--canvas] [--reveal]` | **ENH-156** — verb-driven mode. HTML files → browser pane (interactive, scripts run). Non-HTML files → natural surface (.md → editor, image → viewer). Web URLs → new browser tab. `--canvas` is a rare override that forces canvas-mode mount for HTML (inspect source without firing scripts). The legacy `<meta duo-open-in>` declaration is no longer consulted. |
| `duo reload` | Reload the active browser tab in place — pair for `navigate` without a URL (Stage 20) |
| `duo external <url>` | Opens the URL in the macOS default browser via Electron `shell.openExternal`. Used by the `duo` subagent for hostnames listed in `~/.claude/duo/external-domains.json` — sites known not to render well in the embedded `WebContentsView` (Claude.ai, ChatGPT, banking sites, etc.). NOT used for general navigation; the default route is always Duo. http(s) and mailto schemes only. |
| `duo url` / `duo title` | Current URL / title |
| `duo text [--selector]` | Visible text via `innerText` |
| `duo ax [--selector] [--format md\|json]` | Accessibility tree — required for canvas apps (Docs/Sheets/Slides/Figma) |
| `duo dom` | Full HTML (browser pane, CDP) |
| `duo dom <selector> [--attr <n>] [--text] [--all] [--computed p1,p2]` | **ENH-122** — query the main RENDERER (React shell) by CSS selector. Default outerHTML; `--attr` reads one attribute; `--text` returns textContent; `--computed` returns getComputedStyle props as JSON; `--all` returns an array of matches. |
| `duo dom --js "<expr>"` | **ENH-122** — evaluate an arbitrary expression in the renderer scope. Distinct from `duo eval` (browser pane / CDP). |
| `duo devtools [--browser-pane] [--close]` | **ENH-123** — open / close DevTools on the main renderer or active browser pane. |
| `duo layout` | **ENH-124** — JSON snapshot of WorkingPane state (active tab kind/path, aux state, splitPct, focused subpane, navigatorCollapsed, tab counts). Third member of the visibility-tooling cluster (with `duo dom` + `duo nav-state`). |
| `duo inspect [--on\|--off]` | **ENH-159b** — toggle element-inspect mode in the active browser pane. No arg toggles; `--on` / `--off` force a state. While active: hover an element → 2px orange outline + tag/dims tooltip; click → snapshot `{tag, selector_path, headingTrail, innerText, attrs}` shipped to active terminal as a structured paste; ESC exits without picking. Selection-pill suppressed (mode lock). Chord parity: ⌘⇧C inside WCV. |
| `duo edit --reveal` / `duo open --reveal` / `duo view --reveal` | **ENH-130** — after open, auto-expand the working pane if collapsed (splitPct ≥ 75 → 50) + focus main. Use when the agent has just created an artifact for the user. Idempotent. |
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
| `duo view <path> [--canvas]` | Legacy verb — open a file in the Viewer/Editor column. HTML routing is meta-driven (pre-ENH-156 behavior). **Prefer `duo open` (browser-mode HTML) or `duo edit` (canvas-mode HTML).** `--canvas` forces canvas-mode mount. |
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
| `duo edit <path> [--browser] [--reveal]` | **ENH-156** — verb-driven mode. HTML files → canvas mode (source-editable, scripts blocked). `.md` → TipTap rich editor. Images / PDFs / JSON fall through to their natural viewers. `--browser` is a rare override that forces browser-mode mount for HTML (symmetric with `duo open --canvas`). `--canvas` accepted as deprecated no-op (the default for HTML now). |
| `duo selection [--pane auto\|editor\|browser\|canvas]` | Active surface's selection. `auto` (default) prefers a non-empty browser highlight, then a non-empty canvas selection, falling back to the editor's cached selection. Returns the unified `DuoSelection` shape (`kind: 'editor' \| 'browser' \| 'page'`). Stage 17c adds the canvas branch. |
| `duo doc read [path]` | Live editor buffer (frontmatter + body, including unsaved edits). Optional path pins the read to a specific file. |
| `duo doc write [--replace-selection\|--replace-all] [--text\|stdin]` | Apply text to the active editor |
| `duo doc edit <file> --find "X" --replace "Y" [--occurrence N\|--all] [--at-line N]` | **ENH-195** — surgical PLAIN-markdown find/replace. Reconciles into the live editor buffer when the file is open (echo-safe via the shared `useDiskReconciliation` hook — no whole-doc resend, so no false-positive conflict banner); disk-direct when closed. `--occurrence N` (1-indexed) / `--all` scope which match(es); `--at-line N` confines to one line. The agent-facing "edit a markdown file that might be open in Duo" verb (vs. raw `Write`/`Edit`). Returns `{ok, changed, replacements, path}`. |
| `duo doc goto [<path>] --heading "X" \| --line N \| --anchor "Y"` | **ENH-022** — scroll the active editor (or specified file's editor) to a target. `--heading` markdown-only (case-insensitive substring on heading text). `--line` is 1-indexed. `--anchor` matches markdown heading slug OR canvas/HTML element id (`data-duo-id` first, then `id`). |
| `duo doc find <query> [<path>] [--case-sensitive]` | **ENH-023** — search the markdown editor's live buffer; returns `{matches, first: {line, col}}`. v1 markdown only. |
| `duo doc conflict-log` | **BUG-122** — dump `~/.claude/duo/logs/last-conflict.log` (the most recent save-conflict diagnostic JSON). Read-only file dump; no IPC. Payload carries `firstDiffOffset` + 80-char head/tail excerpts (post-normalize) so the diff signature is one-glance bisectable without DevTools. Written by markdown editor + HTML canvas on every banner-surfacing (watcher-dirty + save-pre-reconcile branches). |
| `duo image insert <path> [--alt "…"]` | **ENH-108 + ENH-125** — insert an image from disk into the active markdown editor OR HTML canvas. Source bytes copied alongside the active doc as `image-<YYYYMMDD-HHMMSS>-<hash>.<ext>`, inserted at caret. v0.6.11 closed the editor-canvas gap (ENH-125): canvas now responds too. The inserted markdown / HTML carries the relative filename (FOLLOWUP-014); DuoImage / imageHydrate hydrate it back to a blob URL on render. |
| `duo json set <file> <dotpath> <value>` | **ENH-195** — structured JSON/YAML edit by dot-path (`<value>` parsed as JSON when it parses, else string). Reconciles into the open JSON/YAML viewer-editor (`kind: 'json'`) via the shared `useDiskReconciliation` hook when open; disk-direct when closed. The agent-facing "edit a `.json`/`.yaml` that might be open in Duo" verb (vs. raw `Write`/`Edit`). **YAML re-serialization drops comments + anchor names** (same caveat as the viewer's source-mode save). Returns `{ok, path}`. |
| `duo json merge <file> <patch.json>` | **ENH-195** — shallow-merge a JSON patch object into the top level of a `.json`/`.yaml` file. Same open-reconcile / closed-disk behavior + YAML comment-loss caveat as `duo json set`. Returns `{ok, path}`. |

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
| `duo html click --id <duo-id> \| --selector <css>` | **ENH-055** — programmatic click; resolves the target via `--id`/`--selector` and fires the canvas-action delegated dispatcher exactly like a real user click (`data-duo-action` verbs fire, events emit). Used by lesson fly-through harnesses. |
| `duo html comment --id <duo-id> --body "…"` | Add a comment anchored to the matched element's nearest `data-duo-id` ancestor (Stage 17d). Stored in `<file>.duo.json § comments[]`; the `.html` is never modified. Anchor via `--id`, `--selector <css>`, or `--text "<substring>"`. Body via flag or stdin. Returns `{ok, commentId, anchorId}`. |
| `duo html comments [--filter all\|open\|resolved]` | List comment threads on the active canvas, sorted in document order (Stage 17d). Each thread: `{id, number, excerpt, resolved, entries: [{id, author, ts, body}]}`. |

### Appearance

| Verb | What it does |
|---|---|
| `duo theme [system\|light\|dark]` | Read or set theme mode |
| `duo author [<name>]` | **BUG-138 Phase 2** — read or set the human author identity used to stamp CriticMarkup marks (track-changes insert/delete/substitute/comment). No arg → JSON `{author}`; with a name → persist + print. Defaults to `$USER` on first read. Stored in renderer localStorage `duo:author`. Agents stamp their own attribution via the `DUO_AUTHOR` env var on per-op verbs (Phase 3); this verb is for the human user. |
| `duo doc insert <file> --text "X" (--after "Y" \| --before "Y" \| --at-line N) [--occurrence N]` | **BUG-138 Phase 3** — wrap "X" as a CriticMarkup insertion (`{++X++}`). Anchor matching runs against the stripped-CM view of the body, so anchors spanning existing tokens still resolve. Disk-only; when the file is open in the editor, the autosave reconciliation surfaces the change. Returns `{ok, changed, reason, op, path}`. |
| `duo doc delete <file> --text "X" [--occurrence N]` | **BUG-138 Phase 3** — wrap "X" as a CM deletion (`{--X--}`). `changed=false` if the range overlaps an existing CM token (split the op). |
| `duo doc substitute <file> --text "X" --with "Y" [--occurrence N]` | **BUG-138 Phase 3** — wrap "X→Y" as a CM substitution (`{~~X~>Y~~}`). Empty `--with` = effective delete. |
| `duo doc highlight <file> --text "X" [--occurrence N]` | **v0.7.2 (BUG-138 family parity)** — wrap "X" as a CM highlight (`{==X==}`). HighlightMark already existed in the editor; this verb closes the CLI gap so agents can apply highlights symmetrically with insert/delete/substitute. Same overlap guard as delete. |
| `duo doc comment <file> --anchor "X" --body "B" [--reply-to <c-id>] [--occurrence N]` | **BUG-138 Phase 3** — anchored comment (`{==X==}{>>id\|author\|ts\|B<<}`). Author resolves from `$DUO_AUTHOR` (default `agent`). Comment id auto-minted as `c-<timestamp>-<rand>`. Comment body normalized to single paragraph. |
| `duo doc accept <file> (--id <c-id> \| --match "X") [--occurrence N]` | **BUG-138 Phase 3** — accept a CM op per standard CriticMarkup semantics (insertion=keep, deletion=drop, substitution=keep new, highlight=keep, comment=keep anchor). `--id` for comments; `--match` for any op's inner text. |
| `duo doc reject <file> (--id <c-id> \| --match "X") [--occurrence N]` | **BUG-138 Phase 3** — reject (insertion=drop, deletion=keep, substitution=keep old, highlight=keep, comment=keep anchor — same as accept for comments). |
| `duo claude-return [submit\|newline]` | **v0.6.15** — Claude-tab plain Return behavior. Default `submit` (xterm passthrough). `newline` activates the ENH-127 v2 override (writes ESC+CR; Claude reads as multi-line newline; ⌘Return submits). Stored in localStorage `duo.claudeReturn.v1`. |
| `duo shift-return [submit\|newline]` | **v0.6.15** — Claude-tab Shift+Return behavior. Default `newline` (matches Slack/Discord/claude.ai-web). `submit` disables the override. Stored in localStorage `duo.shiftReturn.v1`. |
| `duo hidden-files [show\|hide\|toggle]` | **ENH-172 (Sprint 20 / v0.7.7)** — show / hide dotfiles in the navigator. CLI parity with View → Show Hidden Files menu + ⌘⇧. chord (Finder convention). Persists in localStorage `duo.nav.showDotfiles`. `.claude` + `.obsidian` are always visible regardless (always-visible carve-outs in FileTree's `shouldShow()`). `duo nav-state` also returns `showDotfiles: boolean` for snapshot-style reads. No arg = print state. |
| `duo browser-mode [unfiltered\|filtered\|local-only]` | **ENH-178 (v0.7.8)** — three-mode embedded-browser URL filter. **Default: `local-only`** (`file://` + `localhost` + `127.0.0.1` + `[::1]` render in Duo; everything else pops the system browser). `filtered` is the legacy behavior (consult `~/.claude/duo/external-domains.json`). `unfiltered` is debug-only and requires `--i-understand` (IT-policy warning printed otherwise). Persists in renderer localStorage `duo.browserMode`. No arg = print `{ mode }`. |
| `duo split <pct\|preset>` | **ENH-014 + ENH-099** — set split-pane percentage (terminal column as % of split container; clamped 20–80). Numeric arg or named preset (`even`, `terminal-heavy`, `canvas-heavy`, `terminal`, `canvas`, `3way`). The `3way` preset is the on-demand sibling of ENH-126: snaps to outer 33/67 + inner aux 50/50 (canonical 3-pane even). Mirrors View → Pane size menu and ⌘⌥1/2/3/4/0/9. |
| `duo split-view <op> [args]` | ENH-041 / Sprint 3 + Sprint 7 Phase 3c — Split View aux pane (canvas's right-side companion slot). Sub-verbs: `open <path>` (file in aux), `open-browser <id>` (pin browser tab in aux — Phase 3c, browser tab stays a real Chromium tab so scripts run; fixes worksheet-in-split scripted-page case), `close`, `promote`, `resize <pct>`, `state` (or no sub-verb). v1 single-slot. File-aux and browser-aux mutually exclusive — pinning one releases the other. State is renderer-authoritative; main caches snapshot for the no-arg query. Locked spec: `docs/prd/canvas-split-view-research.html`. |
| `duo focus-pane <terminal\|main\|aux>` | **ENH-098 (Sprint 9)** — jump focus DIRECTLY to the named pane (vs. `⌘\`` which cycles). Mirrors the ⌘⌥L (terminal) / ⌘⌥; (main) / ⌘⌥' (aux) chord set. Aux is a no-op when split view is closed. Returns `{target}`. Named `focus-pane` (not the originally-proposed `pane focus`) to avoid collision with `duo focus <selector>` (CDP element focus). |
| `duo events [--follow] [--since <cursor>] [--limit N]` | Stage 27 — stream structured DuoEvents from main's in-memory bus (200-event ring buffer). Snapshot mode prints one JSON line per event from the ring; `--follow` keeps the socket open and pushes each new event as it lands. `--since` resumes from a cursor of the form `<unix-ms>-<seq>`. Producer: canvas-action `duo:event` verb today; renderer / browser / main hooks land as Stage 27.5 follow-ups. |
| `duo packs` | Stage 18b — list every distro pack at `~/.claude/duo/packs/<name>/`. Returns parsed `PACK.json` plus per-pack `errors[]` (malformed manifests surface as errors, never crash the loader). Cached at app boot. |
| `duo pack <list\|uninstall>` | **Stage 21d-iii** — distro pack management. `list` returns JSON of installed packs; `uninstall <name> [--remove-folder]` removes a pack (and optionally its folder on disk). (`duo packs` above is the legacy list alias.) |
| `duo selection-format [a\|b\|c]` | Read or set the Send → Duo payload format (Stage 15 G19, agent-tunable). a = quote + provenance (default), b = literal, c = opaque token. Persisted in renderer localStorage. |
| `duo send [--text "…"] [--enter]` | Write a payload into the active terminal's PTY (Stage 15 G17). No Enter by default — user confirms. Pass `--enter` to submit on their behalf (Stage 23b — pairs with canvas `data-duo-action="terminal:send" data-enter="true"`). Without `--text`, reads stdin. Returns `{ok, written, terminalId}`. |

### Meta

| Verb | What it does |
|---|---|
| `duo status` | **ENH-195** — read-only single-shot state dump of every open working-pane file tab: `{ tabs: [{ kind, path?, url?, title, dirty, active, pinned }], active, focusedColumn, theme, … }`. The reliable "is this file open in Duo?" probe (run before any `Write`/`Edit` so an open file routes through the matching `duo doc edit` / `doc write` / `html *` / `json set`/`merge` verb). Useful first command for any agent joining a session. **Distinct from `duo nav state`** (file-TREE selection) and `duo layout` (active-tab + split geometry). |
| `duo doctor` | Stage 20 — health-check both transports (Unix socket + TCP fallback), report app/CLI version match, `$DUO_SESSION` presence, install path, skill files. First move when a `duo` command fails — names the sandbox failure mode instead of silent failures. Exits 0 if either transport reaches the app. |
| `duo install [--system]` | Symlink CLI into a sandbox-safe location. ENH-141 default order: `~/.claude/duo/bin/duo` (SHIM_DIR — auto-prepended to PATH inside every Duo PTY by `core/pty-manager.ts`) → `~/.local/bin/duo`. `--system` forces `/usr/local/bin/duo` (sudo + outside Claude Code's sandbox). Prints a shell-rc hint scoped to external Terminal/iTerm use when the dir isn't already on the calling shell's PATH (inside Duo PTYs it always is — no action needed). |
| `duo git-status [<path>]` | **ENH-152a** — git status snapshot for a directory (defaults to `$HOME`). Returns JSON: `{ isRepo, workTreeRoot, branch, head, dirty, changedCount, ahead, behind, reason? }`. Backs the Navigator root chip (rendered via `formatGitStatusChip` in `shared/host-api.ts`; clean stays invisible per owner directive). Also surfaced to agents for decisions like "is this checkout dirty before I propose an edit?". |
| `duo clone <url> [<dir>] [--json]` | **ENH-151** — clone a GitHub repo. Uses `gh repo clone` when gh is authenticated; falls back to `git clone` for public repos. `<url>` accepts gh shorthand (`owner/repo`) when gh is present, full HTTPS/SSH URL otherwise. Plain output prints `Cloned via gh\|git → <path>` on success; `--json` returns structured CloneResult `{ ok, clonedTo, errorKind: 'bad-url'\|'auth-missing'\|'clone-failed', error, via }` so agents can branch. Exits non-zero on failure. |
| `duo gh-auth` | **ENH-151** — probe `gh auth status`. Returns JSON `{ ghInstalled, authenticated, host?, user?, ghNotFound }`. Pre-flight for `duo clone` on private repos + future Doctor panel's GitHub-integration row. |
| `duo close-tab` | **FOLLOWUP-020** — close the focused working-pane tab (file editor / canvas / image viewer / browser-mode HTML). CLI parity for the ⌘W chord. Pinned-tab gating routes through `dialog.confirm`. Returns `{ ok }`. |
| `duo close-terminal-tab [<n>]` | **FOLLOWUP-020** — close a terminal tab. No arg → focused tab; `<n>` (1-indexed) → that specific terminal tab. Returns `{ ok }`. |
| `duo workspace save [<path>] [--name <n>] [--save-as]` | **ENH-167** — write the running workspace (tabs + terminals + browser tabs) to a `.duo-workspace` file. `<path>` omitted = save to the active workspace's path (Save semantic); supplied = Save As. `--name` overrides the human-readable name. CLI without an active workspace OR `--path` errors (no GUI dialog from headless context). Mirrors File > Save Workspace in the menu. Autosave continues to mirror to the active `.duo-workspace` on every state change. Returns `{ path, name }`. |
| `duo workspace open <path>` | **ENH-167** — load a `.duo-workspace` and **in-place reset Duo** so the saved tabs/terminals replace the current ones. Same path the File > Open Workspace menu drives, minus the GUI "Save current workspace?" prompt. Returns `{ path, name, switching: true }`. |
| `duo workspace list-recent` | **ENH-167** — JSON list of recent workspaces, sorted by `lastOpenedAt`, capped at 10, pruned for files that no longer exist on disk. Same data the File > Open Recent Workspace submenu renders. |
| `duo workspace current` | **ENH-167** — `{ path, name }` of the loaded workspace, or `null` when untitled. |
| `duo workspace new` | **ENH-167** — **resets the workspace in-place** (parity with File > New Workspace menu). One fresh shell terminal at the live CWD of the previously-frontmost terminal (via `lsof`, spawn-CWD fallback); every working-pane tab dropped except pinned (browser pins restored via `electron/main.ts` § BUG-057 block; file pins via `App.tsx` § `pinAutoOpenRanRef`); active-workspace pointer cleared; window title back to "Duo". CLI skips the GUI Save-current prompt; the File menu item shows the Save / Don't Save / Cancel prompt when anything is open. |
| `duo session list [--cwd <path>]` | **ENH-183** — list prior Claude `<uuid>.jsonl` sessions in a CWD (defaults to active terminal's cwd). Returns `[{uuid, title, source, messageCount, modifiedAt}]`; `source` ∈ `customTitle`/`aiTitle`/`jsonl-firstmsg`/`uuid` (D5 read ladder). Powers the S1 pills surface in the polymorphic SessionHeader. |
| `duo session resume <tabId> <uuid>` | **ENH-183** — spawn `claude --resume <uuid>` in the named tab's PTY. Same wire as clicking an S1 pill or S3 Resume button. `<tabId>` resolves through `PtyManager.getCwd` for cwd validation. |
<!-- ENH-183 pared 2026-05-25 (Option A): `duo session rename` +
     `duo session hydrate` removed. Resume affordances (S1 pills + S3
     restore offer) remain; force-rename + auto-hydration dropped as
     redundant with Claude's own Haiku auto-titling. -->
| `duo project list` | **ENH-182 Phase 4 (Sprint 23 / v0.8.0)** — JSON snapshot of the left rail: derived `projects[]` (root/name/isGitRoot/hasMarker/colorIndex/pinned), the `focusedProject` root (or `null` for All), and per-project member `counts` (`terminals`, `workingTabs`, `hasClaudeKindTerminal`). Cached in main via `PROJECTS_STATE_PUSH` so the call returns instantly without a renderer round-trip. Use this first to discover project names before subsequent verbs. |
| `duo project focus <name\|root>` | **ENH-182 Phase 4** — push `PROJECTS_SET_FOCUS` to the renderer, which calls `setFocusedProject(root)` and downstream effects (navigator re-root, visibility filters, auto-spawn, focus chip) fire identically to a tile click. Name match is case-insensitive against unique project names; exact root paths always resolve. |
| `duo project focus --all` | **ENH-182 Phase 4** — release focus. Renderer calls `setFocusedProject(null)`. |
| `duo project pin <name\|root>` | **ENH-182 Phase 4** — `ProjectsService.togglePin` adds the root to the persisted pin set in `~/.claude/duo/projects.json`; `PROJECTS_CHANGED` broadcast updates the renderer. Verb is idempotent in user-intent terms: pin only adds when absent. |
| `duo project unpin <name\|root>` | **ENH-182 Phase 4** — opposite of pin. Only removes when present (no-op otherwise). |
| `duo project close <name\|root>` | **ENH-182 Phase 4** — push `PROJECTS_CLOSE_REQUEST` to the renderer, which runs the same `handleCloseProject(root)` pipeline as the right-click "Close N terminals and M tabs" menu — including the `dialog.confirm` gate when any member terminal is `kind: 'claude'`, the atomic membership flush, and the fresh-shell spawn when closing the entire focus would leave the strip empty. |
| `duo workspace-pill-menu [on\|off\|toggle]` | **ENH-184 (Sprint 23 / v0.8.0)** — toggle ENH-171's workspace-pill click-to-open-menu (default OFF in v0.8.0). Bare read returns cached value (renderer pushes via `WORKSPACE_PILL_MENU_PUSH` on every change); arg writes push `WORKSPACE_PILL_MENU_SET` to renderer, which applies via the existing `setWorkspacePillMenuFlag` helper (localStorage write + in-window event). |
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
| `DUO_VERSION` | `app.getVersion()` (e.g. `0.8.5`) | Lets the agent reason about feature availability per Duo build. |
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

Today the agent can create new terminal tabs (Stage 19c) and close them
(`duo close-terminal-tab`, FOLLOWUP-020 — shipped). Switching the *focused*
terminal tab from the CLI is the remaining gap. Since Duo terminals are
*the place the agent lives*, terminal-tab switching is the parity hole left
to close.

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
| `duo focus-pane <terminal\|main\|aux>` | ⌘⌥L (terminal) / ⌘⌥; (main) / ⌘⌥' (aux) chord set | **✅ Shipped Sprint 9 (ENH-098). Moved to § 1 Appearance.** Jumps focus DIRECTLY to the named pane (vs. `⌘\`` which cycles). Aux is a no-op when split view is closed. Returns `{target}`. **Note:** the original spec proposed `duo pane focus` as the verb name; shipped as `duo focus-pane` to mirror the chord-set semantic and avoid collision with the existing `duo focus <selector>` (CDP element focus). |
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
| ✅ `duo status` | **Shipped (ENH-195)** | Single-shot state dump: open working-pane file tabs (kind/path/url/title/dirty/active/pinned), focused column, theme. Moved to § 1 Meta. The reliable "is this file open in Duo?" probe agents run before `Write`/`Edit`. |
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

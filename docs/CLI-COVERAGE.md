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
| `duo open <path-or-url> [--canvas] [--reveal]` | **ENH-156** — verb-driven mode. HTML files → browser pane (interactive, scripts run). Non-HTML files → natural surface (.md → editor, image → viewer). Web URLs → new browser tab. `--canvas` is a rare override that forces canvas-mode mount for HTML (inspect source without firing scripts). The legacy `<meta duo-open-in>` declaration is no longer consulted. **ENH-224** — a GitHub *file* URL (`…/blob/<ref>/<path>`, `/raw/`, `raw.githubusercontent.com`): if the repo is already cloned in a navigator git-root project (Phase 3 / D6) it opens YOUR real file from that clone (modality 1 — reports the path; `--checkout` forces the managed checkout); else it is pulled into an opaque managed checkout under `~/.claude/duo/checkouts/<owner>-<repo>@<ref>/` (depth-1 clone at the ref) and opened like a local file — the `duo open` twin of the Open bar's "open just this doc". A bare repo / non-file GitHub URL still opens in the browser pane; unauthenticated bounces to `gh auth login`. Successful opens are recorded in Open Recent (`duo recent`). |
| `duo recent [--json]` | **ENH-224** — list the last ~10 Open-bar targets (local paths + GitHub URLs; the CLI twin of File ▸ Open Recent + the empty ⌘O bar). Reopen by re-passing a target to `duo open`. `--json` prints the raw `RecentEntry[]` array. Shares the machine-global store (`~/.claude/duo/open-recents.json`) with the UI Open bar. |
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
| `duo history <list\|show\|restore> <path> [<id>]` | **ENH-221** — durable local version history for a saved file, independent of the editor's volatile per-tab undo stack. `list` → snapshots oldest→newest (one JSON/line: `{id, ts, hash, size, source}`); `show <id>` → that version's content to stdout; `restore <id>` → writes that version back through `FilesService.write` (`historySource:'restore'`), so an open editor reconciles via the watcher and the restore is itself captured. Backed by the content-addressed store at `~/.claude/duo/file-history/`; capture is fire-and-forget on every Duo-mediated write (zero added save latency). **v1 scope:** captures Duo-mediated writes (editor autosave + `duo doc` verbs + restore); external/raw-`Edit` writes and the History-panel UI + diff are the tracked follow-ups. |
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
| `duo frontmatter-default [expanded\|collapsed]` | **ENH-240** — read or set the app-global DEFAULT collapse state for the markdown editor's frontmatter Properties panel. CLI parity with View → "Expand frontmatter by default". A file the user manually collapses/expands keeps its own per-file choice (localStorage); this only sets the fallback for files with no override. Persisted in `~/.claude/duo/settings.json` (`frontmatterDefaultExpanded`, default `true` = expanded); a change fans `FRONTMATTER_DEFAULT_PUSH` to every window so open editors live-update. No arg = print `{ expanded: boolean }`. |
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
| `duo pr <create\|status\|view\|export> [<path>] [--title …] [--body …] [--branch …] [--draft] [--yes] [--json]` | **ENH-224 Phase 2** — share-back round-trip: propose the diverged doc in a managed checkout (opened via `duo open <github-url>`) as a GitHub PR. **create requires `--yes`** (it pushes + opens a PR under the user's GitHub identity, so the confirmation flag is mandatory): branch (`duo/<slug>-<short>`) + commit (whatever diverged in the checkout — OQ-3) + push + `gh pr create`, **auto-forking** to the user's account and opening a cross-fork PR when they lack push access (D3); D7 prefill (title from the doc's first heading) overridable via `--title`/`--body`/`--branch`/`--draft`; re-running after more edits updates the same PR (D13) → `{ ok, pr:{number,url,state}, pushedTo, forked, action }`. **status**: `{ context, divergence:{diverged, changedFiles}, pr }` (all live — §12). **view**: the open PR for the checkout's branch (or null). **export `<path> <dest>`**: copy the checkout doc to a real local path (the D4 "save a local copy" escape hatch). The round-trip is format-agnostic — `.md`/`.json`/`.yaml`/`.html` all propose via the same path, and the "Propose changes" footer now mounts in the markdown editor, the JSON/YAML viewer, AND the HTML canvas (D8). Runs the git/gh work in main (socket → `core/git/share-back`, like `clone`); `<path>` resolves to its enclosing checkout, refusing paths outside `~/.claude/duo/checkouts/` (D4). Unauthenticated bounces to `gh auth login` (D9). |
| `duo worktree [list] [<path>]`<br>`duo worktree new "<desc>" [--from <ref>] [--window]`<br>`duo worktree remove <path> [--force]` | **ENH-210** (list) + **ENH-222** (new/remove) — list / create / remove git worktrees. Reads AND writes git directly (client-side in the CLI bundle, like the vault verbs — no socket / running app needed, sandbox-tolerant; the exception is `new --window`, which also asks the app to open a window). **list**: JSON `[{ path, branch, head, isMain, isCurrent, detached, prunable, colorIndex }]` (main first, cwd's worktree flagged `isCurrent`; `colorIndex` per `shared/projects.ts`). **new**: create a worktree off `<ref>` (default: the main branch) at `<repo>/.claude/worktrees/<slug>` on branch `claude/<slug>`; the description is sanitized to a slug safe as BOTH a folder name and a git ref (lowercase, spaces/underscores→`-`, allow-list `[a-z0-9-]`, collapse/trim, cap 50, collision-suffixed `-2`/`-3`), falling back to an auto-name if it sanitizes to empty → `{ ok, path, branch, slug }`. **remove**: `git worktree remove` (`--force` when the worktree is dirty) → `{ ok, removed }`. Powers the navigator Worktrees dropdown + its "+ New worktree" create (Variant A). |
| `duo pull [<path>] [--force] [--json]` | **ENH-253** — fetch + pull the latest changes for the repo at `<path>` (default: cwd). Reads AND writes git directly (like `worktree` — no socket / running app needed). A clean, behind-only checkout fast-forwards automatically (`result: 'fast-forwarded'`); a clean but diverged checkout auto-merges (`result: 'merged'`) — a real content conflict aborts the merge immediately, changing nothing (`errorKind: 'merge-conflict'`). A dirty working tree (tracked modifications only — untracked files survive a hard reset and don't count) refuses with `errorKind: 'needs-confirmation'` and reports what's at risk (`{ changedCount, aheadCount, behindCount }`); re-run with `--force` to hard-reset to the remote (`result: 'discarded-and-pulled'`), discarding both uncommitted changes and any unpushed local commits. `--json` prints the structured `PullResult` (and exits non-zero on failure). Powers the navigator's repo-root right-click "Pull latest changes" (`PullModal.tsx`). |
| `duo close-tab` | **FOLLOWUP-020** — close the focused working-pane tab (file editor / canvas / image viewer / browser-mode HTML). CLI parity for the ⌘W chord. Pinned-tab gating routes through `dialog.confirm`. Returns `{ ok }`. |
| `duo close-terminal-tab [<n>]` | **FOLLOWUP-020** — close a terminal tab. No arg → focused tab; `<n>` (1-indexed) → that specific terminal tab. Returns `{ ok }`. |
| `duo window new [--cwd <path>]` | **ENH-191 P5a** — open a SECOND app window (blank: own workspace/browser/navigator, NOT a clone of window 1). Same action as File → New Window (⌥⌘N). **ENH-210 D1-part2** — `--cwd <path>` roots the new window's navigator at a path (e.g. a git worktree); the CLI twin of the Worktrees-dropdown "open in new window". Gated on the "Allow Multiple Windows" setting (default on); exits non-zero when off. CLI parity for the menu item. |
| `duo windows` | **ENH-191 P5a (Tier-3)** — list open app windows `[{id, primary, focused, activeWorkspace}]` for cross-window addressing. Pair with the global `--window N` flag or a terminal's auto-stamped `DUO_WINDOW` env: `duo --window 2 dom body` drives window 2. |
| `duo workspace save [<path>] [--name <n>] [--save-as]` | **ENH-167** — write the running workspace (tabs + terminals + browser tabs) to a `.duo-workspace` file. `<path>` omitted = save to the active workspace's path (Save semantic); supplied = Save As. `--name` overrides the human-readable name. CLI without an active workspace OR `--path` errors (no GUI dialog from headless context). Mirrors File > Save Workspace in the menu. Autosave continues to mirror to the active `.duo-workspace` on every state change. Returns `{ path, name }`. |
| `duo workspace open <path>` | **ENH-167** — load a `.duo-workspace` and **in-place reset Duo** so the saved tabs/terminals replace the current ones. Same path the File > Open Workspace menu drives, minus the GUI "Save current workspace?" prompt. Returns `{ path, name, switching: true }`. |
| `duo workspace list-recent` | **ENH-167** — JSON list of recent workspaces, sorted by `lastOpenedAt`, capped at 10, pruned for files that no longer exist on disk. Same data the File > Open Recent Workspace submenu renders. |
| `duo workspace current` | **ENH-167** — `{ path, name }` of the loaded workspace, or `null` when untitled. |
| `duo workspace new` | **ENH-167** — **resets the workspace in-place** (parity with File > New Workspace menu). One fresh shell terminal at the live CWD of the previously-frontmost terminal (via `lsof`, spawn-CWD fallback); every working-pane tab dropped except pinned (browser pins restored via `electron/main.ts` § BUG-057 block; file pins via `App.tsx` § `pinAutoOpenRanRef`); active-workspace pointer cleared; window title back to "Duo". CLI skips the GUI Save-current prompt; the File menu item shows the Save / Don't Save / Cancel prompt when anything is open. |
| `duo session list [--cwd <path>]` | **ENH-183** — list prior Claude `<uuid>.jsonl` sessions in a CWD (defaults to active terminal's cwd). Returns `[{uuid, title, source, messageCount, modifiedAt}]`; `source` ∈ `customTitle`/`aiTitle`/`jsonl-firstmsg`/`uuid` (D5 read ladder). Powers the S1 pills surface in the polymorphic SessionHeader. |
| `duo session resume <tabId> <uuid>` | **ENH-183** — spawn `claude --resume <uuid>` in the named tab's PTY. Same wire as clicking an S1 pill or S3 Resume button. `<tabId>` resolves through `PtyManager.getCwd` for cwd validation. |
| `duo session open <uuid> [--cwd <path>] [--force]` | **ENH-212 (Home)** — the full Home click contract, main-side: compute the live evidence-gated open-session join (`buildHomeOpenJoin`); if a live terminal tab hosts `<uuid>`, **focus** it (raise window + `TERMINAL_ACTIVATE_TAB`) — never a duplicate spawn; else **resume** `claude --resume <uuid>` in a new tab in the addressed-or-primary window (D15; `--cwd` required to resume). Unlike `session resume`, no `<tabId>` — main resolves the host tab. Returns `{ ok, action: 'focus'\|'resume'\|'fork' }`. A session live OUTSIDE Duo (another terminal / desktop app) is refused by default — pass `--force` to **fork** it (`claude --resume <uuid> --fork-session`, a new branched session id so the running copy's transcript isn't clobbered; parity with the UI's Fork dialog). |
| `duo session digest <tab> [--you-asked-only]` | **ENH-231 (Async Catch-Up)** — resolve `<tab>`→uuid (`sessionIdForTab`: launch cwd → projects dir → freshest jsonl), run the deterministic `extractSessionDigest`, and write it to the rebuildable cache (`~/.claude/duo/session-digests.json`). Fired by the managed Stop/Notification hook (the `set` arm) and UserPromptSubmit (`--you-asked-only`, which keeps the prior turn's todos/files/state and refreshes only "You asked"). Returns `{ ok, uuid? }`. The "no inference at open" pre-hydration. |
| `duo session note <tab> ["<text>"]` · `duo session next <tab> ["<text>"]` | **ENH-231** — agent self-narration into the Duo-owned `home-state.json` (NOT the rebuildable cache — §D9), keyed by session uuid so it survives the tab closing (the Done-review case). With `<text>` → WRITE (`note` = one-line "what just happened", `next` = the single most-useful next action); without → READ. The catch-up card renders these verbatim, falling back to the last assistant block when absent. The skill teaches the agent to call them at natural stopping points. Returns `{ ok, uuid? }` (write) / `{ ok, note?\|next? }` (read). |
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
| `duo home` / `duo home show` / `duo home refresh` | **ENH-212 (Home)** — focus/synthesize **Home** (the permanent slot-0 re-entry surface) in the addressed-or-primary window by pushing `HOME_SHOW` (the single Home main→renderer channel — App activates Home + HomeView refetches). `refresh` shares the push to force a live refetch. Honors `--window N`. No `home close` verb — Home is non-closable by design (see § 3 asymmetries). |
| `duo home state [--json]` | **ENH-212 (Home)** — pull the renderer's `window.__duoGetHomeState()` (the same always-fresh, no-cache pull pattern as `duo status` / `duo layout`): `{generatedAt, greeting, projects[]}` — rolled-up roots, recent sessions, green-pill open joins, recent-file chips. `null` until Home has fetched once. |
| `duo home mode [projects\|catchup]` | **ENH-231 (Async Catch-Up)** — read (no arg → `{ mode }`) or set (→ `{ ok, mode }`) the app-global Home mode in `settings.json` (`projects` = today's project aggregation ↔ `catchup` = the Command Board). A set broadcasts `HOME_MODE_PUSH` to **every** window (`WindowRegistry.all()`), so a toggle in one window moves the others; the renderer subscribes idempotently and does NOT refetch on a push (BUG-046). CLI parity with the in-Home mode toggle. |
| `duo home catchup [--json]` | **ENH-231** — build the **Command Board** (`buildCatchupSnapshot`, coalesced like `home:snapshot`): enumerate the last-7-days sessions, hydrate each from the digest cache (miss ⇒ deterministic re-extract), bucket by attention/liveness into `needsYou`/`working`/`done`, two-tier `full`/`compact` (full if live OR needs-you), merge the `home-state.json` annotations. Returns `CatchupSnapshot`. Zero inference at open. |
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

### Vault (ENH-208 + ENH-216 — filesystem-direct verbs)

Work-notes on a vault. **These verbs read the filesystem directly — no socket,
no running app** (a deliberate parity asymmetry that lets a headless processing
job read the vault; PRD Phase 4). **ENH-216 — two at-rest formats, one graph
model:** **OKF** (standard markdown relative links `[Display](./<note>.md)`, root
`okf_version` `_index.md`/`index.md` marker) and **Obsidian** (wikilinks `[[Display]]`,
`.obsidian/` marker). `okf_version` wins if both markers are present (D4). The
vault is resolved by walking up from the cwd to the nearest marker;
`--vault <path>` overrides. Core lives in `core/vault/` (pure, fs-backed,
shared with the renderer in Phase 3); the single node-free link helper is
`core/markdown/vaultLinks.ts`.

| Verb | What it does | Output |
|---|---|---|
| `duo vault init <path> --format=okf\|obsidian [--name "…"] [--no-default] [--force]` | Scaffold a vault. **`--format` is REQUIRED** (ENH-216 D2 — deliberate asymmetry; the New Vault dialog defaults to OKF). `okf`: root `okf_version` `_index.md` marker (ENH-245 default) + static listings + starter templates (D19 filing rules) + inbox/registry folders, no `.obsidian/`. `obsidian`: `.obsidian/` + `bases/processing.base` + README (legacy, byte-identical to ENH-208). The fresh vault becomes the default (suppress with `--no-default` — PR#98 review C1) and is recorded in `knownVaults` so the Settings picker offers it either way | JSON `{root, created[], warnings[], mode, madeDefault}` |
| `duo vault list` | Vaults detected from the cwd (enclosing + nested) | JSON `[{root, name, noteCount}]` |
| `duo vault schema [--vault p]` | The L0 corpus — types/entities/aliases/props-per-type/observed-enums/templates; a live function over frontmatter, never cached (no-sidecar) | JSON `Corpus` |
| `duo vault capture [--template t] [--text …] [--title …] [--open]` | Timestamped inbox note (D6); untyped by default, `--template` stamps a type | JSON `{path, absPath, type}` |
| `duo vault stub <type> <name> [--open]` | Create a typed entity stub from its template, D19-filed; idempotent. CLI twin of the silent-stub `[[New Name]]`⇥ (ENH-208 P3) | JSON `{path, absPath, type, created}` |
| `duo vault default [<path> [--init [--format=okf\|obsidian] [--name "…"]] \| --clear]` | Read/set the default vault (D11 — CLI twin of the Settings → Default Vault picker; one pref file, `~/.claude/duo/vault.json`, so CLI writes reflect live in the menu). The value is machine-global (persists across windows/workspaces/restarts); setting one also records it in the file's `knownVaults` list so the picker is window-independent, and `--clear` keeps that list (only the active default is unset). Vault verbs resolve `--vault` → enclosing → default → error. **ENH-242 `--init`** (create-on-choose, CLI twin of the "Choose or Create Vault…" dialog): inits a bare `<path>` then sets it (`--format` defaults to OKF; `--name` optional); if `<path>` is a vault or sits inside one, sets the **enclosing** vault instead (never nests — D5). Every output shape echoes `knownVaults` alongside the default | JSON `{defaultVault, knownVaults}` |
| `duo vault search <query> [--vault p]` | Case-insensitive full-text search (CLI twin of ⌘⇧F, D22). 200-hit default cap; `docMatchIndex` = body-occurrence index (`null` for frontmatter hits). ENH-214: search SEES `templates/` (unlike the graph walk) — hits there carry `isTemplate: true` | JSON `[{path, absPath, line, excerpt, docMatchIndex, isTemplate}]` |
| `duo vault mv <from> <to> [--vault p]` | **ENH-216 D5 (clean path)** — move a note (vault-relative POSIX paths) and rewrite every inbound markdown link to its new home, re-basing the moved note's own outbound links. Throws on a dest collision (never clobbers). Prefer over `duo file rename` / shell `mv` for OKF vault notes | JSON `{fromRel, toRel, inboundRewritten:[{fromRel, count}], outboundRebased}` |
| `duo vault relink [--dry-run] [--vault p]` | **ENH-216 D5 (out-of-band repair)** — re-resolve dangling markdown links by their slug/basename key first; the stable frontmatter `id:` (D10) only tiebreaks when >1 note shares a slug (OKF hrefs don't embed the id, so this path is rare); rewrite the unambiguous ones, REPORT ambiguous + broken (warn-don't-block). Auto-runs on vault open; this verb is the headless/inspection twin. `--dry-run` reports without writing | JSON `{repaired:[{fromRel, oldHref, newHref, via:'id'\|'slug', targetRel}], ambiguous[], broken[]}` |
| `duo vault publish [--index-only\|--log-only] [--dir] [--open] [--vault p]` | **ENH-216 D8** — (re)generate the OKF static listings from the corpus: root index (OKF section-6 bullets; frontmatter byte-preserved, body after the `<!-- duo:listing -->` fence) + log (section-7, `## YYYY-MM-DD` from mtimes). **ENH-245:** filenames are `_index.md`/`_log.md` by default, or the legacy `index.md`/`log.md` for a vault that already uses it (resolved from whichever is on disk; never mixed). `--dir` adds per-folder index files; `--index-only`/`--log-only` narrow; `--open` surfaces the root index as a tab. OKF-mode-gated (throws in Obsidian mode). ENH-230: a `listing:` base spec in the root index frontmatter drives the body through the shared engine instead of the group-by-type default; an authored-but-unusable spec falls back and is reported in `warnings` (also echoed to stderr) | JSON `{mode, written[], warnings[]}` |
| `duo vault promote <note> --heading "<h>" --type <t> [--vault p]` | **ENH-216 D9** — split a `## heading` section into its own typed entity (D19-filed), removing it from the source note and leaving a markdown LINK behind (a `[[wikilink]]` in Obsidian) — NEVER an embed-transclusion. Heading matched case-insensitively | JSON `{entityRel, leftLink, created}` |
| `duo graph backlinks <note> [--vault p]` | Notes linking to `<note>` — both wikilinks (basename-resolved) AND markdown relative links (ENH-216) are edges; scans frontmatter + body | JSON `[{path, absPath, line, excerpt}]` |
| `duo graph orphans [--vault p]` | Notes with no inbound and no outbound links (a processing work-list) | JSON `string[]` |
| `duo base lint <file\|--all> [--vault p]` | Validate a base against the corpus (bad types / unresolved `[[entities]]` / off-enum / unknown fns), each with a "did you mean"; advisory, never blocks (D15) | JSON `[{source, findings[]}]` |
| `duo base render <file\|note> [--out p] [--open]` | Evaluate filters/formulas over live frontmatter → a stamped Duo-owned HTML artifact (D13/D16); `--open` surfaces it as a tab | JSON `{path, sourceHash, bases[], warnings?}` (**ENH-255 review:** `warnings` = filter eval-errors, same shape as `rollup render`; also on stderr) |
| `duo rollup render <note\|base> [--html\|--md] [--style css] [--summary "t"\|--no-summary] [--out p] [--open]` | **ENH-229 · ENH-228** — render a rollup spec → one variant: `--html` (stamped, **the default** — D2) OR `--md` (GFM); mutually exclusive. A `type: rollup` NOTE owns its spec (embedded ` ```base ` / `spec:` path); rendering it defaults out to its `out:` + stamps `out`/`last_generated`/`last_hash` back surgically. Rows link the entities they roll up (note + owner/group, incl. OKF rel-md; req #6). `--style` layers CSS (HTML only). Change summary (req #7): self-embedded snapshot + summary log; `--summary` adds the latest "What changed", `--no-summary` clears. **ENH-255:** filter eval-errors are surfaced (⚠ stderr + `warnings[]` + artifact banner — never a silent empty view); declared `groups:` buckets render even when empty | JSON `{path, format, rollupNote?, stamped?, sourceHash, summaries, bases[], warnings?}` |
| `duo rollup list [--vault p]` | **ENH-228** — the rollup inventory: every `type: rollup` note (in `rollups/`) with `{note, title, out, format, last_generated, last_hash, stale}` (`stale = last_hash !== live source hash`). A `type == rollup` corpus query — no scan, no sidecar (D1); the Vault view's Rollups column | JSON `{root, rollups[]}` |
| `duo rollup diff <note\|base> [--against p] [--vault p]` | **ENH-229** — deterministic delta vs the prior artifact's embedded snapshot (newest of both formats; added/removed/changed rows + removed views); the material Claude turns into a `--summary` | JSON `{priorArtifact, diff{}}` |
| `duo rollup new --type <t[,t2]> [--title "t"] [--group a,b] [--bucket v[=Label]]... [--filter k=v\|k!=v\|k~=v\|k?\|k!?]... [--columns a,b] [--vault p]` | **ENH-243** — scaffold a builder-canonical `type: rollup` note (the Rollups tab's CLI twin); ordered `--group` = multi-depth grouping (level 1 in the base block, full list in `group_by:` frontmatter). **ENH-255:** `k~=v` = membership on a multi-valued field (list-of-links matched by note IDENTITY, not display text); `--bucket 'value[=Label]'` declares level-1 buckets that always render — even empty — in flag order (needs `--group`; splits at the first unescaped `=`, `\=` escapes a literal `=` in the value) | JSON `{root, note, absPath, model}` |
| `duo rollup show <note> [--vault p]` | **ENH-243** — parsed builder model + row summary (`model:null` = hand-authored/view-only; `error` set = broken). **ENH-255:** `warnings[]` = filter eval-errors (check before trusting a zero-row rollup); `buckets[]` = declared buckets (label + matched key, null = empty) | JSON `{root, note, title, model, groupBy, buckets, warnings, columns, rowCount, error}` |
| `duo rollup set <note> [--title\|--type\|--group\|--columns] [--bucket …]... [--clear-buckets] [--filter …]... [--clear-filters] [--links github\|relative] [--vault p]` | **ENH-243/248** — mutate a builder-canonical rollup (filters append unless `--clear-filters`; **ENH-255:** `--bucket` replaces the bucket list wholesale — order is render order; `--clear-buckets` drops them); refuses hand-authored specs. `--links github` persists the entity-link mode (works alone + on hand-authored notes) | JSON `{root, note, model?, links?}` |
| `duo rollup doctor <note> [--vault p]` | **ENH-243** — diagnosis: parse/eval error + advisory lint + repair guidance (what the GUI's "Fix with Claude" seeds) | JSON `{root, note, healthy, editable, error, lint, fix}` |
| `duo rollup markdown <note> [--vault p]` | **ENH-244** — "Copy as Markdown" CLI twin; one GFM table to stdout, title-linked to the GitHub blob (GitHub-remote repo, current HEAD branch) or a vault-relative `./path` otherwise; one git probe for the whole table. **ENH-255 review:** filter warnings render as a `> ⚠` blockquote (+ stderr); declared buckets render as sections (empty ⇒ — none —) | raw markdown on stdout (warnings on stderr) |
| `duo rollup delete <note> --force [--vault p]` | **ENH-248 R6** — remove the definition note AND its rendered artifact; without `--force` a dry run prints `wouldDelete` (mechanical destructive guard). GUI twin: the rail row menu | JSON `{root, deleted}` |
| `duo rollup duplicate <note> [--vault p]` | **ENH-248 R6** — copy as `"<Title> (copy)"`, provenance stripped; works on hand-authored notes | JSON `{root, note, absPath}` |
| `duo rollup render … --github` | **ENH-248 R8** — entity links as GitHub blob URLs for this render (stderr warn + relative fallback without a GitHub remote); `links: github` frontmatter opts a note in permanently | (render output as above) |

The Phase-2 renderer layer shipped (2026-06-10) with UI↔verb twins
throughout: the Settings → Default Vault picker ↔ `duo vault default`, the
⇧⌘N quick-capture chord ↔ bare `duo vault capture`, the ⌘⇧F vault-search
palette ↔ `duo vault search`, and the silent-stub type-picker ↔
`duo vault stub` (same code path). `@today` smart tokens stay a deliberate
human-only convenience (agents write dates directly — no verb). One
deliberate UI-only asymmetry: the type-picker's "+ new type…" writes
`templates/<type>.md` directly — agents create a type by writing the
template file; there is no verb.

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
terminal tab from the CLI was the remaining gap; **ENH-212 (Home) closed it
2026-06-12** with `duo term tabs` (enumerate) + `duo term tab <id>` (activate).
Since Duo terminals are *the place the agent lives*, terminal-tab switching
was the last parity hole here — now closed (`duo term close`/`duo term write`
below remain optional follow-ups).

| Verb | UI parallel | Shape |
|---|---|---|
| ✅ `duo new-tab [--shell\|--claude] [--cwd <path>] [--cmd <cmd>]` | `⌘T`/`⌘⇧T`, split-button `+` (claude) / `>` (shell) | **Shipped 2026-04-26 (Stage 19c D27).** Returns `{id, kind, cwd, title}`. `--claude` (and the `+` button) auto-launches `claude` after the shell starts; `--shell` opens vanilla. No flag follows the user's most recent manual choice (`localStorage['duo.lastNewTabKind']`, default `'claude'`). `--cmd` pre-types (no Enter) — overlaps intentionally with Backlog `duo tab (was 15d) --cmd`; lock semantics at 15d kickoff. Renamed from `duo term new` per Stage 19 D27. |
| ✅ `duo term tabs` | Visible strip | **Shipped 2026-06-12 (ENH-212).** Returns `{tabs: [{id, kind, cwd, title, active}], activeTabId}` — reads the renderer's `__duoGetLayout().terminal` (always-fresh). Honors `--window N`. |
| ✅ `duo term tab <id>` | `⌘1-9`, tab click | **Shipped 2026-06-12 (ENH-212).** Activates the tab by its `id` (from `duo term tabs` — NOT a bare index; `duo tab <n>` owns the browser number space). Pushes `TERMINAL_ACTIVATE_TAB`; a stale id is a harmless no-op. Closes the documented P0 gap. |
| ✅ `duo term close <id> [--force]` | `⌘W` in terminal focus, × on chip | **Shipped 2026-06-12 (ENH-212).** Closes the tab by `id` (from `duo term tabs`); kills its PTY via the renderer's `closeTab` (floor-of-1 + closed-tab ring preserved). Refused when a live `claude` runs in the tab unless `--force` (BUG-200 data-loss caution). Complements the by-index `duo close-terminal-tab [<n>]` (FOLLOWUP-020). |
| `duo term write <id> <data>` | User typing | Synthesize input (separate from `--cmd` which is pre-type + no Enter) |

**Note:** current `duo tab <n>` and `duo close <n>` address browser tabs.
The terminal parallel needs its own namespace to avoid the number-space
collision. The new-tab verb is in the bare `duo new-tab` namespace
(not `duo term`) per Stage 19 — agent-readable shape `{id, kind, cwd,
title}` + tab-strip primary affordance ("`+` = claude") justify
top-level placement.

### Scheduling (cron) — ENH-223 Tier 1 (engine + CLI)

Scheduled ("cron") Claude sessions. A job is a saved recipe (cwd + initial
instruction + periodicity + fresh/same-session) that Duo's in-app scheduler
fires **while Duo is open** by opening an **interactive** Claude terminal tab
seeded with the instruction. Duo only does session start + initial instruction;
all execution stays interactive — headless `-p`/`--print` is rejected at spawn
time (gated by `FEATURE_HEADLESS_CRON`, default off, not in the UI — D4). Single
`cron` socket command with a discriminated `op`, delegated to the main-process
`CronService` (owns `~/.claude/duo/cron-jobs.json` + the tick scheduler). The
run's landing window is resolved from the job's cwd (D10), not `--window`.

| Verb | UI parallel | Shape |
|---|---|---|
| ✅ `duo cron list` | Home "Scheduled" rows (Tier 2) | **Shipped (ENH-223 Tier 1).** `CronJobView[]` — each job + computed `nextFireAt` + human `scheduleLabel` + last-run status. Each carries a `kind` (`claude` \| `shell`, ENH-237). |
| ✅ `duo cron add --name <n> --cwd <path> (--say "<instruction>" [--session fresh\|same] \| --run "<command>") (--every hourly\|daily\|weekdays\|weekly [--at HH:MM] [--on <weekday>] \| --cron "<expr>") [--catch-up]` | "+ Schedule" / File ▸ New Scheduled Job (Tier 2) | **Shipped (ENH-223 Tier 1; `--run` ENH-237).** Creates a job. **`--say`** → a **claude** job: fresh runs pre-allocate the session id (`claude --session-id <uuid> "<instruction>"`, D3); `--session same` resumes the prior run's session (`claude --resume <uuid> …`), falling back to fresh if it's gone. **`--run`** → a **shell** job: runs the raw single-line command in a background terminal tab, no Claude session, no headless gate (mutually exclusive with `--say`/`--session`). `--catch-up` = run once on next launch if an occurrence was missed while closed (D5). Returns `CronJobView`. |
| ✅ `duo cron edit <id> [--name <n>] [--cwd <path>] [--say "<instruction>" \| --run "<command>"] (--every <preset> [--at HH:MM] [--on <weekday>] \| --cron "<expr>") [--session fresh\|same] [--catch-up \| --no-catch-up]` | Home "Edit" row action (Tier 2) | **Shipped (ENH-223 Tier 2; `--run` + shell-job edit ENH-237).** Edits a job — only the flags you pass change; any schedule flag replaces the whole schedule; `--no-catch-up` turns catch-up off. `--run` patches a shell job's command (mutually exclusive with `--say`/`--session`); a schedule-only edit of a shell job preserves `kind:shell` + its command. Returns `CronJobView`. |
| ✅ `duo cron show <id>` | Job row detail (Tier 2) | **Shipped (ENH-223 Tier 1).** One job's `CronJobView`. |
| ✅ `duo cron run <id>` | "Run now" row action (Tier 2) | **Shipped (ENH-223 Tier 1).** Fires a job now (manual), same path as a scheduled fire. Returns `CronJobView`. |
| ✅ `duo cron pause <id>` / `duo cron resume <id>` | Pause/resume toggle (Tier 2) | **Shipped (ENH-223 Tier 1).** Disable / re-enable without deleting (paused jobs persist but never fire). Returns `CronJobView`. |
| ✅ `duo cron rm <id>` | Delete row action (Tier 2) | **Shipped (ENH-223 Tier 1).** Deletes a job. Returns `{ ok, removed }`. |
| ✅ `duo attention --state set\|clear [--tab <id>]` | The "waiting on you" tab badge (ENH-225) | **Shipped (ENH-225).** Set/clear a terminal tab's attention badge. Primarily driven by Duo's managed Stop/Notification (set) + UserPromptSubmit (clear) hooks (keyed on `$DUO_TAB`); exposed for parity so an agent can flag a tab needing the user. `--tab` defaults to `$DUO_TAB`; the badge also clears on tab focus. Returns `{ ok, tabId, needsAttention }`. |

**Tier 2 (Home surface) + ENH-225 (the "waiting on you" tab badge) are tracked
separately** — see `docs/prd/enh-223-scheduled-sessions.md`.

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

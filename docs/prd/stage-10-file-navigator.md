# Stage 10 PRD — File navigator / context drawer + layout reshape

> **Status:** spec locked 2026-04-23. In progress.
> **Supersedes:** the ROADMAP "Stage 10" section for everything below.
> **References:**
> - [docs/VISION.md](../VISION.md) — north star, file browser / context drawer
> - [docs/research/file-navigator-v1.md](../research/file-navigator-v1.md)
>   — current CWD plumbing + data-model sketch
> - [docs/DECISIONS.md § Layout model](../DECISIONS.md#layout-model--working-pane-model--resolved-by-owner)
>   — three-column layout + unified tab strip

---

## 1. What we're building

Stage 10 delivers three things in one release:

1. **A file navigator** in the leftmost column — tree-based, always
   showing *somewhere on disk*, drivable by both the user and the agent.
2. **The layout reshape** — terminal moves from today's left column
   to the middle; the browser pane on the right is hoisted into a
   polymorphic **WorkingPane** that hosts any tab type (browser today;
   editor and preview in this stage + Stage 11).
3. **The file-render story for non-`.md` types** — clicking a file
   opens it in the WorkingPane as a new tab. `.md` renders as a
   read-only preview (Stage 11 ships the editor). Images/PDFs render
   in-place. Everything else offers "Open with default app."

These pieces are atomic: one visual release, one PR if the diff stays
manageable.

**Out of scope:** the actual markdown **editor** (that's Stage 11),
file operations (rename/delete/new), git status decorations, drag-
file-to-conversation. All noted as follow-ups.

---

## 2. Personas + jobs to be done

**Primary persona:** PM who doesn't type file paths. They want to see
their folders, click on a PRD, read it, maybe spawn a terminal "in
this project" without knowing what "CWD" means.

Jobs this stage does:
- "Show me what's in this folder."
- "Let me click a .md file and read it."
- "When I hit the new-terminal button, open it in the folder I'm
  looking at."
- "When Claude modifies a file I'm looking at, tell me."
- "When Claude says `I updated /foo/bar.md`, show me where that is."

Jobs this stage does NOT do:
- Rename / delete / new files (terminal still works for those).
- Edit markdown — Stage 11.
- Git status per file — a later stage.

---

## 3. Resolved decisions

| # | Area | Decision |
|---|---|---|
| D1 | **Follow mode** | Navigator tracks the active terminal tab's launch CWD by default. A pin icon in the navigator header lets the user freeze the navigator independently. |
| D2 | **Persistence** | Navigator folder + tree-expansion state persist across relaunches. Stored as JSON in Electron's `userData` dir. |
| D3 | **Scope** | Anywhere the user can read on disk. No `$HOME` sandbox. |
| D4 | **Click model** | Single click expands folders and opens files. Double click is not required. |
| D5 | **Column chrome** | Resizable (180–360px) + collapsible. `⌘B` toggles. Collapsed state is a narrow icon rail, not fully hidden. |
| D6 | **Dotfile visibility** | Dotfiles hidden by default **except `.claude/` directories and their contents**, which are always visible. A toggle shows all dotfiles. |
| D7 | **Icons** | Per-type SVG icons (folder, `.md`, `.png`, `.pdf`, `.csv`, `.ts/.js/.py`, generic file). Small bundled set. |
| D8 | **Breadcrumb** | Clickable breadcrumb bar at the top of the navigator (`~ / Documents / GitHub / duo`). |
| D9 | **Pending CWD rule** | The navigator's current view is the pending CWD for the next new terminal tab. If a **file** is selected, pending CWD is the file's **parent directory**. |
| D10 | **Pending CWD indicator** | Tooltip on the terminal-tab `+` button only ("Will launch in `<folder>`"). No always-visible label. |
| D11 | **Right-click menu (v1)** | Open terminal here (folders), Reveal in Finder, Copy path, Open with default app, Open in Duo editor (Stage 11-ready). |
| D12 | **`.md` click (v1)** | Opens a read-only rendered preview in a new WorkingPane tab. Images render inline; links are clickable (open via `duo open` plumbing). Stage 11 replaces this with the editor. |
| D13 | **Already-open file** | Clicking a file that's already open in a WorkingPane tab **switches** to that tab (identity = absolute path + type). Does not create a duplicate. |
| D14 | **Tab titles** | Filename only, with the absolute path in the tooltip. Duplicate basenames disambiguated with `basename – parent/`. |
| D15 | **Unknown file types** | Open a small card in a new WorkingPane tab: filename, size, mtime, and an "Open with default app" button that calls macOS `open`. |
| D16 | **`duo reveal`** | Navigator jumps to the path immediately + a dismissible chip ("Claude moved to /foo/bar") fades in at the top of the navigator. |
| D17 | **`duo view`** | New CLI command that opens a file in the WorkingPane as a new tab (type inferred from extension). Distinct from `duo open` (reserved for browser / HTML). |
| D18 | **File watcher** | Live file watcher (via `chokidar`) keeps the tree + working-pane previews in sync. Debounced; scoped to the visible subtree plus expanded descendants. Same infrastructure will feed Stage 11b (agent-change highlight). |
| D19 | **Drag-and-drop (v1)** | Deferred. Architecture does not preclude it (drop target + PTY injection plumbing remain open), but the affordance does not ship in Stage 10. |
| D20 | **File ops (rename / delete / new)** | Deferred. Users do these in the terminal for now. |
| D21 | **Reshape shape** | Atomic — one release adds the Files column, moves the terminal to middle-top, hoists the browser tab strip into a `WorkingPane`. |
| D22 | **Expand memory** | Tree expansion state is persisted by absolute path in `userData`. Expansions survive folder changes and relaunches. |
| D23 | **Git status badges** | Deferred. |
| D24 | **First-launch default** | Navigator opens at `$HOME` if no persisted state exists. Once a session exists with tabs, follows the active tab (see D1). |
| D25 | **Preview tab semantics** | **Always** opens a new tab per click (no VS Code-style "preview tab" with italic title). Selection == intent; users close what they don't need. |
| D26 | **Tab type indicators** | Each tab shows a small leading SVG icon indicating its type (browser globe, editor pencil, image thumbnail, etc.). Same icon set as the navigator. |
| D27 | **Tree keyboard nav** | Arrow keys move selection, ←/→ collapse/expand, Enter opens, typing characters = typeahead to matching sibling name. |
| D28 | **Markdown preview scope** | Full preview: renders inline images (resolves paths relative to the file), makes links clickable (internal `.md` links open as new preview tabs; external URLs open as new browser tabs via `duo open`). |
| D29 | **`⌘W` semantics** | Focus-aware — closes the active tab in the currently-focused column (terminal tab if terminal is focused; WorkingPane tab if WorkingPane is focused). |
| D30 | **`⌘1`–`⌘9`** | Unchanged — jumps terminal tabs. **`⌘⇧1`–`⌘⇧9`** is new: jumps WorkingPane tabs. |
| D31 | **Focus indicator** | Subtle 1px accent border on the currently-focused column. Enables focus-aware shortcuts to be discoverable. |
| D32 | **Narrow window behavior** | Below ~1100px total width, the Files column auto-collapses to the icon rail. Expanding it manually at narrow widths respects the user's override. |

---

## 4. Data model

New renderer-side app state (in `App.tsx`):

```ts
interface NavigatorState {
  cwd: string                           // absolute path currently shown
  selected: { path: string; kind: 'file' | 'folder' } | null
  expanded: Set<string>                 // absolute paths of expanded folders
  pinned: boolean                       // follow-mode override
  showDotfiles: boolean                 // toggle; default false
  collapsed: boolean                    // column collapsed to rail?
  revealChip: { text: string; id: number } | null  // dismissible agent-reveal chip
}
```

Derived:

```ts
const pendingCwd =
  nav.selected?.kind === 'file' ? dirname(nav.selected.path)
  : nav.selected?.kind === 'folder' ? nav.selected.path
  : nav.cwd
```

New WorkingPane tab record (replaces today's narrow `BrowserTab`):

```ts
type WorkingTabType = 'browser' | 'markdown-preview' | 'image' | 'pdf' | 'unknown'
  // Stage 11 adds 'markdown-editor' later.

interface WorkingTab {
  id: number                       // 1-based, continuous across types
  type: WorkingTabType
  title: string                    // filename for file tabs; page title for browser
  // Type-specific:
  url?: string                     // browser
  path?: string                    // file tabs
  mime?: string                    // file tabs
  isActive: boolean
}
```

New focus state:

```ts
type FocusedColumn = 'files' | 'terminal' | 'working'
const [focusedColumn, setFocusedColumn] = useState<FocusedColumn>('terminal')
// Wired from click handlers and `focus` events on each column root element.
```

---

## 5. IPC additions

```ts
// shared/types.ts
FILES_LIST: 'files:list'                // (path) → { entries: DirEntry[] }
FILES_READ: 'files:read'                // (path) → { bytes: ArrayBuffer; mime: string }
FILES_WATCH: 'files:watch'              // (paths[]) → subscription; fires FILES_CHANGED
FILES_CHANGED: 'files:changed'          // main → renderer
FILES_OPEN_EXTERNAL: 'files:open-ext'   // (path) → spawn `open path`
FILES_REVEAL_IN_FINDER: 'files:reveal'  // (path) → spawn `open -R path`

NAV_STATE_GET: 'nav:get'                // for duo CLI → renderer bridge
NAV_STATE_SET: 'nav:set'                // agent-driven reveal
```

Where they live:
- **Main process**: `electron/files-service.ts` (new) — handles list / read /
  watch / external-open / reveal via Node `fs` + `chokidar` + `shell`.
- **Preload**: `electron/preload.ts` gains `window.electron.files.{list,read,watch,openExternal,revealInFinder}`.
- **Renderer hook**: `renderer/hooks/useNavigator.ts` (new) — wraps the
  state machine above and the IPC calls.

---

## 6. CLI additions

New socket commands (wired through `electron/socket-server.ts` and
`cli/duo.ts`):

| Command | Purpose | Output |
|---|---|---|
| `duo view <path>` | Open the file in the WorkingPane as a new tab (or switch to the existing tab if already open). Type inferred from extension. | JSON: `{ok, id, type, title, path}` |
| `duo reveal <path>` | Move the navigator to `<path>` + fire the chip. | JSON: `{ok, cwd}` |
| `duo ls [path]` | Return directory listing (for agent pull-model). Defaults to navigator's current folder. | JSON array |
| `duo nav state` | Current navigator state. | JSON: `{cwd, selected, pinned, expanded}` |

`duo open` (Stage 8) stays browser-only. The skill + subagent docs get
a line clarifying the `view` vs `open` distinction.

---

## 7. Layout reshape mechanics

Today:

```
┌──────────────┬──────────────────────────────────┐
│  Terminal    │         BrowserPane              │
│  (left col)  │   (BrowserTabStrip + WebContents)│
└──────────────┴──────────────────────────────────┘
```

After Stage 10:

```
┌────┬─────────────────┬─────────────────────────┐
│    │                 │ WorkingPane             │
│Files│   Terminal     │ (WorkingTabStrip +      │
│    │   (middle-top) │  per-type renderer)     │
│    ├─────────────────┤                         │
│    │ (Stage 12       │                         │
│    │  agent tools,   │                         │
│    │  placeholder)   │                         │
└────┴─────────────────┴─────────────────────────┘
```

Specific mechanical changes:

- **New component: `FilesPane`** — left column. Owns the navigator
  tree, breadcrumb, pin, collapse.
- **Terminal**: existing `TerminalPane` stays; its parent CSS grid cell
  moves from left to middle-top. Zero changes to xterm.js plumbing.
- **Middle-bottom placeholder** — reserved element with a border; renders
  nothing until Stage 12. The cell collapses flat (`height: 0`) when
  agent tools are absent, giving the terminal the full middle column.
- **`WorkingPane`** (new wrapper) — absorbs today's `BrowserPane`:
  - Its tab strip hoists today's `BrowserTabStrip` concept to handle
    any `WorkingTabType`, prefixed with a type-icon chip.
  - The `WebContentsView` rendering path stays exactly as it is for
    browser-type tabs.
  - For non-browser types, the corresponding in-renderer component
    mounts (MarkdownPreview / ImagePreview / PdfPreview / UnknownFile).
- **Focus management** — each column root `<div>` participates in focus
  tracking; clicks update `focusedColumn`. The Electron app menu's
  `⌘W` handler branches on `focusedColumn`.
- **Auto-collapse** — the App-level container listens to window width
  via `ResizeObserver`; below threshold flips `navigator.collapsed` to
  true (user can still manually re-expand).

---

## 8. Components (new + changed)

| Component | New / Existing | Notes |
|---|---|---|
| `FilesPane` | New | Wraps breadcrumb + tree + pin + collapse rail. |
| `Breadcrumb` | New | Clickable path segments, leading `~`. |
| `FileTree` | New | Virtualized list of file rows; lazy-loads children on expand. |
| `FileTreeNode` | New | Single row: chevron, icon, name, optional badge. |
| `CollapsedRail` | New | Narrow icon strip when column is collapsed. |
| `RevealChip` | New | Dismissible "Claude moved to …" chip at the top of the navigator. |
| `WorkingPane` | New (hoist) | Shell with unified tab strip. Absorbs today's `BrowserPane` layout. |
| `WorkingTabStrip` | New (hoist) | Replaces `BrowserTabStrip`; renders type-icon prefix + disambiguated title. |
| `MarkdownPreview` | New | Renders a `.md` file to HTML via `remark` + `rehype`. Resolves relative images. Links wired through `duo open` for external, new preview tab for internal `.md`. |
| `ImagePreview` | New | Native `<img>` in a centered container. |
| `PdfPreview` | New | Electron's built-in PDF renderer (`<embed>`). |
| `UnknownFile` | New | Card with size / mtime / "Open with default app" button. |
| `BrowserPane` | **Removed** | Content absorbed into `WorkingPane` (browser renderer is one of the per-type renderers). |
| `BrowserTabStrip` | **Removed** | Absorbed into `WorkingTabStrip`. |
| `TerminalPane` | Unchanged | Grid cell moves; component itself untouched. |
| `App` | Changed | CSS grid for three columns + middle-row split; focus state; ⌘B; ⌘W routing; ⌘⇧1–9. |

---

## 9. State persistence

`~/Library/Application Support/duo/state.json`:

```json
{
  "version": 1,
  "navigator": {
    "cwd": "/Users/geoff/Documents/GitHub/duo",
    "expanded": ["/Users/geoff", "/Users/geoff/Documents/GitHub/duo"],
    "pinned": false,
    "showDotfiles": false,
    "collapsed": false,
    "widthPx": 220
  },
  "workingPane": {
    "activeTabId": 2,
    "tabs": [
      { "id": 1, "type": "browser", "url": "https://example.com", "title": "Example" },
      { "id": 2, "type": "markdown-preview", "path": "/Users/…/duo/README.md", "title": "README.md" }
    ]
  }
}
```

Loaded synchronously at main-process startup; written via debounced
save-on-change from the renderer over a new `STATE_PERSIST` IPC.

---

## 10. Build plan (phased)

Ordered so each phase is individually testable. Rough T-shirt sizes
in parentheses.

### Phase 1 — Main-process file-system service (S)
- `electron/files-service.ts`: `list`, `read`, `watch`, `openExternal`, `revealInFinder`.
- `chokidar` dep + watch debouncer.
- IPC channels registered in `main.ts`.
- Preload `window.electron.files.*` exposed.
- Shared types + `DuoCommandName` additions.

### Phase 2 — Layout reshape skeleton (M)
- `App.tsx` → CSS grid with three named columns + middle-row split.
- Terminal cell moves to middle-top. Placeholder cell for middle-bottom.
- Empty `FilesPane` placeholder (stubbed) in left column.
- Focus state + accent-border styling.
- `⌘W` focus-aware routing.
- `⌘B` toggle for `FilesPane`; auto-collapse on narrow width.
- Nothing visible from the navigator yet; just the shape.

### Phase 3 — WorkingPane unification (M)
- Create `WorkingPane`; fold today's `BrowserPane` into it as the
  browser renderer for `type: 'browser'` tabs.
- `WorkingTabStrip` with type-icon prefixes.
- Tab records gain `type`, `path`, `mime`. Back-compat: `url` only for
  browser tabs.
- `⌘⇧1`–`⌘⇧9` → working-pane tab switcher.
- No regressions vs today's browser behavior.

### Phase 4 — Navigator UI (L)
- `FilesPane`: breadcrumb + tree + pin + collapsed rail.
- `FileTree` with lazy-load on expand, virtualization if needed.
- Tree keyboard nav: arrows, ←/→, Enter, typeahead.
- Per-type SVG icons + dotfile filter (always show `.claude/*`).
- Follow-mode wiring: active terminal tab switch updates `nav.cwd` unless pinned.
- Pending-CWD hook for `newTab()`; tooltip on `+` button.
- Click a folder → expand; click a file → open via WorkingPane.

### Phase 5 — File renderers in WorkingPane (M)
- `MarkdownPreview` (remark + rehype, relative image resolution, link dispatch).
- `ImagePreview` (img tag).
- `PdfPreview` (Electron built-in).
- `UnknownFile` (card with Open with default app).
- Type inference from extension at tab-open time.

### Phase 6 — Agent-facing CLI + chip (S)
- `duo view <path>` → opens or switches to WorkingPane tab for the file.
- `duo reveal <path>` → moves navigator + fires chip.
- `duo ls [path]` + `duo nav state`.
- `RevealChip` component: auto-dismiss after ~4s; X to dismiss.

### Phase 7 — State persistence + right-click menu (S)
- `state.json` read/write in main; debounced persist on change.
- Right-click menu on navigator rows: Open terminal here (folders), Reveal in Finder, Copy path, Open with default app, Open in Duo editor.
- First-launch default: `$HOME` when no persisted state.

### Phase 8 — Polish + docs (S)
- Skill + subagent docs updated with `duo view` / `duo reveal` patterns.
- README + ROADMAP updated to reflect shipped state.
- `npm run sync:claude` as a final step.

**Estimated total:** ~14–20 days of focused work across the phases.
Ship as one PR where the diff allows; split into Phase 1+2 (plumbing
+ shape) vs Phase 3+ (visible new features) if the PR becomes
unreviewable.

---

## 11. Testing approach

- **Phase 1**: unit tests (or at least scripted `Bash` against the
  file-service IPC) for `list` / `read` / `watch`.
- **Phase 2**: visual smoke test only — terminal still types,
  browser still renders at new position.
- **Phase 3**: all Stage 8 tests (open, close, tab, navigate, CDP
  commands) must still pass verbatim. This is the regression gate.
- **Phase 4**: manual click-through — every keyboard binding,
  follow-mode toggle, pin toggle, tree lazy-load. Include a
  typeahead test against a folder with many siblings.
- **Phase 5**: open a sample `.md` with an inline image + internal and
  external links. Verify image loads, internal link opens a new
  preview tab, external link opens a browser tab.
- **Phase 6**: fresh Claude Code session inside a Duo terminal ran
  through `duo view /path/to/thing` and `duo reveal …` — verify
  chip + navigator jump + preview tab creation.
- **Phase 7**: quit Duo, relaunch, verify navigator state restored;
  right-click a file, every menu item works.
- **Phase 8**: the skill picks up the new commands; a fresh Claude
  Code session autonomously uses `duo view` when asked "show me the
  PRD."

---

## 12. Risks + mitigations

| Risk | Mitigation |
|---|---|
| File watcher churn (`chokidar` on `node_modules`) | Scope watchers to visible subtree + expanded descendants only. Don't watch recursively across everything. |
| Markdown renderer security (XSS from a doc with script tags) | Use `rehype-sanitize` in the remark pipeline. Never `dangerouslySetInnerHTML` without it. |
| CSS grid reshape breaking the browser `WebContentsView` bounds sync | Phase 2 smoke test covers this explicitly before Phase 3 touches tab code. |
| Tree performance on very large folders (10k+ entries) | Virtualize (`react-window` or equivalent) if needed. Start simple, add virtualization only if perf warrants. |
| Lazy-load race (user double-clicks expand during a pending `files:list`) | Dedupe requests per path; cache the result until invalidated by the watcher. |
| `duo view` vs `duo open` agent confusion | Skill + subagent docs explicitly distinguish. Both stage-specific examples ship. |
| Auto-collapse feels jumpy on window-resize jitter | Debounce the width threshold check (~150ms). User's explicit expand overrides until they manually collapse again. |

---

## 13. Open questions (not blocking)

Items left deliberately under-specified; decide during implementation:

- Exact SVG icon set (which file types warrant their own icon vs the
  generic icon). Start with: folder, `.md`, `.png`/`.jpg`/`.gif`,
  `.pdf`, `.csv`, `.ts/.js/.py/.go/.rb/.sh` (single "code" icon),
  `.html`, generic. Expand from feedback.
- Animation timing for the reveal chip (fade in/out, auto-dismiss
  duration).
- Typeahead timeout before the search string resets (default: 1000ms).
- When the user collapses the navigator while a file is selected,
  does the selection persist across collapse / expand? Assume yes
  (keep state, just hide view) unless it feels wrong.

---

## 14. Post-Stage 10

Stage 10 explicitly does **not** deliver:

- The `.md` editor (`Stage 11`).
- Drag-file-to-conversation (future sub-stage; architecture doesn't
  block it).
- File ops (rename / delete / new).
- Git status badges.
- Cozy-mode terminal typography (`Stage 9` lands in parallel or
  after — independent work).

After Stage 10 ships, the natural next move is **Stage 11** — the
collaborative markdown editor replaces `MarkdownPreview` with a full
editing surface, and the `Open in Duo editor` right-click item (D11)
activates.

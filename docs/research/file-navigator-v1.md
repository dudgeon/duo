# File Navigator v1 — research note

> Grounds the Stage 10 spec. The navigator is the leftmost column in
> the locked three-column layout and has deep interaction with terminal
> sessions — specifically, the "initialization scope" (PTY launch CWD)
> of the current / focused terminal, and how navigator selection drives
> where the next terminal session will initialize.
>
> Before coding, this note maps the current CWD plumbing in Duo,
> identifies the seams where the navigator has to hook in, and names
> the UX flows + open decisions for v1.

---

## TL;DR

**What's already true in Duo today:**

- Each `TabSession` carries its own `cwd: string`
  ([`shared/types.ts:3-7`](../../shared/types.ts)). This is the
  PTY's *launch* directory — captured at `pty.spawn`, fixed for the
  life of the tab.
- Today every new tab initializes at `$HOME` (`App.tsx:makeTab()`
  lines 8–14). There's no mechanism for "new tab should launch in
  this folder."
- `SkillsPanel.tsx` already receives the active tab's `cwd` and
  displays a truncated form (line 8), so the per-tab CWD is
  renderer-accessible.
- A working `electron/skills-scanner.ts` already consumes launch CWD
  to find project skills. It's not wired to IPC yet, but the data
  shape is exercised.

**The navigator integrates via two small additions:**

1. An app-level **`navigatorCwd`** state (what the navigator is
   currently showing). Starts at the active tab's launch CWD;
   controllable by user.
2. A **pending-CWD** behavior on new-tab creation: when the user
   clicks the `+` / uses `⌘⇧T`, the navigator's current folder
   becomes the new tab's launch CWD.

That is the thread that makes VISION's "drag file into conversation"
and "open terminal here" flows honest without breaking the existing
per-tab-CWD invariant.

---

## 1. Current CWD plumbing (reality check)

Traced via the Explore agent; verified against source.

```
renderer                                                main
─────────                                               ────
App.tsx:makeTab()  →  TabSession { cwd: $HOME }
  cwd hardcoded ─────┐
                     │
TerminalPane.tsx     │
  useEffect(tab.id)  │
    window.electron.pty.create(tab.id, undefined, tab.cwd)
                           │
              preload.ts: ipcRenderer.invoke(IPC.PTY_CREATE, {id, shell, cwd})
                           │
                      main.ts:ipcMain.handle(PTY_CREATE)
                           │
                      pty-manager.ts:create(id, shell?, cwd?)
                           │
                      node-pty.spawn(shell, [], { cwd, ... })
```

Key files + lines:

- [`shared/types.ts:3-7`](../../shared/types.ts) — `TabSession` shape
- [`renderer/App.tsx:8-14`](../../renderer/App.tsx) — `makeTab()` sets
  `cwd: window.electron.env.HOME`
- [`renderer/App.tsx:25-29`](../../renderer/App.tsx) — `newTab()`
- [`renderer/hooks/useKeyboardShortcuts.ts:33-37`](../../renderer/hooks/useKeyboardShortcuts.ts)
  — `⌘⇧T` → `newTerminalTab()`
- [`renderer/components/TabBar.tsx:34-42`](../../renderer/components/TabBar.tsx)
  — `+` button
- [`renderer/components/TerminalPane.tsx:119`](../../renderer/components/TerminalPane.tsx)
  — the actual `pty.create` call, keyed on `tab.id` + `tab.cwd`
- [`electron/pty-manager.ts:19-33`](../../electron/pty-manager.ts) —
  `create(id, shell, cwd)`; `DEFAULT_CWD = homedir()` from
  `electron/constants.ts:17`
- [`electron/skills-scanner.ts`](../../electron/skills-scanner.ts) —
  reads the launch CWD (not yet wired to IPC; Stage 12 absorbs this)
- [`renderer/components/SkillsPanel.tsx:8`](../../renderer/components/SkillsPanel.tsx)
  — existing consumer of `tab.cwd`

**Good news:** CWD is already per-tab and stable. We don't need to
reshape anything to add a navigator — we just need a way to set the
CWD at `makeTab()` time from a source other than `$HOME`.

---

## 2. Data model for v1

Add to `App.tsx` state:

```ts
// What the navigator is currently showing. Seeds next-tab CWD.
const [navigatorCwd, setNavigatorCwd] = useState<string>(
  // On first run, follow the active tab's launch CWD — which today is $HOME,
  // so effectively $HOME. When Stage 10 ships, the navigator drives.
  () => activeTab?.cwd ?? window.electron.env.HOME
)
```

`makeTab()` switches to:

```ts
function makeTab(cwd: string): TabSession {
  return { id: crypto.randomUUID(), title: 'Terminal', cwd }
}
```

`newTab()` reads `navigatorCwd` at call time:

```ts
const newTab = useCallback(() => {
  const tab = makeTab(navigatorCwd)
  setTabs(prev => [...prev, tab])
  setActiveTabId(tab.id)
}, [navigatorCwd])
```

No IPC additions needed for v1. The navigator mutates renderer state;
PTY creation already takes `cwd` as an argument.

---

## 3. Core UX flows

### Flow A — "What's the navigator showing right now?"

- **Default on app start**: navigator shows the active tab's launch
  CWD (which today is `$HOME` for the first tab).
- **When user switches terminal tabs**: the navigator **follows** to
  that tab's launch CWD — it's the shared "which project am I in"
  signal. This matches VISION's "context drawer" framing: the drawer
  reflects the project the current agent is working in.
  - Open question: is the follow sticky or opt-out? See §4.
- **When user clicks a folder in the navigator**: the navigator
  navigates. The active terminal tab is unaffected — its launch CWD
  was frozen at spawn. The *next* new tab will inherit whatever
  folder the navigator is showing.

### Flow B — "Open terminal here"

Two paths:

1. **User clicks `+` / `⌘⇧T` while navigator is at `/some/folder`** →
   new tab launches at `/some/folder`. No extra action required.
2. **User right-clicks a folder in the navigator → "Open terminal
   here"** → same outcome, but clearer. For v1, path 1 is enough;
   context menu is a polish item.

### Flow C — "Drag file into conversation"

Per VISION. Out of scope for Stage 10 v1 of the navigator spec itself
but must not be architecturally blocked:

- Electron supports HTML5 drag-drop between renderer elements.
- Drop target is the active terminal pane; on drop, inject `@<path>`
  (or the relevant harness syntax) into the PTY via
  `pty.write(activeTabId, '@' + path + ' ')`.
- Requires knowing whether the foreground process is Claude Code
  (which treats `@` specially) vs a bare shell (which just receives
  it as literal text). Safe to inject the literal; the agent will
  interpret or not.

### Flow D — "Click a file"

- `.md` → opens in a new working-pane tab (editor mode — Stage 11
  when ready; v1 of Stage 10 can show a read-only markdown preview as
  a placeholder).
- `.png` / `.jpg` / `.pdf` → opens in a preview tab.
- `.ts` / `.js` / `.py` / etc. → source preview (syntax-highlighted,
  read-only in Stage 10; editable later).
- Everything else → "Open in the browser via `file://`" as a
  fallback, or a hex/raw preview. Skip unknown types for v1.

Per the working-pane model, each of these **creates a new tab in the
unified Viewer/Editor strip**, not a modal or a navigator-side
preview.

### Flow E — Agent-driven reveal

Stage 7 committed: `duo reveal <path>` takes over the navigator and
jumps it to `<path>`. For Stage 10 v1:

- The CLI command stays.
- On reveal, navigator state updates → `navigatorCwd` moves →
  subsequent new tabs inherit the revealed folder.
- An alert chip at the top of the navigator (`"Claude revealed
  <folder>"`) surfaces the agent-driven change; clicking dismisses.
  Matches the "gentler reveal" sketch in old Stage 7.

---

## 4. Open decisions for v1

- [ ] **Navigator follow-mode on terminal-tab switch.** Does
      `navigatorCwd` track the active terminal tab automatically, or
      does the navigator hold its own state and only change when the
      user drives it?
      - *Recommend*: track by default, with a small "pin" control in
        the navigator header so power users can unpin. Most PMs will
        want follow-mode; a few (split across two projects at once)
        will appreciate the pin.

- [ ] **Where does the navigator live across app sessions?** Should
      it persist last-opened folder on relaunch?
      - *Recommend*: yes. Store `navigatorCwd` in Electron's
        `userData` via `app.getPath('userData') + /duo/state.json`
        (already a session-restore ambition in Stage 14; seeds that
        pattern).

- [ ] **Tree depth on first render.** All-ancestors-expanded or
      just-current-level?
      - *Recommend*: just the immediate children of the active CWD
        plus a breadcrumb trail up to `$HOME`. No full-disk
        expansion. Large node_modules would otherwise take over.

- [ ] **Hidden files and `.gitignore`.** Show or not?
      - *Recommend*: hide dotfiles by default with a toggle. Respect
        `.gitignore` is a deeper rabbit hole (parse rules, honor
        nested gitignores) — out of scope for v1. A "Hide ignored
        files" preference in v2.

- [ ] **CWD outside `$HOME`.** Can the navigator show any directory
      the user can read (`/`, `/Applications`, `/opt`, …) or only
      within `$HOME`?
      - *Recommend*: anywhere the user can read. VISION says "fully
        free" and the BYO-harness escape hatch assumes power-users
        can navigate the filesystem.

- [ ] **Project roots.** Should the navigator try to detect project
      roots (presence of `.git`, `package.json`, `CLAUDE.md`) and
      render a chip/badge?
      - *Recommend*: v1 — no. v2 — yes, as a UX win once the basic
        tree works.

- [ ] **Starred / pinned folders.** A short list of favorites at the
      top?
      - *Recommend*: defer to v2. First we need a functional tree.

- [ ] **File watcher.** Keep the tree in sync as files change on
      disk (via chokidar or Electron's `fs.watch`)?
      - *Recommend*: yes, with debounce. Stage 11's editor also
        needs this (issue #5 — agent-file-change surface), so a
        single watch infrastructure serves both. Build it once in
        Stage 10.

---

## 5. Layout reshape — what Stage 10 owns

Stage 10 also owns the physical column reshape from today's
terminal-left / browser-right shape to the locked three-column
shape (Files | Terminal + Agent tools | Viewer/Editor). Specifically:

- **Add** the Files column on the left (this spec).
- **Move** the terminal from left to middle-top.
- **Hoist** today's `BrowserTabStrip` + tab state into a unified
  `WorkingPane` shell whose tab strip handles mixed types — browser
  (shipped), editor (Stage 11), preview (Stage 10). See
  [docs/DECISIONS.md § Layout model](../DECISIONS.md).
- **Reserve** the middle-bottom collapsed region for Stage 12 agent
  tools — just an unused row with a header placeholder is fine.

The reshape and the navigator ship together as a single visual
release so users don't experience a confusing two-step migration.

---

## 6. CLI surface

Per Stage 10's existing ROADMAP entry, but updated for the unified
tab model:

| Command | Meaning | Notes |
|---|---|---|
| `duo reveal <path>` | Focus `<path>` in the navigator; update `navigatorCwd` | |
| `duo ls [path]` | List directory contents via the bridge | Bypass for agents that need tree data without triggering the UI reveal |
| `duo nav state` | Current navigator folder + any selection | For agent pull-model |
| ~~`duo open <path>`~~ | **Reserved for HTML / URL into the browser.** Stage 8. | Not the file-viewer command. |
| `duo view <path>` (new) | Open a file in the Viewer/Editor (preview type inferred from extension) | Replaces the old Stage 7 sketch of `duo open` for files |

`duo view` and `duo reveal` are the agent's two primary file-surface
commands.

`duo open` retains its current meaning (load a URL / HTML file in a
new browser tab). The overlap the roadmap flagged is resolved by
name: open for browser, view for viewer/editor.

---

## 7. What Stage 10 v1 does NOT try to do

- Full IDE features (rename / delete / new file from the navigator).
  The user can do these via the terminal or the OS. Add in a later
  stage if real demand materializes.
- Git status decorations (badges for modified / untracked). Nice to
  have; defer until after flagship.
- Drag-into-conversation — captured as a "must not be blocked"
  architectural requirement, not a v1 ship item. It's a small
  follow-up once the drop target and PTY injection are in place.
- Search ("find file by name"). V2.
- Multi-select and bulk actions. V2.
- Preview on hover. V2 if ever.

Keep v1 humble: tree + reveal + click-to-view + set-pending-CWD.
That plus the layout reshape is already a big shippable change.

---

## 8. Validation checklist (pre-merge)

- [ ] Navigator visible on app launch, showing `$HOME` by default.
- [ ] Clicking a folder opens it in place; breadcrumbs update.
- [ ] `⌘⇧T` while navigator is at `/foo/bar` launches a new terminal
      whose `pwd` on first `echo $PWD` is `/foo/bar`.
- [ ] Switching between existing terminal tabs moves the navigator
      to each tab's launch CWD (follow-mode default).
- [ ] Pinning the navigator disables follow-mode; tab switches leave
      the navigator alone.
- [ ] Clicking a `.md` file opens a new editor tab in the right
      column (Stage 11 if ready; otherwise read-only preview stub).
- [ ] `duo reveal /path/to/thing` from an agent moves the navigator
      and surfaces the "Claude revealed …" chip.
- [ ] `duo view /path/to/thing` opens the file in a new right-column
      tab with type inferred from extension.
- [ ] Layout reshape: terminal lives in middle column, browser tabs
      are still present in the right column, nothing visual or
      functional regresses from today's two-column shape.
- [ ] Navigator state persists across app relaunch.

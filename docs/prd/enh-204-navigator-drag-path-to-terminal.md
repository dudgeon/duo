# ENH-204 PRD — Drag a navigator file/folder to insert its path into the active terminal

> **Status:** spec locked 2026-06-08 (owner decisions D1–D5 captured via
> `AskUserQuestion` this session — no decision playground was needed per
> CLAUDE.md rule 11, since the clarification channel was already interactive).
> **Not yet implemented** — no branch/PR yet; this PRD is the build spec.
> **References:**
> - [Stage 10 PRD — file navigator](stage-10-file-navigator.md) — the navigator
>   this extends (`FileTree` / `useNavigator` / `FilesPane`).
> - [ENH-190 PRD](enh-190-navigator-resize-peek.md) — sibling
>   navigator-interaction upgrade; the shape model for this PRD.
> - Code: `renderer/components/FileTree.tsx`, `renderer/App.tsx`,
>   `renderer/components/TerminalPane.tsx`, `core/pty-manager.ts`,
>   `cli/duo.ts` (`send`).
> - Grounding: the ENH-204 research workflow verified the four load-bearing
>   technical claims against source; the file:line map lives in the tasks.md
>   entry.

---

## 1. What we're building

A direct-manipulation shortcut for the most common "tell the agent which file
to work on" moment: **drag a row out of the navigator and drop it on the
terminal, and its absolute path appears at the cursor of the active terminal.**

- Works for both **files and folders** (identical `DirEntry.path` shape).
- Works whether the active terminal is a **vanilla shell** or a **running
  Claude Code session** — the write path is kind-agnostic.
- The path is inserted with **one trailing space and no newline**, so it never
  auto-runs / auto-submits; the user keeps typing or presses Enter themselves.
- Dragging with **multiple rows selected** inserts all selected paths,
  space-joined in tree order.

**Out of scope (deferred — see § 9):** native Finder / OS-file drops (a
different `dataTransfer` payload), dropping onto the editor/canvas (an
`@`-mention is a separate feature), and dropping onto a specific *non-active*
terminal tab.

---

## 2. Persona + job to be done

**Primary persona:** the PM/owner pairing with Claude in a Duo terminal, who
knows the file they want in the navigator but doesn't want to type or hand-copy
a long nested path into the prompt.

**Job:** *"Let me point the agent (or my shell) at this exact file without
typing or copy/pasting its path."* The navigator already shows the file and
already holds its absolute path; dragging it onto the terminal should be all it
takes.

---

## 3. The model (D1)

**D1 — Insert the absolute path at the active terminal's cursor; there is no
pixel-addressable caret.** A PTY has no addressable caret — you write bytes to
stdin and the foreground program (zsh, Claude's TUI input box) places them at
*its own* cursor. "Inserted at the caret" therefore means: the path bytes are
written to the active terminal's PTY, landing wherever that program's input
cursor currently sits. The navigator stores absolute paths (`DirEntry.path`,
annotated `// absolute` in `shared/types.ts`), and the terminal's cwd may
differ from the navigator's root, so the **absolute** path is always correct
and unambiguous.

---

## 4. Behavior — drag source (navigator)

**D2 — The row-content `<button>` becomes the drag source, not the row
wrapper.** Add `draggable` + `onDragStart` to the per-row content
`<button type="button">` in `FileTree.tsx` (the element that already renders
the icon, name, and `title={entry.path}`), **not** the outer `group/row`
wrapper `<div>` — the wrapper also covers the chevron toggle and the
folder-only "new Claude here" button, which a drag would hijack. A row in
rename mode swaps that button for an `<input>`, so a renaming row naturally
carries no drag handler (correct by construction).

**D2a — `dataTransfer` payload.** On `onDragStart`, set two entries, mirroring
the existing tab-reorder convention (`application/x-duo-tab-id` in
`WorkingTabStrip.tsx`):

- `application/x-duo-fs-path` — the duo-namespaced type the drop handler keys
  on, so a navigator drag is distinguishable from a foreign OS/Finder drag.
- `text/plain` — the same path string, so the drag degrades gracefully if
  dropped somewhere else.

**D2b — Multi-select drag.** The navigator already supports multi-select
(`useNavigator`'s `selectedItems`). `onDragStart` **reads** the selection at
drag-start and must **not** mutate it — do not route it through the row's click
handler, which has a clear-on-reclick branch (`FileTree.tsx`); you can't drag
"nothing". If the dragged row is in `selectedItems`, the payload carries **all
selected paths** (files and folders alike). Conversely, if the dragged row is
*not* in the current selection, only that single row's path is carried.

**Tree-order is not free.** `selectedItems` is a `Map` in *click/insertion*
order (⌘-clicking rows bottom-to-top yields reverse-tree order); only
shift-range / ⌘-A build it pre-sorted. Emitting paths in visible-tree order
(D4) therefore requires an **explicit sort** of the carried paths by their index
in the flattened visible-row list before joining — call this out as net-new
logic, not a property the `Map` gives for free.

---

## 5. Behavior — drop target & insertion

**D3 — Drop on the terminal column → write to the active tab's PTY.** Attach
`onDragOver` + `onDrop` to the terminal-column wrapper in `App.tsx` (the
`flex-1 overflow-hidden` div around `<TerminalPane>`). Because terminal tabs
render stacked with only the active one `display:block`, a drop on the visible
terminal body always targets the active tab. Resolve it via the existing
`activeTabId` React state and write via the existing transport
`window.electron.pty.write(activeTabId, payload)` — IPC `pty:write`
(`electron/preload.ts`) → `ptyManager.write(id, data)` (`core/pty-manager.ts`)
→ `session.pty.write(data)`. This reuses the same write primitive the canvas
`terminal:send` action already ships in `App.tsx`, so **no new IPC is added**.

**D3a — `preventDefault` is non-negotiable.** `onDragOver` **must** call
`e.preventDefault()` (and set `dropEffect = 'copy'`); `onDrop` must call it too.
Without it, Chromium's default drop action navigates the renderer window to the
dropped `file://` URL and **blanks the entire app** — there is no global
drop-guard and no `will-navigate` handler on the main window. (A renderer
navigation also crashes the dev Electron, so this is the first regression line
in § 8.)

**D3b — Foreign-drag rejection (still `preventDefault`).** `onDragOver` and
`onDrop` call `preventDefault()` on **every** drag over the column — including
foreign ones — so a stray Finder/OS file drop can't navigate the window to
`file://` and blank the app. A drag without our `application/x-duo-fs-path`
MIME is then **swallowed without inserting** (no `pty.write`); `dropEffect` is
set to `none` so the cursor shows no-drop. v1 does **not** read
`e.dataTransfer.files`, so OS/Finder paths aren't *inserted* (deferred, § 9) —
but they are now inert rather than navigating the window.

**D3c — Collapsed terminal rail.** The `flex-1 overflow-hidden` wrapper only
renders when the terminal column is *expanded*; when collapsed it is replaced by
`CollapsedPaneRail` and the drop-target div does not exist. Attach the same
`onDragOver`/`onDrop` to `CollapsedPaneRail` (`kind='terminal'`) so a drop on the
rail **expands the column and then inserts**, rather than being a dead gesture
with no feedback.

**D3d — No live PTY is a silent no-op.** `ptyManager.write` is
`sessions.get(id)?.pty.write(data)`, so if the active tab's shell/Claude has
**exited** (the floor-of-1 is on *tabs*, not PTY liveness) the path is silently
swallowed. Acceptable for v1 (the user re-runs their shell), but the implementer
must not treat "`pty.write` returned" as "path landed"; a brief toast is a
possible refinement (§ 9).

**D4 — Payload format: sanitize, quote-if-needed, space-joined, one trailing
space, no newline.**

- **Sanitize first:** strip (or escape) embedded newlines and control characters
  from each path *before* anything else — POSIX filenames *can* contain
  newlines, and D5's single-line safety depends on this. Nearest precedent:
  `renderer/components/editor/sendFormat.ts` (its `sanitizeLine()` strips
  CR/LF/U+2028/U+2029); the new helper should mirror it.
- **Quoting:** POSIX single-quote-wrap a path **only** when it contains a space
  or shell-metacharacter (escaping any embedded single-quote via the `'\''`
  idiom); emit it raw otherwise, to avoid noisy quoting on the clean common
  case. No POSIX shell-*quote* helper exists in the repo today (`sendFormat`
  does sanitization, not shell-quoting) — this is a small net-new utility.
- **Multi-path:** quote each path independently, then **space-join** in
  **visible-tree order** (the explicit D2b sort — the selection `Map` is in
  click order, not tree order).
- **Terminator:** exactly **one trailing space, no newline** — matches the
  `duo send` no-auto-submit default and every reference terminal
  (Terminal.app, iTerm2, VS Code), and sidesteps the Claude-submit hazard (D5).

**D5 — Same write for shell and Claude; never auto-submit.** The programmatic
write path does **not** branch on tab kind (`claudePresence` drives only the UI
send-pill and the interactive xterm Enter-key interceptor, not the write
transport), so identical bytes reach a zsh prompt and Claude's TUI input box.
The one runtime hazard is the *terminator*: a trailing newline that merely
"runs the command" in a shell would **submit a half-formed prompt** to Claude.
D4's trailing-space-no-newline rule neutralizes this. Single-line space-joined
payloads also avoid the unbracketed-multiline-paste hazard — raw `pty.write`
does not wrap in `ESC[200~…ESC[201~` (only xterm's `term.paste()` does), so an
embedded newline could be read line-by-line by Claude where it is harmless to a
shell. The drop targets/keeps the active tab focused, so `claudePresence`
(which tracks only the front terminal) stays meaningful — and a drop is honored
even when another pane held focus (`focusedColumn` and `activeTabId` are
independent), writing to the current `activeTabId` and shifting focus to the
terminal.

---

## 6. CLI / UI parity

**Satisfied at the write primitive — no new CLI surface.** The core effect
("a path string appears at the active terminal cursor") is what the shipped
`duo send --text "<path>"` already does: both funnel through
`sendToActiveTerminal()` → `ptyManager.write(activeId, text)`
(`core/socket-server.ts`; `electron/main.ts`) — the same primitive the
Send→Duo pill and the canvas `terminal:send` action use. **One honest
asymmetry:** the drag adds *renderer-side* quote-if-needed + space-join (D4)
that `duo send --text` does **not** apply (it writes text raw), so an agent
reproducing a spaced-path drop would pre-quote the string itself. That is a
convenience gap, not a capability gap — the rule-4 requirement (the agent *can*
do it) holds by reuse, so no dedicated `duo paste-path` / `duo term write` verb
is added. Full hands-free parity (resolve + shell-quote in one verb) is the
deferred `duo send --path <p>` sugar (§ 9).

---

## 7. Implementation notes

- **Two greenfield handlers on a built transport.** The drag source
  (`FileTree.tsx`) and the drop target (`App.tsx`) are net-new, but the write
  transport (`pty.write` → `ptyManager.write` → `session.pty.write`) is fully
  built and already exercised twice in the renderer (the Send→Duo pill and the
  canvas `terminal:send` action) — this is not a rearchitecture.
- **xterm event-swallowing fallback.** If live testing shows xterm.js's
  canvas/textarea stops the native `drop` before the React `onDrop` on the
  wrapper fires, move the handler to a **capture-phase** listener on the xterm
  host element, mirroring the existing BUG-094 capture-phase paste listener in
  `TerminalPane.tsx`. Decide this empirically in the running app.
- **Shell-quote helper** is the only genuinely new logic (~10 lines): wrap in
  single quotes iff the path matches a space/metacharacter test; escape any
  embedded `'` via the `'\''` idiom.
- **Multi-window (ENH-191) is window-correct by construction.** PTYs carry an
  `ownerWindowId` and `activeTabId` is per-renderer state; a DOM drop event is
  intrinsically scoped to the window it lands in, so the window's own
  `activeTabId` is always the right target — no app-global "active terminal"
  concept is needed.

---

## 8. Verification — smoke-walk checklist

**A macOS dev-session smoke-walk is owed before any version cut**
(drag-and-drop is not exercisable headlessly). Walk:

1. **File → path at cursor** — drag a file row onto the terminal; its absolute
   path appears at the prompt with a trailing space and **does not run**.
2. **Folder** — drag a folder row; its path inserts identically.
3. **Path with spaces** — drag a file under a spaced path (e.g.
   `~/Library/Application Support/…`) → it inserts single-quote-wrapped and
   intact.
4. **Multi-select** — select several rows, drag one → all selected paths insert
   space-joined in **visible-tree order**, each quoted as needed, one trailing
   space.
5. **Single row, empty selection** — with nothing selected, drag one row → only
   that path inserts (the common single-file case + the D2b not-in-selection
   branch).
6. **Claude session** — with a `claude` session running in the active tab, drop
   a path → it lands in Claude's input box and **does not submit**; (edge)
   dropping while a Claude permission prompt is open does not mis-route or
   crash.
7. **`preventDefault` guard** — a drop on the terminal never navigates the
   window to a `file://` URL or blanks the app.
8. **Foreign drag ignored** — dragging a file from Finder onto the terminal is
   inert in v1 (no crash, no navigation).
9. **Collapsed terminal** — collapse the terminal column, drop a row on its rail
   → the column expands and the path inserts (D3c).
10. **Exited PTY** — let the active tab's shell/Claude exit, then drop → no
    insertion and no crash (acceptable no-op, D3d).
11. **Aborted drag** — start dragging a row, release back over the navigator →
    no insertion and selection unchanged.
12. **Regression** — navigator single-click select / double-click open still
    work; tab-reorder drag-and-drop (TabBar / WorkingTabStrip) still works;
    `duo send --text "x"` still writes to the active terminal.

---

## 9. Future / open

- **Native Finder / OS-file drops** — read `e.dataTransfer.files` so a drag
  from Finder also inserts paths (a different payload shape; the
  `x-duo-fs-path` vs `files` branch is the seam).
- **Drop onto editor / canvas as an `@`-mention** — a path dropped on a Claude
  session might warrant `@path` mention syntax rather than a bare path; a
  separate feature.
- **Drop onto a specific (non-active) terminal tab** — e.g. drop directly on a
  tab in the strip to target that PTY instead of the active one.
- **Kind-aware quoting** — a path dropped into Claude's natural-language prompt
  arguably does not want shell-quoting; a `tab.kind`-aware branch could skip
  quoting for Claude sessions. Deferred — the trailing-space-no-newline default
  keeps even an over-quoted path harmless.
- **`duo send --path` sugar** — optional CLI convenience that resolves +
  shell-quotes a path, if agents end up hand-rolling that.

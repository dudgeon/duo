# ENH-190 PRD — Navigator temporary-widen, drag-to-collapse, and resize-handle affordance

> **Status:** spec locked 2026-06-06 (owner-tuned); implemented on branch
> `claude/file-nav-auto-collapse-vaN3Y` (PR #67), pending a macOS smoke-walk
> before a version cut.
> **References:**
> - **Tuning prototype (design artifact):**
>   [`docs/research/navigator-peek-collapse-prototype.html`](../research/navigator-peek-collapse-prototype.html)
>   — the interactive sheet the owner drove to lock every value below. Rendered
>   preview (off the working branch):
>   `https://raw.githack.com/dudgeon/duo/claude/file-nav-auto-collapse-vaN3Y/docs/research/navigator-peek-collapse-prototype.html`
> - [Stage 10 PRD — file navigator](stage-10-file-navigator.md) — the navigator
>   this extends (`FileTree` / `useNavigator` / `FilesPane`).
> - Code: `renderer/components/FilesPane.tsx`, `renderer/App.tsx`,
>   `renderer/styles/globals.css`.

---

## 1. What we're building

The navigator (leftmost column — internally `FilesPane`) ships three related
interaction upgrades, all chrome-only (no change to the file tree, selection,
or CWD plumbing):

1. **Temporary widen → ease back.** A way to *transiently* make the navigator
   wider to read a truncated file name, after which it eases back on its own —
   no persistent resize to manage.
2. **Drag-to-collapse.** Dragging the expanded navigator's right border left,
   past a threshold, collapses it to the rail.
3. **Resize-handle affordance.** A hover-reveal grip that widens the click
   target on the draggable seams (the navigator's right border and the
   terminal↔canvas split divider), so a 1px hairline is no longer fiddly to
   grab.

**Out of scope (deferred):** the collapse-button **icon refresh** for the
terminal / canvas panes (Behavior 4 in the prototype). It was *not* in the
owner's locked settings; see § 7.

---

## 2. Persona + job to be done

**Primary persona:** the PM/owner working in a narrow window where the
navigator is either collapsed to a rail or expanded to a fixed 208px, and long
file names (`useNavigatorAutoCollapse.test.ts`) truncate with an ellipsis.

**Job:** *"Let me glance at the full name without committing to a wider
navigator I then have to put back."* The whole point is that widening is
**transient** — the owner explicitly does **not** want to manage a persistent
custom width. Plus the everyday papercut: a 1px divider is hard to grab.

---

## 3. The model (D1)

**D1 — Two resting sizes only; no persistent custom width.** The navigator
rests at exactly one of:

| Resting state | Width |
|---|---|
| **rail** (collapsed) | 44px |
| **expanded** | 208px |

Every widen — whether a hover-peek from the rail or a drag of the expanded
border — is **transient**: it eases back to whichever resting state it came
from. The only thing that changes the *resting* state is the existing toggle
(⌘B / header button / `AUTO_COLLAPSE_WIDTH` on window resize) or crossing the
drag-to-collapse threshold. There is no "drag to a custom width and keep it."

This keeps the persistent model a single boolean (`filesCollapsed`, owned by
`App.tsx`) and pushes all transient width into component-local state (D9).

---

## 4. Behavior 1 — Temporary widen → ease back

Two independent triggers, both easing back to the resting size after the
cursor leaves the navigator.

- **D2a — Expanded-border drag-widen (the core gesture).** Drag the expanded
  navigator's right border *wider* (up to a 360px ceiling) to un-truncate a
  long name. On release it stays where dragged, then eases back to 208px.
- **D2b — Collapsed-rail hover-peek.** Hovering the collapsed rail opens a
  transient peek to **200px**, easing back to the rail.
- **D3 — Snap-back clock.** The ease-back fires **1500ms after the cursor
  leaves the navigator** (not on a fixed timer from when the widen began).
  Re-entering the navigator cancels the pending snap-back. Applies to *both*
  triggers.
- **D4 — Rail-peek timing/feel.** Hover-in delay **260ms** (rest on the rail
  this long before it peeks, so a cursor passing through doesn't trigger it);
  peek width **200px**; animation **220ms** `cubic-bezier(.22,.61,.36,1)`
  (ease-out). The same animation governs the drag-widen snap-back and the
  collapse animation.

### Commit (make a peek stay open)

- **D5 — Click-anywhere commit.** While peeking the rail, a click *anywhere*
  in the navigator body (a file row or empty space) commits it to the expanded
  resting state. Header buttons (collapse, pin) keep their own handlers and do
  **not** double as a commit. This is the locked answer to the "I can't click
  the bar to keep it open anymore" problem the rail-peek introduced (the rail
  swaps out for the tree on hover, so the click target had vanished).
- A peek can also be committed via the existing rail click-to-expand, ⌘B, or
  the header toggle.

---

## 5. Behavior 2 — Drag-to-collapse

- **D6 — No drag-expand from the rail.** The drag handle only exists on the
  *expanded* navigator. The rail expands only via the toggle / ⌘B / a
  click-commit of a peek — never by dragging it open. (Locked: a rail
  drag-expand was prototyped and explicitly rejected.)
- **D7 — Collapse on release, past a threshold.** Dragging the expanded border
  left past **96px** collapses to the rail **on release** (so you can back out
  by dragging right again before letting go). A leftward drag that stops *above*
  the threshold snaps back to 208px (an aborted collapse — no custom width).
  - **Release-zone hint: on.** Below the threshold the navigator's right border
    turns red (`#c8553d`) and a small "Release to collapse" badge appears.
  - **Rubber-band resistance: off.**

---

## 6. Behavior 3 — Resize-handle affordance (D8)

**D8 — A shared hover-reveal grip, applied to both draggable seams** (the
navigator's right border and the terminal↔canvas split divider):

- **Hit target 12px**, centered on the seam, while the **visible seam stays
  1px** (the catch area grows, the line does not).
- **Reveal on hover**, **120ms fade-in**.
- **Grip pill** style (a short rounded accent pill) **with grab-dots** (⋮).

Implemented as shared CSS (`.resize-grip`, `.nav-resize-handle`,
`.split-divider::before`) so the two seams stay visually identical and tune
together.

---

## 7. Out of scope — collapse-button icon refresh (deferred)

The prototype also explored replacing the terminal/canvas collapse-button glyph
(today a split-pane diagram that reads as *state*, not *action*) with a
directional set; the recommended pick was **"Panel + chevron"** (the VS Code /
Finder sidebar-toggle metaphor). This was **not** in the owner's locked
settings and is **deferred**. If revived, it touches
`renderer/components/TabBar.tsx` (terminal) and
`renderer/components/WorkingTabStrip.tsx` (canvas); the gallery of candidates
lives in the prototype sheet.

---

## 8. Implementation notes

- **Transient width is component-local (D9).** `FilesPane.tsx` owns the
  transient state machine: `override` (px width during peek/drag; `null` = use
  the resting width), `peekActive`, `widenActive`, `willCollapse`, plus a
  right-border `.nav-resize-handle` using pointer capture. The persistent
  resting state remains `filesCollapsed` in `App.tsx`, set via the new
  `onSetCollapsed(collapsed: boolean)` prop (alongside the existing
  `onToggleCollapsed`).
- **Locked values are named constants** at the top of `FilesPane.tsx`
  (`NAV_RAIL_W`, `NAV_EXPANDED_W`, `NAV_PEEK_W`, `NAV_MAX_W`,
  `NAV_COLLAPSE_THRESHOLD`, `NAV_HOVER_IN_MS`, `NAV_SNAP_BACK_MS`,
  `NAV_ANIM_MS`, `NAV_EASE`).
- **Snap-back is timer-driven** (`mouseleave` → `setTimeout`), cleared on
  re-enter, drag-start, commit, and unmount, and reset whenever `collapsed`
  changes externally. `onTransitionEnd` clears `override` back to `null` once a
  width animation settles at rest.
- **Shared affordance CSS** lives in `renderer/styles/globals.css` and is
  applied to the terminal↔canvas `.split-divider` in `App.tsx` (grip child +
  `dragging` class).

---

## 9. CLI / UI parity

The persistent collapse/expand state already has its toggle (⌘B / menu); no new
CLI verb is added. The temporary widen, hover-peek, and resize-grip are
**mouse-only affordances with no persistent effect** — there is no durable
state for the agent to read or set, so CLI parity is satisfied by the existing
collapse/expand verbs. (Noted here as a deliberate asymmetry per the
CLI-parity rule.)

---

## 10. Verification — smoke-walk checklist

Authored in a Linux remote sandbox without Electron, so a **macOS dev-session
smoke-walk is owed before any version cut.** Walk:

1. **Drag-widen snap-back** — from expanded, drag the right border wider to
   read a long name; move the cursor off the navigator; it eases back to 208px
   after ~1.5s.
2. **Rail hover-peek** — collapse (⌘B), hover the rail; after ~260ms it peeks
   to 200px; move away → eases back to the rail after ~1.5s.
3. **Click-to-stay** — during a rail-peek, click a file row or empty space →
   it commits to expanded (and the file opens, for a row).
4. **Drag-to-collapse** — from expanded, drag left past 96px → red border +
   "Release to collapse" hint → release collapses to the rail; releasing
   *above* the threshold snaps back to 208px.
5. **No rail drag-expand** — the rail has no drag handle; it can't be dragged
   open.
6. **Resize-handle affordance** — hovering the navigator border *and* the
   terminal↔canvas divider reveals the grip pill (+ dots); the hit target is
   forgiving while the seam stays a hairline.
7. **Regression** — ⌘B / header toggle still collapse/expand (now at the 220ms
   animation), and `AUTO_COLLAPSE_WIDTH` still fires on a narrow window.

---

## 11. Future / open

- Collapse-button icon refresh (§ 7) — revive if the owner wants it.
- If a persistent custom width is ever requested, it would reopen D1; today's
  model is deliberately binary.

---

## 12. BUG-197 — rail-peek commits on a whitespace click but NOT on a row click

> **Status:** 🆕 filed 2026-06-06 (owner, on the v0.9.1 ENH-190 smoke-walk).
> **Type:** defect in **D5** (click-anywhere commit). **Effort:** S · **Risk:**
> low · **User value:** medium. Non-blocking, but the D5 commit gesture is
> *partly* broken — half the body (every file/folder row) doesn't honor it.
> **Code:** `renderer/components/FilesPane.tsx`, `renderer/components/FileTree.tsx`.

### Symptom (owner)

While the rail is peeked open (Behavior 1 / D2b), **clicking empty body
whitespace correctly commits** the peek to the expanded resting state, **but
clicking a file or folder row does NOT also commit it** — the peek eases back
to the rail on cursor-leave as if no commit happened. Owner: *"click in white
space persists the expand; clicking in file or folder should but does not also
persist the expand."* This contradicts the D5 lock ("a click *anywhere* in the
navigator body — a file row or empty space — commits it"; § 4).

### Root cause (precise — file:line)

The D5 commit handler `onRootClick` (`FilesPane.tsx:186-194`, wired at `:276`
`onClick={onRootClick}`) bails early at **`FilesPane.tsx:189`**:

```ts
if ((e.target as HTMLElement).closest('button')) return
```

That guard exists to stop the two **header chrome** controls — `PinButton`
(`FilesPane.tsx:460-484`) and `CollapseButton` (`:486-504`), both in the header
row at `:308-309` — from doubling as a commit, since they own their own
handlers. But it is **scoped far too broadly**: every file/folder **row is
itself a `<button>`** (`FileTree.tsx:1186-1194`, `<button
onClick={onSingleClickRow} …>`), and folder rows additionally carry a chevron
`<button>` (`:1163-1171`). So a click on any row matches `.closest('button')`,
`onRootClick` returns at `:189`, and `onSetCollapsed(false)` (`:193`) never
runs. A whitespace click lands on the wrapping `<div>` (not a button), so it
falls through and commits — exactly the asymmetry the owner sees.

This is the guard **catching too much**, not a `stopPropagation` race: the
row's own `onSingleClickRow` (`FileTree.tsx:1097-1109`) does **not** stop
propagation, so the click *does* bubble to `onRootClick` — it's just rejected
by the over-broad guard. (Contrast the two handlers that *do* call
`stopPropagation` — the chevron at `:1113` and the "new Claude here" button at
`:1293` — see Parity below.)

### Fix approach

Narrow the `:189` guard so it excludes only the navigator **header chrome**
(pin/collapse), not the tree body. Either shape works (both leave the row's own
select/open handler intact, so one click commits *and* opens):

- **(a) Tag + exclude (recommended).** Add `data-nav-header` to the header row
  (`FilesPane.tsx:293`, the breadcrumb/pin/collapse flex container) and change
  the guard to bail only on `closest('[data-nav-header]')`. Narrowest possible
  blast radius; reads as intent.
- **(b) Invert to a body allow-list.** Commit only when the click lands inside
  the tree/body region (e.g. `closest('[data-nav-body]')` on the `:286` body
  `<div>`). Equivalent outcome; slightly larger diff.

Because `onSingleClickRow` doesn't `stopPropagation`, the corrected handler
runs **alongside** the row's open/select — a single click on a row both commits
the peek to expanded *and* opens the file / navigates the folder, which is the
D5-intended one-click behavior.

### Parity disposition

- **D5 fidelity:** restores the locked "click *anywhere* in the body commits"
  contract for the half of the body (rows) that currently no-ops. Whitespace
  clicks already worked and are unchanged.
- **Header chrome (pin/collapse):** must keep NOT committing — the narrowed
  guard preserves this (it's the only thing the guard should ever catch).
- **Chevron (`FileTree.tsx:1113`) + "new Claude here" (`:1293`):** these call
  `stopPropagation`, so the click never reaches `onRootClick` and they
  correctly continue to **not** commit. That is the desired behavior — toggling
  a folder's expansion or spawning a Claude tab is an in-row action that
  shouldn't also commit the peek — and this fix deliberately leaves it intact.
  (A folder *row* click, which navigates/re-roots, is the bubbling case that
  *should* commit, and does once the guard is narrowed.)
- **CLI / UI parity (§ 9 unchanged):** the rail-peek and its commit remain
  mouse-only affordances with no durable agent-readable state; the persistent
  collapse/expand state still flips via ⌘B / the header toggle /
  `onSetCollapsed`. No new CLI verb. The deliberate mouse-only asymmetry
  recorded in § 9 still holds.

### Smoke-walk line (add to § 10, walk step 3 "Click-to-stay")

3b. **Row-click commit (BUG-197)** — during a rail-peek, click a **file row**
→ the file opens **and** the navigator commits to expanded (does not ease back
to the rail on cursor-leave). Repeat clicking a **folder row** → it
navigates/re-roots **and** commits. Confirm the header **pin** and **collapse**
buttons, and a folder's **chevron**, still do **not** commit (chevron only
toggles; pin/collapse keep their own behavior).

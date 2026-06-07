# BUG-157 PRD — Browser WebContentsView bounds / resize resilience

> **Status:** spec locked 2026-06-06; not yet implemented. Small,
> low-risk defense-in-depth + dead-code removal. Closes the remaining
> open ACs of the BUG-157 audit.
> **References:**
> - Task entry: [`tasks.md` § BUG-157](../../tasks.md) ("Audit other
>   fit-then-resize patterns for the same latent bug").
> - Root-cause sibling: **BUG-156** — the same renderer-measures-DOM →
>   writes-to-main-via-IPC-without-a-sanity-check pattern, fixed in the
>   terminal path. The authoritative guard it added lives at
>   [`core/pty-manager.ts:125-137`](../../core/pty-manager.ts) and is the
>   exemplar this PRD mirrors.
> - Triggering regression context: ENH-183's flex-column `SessionHeader`
>   wrapper, which let a host element transiently measure to 0 during
>   layout reflow.
> - Code touched: `electron/browser-manager.ts`,
>   `renderer/hooks/useTerminal.ts`.

---

## 1. What we're building

Two small, independent changes that close the still-open acceptance
criteria of the BUG-157 audit:

1. **A main-process bounds guard** on the two WebContentsView (WCV)
   sizing entry points — `BrowserManager.setBounds` and
   `BrowserManager.setAuxBounds` — so a degenerate (zero or negative)
   `width`/`height` measured in the renderer can never reach the native
   `view.setBounds(...)` call. This mirrors BUG-156's defense-in-depth:
   an authoritative check **at the main-process API border**, not only at
   the renderer call site.

2. **Removal of confirmed dead code** — `renderer/hooks/useTerminal.ts`
   (the `useTerminalIPC` hook), which has zero callers and contains its
   own un-guarded `fit.fit()` → `pty.resize()` instance of the exact
   pattern this audit set out to eliminate.

This is a hardening + hygiene change. **There is no behavior change for
valid bounds** — the guard is a no-op on every real resize.

### The audit, and where it actually landed

BUG-156's root cause was a renderer-side "measure DOM → push the measured
value to a main-process backing system over IPC" loop with no check that
the measured value was sane. The audit (BUG-157) enumerated the sibling
instances of that pattern and asked, for each: *what does it measure,
where does it cross IPC, and does the receiving main-process function
defensively reject zero/negative dimensions?* Investigation results:

| Site | What it measures | Crosses IPC? | Main-side guard today | Disposition |
|---|---|---|---|---|
| `TerminalPane` xterm `fit.fit()` → `pty.resize` | cols × rows | yes → `PtyManager.resize` | **yes** (`pty-manager.ts:136` `if (cols < 1 \|\| rows < 1) return`) | already fixed (BUG-156) |
| `BrowserRenderer.tsx:57` ResizeObserver | host rect → WCV bounds | yes → `browser.setBounds` | **no** | **fix here (D1)** |
| `AuxBrowserSlot.tsx:111` ResizeObserver | host rect → aux WCV bounds | yes → `browser.setAuxBounds` | **no** | **fix here (D1)** |
| `ImageView.tsx:138` ResizeObserver | host rect → React state | **no** (writes `setContainerSize` only) | n/a | safe, no guard needed |
| `useTerminal.ts:39-47` `fit.fit()` → `pty.resize` | cols × rows | yes, *but* never mounted | n/a (dead) | **delete (D2)** |

So the headline crash vector is already double-guarded, but two WCV
bounds paths and one dead-code instance remain — that is exactly this
PRD's scope.

---

## 2. Persona + job to be done

**Primary persona:** the owner / any Duo user with the browser pane (or an
aux-pinned browser tab) visible while the surrounding layout reflows —
collapsing the navigator, dragging the terminal↔canvas split, opening a
full-viewport modal that parks the WCV, or resizing the window narrow.

**Job (implicit / non-functional):** *"Don't let a transient 0-size
measurement during a layout reflow do something weird to the browser
pane."* The user never asks for this directly — it's the kind of latent
fault that only surfaces as a future regression in some unrelated
layout-change PR (the way ENH-183's wrapper surfaced BUG-156). The job to
be done is **pre-empting that surprise** with a guard at the authoritative
boundary, plus removing a dead landmine that a future contributor might
wire up and re-introduce the bug through.

---

## 3. The problem this fixes

Both WCV bounds call sites follow the at-risk shape. `BrowserRenderer`'s
`send()` measures the host element and pushes the raw rounded rect across
IPC:

```ts
// renderer/components/BrowserRenderer.tsx:36-44
const r = el.getBoundingClientRect()
window.electron.browser.setBounds({
  x: Math.round(r.left), y: Math.round(r.top),
  width: Math.round(r.width), height: Math.round(r.height)
})
```

`AuxBrowserSlot.tsx:100-108` does the identical thing into
`browser.setAuxBounds`. Both flow through `electron/main.ts:1312` /
`:1321` into `BrowserManager`, where the receiving methods apply the
bounds to the native view **with no dimension check**:

```ts
// electron/browser-manager.ts:969-995 (abridged)
setBounds(bounds: BrowserBounds): void {
  this.currentBounds = bounds
  if (this.tabs.length > 0 && !this.mutedForOverlay) {
    const activeId = this.tabs[this.activeIndex]?.id
    if (activeId !== undefined && activeId !== this.auxTabId) {
      this.tabs[this.activeIndex].view.setBounds(bounds)   // ← no guard
    }
  }
}
setAuxBounds(bounds: BrowserBounds): void {
  this.auxBounds = bounds
  if (this.auxTabId === null) return
  const aux = this.tabs.find(t => t.id === this.auxTabId)
  if (aux && !this.mutedForOverlay) {
    aux.view.setBounds(bounds)                              // ← no guard
  }
}
```

If a reflow ever lets the host element measure to 0 (or briefly negative)
height/width, that degenerate geometry is committed straight to the native
WCV — the browser-pane analog of the terminal SIGHUP cascade BUG-156
fixed. Today no shipped layout provokes it, which is precisely why it's a
*latent* bug worth a cheap guard rather than waiting for the next reflow
PR to trip it.

Note the deliberate **1×1 park exception**: both call sites intentionally
send `{ x: 0, y: 0, width: 1, height: 1 }` to hide the WCV (on unmount, and
on the `duo-wcv-park` modal-occlusion event — FOLLOWUP-025). `1×1` is a
valid, intended "keep the view alive but invisible" state, so the guard
must reject `< 1`, not `<= 1` — i.e. it must preserve the 1×1 park. (See D1
for the exact predicate.)

---

## 4. The fix

### D1 — Clamp at the main-process boundary; reject sub-1 dimensions (mirror BUG-156)

Add an early guard to **both** `setBounds` and `setAuxBounds`, before any
`view.setBounds(...)` call, that returns early when either dimension is
below 1 — structurally identical to `PtyManager.resize`'s
`if (cols < 1 || rows < 1) return`:

```ts
setBounds(bounds: BrowserBounds): void {
  // BUG-157 — refuse a degenerate (0 or negative) WCV size. A
  // zero-dimension bounds can reach here if a layout reflow lets the
  // host element measure to 0 during a transient (the browser-pane
  // analog of BUG-156's terminal SIGHUP cascade). 1×1 is the
  // intentional "park / hide but keep alive" state (FOLLOWUP-025), so
  // gate on < 1, not <= 1, to preserve it. Defense-in-depth: guard the
  // renderer call sites AND this main-side entry point.
  if (bounds.width < 1 || bounds.height < 1) return
  this.currentBounds = bounds
  /* …unchanged… */
}
```

…and the same predicate at the top of `setAuxBounds`.

**Why reject (return early) rather than floor to 1×1?** Returning early
keeps the *last good* bounds applied to the live view (the WCV stays where
it was, at its last sane size) and avoids a visible 1×1 flash on a
spurious 0-measurement during a reflow. Flooring would actively shrink the
view to a dot for one frame. Early-return is also exactly what BUG-156
chose, keeping the two guards' semantics identical and easy to reason
about. The cached field (`currentBounds` / `auxBounds`) is intentionally
**not** updated on a rejected call, so the next valid measurement
restores cleanly.

**Decision note — should `x`/`y` be guarded too?** No. Negative `x`/`y` is
legitimate (a pane partly scrolled/positioned off-screen edge is a normal
WCV state); only `width`/`height` cause the degenerate-surface fault. Guard
the two dimensions that matter, nothing more — keep the predicate minimal
(echoing BUG-156's cols/rows-only check).

### D2 — Delete the dead `useTerminal.ts` hook

`renderer/hooks/useTerminal.ts` exports `useTerminalIPC`, whose header
comment claims "TerminalPane.tsx uses this directly" — but it does not.
`TerminalPane` has its own inline PTY wiring and its own ResizeObserver
(the guarded path); a grep across `renderer/` finds **zero** importers of
`useTerminalIPC`. The file additionally contains an un-guarded
`fit.fit()` → `pty.resize(tabId, term.cols, term.rows)` at lines 39-47 —
i.e. a dormant instance of the very pattern this audit exists to remove.
Delete the file outright. (Removing it also closes AC5's "bonus".)

No callers ⇒ no import to update; this is a pure deletion. A typecheck +
build confirms nothing referenced it.

### Out of scope (already-correct, by design)

- **`ImageView.tsx` ResizeObserver** — its observer writes only React
  state (`setContainerSize`, `:141`) and never crosses IPC, so there is no
  main-process backing system to corrupt. No guard is added; adding one
  would be cargo-culting the pattern where it doesn't apply.
- **The renderer call-site guards.** The renderer already self-limits via
  the intentional 1×1 park; the audit's defense-in-depth principle is that
  the *authoritative* guard belongs at the API border (D1). We are not
  adding redundant renderer-side `if (width < 1)` checks — the boundary
  guard is the single source of truth, matching how BUG-156 left the
  terminal path (renderer guards there pre-existed; the durable fix was the
  PtyManager check).

---

## 5. CLI / UI parity

**No parity surface.** WCV bounds are an internal, continuously-recomputed
layout value driven by ResizeObserver — not a user-invokable action, a
toggle, or any persistent state an agent would read or set. There is no
`duo` verb today that sizes the browser pane directly (panes size from the
window/split geometry), and this change adds none. The guard is invisible
plumbing; the dead-code deletion removes an unused module. **No CLI verb,
skill, `agents/duo.md`, or `CLI-COVERAGE.md` change is warranted** —
called out here explicitly per the CLI-parity rule as a deliberate
(trivial) asymmetry.

**Renderer-surface parity (renderer-surfaces.md):** the deleted hook is
terminal-only and unmounted; it has no editor/canvas analog, so its
disposition is **(b) skipped — surface-specific**. The D1 guard is
main-process infrastructure, not an editor surface feature, so the
editor/canvas parity rule does not apply.

---

## 6. Verification — checklist

This is a guard + deletion with no new user-visible UI, so the bar is
"prove the guard fires, prove nothing valid regressed, prove the deletion
is clean" — not a full smoke-walk. Still, it touches `electron/` (a
main-process change → requires a real Electron restart, not HMR) so the
live checks run against a fresh `npm run dev`.

1. **Typecheck + build clean** — `npm run typecheck` and `npm run build`
   pass after deleting `useTerminal.ts` (confirms zero stale importers).
2. **Guard unit-level reasoning** — confirm `setBounds`/`setAuxBounds`
   early-return for `width: 0`, `height: 0`, and negative values, and pass
   through `1×1` and all normal sizes. (A focused vitest around
   `BrowserManager` bounds, if cheap to stand up, locks this against
   regression per the "recurring regressions need durable coverage" rule;
   otherwise verify by inspection against the BUG-156 exemplar.)
3. **No regression on valid resize (live, main-process restart):** with
   the browser pane open, resize the window, drag the terminal↔canvas
   split, and collapse/expand the navigator — the browser pane tracks its
   host element exactly as before (the guard never fires on real
   geometry).
4. **1×1 park still works (live):** open a full-viewport modal that emits
   `duo-wcv-park` (e.g. the Clone modal, FOLLOWUP-025) → the WCV hides
   (not occludes the modal); close it → `duo-wcv-restore` repositions the
   pane. Confirms the `< 1` (not `<= 1`) predicate preserved the park.
5. **Aux path (live):** pin a browser tab into the aux slot, then resize /
   close the split — the aux WCV repositions and hides correctly
   (`setAuxBounds` guard didn't break the FOLLOWUP-025-style 1×1 cleanup).
6. **Terminal unaffected:** terminals still resize normally (we only
   deleted an unmounted hook; `TerminalPane`'s own RO path is untouched).

---

## 7. Future / open

- **None blocking.** If a future feature ever adds a `duo` verb that sizes
  the browser pane directly, that verb's handler should route through the
  now-guarded `setBounds`, inheriting the protection for free.
- If the codebase grows a third+ WCV bounds entry point, fold it under the
  same D1 predicate rather than re-deriving a local check — the boundary
  guard is meant to be the one place this lives.

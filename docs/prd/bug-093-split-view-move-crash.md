# BUG-093 PRD — Move-tab-to-Split-View renderer crash (un-batched setState cascade)

> **Status:** confirmed-open, fix not yet applied. v0.6.7 landed only
> *instrumentation* (the `[BUG-093]` console traces + an inline `ErrorBoundary`
> around `<WorkingPane>`); the suspect logic is unchanged. FOLLOWUP-013
> (Sprint 16) could not reproduce the crash via synthetic CLI `KeyboardEvent`s,
> so it carried forward. This PRD specifies the **fix**, gated on a real-keystroke
> repro.
> **References:**
> - **Bug entry:** [`tasks.md` § BUG-093](../../tasks.md) (symptom, three
>   structural-issues audit, three deferred fix candidates).
> - **Follow-up:** [`tasks.md` § FOLLOWUP-013](../../tasks.md) — the stalled
>   clean-repro investigation (synthetic events don't simulate mid-typing dirty
>   state).
> - **Code:**
>   - `renderer/App.tsx § splitViewMoveTabByPath` (the swap primitive — instrumented
>     at App.tsx:2993, suspect setState cascade at App.tsx:3067–3107).
>   - `renderer/components/WorkingPane.tsx` (renders main `fileTabs` + the aux slot;
>     intermediate-render window at WorkingPane:687–707 and :761–785).
>     `buildAuxFileTab` at WorkingPane:798.
>   - `renderer/components/ErrorBoundary.tsx` (the inline boundary; `[ErrorBoundary:WorkingPane]`
>     log at ErrorBoundary:75).
> - **Cross-ref:** BUG-092 (companion — even when the move *succeeds*, the moved
>   canvas can't run scripts because the aux iframe sandbox blocks them);
>   BUG-091 (the over-broad lift that gated this surface); BUG-065 (the original
>   app-level ErrorBoundary this `inline` variant extends).

---

## 1. The feature — Move tab to Split View

Duo's working pane (the "canvas" slot — internally `WorkingPane`) can show two
file tabs side-by-side: a **main** column and an **aux** column. "Move to Split
View" takes the active main file tab and relocates it into the aux slot. Four
entry points all converge on one primitive:

| Trigger | Path to the primitive |
|---|---|
| Right-click a working tab → **"Move to Split View"** | `splitViewMoveTabByPath(path)` |
| **⌘\** (move active main tab to aux) | resolves active path → `splitViewMoveTabByPath` (App.tsx:3127) |
| A page-link / programmatic open into aux | `workingAux.onOpen` → `splitViewMoveTabByPathRef.current(path)` (App.tsx:3794) |
| **`duo split-view open <path>`** (CLI) | same `workingAux.onOpen` IPC → same ref (cli/duo.ts:835) |

`splitViewMoveTabByPath` (App.tsx:2993) is the single source of truth. It:
1. releases any pinned browser-aux tab first (file-aux and browser-aux are
   mutually exclusive);
2. no-ops if the path is already in aux;
3. if aux currently holds a *different, dirty* path, shows the dirty-replace
   confirm (the swap will unmount that editor and lose unsaved edits);
4. **performs the swap** — drops the moving path from main `fileTabs`, promotes
   the old aux path back to main as a fresh tab, repoints `activeWorking`, and
   installs the new `auxState`.

It is the swap in step 4 that crashes.

---

## 2. Persona + job to be done

**Primary persona:** the PM/owner mid-flow in a fresh canvas — typing bullets,
having just dropped a comment on one — who wants to pull a second document up
beside it.

**Job:** *"Put this canvas I'm working in side-by-side with another, without
losing what I just typed and without the app blowing up."* The crash violates
the second half hard: a routine "show me these two together" gesture takes down
the whole working surface. Pre-instrumentation it dropped the **entire
renderer** to the app-level error page (losing every open tab on Reload);
post-instrumentation the inline `ErrorBoundary` localizes it to a "WorkingPane
hit a render error" panel — the terminal column, navigator, and banners survive
— but the user still loses the canvas they were in.

---

## 3. The problem this fixes

When the crash fires, the swap's **four un-batched `setState` calls** run as
separate renders instead of one. `splitViewMoveTabByPath` is `async` and crosses
two `await` boundaries before the swap — `await releaseAuxTab()` (App.tsx:3014)
and `await dialog.confirm(...)` (App.tsx:3039). **In React 18, automatic
batching does not span an `await`** (the function has yielded to the
microtask queue), so the post-await block fires four state updates that each
trigger their own render:

| Order | Call | Site |
|---|---|---|
| 1 | `setFileTabs(prev => prev.filter(t => t.path !== path))` — drop moving path from main | App.tsx:3067 |
| 2 | `setFileTabs(curr => [...curr, promotedTab])` — promote old aux path back to main | App.tsx:3075 |
| 3 | `setActiveWorking(...)` — repoint focus to the promoted tab | App.tsx:3082 |
| 4 | `setAuxState({ paths: [path], ... })` — install moving path in aux | App.tsx:3091 |

Between these, `WorkingPane` renders **inconsistent intermediate states**:

- After (1)/(2) but before (4), the moved path is in **neither** main `fileTabs`
  nor `auxState` — its `PageTab` (canvas iframe) is unmounting from main with no
  aux mount yet to receive it.
- `activeWorking` can transiently reference an id no longer in `fileTabs`
  (WorkingPane:696–706 has an explicit browser-fallback guard for exactly this
  race — evidence the intermediate state is real and already partially
  defended).
- The aux slot keys its `PageTab` off a **path-derived** id (`buildAuxFileTab`,
  WorkingPane:798), while main tabs use random `crypto.randomUUID()` ids
  (App.tsx:3073) — so the same file's canvas is a *different React subtree* in
  aux than in main. The swap is therefore an **unmount-here / remount-there**,
  not a key-preserving move.

The throw window is a `PageTab` mid-`wire()` (its iframe `load` handler installs
a `selectionchange` listener, a `MutationObserver` from `installAutoStampIds`, a
comment-anchor click delegate, and a repaint scheduler — each returning a cleanup
that must run before the next wire). When the moving canvas is **mid-mount with
pending state** (autosave debouncer queued mid-keystroke, MutationObserver firing
on the user's own typing, comment rail mounting), one of those intermediate
renders reads torn-down or half-set state and throws — caught by the inline
`ErrorBoundary`, logging `[ErrorBoundary:WorkingPane]`.

**Why FOLLOWUP-013 stalled:** synthetic CLI `KeyboardEvent`s fire the chord with
a *clean, settled* canvas — the full `[BUG-093] ENTRY → beginning swap →
COMMITTED` trace runs with no throw. The crash needs the **real-user
mid-typing dirty state** that only actual keystrokes produce. This is the
documented "use computer-use for keystroke-only tests" pattern.

---

## 4. The fix (D1)

### D1 — Batch the post-await swap into one render.

**Options considered:**

- **(a) `flushSync` the post-await block.** Wrap the four setStates
  (App.tsx:3067–3107) in `flushSync` from `react-dom` so they apply as one
  synchronous commit — no intermediate render is ever painted, so there is no
  inconsistent state for a child `PageTab` to read mid-swap. Small, localized,
  reversible. Caveat: `flushSync` is forbidden *during* render and can
  de-optimize scheduling — neither applies here (we're in an async event
  handler, well outside render).
- **(b) Single `useReducer`-style update.** Restructure the four setStates into
  one reducer dispatch computing the whole next shape atomically. Eliminates the
  intermediate-render *class* more durably, but is a bigger refactor touching how
  `fileTabs` / `activeWorking` / `auxState` are owned — out of proportion to a
  targeted crash fix, and higher regression surface across every other consumer
  of those three states.
- **(c) Per-mount epoch guard in `PageTab`.** Have `handleReady`/`wire()` check
  a per-mount counter before each side-effect install so a stale wire's cleanup
  can't race a new wire's setup. Treats the *symptom* in the child rather than
  the *cause* (intermediate renders) in the parent; leaves the inconsistent
  intermediate renders in place for every other child.

**Recommendation: (a) `flushSync`.** It directly removes the root cause — the
multi-render cascade — with the smallest blast radius, and because **all four
entry points (right-click, ⌘\, page-link, `duo split-view open`) route through
this one function, one change fixes every path at once.** (b) and (c) stay on
file as escalations if a `flushSync`'d build still reproduces.

**Hard gate — repro before ship (D1a).** Per the bug entry and FOLLOWUP-013,
**do not ship a code change without first capturing a real-keystroke crash trace.**
The fix is high-confidence but the *confirmation* that (a) resolves it must be
empirical, not asserted:

1. `request_access` for **"Electron"**; in the running dev app open a fresh
   canvas (`duo edit --canvas /tmp/bug093-repro.html` against a non-existent
   path → renderer seeds boilerplate).
2. **Type** several bullets with real keystrokes (computer-use, not synthetic
   events). Add a comment on one bullet.
3. With autosave still pending (immediately after typing), right-click the tab →
   **"Move to Split View."**
4. Read the last `[BUG-093]` line (names the swap phase running at the throw) +
   the `[ErrorBoundary:WorkingPane]` message + component stack. Confirm the
   component stack points into the `PageTab` / `RenderedPage` wire path as
   hypothesized.

Only after the crash is observed on the *current* build, apply (a) and confirm
the same gesture no longer throws (the `[BUG-093] COMMITTED` line now follows
cleanly with no `[ErrorBoundary]` log).

**Keep the instrumentation.** The `[BUG-093]` traces and the inline
`ErrorBoundary` are cheap (one `console.log` per move) and are the forensic net
for any *future* swap regression — leave them in place after the fix lands
(mirrors the ENH-091 "instrumentation stays in code" precedent).

---

## 5. Behaviors after the fix

- **No crash.** A "Move to Split View" while the source canvas is mid-typing
  (pending autosave + live MutationObserver + mounting comment rail) completes
  without a `[BUG-093]`/`[ErrorBoundary:WorkingPane]` throw, on every entry
  point.
- **Swap result unchanged.** The visible outcome is identical to today's
  happy path: moving path lands in aux at a 50/50 inner split (ENH-126,
  App.tsx:3098), outer columns snap to ~33/33/33 when the terminal is visible
  (App.tsx:3105), the old aux path (if any) is promoted back to a fresh main
  tab, and focus follows it.
- **Dirty-replace gate untouched.** The confirm dialog (App.tsx:3039) still
  fires when aux holds a different *dirty* path; Cancel still bails, Discard
  still proceeds. `flushSync` wraps only the post-gate swap, after the `await
  dialog.confirm` has already resolved.
- **No unsaved-work loss on the moved tab.** This fix does not change what the
  swap saves — it changes *how the renders batch*. (The aux iframe's
  scripts-blocked limitation when the moved file is a playground is **BUG-092**,
  tracked separately; out of scope here.)

---

## 6. Implementation notes

- **Single touch-point.** The change is the `flushSync` wrapper around
  App.tsx:3067–3107 plus a `react-dom` import. `grep flushSync renderer/`
  currently returns zero hits — this is the first use, so no existing pattern to
  match.
- **What goes inside the wrapper.** Exactly the four state mutations that must
  commit atomically: the two `setFileTabs` (3067, 3075), `setActiveWorking`
  (3082), and `setAuxState` (3091). The trailing `setSplitPct(33)` (App.tsx:3106)
  is layout-only and can stay inside the same batch for tidiness (it doesn't
  affect the `fileTabs`/`auxState` consistency the crash hinges on). The
  `[BUG-093] COMMITTED` log stays just after the wrapper.
- **Leave the `await`s outside.** `flushSync` must not wrap `await
  releaseAuxTab()` or `await dialog.confirm(...)` — it is synchronous-only and
  the gate logic legitimately yields. Only the post-decision swap is wrapped.
- **The stale-`fileTabs` closure read (App.tsx:3084).** `setActiveWorking`'s
  `fileTabs.find(...)` reads the closure's pre-removal `fileTabs` — which is the
  *intended* (pre-swap) snapshot, so it stays correct. No change needed; noted
  so a future reader doesn't "fix" it into a bug.
- **Renderer-only.** No `electron/`, `shared/`, or `cli/` edits — this lives
  entirely in `renderer/App.tsx`. Per `.claude/rules/ui-verification.md`, the
  renderer change HMRs without an Electron restart, but the **live repro + post-
  fix re-verify (D1a) is mandatory** before "done".
- **Editor/canvas parity (`.claude/rules/renderer-surfaces.md`).** The swap
  primitive is surface-agnostic (it moves any `FileTab` kind), but the crash is
  most easily reproduced on the **canvas** (`PageTab` iframe wire). Disposition:
  **(a) Mirrored by construction** — the `flushSync` fix is in shared App-level
  swap code, so it protects the markdown-editor and JSON-viewer aux moves
  equally; no per-surface port needed.

---

## 7. CLI / UI parity

**Full parity already exists — and that is load-bearing for this fix.** The CLI
verb `duo split-view open <path>` (cli/duo.ts:835) sends an IPC that lands on
`workingAux.onOpen` and calls `splitViewMoveTabByPathRef.current(path)`
(App.tsx:3794) — **the identical function** the right-click menu and ⌘\ chord
invoke. Consequences:

- The bug is **CLI-reproducible in principle** (an agent can drive
  `duo split-view open` against a mid-mount canvas), and the fix protects the CLI
  path automatically.
- **No new verb** is added. The full split-view verb set
  (`open` / `open-browser` / `close` / `promote` / `resize` / bare-status,
  cli/duo.ts:817) already covers the agent side; the right-click "Move to Split
  View" is the human mirror of `duo split-view open`.
- **No deliberate asymmetry.** The only UI-only affordance in this area is the
  *dirty-replace confirm dialog*, which is a human safety prompt; the CLI path
  hits the same gate (`splitViewMoveTabByPath` runs the dialog regardless of
  caller), so even that is symmetric.

---

## 8. Verification — smoke-walk checklist

UI-touching renderer change → a **macOS dev-session walk is owed before any
version cut** (per CLAUDE.md §7 + `.claude/rules/ui-verification.md`). The first
two items are the fix's reason for existing and **must use real keystrokes**
(computer-use), not synthetic events — synthetic dispatch is exactly what made
FOLLOWUP-013 a false-negative.

1. **Repro on the pre-fix build (gate).** Fresh canvas → type bullets (real
   keystrokes) → add a comment → right-click tab → "Move to Split View" while
   autosave is pending. Confirm the `[ErrorBoundary:WorkingPane]` panel appears
   and capture the last `[BUG-093]` phase + component stack. *(If it refuses to
   crash even with real keystrokes, escalate variants per FOLLOWUP-013 step 4
   before concluding the cascade isn't the cause.)*
2. **Same gesture, post-fix — no crash.** After applying (a), repeat step 1's
   exact sequence; the working pane stays alive, `[BUG-093] COMMITTED` logs, no
   `[ErrorBoundary]` line.
3. **Move into an empty aux** — fresh canvas, no aux open, right-click → Move to
   Split View → canvas lands in aux at 50/50, main falls back to browser (no
   promote), no throw.
4. **Move into an occupied, clean aux** — aux holds a saved file → moving a new
   canvas in promotes the old aux file back to a fresh main tab, focus follows
   it, no throw.
5. **Dirty-replace gate intact** — aux holds a *dirty* file → moving a new tab
   in still raises the confirm; Cancel bails (aux unchanged), Discard proceeds
   (swap completes), neither path crashes.
6. **Chord + CLI parity** — repeat the empty-aux move via **⌘\** and via
   **`duo split-view open /tmp/bug093-repro.html`**; both produce the identical
   result and neither throws (proves the shared-primitive fix covers all entry
   points).
7. **Regression** — `duo split-view close` / `promote` / `resize <pct>` still
   behave; opening/closing split view repeatedly leaves no orphaned aux state or
   error overlay.

---

## 9. Future / open

- **BUG-092 (companion, separate fix).** Even with the crash gone, moving a
  *playground* (scripts-needed HTML) into aux renders it script-blocked because
  the aux iframe inherits the canvas sandbox. Tracked separately; this PRD does
  not address it.
- **Escalation path.** If a `flushSync`'d build still reproduces under real
  keystrokes, the next move is **D1 option (b)** (single reducer-shaped update)
  or **(c)** (PageTab per-mount epoch guard) — both pre-analyzed in the bug
  entry. Capture a fresh trace first; don't escalate blind.
- **Durable regression coverage.** A live UI crash that returns is exactly the
  "recurring regression needs a durable test" case. A jsdom unit test can't
  reproduce the iframe-wire timing, but a thin test asserting that
  `splitViewMoveTabByPath` performs its state mutations in a single batched
  commit (e.g. counting renders, or asserting no intermediate render observes a
  path absent from *both* `fileTabs` and `auxState`) would pin the batching
  guarantee against a future refactor that re-splits the cascade. File as a
  follow-up if the owner wants belt-and-suspenders beyond the smoke walk.

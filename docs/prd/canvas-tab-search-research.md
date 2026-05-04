# Canvas tab-search research — `⌘⇧A` palette over WebContentsView occlusion

> **Status.** Research doc — owed before any ENH-080 code. Format note:
> the tasks.md entry asks for `.html` mirroring
> `canvas-split-view-research.html`. I'm writing this as `.md` because
> (a) all other PRDs in `docs/prd/` are markdown, (b) this doc is more
> "decision capture + arch options" than user-facing, and (c) it stays
> grep-able. Easy to convert to HTML later if needed.
>
> **Filed:** 2026-05-04 (Sprint 4 Phase 6 — owner asked for ⌘⇧A palette
> in v0.6.5; research-doc gate per tasks.md ENH-080).
>
> **Cross-refs:**
> - [tasks.md § ENH-080](../../tasks.md) — feature ask
> - [docs/DECISIONS.md § WCV-occlusion remediation](../DECISIONS.md) —
>   ADR for the bug class this design must navigate
> - [docs/prd/canvas-split-view-research.html](canvas-split-view-research.html) —
>   structural template; same problem space (renderer-DOM UI vs. WCV
>   occlusion), different feature
> - BUG-006 (Send → Duo pill), BUG-045 (file:// browser tabs context
>   menu), BUG-047 (broader class summary), BUG-050 (ContextMenu
>   occluded by editor canvas), BUG-058 (context menu occluded by
>   browser), BUG-064 (trash + pinned-close modal occlusion)

---

## 1. Owner intent

Verbatim ask: *"need cmd+shift+a to search open tabs"* — and the
follow-up constraint flagged in idle-thoughts processing: *"think hard
about the menu occlusion issues we've had to make sure we get this one
right."*

Reading: an instant tab-jumper. The user has many tabs across the
working pane (file tabs, page canvases, Split View aux) AND the
browser pane (faq.html, smoke walks, anthropic.com, …). Today there's
no fast "where is the X tab?" gesture — they alt-tab visually, scroll
the strip, or remember the rough position. ⌘⇧A would be type-as-filter
+ Enter-to-activate, mirroring VS Code's ⌘P, Linear's ⌘K, Slack's ⌘K.

Rough requirements (firm):
- Type-as-filter against `title` + `path` + `url`.
- Group by surface — working / browser / aux — with section headers.
- Arrow keys to navigate; Enter to activate; Escape to dismiss.
- Activation routes through the same paths existing tab-strip clicks
  take (no surface-specific re-implementation).
- CLI parity: `duo tab-search [--query <q>]` returns the filtered tab
  list as JSON (per the rule that every UI feature ships a CLI
  counterpart).

Soft requirements (negotiable):
- Recent-first ordering inside groups (vs. positional / alpha).
- Hotkey hints (e.g. ⌘1/⌘2 for first/second result).
- Persistence of the last query across opens (probably no).

---

## 2. The constraint that shapes this — WCV occlusion

A tab-search palette is a renderer-DOM floating UI that the user
expects to see ABOVE everything else. The active browser tab is a
[`WebContentsView`](https://www.electronjs.org/docs/latest/api/web-contents-view)
(WCV) which Electron composites at the **window-server level**, not
the DOM level. WCVs are not z-indexable from the renderer — they sit
ON TOP of the renderer's React tree by construction. Any
renderer-rendered overlay (modal, popover, palette, dropdown) appears
**under** the active WCV when the working pane is on the browser side.

This is the bug class behind:
- BUG-006 (Send → Duo pill — solved with in-page CDP injection)
- BUG-045 (file:// browser tabs context menu — native NSMenu)
- BUG-047 (class summary)
- BUG-050 (ContextMenu occluded by editor canvas)
- BUG-058 (context menu occluded by browser)
- BUG-064 (trash + pinned-close modal occlusion)

[ADR](../DECISIONS.md) resolution for menus + sheets: **native NSMenu
+ system sheets**, NOT WCV-mute. That works for menus (1-shot,
short-lived, OS-managed). It does **not** trivially work for an
interactive palette: NSMenu doesn't fit a typeahead-filterable list
with grouped sections + arrow-key navigation + persistent typing
state.

So ENH-080 needs a different mechanism. Four options follow.

---

## 3. Architecture options

### Option A — Native child window (`BrowserWindow` w/ transparent borderless chrome)

**Mechanism.** Spawn an Electron child `BrowserWindow` parented to
the main window. Configure: `transparent: true`, `frame: false`,
`resizable: false`, `alwaysOnTop: false` (parented), `skipTaskbar:
true`, `parent: mainWindow`, `modal: false`. The child window has its
own renderer process, hosts a small React surface for the palette,
and dismisses on `blur` (clicking elsewhere) or Escape. Composes
above the WCV at the window-server level — the same mechanism that
makes `dialog.showMessageBox` work over WCVs.

**Pros.**
- WCV occlusion is a non-issue. Window-server-level layering means
  the palette sits above the WCV by construction.
- Visual styling is fully under our control — Atelier paper + accent
  + ink tokens, custom typography, custom transitions. No NSMenu
  styling constraints.
- Interaction is full DOM — typeahead, keyboard nav, async loading,
  groupings — all native React patterns.
- Standard Electron pattern; well-trodden territory.

**Cons.**
- Spinning up a child window has measurable latency (~50-150ms in
  practice). For a chord-driven palette, that's borderline noticeable.
  Mitigation: pre-create the window at app boot, hide/show on chord.
  Adds a quiet always-resident process at the cost of zero-latency
  open.
- IPC wire between parent and child for the tabs list + activate
  callback. Not architecturally hard — main process is the source
  of truth for both surfaces — but it's another communication
  channel to maintain.
- Visual continuity with the rest of the app needs care. Child
  window's transparency + Atelier styling need to match the main
  window's tokens; no shared CSS-vars unless we ship them via IPC
  injection (which we can — the brand tokens are static).
- Focus management is delicate. The child needs to STEAL focus from
  the WCV reliably, accept input, and return focus to the previously-
  focused surface on dismiss. Test thoroughly: chord from xterm,
  chord from canvas, chord from browser-pane.

**Estimated effort.** Medium. ~2-3 days incl. testing, focus
edge-cases, visual polish. A pre-created child window pattern needs
care around app shutdown (don't leak the hidden window).

### Option B — WCV mute pattern (BUG-058 v2 lineage)

**Mechanism.** When the palette opens, call
`browserManager.setOverlayMuted(true)` which collapses every WCV to
1×1 pixel offscreen. Renderer-DOM palette renders normally over the
now-WCV-free pane. Closing the palette restores WCV bounds.

**Pros.**
- Mechanism already exists in the codebase (used in BUG-058 v2's
  earlier iterations).
- No new process; no IPC wiring beyond the existing
  `setOverlayMuted` IPC path.
- Visual styling lives in the renderer where the rest of Atelier
  styling lives — no token-injection step.
- Open/close is fast (no process spawn).

**Cons.**
- ENH-050's ADR explicitly retired this for menus + sheets in favor
  of native NSMenu. Re-introducing it for the palette risks
  regressing the precedent ("we use native chrome for chrome-y
  things; we use WCV-mute only when there's no native equivalent").
  It's defensible IF the palette genuinely doesn't fit native
  primitives — which is the case here — but the precedent should be
  documented in DECISIONS.md as part of landing this.
- Visual flicker risk. The WCV → 1×1 collapse + restore are
  observable as page-content flash, especially if the active tab
  has expensive render (Google Docs, dynamic dashboards). Mitigation:
  fade the WCV via `view.setOpacity(0)` for the duration instead of
  collapsing bounds. Less abrupt; same z-effect.
- Doesn't help any future palette feature that needs to OVERLAY the
  WCV while keeping WCV interactive (e.g. a "click in the page to
  add a comment anchor" mode). For ⌘⇧A specifically that's not a
  requirement, but the pattern doesn't compose if we want richer
  future palettes.

**Estimated effort.** Small. ~1 day. Most code is renderer-side
React + reuse of existing mute mechanism.

### Option C — Renderer-DOM palette + dynamic WCV bounds shrink

**Mechanism.** Same as B, but instead of mute-to-1×1, the renderer
dynamically resizes the active WCV bounds while the palette is
visible — e.g. shrink to a margin around the palette, or constrain
to a visible quadrant. Aesthetic: page stays partially visible; only
the palette area is opaque renderer DOM.

**Pros.**
- Page-visibility is preserved during palette use. The user can see
  what's behind the palette as they search.
- Doesn't fully retire WCV interactivity (mid-palette page click
  could dismiss the palette and click through, if we want).

**Cons.**
- Animation + re-layout complexity is real. WCV bounds changes are
  not animatable; they're step changes. The palette appearing
  triggers a single jarring resize.
- Edge cases multiply: window resize during palette open, multiple
  monitors, dark mode, WCV CDP debugger session, etc.
- Visual coherence with the page underneath is hard. The palette
  needs a backdrop / scrim to be readable, which negates the
  page-visibility argument.
- The shrunk WCV's content area is now smaller than the user's tab
  expects; React-based pages re-flow their layouts on resize, which
  for the duration of the palette is wasted work.

**Estimated effort.** Medium-high. ~3-4 days. Animation polish + edge
cases dominate.

### Option D — Extension-style CDP overlay (in-page palette injection)

**Mechanism.** Mirror the BUG-006 in-page Send → Duo pill pattern.
The palette is rendered into the active WCV via CDP injection — same
mechanism as the pill. Window-server occlusion is bypassed because
the palette IS in the WCV.

**Pros.**
- Same proven pattern as the Send → Duo pill (BUG-006). Familiar
  shape.
- No separate process; no WCV mute or shrink.

**Cons.**
- The palette must work even when no browser tab is active — when
  the user is on a canvas / file tab and ⌘⇧A is pressed. CDP
  injection requires a target; without an active WCV there's
  nowhere to inject. Would need a fallback path for the no-WCV
  case, which forces multiple implementations of the same UI.
- Cross-surface input. The palette would receive keystrokes inside
  the WCV's renderer process; routing those back to the main
  process and the React tab-list state requires bridging two JS
  realms. Doable but adds complexity.
- Visual styling would need to be re-derived inside the CDP-injected
  context — Atelier tokens aren't available unless we inject them
  via the same channel. Repeated for each surface where the palette
  fires.
- Strategically wrong fit: tab-search is a CHROME feature ("which
  tab do I want?"), not a PAGE feature ("act on the page content").
  CDP injection is the right pattern for page-coupled features
  (selection, annotations, in-context UI) — not chrome-coupled
  ones.

**Estimated effort.** High. ~4-5 days. The two-realm input bridging
+ multi-surface fallback dominate.

---

## 4. Comparison matrix

| | A: Child window | B: WCV mute | C: WCV shrink | D: CDP overlay |
|---|---|---|---|---|
| WCV occlusion solved? | ✅ window-server level | ✅ via mute | ✅ via shrink | ✅ in-WCV |
| Works when no browser tab active? | ✅ | ✅ | ✅ | ❌ needs fallback |
| Visual flicker risk | None | Medium (mitigable via opacity) | Low–medium (single resize step) | None |
| Atelier styling fidelity | Full (token injection) | Full (renderer DOM) | Full (renderer DOM) | Partial (per-surface re-injection) |
| Open/close latency | ~50–150ms (or zero w/ pre-create) | Fast | Fast | Fast |
| Effort | Medium (2–3 days) | Small (1 day) | Medium-high (3–4 days) | High (4–5 days) |
| Pattern precedent in codebase | None for palettes | BUG-058 v2 lineage | None | BUG-006 pill |
| ENH-050 ADR alignment | ✅ "not WCV-mute" applies | ⚠️ retired pattern revisited | N/A (different mechanism) | ✅ aligned |
| Future-extensibility for richer palettes | High | Medium | Low | Low |
| Cross-monitor / window-resize edge cases | Standard Electron | Existing handled | New surface area | New surface area |

---

## 5. Recommendation

**Option A** (native child window with pre-creation at boot) is the
recommended path, with **Option B** as the fast-fallback if A's
focus / pre-creation polish is unworkable.

Rationale:
- A's main downside (latency) has a clean mitigation (pre-create at
  boot). Apple Spotlight, Raycast, Alfred all use this pattern; the
  user's mental model expects instant.
- A composes for future palettes. If we add ⌘P (file picker) or ⌘K
  (command palette) later, we reuse the child-window pattern — the
  palette skeleton becomes a reusable React component, and only the
  data source changes.
- A doesn't re-litigate the ENH-050 ADR. WCV-mute (option B) is a
  documented retired pattern; reviving it for one feature is
  acceptable, but accumulating revivals weakens the precedent.
- A's effort is the median of the four. C and D are more work for
  no clear win.

If the prototype of A reveals a hard blocker — e.g. focus
management between child window and main window proves brittle on
some macOS version — fall back to Option B with the documented
caveat that we accept the ADR exception for this case.

**Explicitly NOT recommended:**
- Option C (dynamic shrink) — animation polish swamps any visual
  benefit, and the result is worse than A or B.
- Option D (CDP overlay) — wrong fit for chrome features; complexity
  for no benefit; doesn't handle no-browser-tab case.

---

## 6. Implementation sketch — Option A locked

### 6.1 New chord row

[`renderer/keyboard/globalShortcuts.ts`](../../renderer/keyboard/globalShortcuts.ts) —
add:

```ts
if (meta && shift && !alt && !ctrl && e.code === 'KeyA') {
  return { id: 'tabSearchOpen' }
}
```

`e.code` not `e.key` — Phase 4 lesson; locked by negative tests in
`globalShortcuts.test.ts`. Add a positive + a negative regression
test.

### 6.2 Wire-through

[`useKeyboardShortcuts`](../../renderer/keyboard/useKeyboardShortcuts.ts)
adds the `tabSearchOpen` case. Dispatches an IPC call to the main
process (`IPC.TAB_SEARCH_OPEN`) with the current focusedColumn
context (so the palette can prefer "current surface" matches in
ordering).

### 6.3 Main process — child window lifecycle

New service `electron/tab-search-window-service.ts`:
- On app `ready`, pre-create the child `BrowserWindow`. Hidden.
- Wire IPC for: `open(focusContext)`, `close()`, `getTabs()`,
  `activate(targetId)`.
- Activate dispatch routes through existing handlers — working tab
  click via `setActiveWorking({kind:'file', id})`, browser tab via
  `browserManager.activateTab(tabId)`, aux via the Phase 3c-ii path.
- Closing the child window doesn't destroy it — re-show on next
  open. Destroy only on app quit.

### 6.4 Renderer entry point for the child window

New Vite entry `renderer/tab-search/index.tsx`. Loads a small React
tree, listens for the `open(focusContext)` IPC, queries main for the
tab list, renders the palette. Uses Atelier tokens injected via
`additionalArguments` at child-window creation (same pattern as
`--duo-app-version` / `--duo-is-dev`).

### 6.5 CLI parity

[`cli/duo.ts`](../../cli/duo.ts) gets `duo tab-search [--query <q>]`:
- Returns `{ working: [...], browser: [...], aux: [...] }` JSON,
  filtered by `--query` against title/path/url substring.
- Reuses the same data source as the palette (an
  `IPC.TAB_SEARCH_LIST` getter on the main process), so agent
  inspection and human use stay aligned.
- Add to plumbing: `shared/types.ts § DuoCommandName`, preload, main
  IPC handler, socket-server case, skill cheat-sheet, agents/duo.md
  cheat-sheet, docs/CLI-COVERAGE.md.

### 6.6 Visual

Center-screen palette. ~480px wide, max 60% viewport height.
Atelier paper bg + accent border + ink-soft body. Three sections
(Working / Browser / Aux). Type-as-filter input pinned at top with
icon. Result rows: glyph (file kind / globe / split icon) + title +
secondary path/url. Selected row gets `bg-accent text-white`
(Finder-style, per memory rule).

Dismiss: Escape, blur, click outside the palette, Enter (after
activation).

### 6.7 Open questions

- Pre-created child window: visible flash on first open, or
  imperceptible? Spike A1 — measure. If imperceptible (≤16ms), no
  pre-create needed. If perceptible, pre-create.
- Recent-first vs. positional ordering inside groups? Default to
  positional (matches strip order). Add a setting later if owner
  asks for recent-first.
- Hotkey hints (⌘1, ⌘2, …)? Skip for v1.
- Persistence of last query? Skip for v1.

---

## 7. v0.6.6 sprint candidacy

ENH-080 is queued for v0.6.6 per [active-sprint.md](../dev/active-sprint.md)
Phase 6. This research doc is the sprint-entry gate. After owner
agrees with the recommendation, the implementation sketch above
becomes the work plan.

If owner wants Option B instead (smaller effort), the sketch
collapses to:
- (6.1) chord row — same.
- (6.2) wire-through — same.
- (6.3) is replaced with `browserManager.setOverlayMuted(true)` on
  open, restore on close.
- (6.4) is collapsed into the main renderer (no separate Vite entry).
- (6.5) CLI parity — same.
- (6.6) visual — same, rendered in the main renderer over the muted
  WCV.
- Effort drops from 2–3 days to ~1 day.

Both paths preserve CLI parity and the visual brief.

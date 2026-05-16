# ENH-159 v2 — Inspect mode UX redesign + selection-pause regression

**Status:** 🆕 Filed 2026-05-16 after v0.7.0 walk surfaced four ENH-159 issues.
**Parent:** ENH-159 (browser send-to-Claude DOM context + inspect mode) — shipped today as the v1 of inspect mode.

## What the walk caught

Owner walked ENH-159's inspect mode and reported:

1. **Walk step 1's seed command failed** — owner rewrote one that worked. (Walk-instruction issue, not feature.)
2. **Steps 2–5 PASS** — selection-format paste correctly carries `> @ <selector>` + fenced `context` block.
3. **Step 7 FAIL — toggle-via-CLI-only is too narrow.** Owner: *"need toggle other than cli; e.g. right click in browser pane and/or browser tab"*.
4. **Step 10 — UX feedback (substantive design change).** Owner: *"clicking the highlighted element should freeze/lock the element selection (such that moving the cursor does not change the element selection) and then expose the send to duo pill — clicking the element should not automatically send the element"*.
5. **Step 12 FAIL — selection observer pause during inspect mode doesn't work.** The Send → Duo pill still appears when you select text while inspect mode is on.

This PRD is the v2 design for inspect mode. The CLI verb shape and the DOM-context paste format are unchanged — those passed. This is purely about the UI flow + entry points + selection-observer interaction.

---

## v1 today (recap)

- `duo inspect` toggles inspect mode on/off.
- ⌘⇧C inside the WCV is the keystroke equivalent.
- Hover an element → 2px orange outline + dims tooltip.
- **Click** captures `{tag, selector_path, headingTrail, innerText (capped), attrs}` AND **immediately** ships the structured paste to the active terminal.
- ESC inside the page exits inspect mode without picking.
- Mode-lock should pause the selection observer (so the Send → Duo pill doesn't fire on text-select). **Today this is broken (walk-step 12).**

## v2 — proposed redesign

### 2.1 Click-to-freeze (not click-to-ship)

**Three-state flow** instead of two:

```
State A — INSPECT MODE OFF (default)
  - Selection observer active.
  - Hover does nothing visual.
  - Click = normal page interaction (link, button, focus input).
  - Text selection → Send → Duo pill appears.

State B — INSPECT MODE ON, no element frozen (after `duo inspect`)
  - Selection observer PAUSED. No pill on text-select.
  - Hover → orange outline + tooltip on whatever's under the cursor.
  - Click → freezes the picked element (transition to State C).
  - ESC → exit inspect mode (back to State A).

State C — INSPECT MODE ON, element frozen (after first click)
  - Selection observer still paused.
  - Outline LOCKED on the picked element (different visual — solid 2px
    orange + small persistent label tag showing the selector).
  - Moving the cursor does NOT change the outlined element (locked).
  - A new "Send to Duo" pill appears NEAR the locked element (or
    fixed in a corner — see Q1).
  - Click outside the locked element → either unfreezes (→ State B)
    or no-ops (see Q2).
  - Click the pill → captures the snapshot + ships the structured
    paste to the active terminal. Exits inspect mode (→ State A).
  - ESC → unfreezes (→ State B). Second ESC exits (→ State A).
```

**Why click-to-freeze.** Owner's directive paraphrases as: *"I want to point at an element, confirm 'yes, this one', then send it — not pre-commit by clicking."* This is the inspector-tool pattern in Chrome DevTools (click selects + locks; ESC exits) but with an explicit "ship it" affordance instead of auto-ship.

### 2.2 Entry points — three triggers, not just one

**Today.** `duo inspect` CLI verb + `⌘⇧C` chord. Both toggle on/off.

**v2 — add right-click options on the browser surface:**

- **Right-click in the browser pane** (anywhere) → context menu adds:
  - **"Inspect element here"** — enters State B with the right-clicked element already pre-frozen (jumps straight to State C).
  - **"Toggle inspect mode"** — same as `duo inspect` (enters State B).

- **Right-click on a browser tab** (in the tab strip) → context menu adds:
  - **"Inspect element on this page"** — switches to that tab + enters State B.

The existing `duo inspect` CLI + ⌘⇧C chord stay. The right-click options are additive.

**Implementation note.** The browser pane is a WebContentsView; intercepting right-click currently requires the page-side IIFE to capture `contextmenu` and fire a CDP binding back to main. ENH-094's `playgroundActions` IIFE is the established pattern.

### 2.3 Fix the selection-observer pause regression

**The walk caught.** Step 12 fail: inspect mode is on; user selects text; the Send → Duo pill still appears.

**Root cause (likely).** The page-side IIFE checks `__duoInspectActive` to gate inspect-mode events, but the SELECTION_OBSERVER_IIFE (separate file) doesn't check the same flag before firing the pill. Easy fix in `electron/cdp-bridge.ts § SELECTION_OBSERVER_IIFE`: add an early return if `window.__duoInspectActive === true`.

**Add a regression test** in `electron/cdp-bridge.test.ts` (structural assertion on the IIFE source containing the inspect-active guard).

---

## Open decisions (owner)

1. **Q1 — Pill position when an element is frozen.** Anchored to the element (above/below it, like the existing Send→Duo pill on selection)? OR fixed in a corner (top-right of the browser pane, like a "Send selected element" floating affordance)? Trade-off: anchored is discoverable; fixed-corner avoids occluding the element.

2. **Q2 — Click-outside-locked behavior in State C.** Unfreezes back to State B (re-enables hover targeting)? OR no-op (only the pill or ESC can change the frozen element)? Trade-off: unfreeze gives a "pick another one" path; no-op prevents accidental re-pick.

3. **Q3 — Initial click frozen-element visual.** Same orange outline as hover but solid (not 2px → keep at 2px but no dashes)? OR something more pronounced (4px or a different color)?

4. **Q4 — Pre-frozen entry via right-click context menu** (§2.2 first bullet) — should it skip State B entirely and land directly in State C? OR briefly flash through State B (showing the user the element they right-clicked is now selected) for ~200ms then lock to State C?

5. **Q5 — Chord parity for State C.** ⌘D (Send→Duo) when in State C → ships the frozen element + exits inspect mode? OR only the explicit pill?

---

## Implementation outline (deferred — not for this sprint)

Once decisions land:

- `electron/cdp-bridge.ts` — extend INSPECT_OBSERVER_IIFE with the three-state machine. New events: `inspect-freeze` (B→C), `inspect-unfreeze` (C→B), `inspect-send` (C→A with payload).
- `electron/cdp-bridge.ts § SELECTION_OBSERVER_IIFE` — add `__duoInspectActive` guard + regression test.
- `electron/main.ts` — context-menu integration for browser-pane right-click + browser-tab-strip right-click (NEW: the existing browser tab strip menu).
- `renderer/components/BrowserRenderer.tsx` — render the locked-element pill (anchored or corner per Q1).
- `cli/duo.ts` + `agents/duo.md` + `skill/SKILL.md` + `docs/CLI-COVERAGE.md` — doc the new state machine for agents (`duo inspect` still toggles, but now there's the freeze/send sub-state visible to agents via `BROWSER_INSPECT_STATE` push).

Estimate: 2 dev days for the state machine + entry points + test coverage. Doesn't block any Sprint 18 anchor; can ship independently.

---

## Walk gate

Before any code:

- Owner reviews this PRD.
- Decides Q1–Q5.
- (Optional) Owner walks a stripped-down mockup HTML showing the three states.

Then file v2 as `ENH-159 v2` follow-up in tasks.md.

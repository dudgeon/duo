# Active sprint state — Sprint 6 (v0.6.7)

> **What this file is.** Running scratchpad for the active sprint
> arc. The historical record (Sprint 5 reframe + v0.6.6 cut + Stage
> 19e closure) lives in [docs/dev/session-log.md](session-log.md) —
> most recent at the top.
>
> **For future Claude instances:** if you're picking up after a
> compaction, READ THIS FILE FIRST. Sprint 6's focus is **comments
> on both surfaces** — canvas (regressed) + markdown editor (never
> shipped). The phase plan below is path-dependency-ordered — start
> at Phase 1.
>
> **Update cadence:** at the end of each commit (mark a phase row
> done; flip the "next" pointer; add deviations).

---

## Sprint goal

**"Comments are real and visible" sprint.** Comments on canvas regressed (BUG-081 family — the discoverability UX is broken AND the rail doesn't restore on reopen AND there's no visual link between comment and anchored text); comments on the markdown editor were never built (MISSING-001 / Stage 14a — only the visual primitive exists; the entire data plane is unbuilt). Sprint 6 fixes all four pieces and ships them together with consistent UX across both surfaces:

- **Three discoverable affordances** for adding a comment (replacing the broken hover-pill): keyboard shortcut **⌘⌥M** (Google Docs parity), context-click "Comment" entry, toolbar button.
- **Anchor decoration in the body** — a comment that doesn't visibly attach to its anchor is barely a comment.
- **Bidirectional click-to-focus** — click a thread in the rail → scroll to anchor; click anchored text → focus the thread.
- **Persistence works on reopen** — close + reopen the file, your comments are still in the rail.

**Cut path:** v0.6.7 cuts when both surfaces have the four affordances working, the persistence regression is fixed, the visual association lands, and a smoke walk validates end-to-end.

---

## Phase plan (path-dependency-ordered)

### Phase 1 — BUG-082 (rail-not-restoring-on-reopen) · ✅ 2026-05-04

**Smallest item, highest signal.** Fixes the data-loss appearance. Likely an async-sidecar-vs-mount-gate race in `PageTab.tsx`'s `railThreads` derivation.

- Find the `railThreads` definition + its dependencies in `renderer/components/Page/PageTab.tsx`.
- Check the sidecar load path in `renderer/components/Page/sidecar.ts` — when does it resolve relative to the rail render?
- Likely fix: ensure the gate at line 1422 (`railThreads.length > 0`) re-evaluates after sidecar load resolves. Probably a missing dependency in a `useMemo` / `useEffect`.

**Acceptance:** add 2 comments, close tab, reopen — both visible in the rail without any further action.

**Resolution.** Root cause was exactly the second hypothesis: `builtThreads` useMemo deps `[threadsTick, getDoc]` only got bumped by `persistSidecarMutation` (user mutates the sidecar). Neither the async `readSidecar` resolution NOR the `handleReady` iframe-ready callback bumped the tick — so a fresh open of a file with an existing sidecar never recomputed the rail. Fix: `setThreadsTick(v => v + 1)` in BOTH async resolution paths so whichever finishes second triggers the recompute (covers both orderings: sidecar-first-iframe-second and iframe-first-sidecar-second). Verified via CLI-driven repro: `duo html new` + write sidecar + close tab + `duo view` → rail mounts with both comments anchored. **Regression-test gap** filed as FOLLOWUP-009 (project lacks `@testing-library/react` infra; one-off React component test isn't worth the infra change today).

### Phase 2 — BUG-081 (UX redesign) · ✅ 2026-05-04

**Drop the hover Comment pill; replace with kb / right-click / toolbar.** The hover pill is gated on Claude session via the shared `onSendToDuo` block at `PageTab.tsx:1437` — that gate is incidental; the real fix is the UX redesign per owner direction (Google Docs parity).

Steps:
1. **Wire ⌘⌥M.** Add to `renderer/keyboard/globalShortcuts.ts`. The forwarder already reaches inside the canvas iframe via `installGlobalShortcutForwarder` (CLAUDE.md § 4 plumbing checklist for surfaces). Handler calls `handleStartNewComment` if there's a selection with an anchor; no-ops otherwise.
2. **Add the context-menu entry.** Canvas has a right-click menu via `electron-context-menu`. Add a "Comment" entry that's enabled when the selection's anchor element has a live `data-duo-id`. Same handler.
3. **Add the toolbar button.** Find the canvas chrome row (probably `PageTab.tsx`'s sidecar / chrome). New "💬 Comment" button — enabled-state mirrors selection presence. No floating pill.
4. **Remove the hover Comment pill.** Delete the `<CommentButton rect={pillRect} ...>` render at `PageTab.tsx:1444` and the `CommentButton` primitive if nothing else uses it. **Send → Duo pill stays.**

**Editor-canvas parity** per CLAUDE.md § 4: this is a **(c) Deferred** mirror — markdown side blocks on Phase 4 (MISSING-001). Same kb / right-click / toolbar wires when Phase 4 lands.

**Acceptance:** open a canvas, no Claude session — Comment button still appears in toolbar. ⌘⌥M with selection adds a comment. Right-click on selection → "Comment" entry adds a comment. Hover pill is gone.

**Resolution.**
- **EditorActions** gained optional `startComment` + `canStartComment` (top-level, not in CanvasExtras — Phase 4 will reuse them on the markdown side).
- **EditorToolbar** renders a 💬 button conditionally on `actions.startComment` being set; the toolbar reads `canStartComment()` on every render so selection-version bumps drive the enabled state.
- **`pageEditorActions`** accepts a `PageEditorActionsOptions` second arg with the two callbacks; PageTab wires them via a `startCommentRef` (the editorActions useMemo stays stable while always invoking the latest closure).
- **`globalShortcuts.ts`** got `'startComment'` ShortcutId + ⌘⌥M matcher using `e.code === 'KeyM'` (not `e.key === 'm'` — Option on macOS yields 'µ', same gotcha as BUG-075 v2 and `e.code === 'Slash'` for `/?`).
- **`useKeyboardShortcuts`** dispatches `'duo-start-comment'` window CustomEvent on the chord (mirrors the `sendToDuo` indirection).
- **Right-click**: `electron/main.ts` gated on `parameters.frameURL.startsWith('about:srcdoc')` so only canvas iframes get the "Comment" entry. Click sends `IPC.PAGE_COMMENT_REQUEST` → renderer bridge in App.tsx re-dispatches `'duo-start-comment'` → PageTab handler.
- **Hover pill removed**: `<CommentButton>` element + the orphaned primitive deleted; SendToDuoPill kept.

Verified live: triple-click heading → toolbar button enabled, click opens composer; ⌘⌥M with selection opens composer; right-click → "Comment" opens composer; submitted a comment via right-click and the rail mounted with the badge anchored to the heading.

### Phase 3 — BUG-083 (visual association) · ✅ 2026-05-04

**Make comments visibly attach to their anchored text.** Three sub-pieces:

1. **Anchor decoration in canvas body.** CSS rule on `[data-duo-comment-id]` — subtle highlight (probably a `var(--duo-accent-soft)` background or underline). Lives in `renderer/styles/globals.css`.
2. **Click-to-focus, both directions.** Clicking a thread in the rail → scroll canvas to anchor (probably already wired via `onJumpTo`). Clicking the highlighted text in the canvas → focus the corresponding thread in the rail (likely not wired today). Same `onJumpTo` callback in reverse.
3. **Active-thread indication.** When a thread is focused (rail-side or canvas-side), the linked anchor highlights more strongly. Mirrors Google Docs' "this is the one we're looking at" affordance.

**Acceptance:** add a comment to a span. The span renders with a visible highlight. Click the span → rail thread highlights. Click the rail thread → canvas scrolls to span + span highlights more strongly.

**Resolution.** All three concerns shipped + a bonus fix:
- New attributes `data-duo-has-comment` (decoration target) and `data-duo-comment-active` (active emphasis) stamped by `paintAnchors` on the anchor element ITSELF (not the badge sibling). Resolved threads don't get decorated.
- New `installCommentAnchorStyles(doc)` injects an iframe-side `<style>` with the badge styles AND the new `[data-duo-has-comment]` / `[data-duo-comment-active]` rules. Light + dark mode honored. Mirrors `installJustAddedStyles` pattern.
- New `installAnchorClickListener(doc, onClick)` adds a delegated click on the iframe body that catches clicks on commented anchors (walks up via `closest()`) and calls `setActiveThreadId`. Cleanup wired in PageTab's wireCleanupRef.
- **Bonus:** the existing badge `.duo-comment-anchor` rules lived only in `globals.css` (parent doc) which doesn't reach the iframe. Badges had been rendering as plain "1" text inside canvases. The new stylesheet install fixes that too — circle badges with proper accent fill now render correctly.
- **Serializer:** new `RUNTIME_ATTRS_TO_ALWAYS_STRIP` set (parallel to `RUNTIME_CLASSES_TO_STRIP`) covers both new attributes. Strips on every element regardless of the runtime sentinel since these live on user-authored elements.

Verified live: opened a canvas with one anchored comment; the heading rendered with the soft accent decoration; clicking the rail thread strengthened the anchor's background AND added the rail-side border; close + reopen + clicking the heading text focused the rail thread (canvas → rail direction). Bidirectional click-to-focus works.

### Phase 4 — MISSING-001 / Stage 14a (markdown editor comments) · ✅ 2026-05-04

**The biggest piece.** The entire TipTap data plane is unbuilt. Three concerns:

1. **TipTap mark for `data-duo-comment-id`.** New mark extension that renders the same anchor decoration as Phase 3 (use the same CSS class so styling is shared). Mark spans the commented text range.
2. **Anchor reconciliation across edits.** When the user edits text mid-comment, the anchor should follow. TipTap's mark system handles this naturally for adjacent edits; harder cases (paste, delete-across-anchor) may need explicit reconciliation logic.
3. **CommentRail data-plane wire-up.** Pass the same `threads` shape `<CommentRail>` already accepts. Reuse `handleStartNewComment` / `handleSubmitNewComment` / `handleResolveThread` patterns from canvas. The visual primitive is already shared.

Then wire the same three affordances from Phase 2 (⌘⌥M, right-click, toolbar) — most of the kb shortcut / context-menu plumbing is reusable. The toolbar button lives in the markdown editor's existing `EditorToolbar`.

**Acceptance:** open a markdown file, ⌘⌥M with selection adds a comment. Same UX as canvas. Comments persist across reload. Visual association works.

### Phase 5 — Smoke walk + cut

After Phases 1–4 land, run a smoke walk (use the `smoke-walk` skill — it now fires live `duo:event`s thanks to ENH-094 + ENH-043, so progress streams to Claude in real time). Items: each affordance × each surface = 6 items minimum, plus persistence + visual association on each.

Cut readiness:
1. All four affordances work on both surfaces.
2. Persistence verified on both surfaces.
3. Visual association working on both.
4. Smoke walk passes 100%.
5. Vitest green (ideally with new tests for the comment-anchor reconciliation logic).
6. `package.json` already at `0.6.7`.
7. Cut via `cut-version` skill.

---

## Stretch (if Phases 1–5 land before cut)

- **ENH-091** — caret placement on freshly-created canvas (owner ask 2026-05-04).
- **BUG-079** — `⌃⇧\`` cycle multi-second latency (recurring class).
- **ENH-080** — `⌘⇧A` tab-search palette (research doc shipped v0.6.5; implementation queued).
- **ENH-084** — aux pane focus glow (3 v0.6.5 attempts failed; full defect log in tasks.md).
- **FOLLOWUP-007** — `window.duoSendResult` CDP binding (small).
- **FOLLOWUP-008** — accent token RGB-triplet migration (unblocks `bg-accent/N` opacity modifiers).

---

## Skipped this sprint (carry-over to v0.6.8+)

- **ENH-088** — already shipped v0.6.6.
- **Stage 19d** — mid-tab launch-claude banner. Pedagogy theme; not blocking.

---

## How to resume after compaction

**Sprint state (as of 2026-05-04 evening, post v0.6.6 cut + Sprint 6 priorities filed):** v0.6.6 cut + tagged + pushed to GitHub Releases (signed + notarized DMGs at https://github.com/dudgeon/duo/releases/tag/v0.6.6). Working tree clean on `main`. Dev identifies as `v0.6.7`. Sprint 6 not yet started — tasks.md has BUG-081 reframed + BUG-082/083 filed + MISSING-001 priority bumped, all queued as immediate priorities.

**Resume recipe (Sprint 6 kickoff):**

1. **Read this file FIRST.** Phase plan above is the running order.
2. **`git log --oneline -10`** — head should be the Sprint 6 prep commit (`6a5ce80 tasks: BUG-081 reframed + BUG-082/083 filed`); v0.6.6 cut is `7801fdc`.
3. **Restart Duo** before any UI work (electron-vite HMR is renderer-only; main-process / preload changes need a kill + restart). Smoke-walk skill HARD RULES still apply: probe with `ps -ef | grep "MacOS/Electron \."` before any `npm run dev` (never spawn duplicate); after `duo open` verify focus via `duo url` + `duo title`.
4. **Phase 1 first** — BUG-082 is the smallest, fixes the data-loss appearance. Likely a 30-min fix once the `railThreads` derivation is found.
5. **Then Phase 2** — UX redesign. Get the kb shortcut working first; then right-click; then toolbar; then delete the hover pill.
6. **Phase 3 + 4** are the bigger pieces. Phase 4 (MISSING-001) is the largest — full TipTap data plane. Consider whether Phase 4 needs its own sprint OR rides in v0.6.7 if it's tractable.

**Smoke-walk skill rules (still in effect):** probe before `npm run dev`; verify focus after `duo open`; smoke walks now fire live `duo:event`s through ENH-094 — Claude subscribed via `duo events --follow` sees walk progress in real time, no copy/paste required for in-Duo walks.

**Worksheet primitive note:** the smoke-walk + sprint-plan generators emit live events on radio change as of v0.6.6 (ENH-043). Manifest's `kind` is the event prefix; payload is `{worksheet, id, value}`. Falls back silently outside Duo.

---

## Cross-reference index

| File | Purpose |
|---|---|
| [tasks.md § BUG-081](../../tasks.md) | UX redesign — kb / right-click / toolbar; drop hover pill. Hypothesis list + where-to-look |
| [tasks.md § BUG-082](../../tasks.md) | Rail-not-restoring-on-reopen — likely async race |
| [tasks.md § BUG-083](../../tasks.md) | Visual association gap — anchor decoration + click-to-focus |
| [tasks.md § MISSING-001](../../tasks.md) | Markdown editor comments (Stage 14a) — entire data plane unbuilt |
| [renderer/components/Page/PageTab.tsx](../../renderer/components/Page/PageTab.tsx) | Canvas comment wire-up; line 1437 has the gating block |
| [renderer/components/editor/primitives/CommentRail.tsx](../../renderer/components/editor/primitives/CommentRail.tsx) | Visual primitive — already shared canvas + (future) markdown |
| [renderer/components/Page/sidecar.ts](../../renderer/components/Page/sidecar.ts) | Sidecar persistence — start of BUG-082 trace |
| [renderer/components/Page/commentAnchors.ts](../../renderer/components/Page/commentAnchors.ts) | Anchor resolution + decoration target for BUG-083 |
| [renderer/keyboard/globalShortcuts.ts](../../renderer/keyboard/globalShortcuts.ts) | Where ⌘⌥M lands for Phase 2 |
| [docs/RELEASES.md](../RELEASES.md) | v0.6.6 prose entry — most recent shipped chapter |
| [CLAUDE.md § 4 — plumbing checklists](../../CLAUDE.md) | The plumbing rules; specifically the editor-canvas parity rule for Phases 2 + 4 |

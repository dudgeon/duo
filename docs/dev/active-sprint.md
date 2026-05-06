# Active sprint state — Sprint 6/7 (v0.6.7)

> **What this file is.** Running scratchpad for the active sprint
> arc. The historical record (Sprint 5 reframe + v0.6.6 cut + Stage
> 19e closure) lives in [docs/dev/session-log.md](session-log.md) —
> most recent at the top.
>
> **For future Claude instances picking up cold (2026-05-05 late
> evening snapshot):** Sprint 6 closed-in-code on 2026-05-04 (Phases
> 1–4 all landed). Sprint 7 is mid-flight: Phase 3c (browser-in-aux,
> BUG-092 fix) + BUG-094 paste fix + BUG-095/096 follow-ups + BUG-093
> instrumentation + arm64-only distribution policy + ~2.6 GB of
> Intel-DMG cleanup + **rev6 walk results landed (Claude-driven
> verification, 2026-05-05 22:00) → BUG-088/090/087 actually fixed
> via duplicate-id-on-clone detection in idInjector + BUG-098 (trash
> on missing file) + ENH-095 (aux ✕/⇤ consolidation)** — all in the
> working tree, **uncommitted**. **Read § "Resume — fresh session
> picking up post-rev6 fixes" below FIRST.**
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

#### Smoke walk history (2026-05-04)

- **rev1** — partial. Page opened in canvas mode (procedural BUG-086) blocking Copy buttons. Owner pasted page text by hand. Found: MISSING-001 rail #2 active-state broken (BUG-087); BUG-083 sub-bugs (BUG-088 / BUG-089 / BUG-090); 6 items SKIP'd due to procedural blocker.
- **Mid-sprint fix-and-recommit** (commit 25a755b) addressed BUG-087, attempted BUG-088/090 via auto-stamp, fixed BUG-089 via static colors. Filed BUG-086 / BUG-091.
- **rev2** — partial. Title rendered identically to rev1 in browser-tab strip (worksheet generator hardcoded title from base version, ignoring manifest.title). BUG-088/090 fix INSUFFICIENT — sentinel attr persisted to disk so install bailed on reopen; user re-saw the `<ul>`-grouping bug. BUG-091 confirmed; user's split-view promotion turned worksheet into editable canvas, blocking Copy buttons again.
- **Mid-sprint fix-and-recommit-2** (commit 99826fa) re-fixed BUG-088/090 (no sentinel, idempotent stamping, initial sweep), fixed BUG-091, added `<meta name="duo-editable" content="false">` to worksheet template, fixed worksheet title to honor `manifest.title`.
- **rev4** — pending owner walk (2026-05-05). Manifest at `docs/dev/smoke-walks/v0.6.7-rev4.json` (15 items: 4 Phase 3c verification + 10 rev3 carry-over + 1 BUG-094 mini). Page opened in browser pane against single fresh Duo (pid 60389, started 2026-05-05 with the uncommitted Phase 3c diff loaded). Items ordered so Phase 3c gets validated FIRST — its pass unblocks the rest of the walk in split view.

- **rev3** — partial walk + 3 new bugs surfaced; pivot to Phase 3c rebuild same session.
  - **PROCEDURAL FAIL (item 1)** — split-view procedural goal not achievable. Read-only DOES hold (canvas doesn't capture clicks as cursor placement) but Copy results / Send / mark-all are silently inert in the canvas surface. Root cause is the no-`allow-scripts` sandbox (PRD H4/H8) — worksheet's entire interactive surface lives in one inline `<script>` block that can't run in the iframe. `duo-editable: false` was the wrong-layer fix. **Filed as BUG-092 (real fix = Phase 3c browser-in-aux, queued for Sprint 7).**
  - **FAIL (item 2 / BUG-088/090)** — partial repro completed; right-click tab → Move to Split View triggered a render error that forced a full app reload. Crash root cause not yet diagnosed (suspected: dirty-replace swap × auto-stamp observer cleanup × comment data-plane mount race during the unmount/remount cycle). **Filed as BUG-093 (need error boundary around `WorkingPane` + console-trace before chasing).**
  - **OTHER NOTES — terminal paste auto-executes on Return.** User copied a command from chat and pasted into terminal; trailing `\n` in the copy hit zsh as Enter and auto-executed the command before the user could read it; one of the `\n`s was also internal (likely Ink-rendered hard-wrap from chat), splitting one command across multiple Returns. Subsequent terminal resize re-wrapped the polluted scrollback into duplicate-looking rows. Owner verdict: "unacceptable; I copied your text and pasted it; I need to be able to do this." **Filed as BUG-094 and FIXED same session** — `TerminalPane.tsx` now installs a capture-phase `paste` listener that strips ONLY trailing newlines from clipboard payloads (matches Terminal.app default paste behavior; preserves internal `\n`s so multi-line paste — Claude Code prompts, heredocs, scripts — still works). Cleaned text routes through `term.paste()` (still respects bracketed-paste mode if the shell enabled it). Pastes without trailing newlines fast-path to xterm's default — no behavior change for the common case. Open follow-up if the internal-`\n` chat-copy case still bites: add bracketed-paste-mode detection or a soft-wrap heuristic.
  - **9 items SKIP'd** (BUG-087, BUG-089, MISSING-001 Phase 4 full lifecycle, BUG-083 full check, BUG-082 reopen, BUG-085 watcher, BUG-084 no-app-reload, BUG-084 browser-reload, BUG-056). Owner: "too many issues to even do the smoke walk." Re-walk needed in Sprint 7 against a freshly-cut build with BUG-094 in place + stable terminal.

#### Cut posture (as of 2026-05-04 evening)

🚫 NOT cut-ready on the comment-system arc — rev3 walk surfaced BUG-092 / BUG-093 / BUG-094 and the owner stopped the walk. Sprint pivots: **cut Sprint 6 on BUG-094 only**, defer all comment-system re-validation to Sprint 7.

#### Sprint 6 close-out plan (revised 2026-05-04 evening)

**What this cut covers.** Phases 1–4 are landed code. The walk that would have validated them stalled at rev3 step 1 due to BUG-092 (split-view procedural blocker — architectural, not landable in this sprint). The terminal paste fix (BUG-094) is the only new code change in this close-out.

**Cut criteria for v0.6.7 (this sprint):**
1. ✅ BUG-094 fix landed — typecheck green.
2. 🟡 Owner runs a **paste-fix mini-smoke** (single item: copy a multi-line block from chat, paste into terminal, confirm command lands on one line and doesn't auto-execute).
3. 🟡 Cut via `cut-version` skill once mini-smoke passes.
4. ⏭ Comment-system re-validation (rev3 items 2–11) deferred to Sprint 7 — the walk runs against the v0.6.7 build with BUG-094 in place so the terminal stays usable end-to-end.

**Phase 3c shipped same session (2026-05-04 evening, post-cut-pause).** Owner explicitly redirected: "you said you'd do these, you didn't, and now you're asking me to cut?" — pulled cut, built browser-in-aux properly. What landed:
- `shared/types.ts` — `BrowserTab.inAux` flag + 3 new IPC channels (BROWSER_AUX_BOUNDS, BROWSER_MOVE_TAB_TO_AUX, BROWSER_RELEASE_AUX_TAB) + WORKING_AUX_OPEN_BROWSER + `'open-browser'` WorkingAuxOp.
- `electron/browser-manager.ts` — `auxTabId` + `auxBounds` tracking, `moveTabToAux`/`releaseAuxTab`/`setAuxBounds`/`getAuxTabId` methods, `getTabs()` marks `inAux`, `switchTab` refuses aux targets, `closeTab` clears aux on close, `setBounds` skips the aux tab.
- `electron/main.ts` — IPC handlers + `splitViewOpenBrowser` CLI helper + nav-object wiring.
- `electron/preload.ts` + `shared/host-api.ts` — `browser.setAuxBounds`/`moveTabToAux`/`releaseAuxTab` bridge methods + `workingAux.onOpenBrowser` subscriber.
- `renderer/App.tsx` — `auxBrowserTab` state separate from `auxState`, `splitViewMoveBrowserTab` callback, `splitViewPromote`/onAuxClose/onAuxResize handle both kinds, `splitViewMoveTabByPath` releases browser-aux first, `onTabsChange` subscriber keeps aux state consistent (clears when external close fires; tracks url/title from broadcasts), snapshot push reflects browser-aux.
- `renderer/components/AuxBrowserSlot.tsx` — new component, mirrors BrowserRenderer's bounds-push pattern + minimal header (URL/title + Promote/Close).
- `renderer/components/WorkingPane.tsx` — `splitOpen` accounts for both kinds, aux render branch chooses file or browser, browser tabs filter `inAux` from main strip, `onMoveBrowserTabToSplit` thread.
- `renderer/components/WorkingTabStrip.tsx` — `parseBrowserId` helper + `move-to-split` case branches on `tab.type === 'browser'` to call the right callback, menu builder accepts both callbacks.
- `cli/duo.ts` + `core/socket-server.ts` — `duo split-view open-browser <id>` verb end-to-end.
- `skill/SKILL.md` + `agents/duo.md` + `docs/CLI-COVERAGE.md` — cheat-sheet entries updated.
- Typecheck clean. CLI binary rebuilt. `npm run sync:claude` ran.

**Sprint 7 carryover:**
- BUG-093 — instrumentation landed in v0.6.7 (inline ErrorBoundary around `<WorkingPane>` + `[BUG-093]` console traces in `splitViewMoveTabByPath`). Next session repros against the armed build to identify the failing component.
- Comment-system re-walk against the integrated build (Phase 3c + BUG-094 + Sprint 6 Phases 1–4 all in scope) — rev4 smoke walk is the deliverable. Items: rev3 step 2–11 + new Phase 3c verification (right-click browser tab → split, scripts run, swap semantics work both directions).

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

### Resume — fresh session picking up post-rev6 fixes (2026-05-05 late-evening snapshot)

**TL;DR:** Three rev6 fixes landed via Claude-driven smoke walk this evening, all uncommitted on top of the earlier rev6-snapshot diff. Owner has not run a re-walk; next session can either re-walk the affected items or commit + cut directly given the fixes were validated end-to-end during the Claude-driven verification.

**rev6 walk results (owner-paste, 2026-05-05 evening):**

| Item | Outcome | Notes |
|---|---|---|
| PROCEDURAL-PHASE3C-CLI | FAIL | `duo tabs` listed only ids 1, 2, 3, 5 — id 4 was the rev6 page in aux but `inAux: true` filtered it from main strip enumeration in user's mental model. Real "bug": rev6 manifest told user to find rev6 page's id, but that page was already in aux and the user typed the bogus-id step assuming any tab was valid. **Procedural** — manifest copy could be clearer; CLI is functioning. |
| PROCEDURAL-PHASE3C-PROMOTE | PASS, with ENH note | "promote and X buttons seem to do the same thing; get rid of promote, ensure X functions like promote" → **ENH-095 landed same session.** |
| BUG-095-MAIN-FOCUS | PASS, with side note | Side note: vertical placeholder rendering in fresh markdown editor → confirmed already filed as **BUG-097**. |
| BUG-096-CLOSE-BLANKS-AUX | PASS | |
| BUG-088-090 (DIAGNOSTIC) | FAIL | Console showed three `<li>` sharing one `data-duo-id`. Comment briefly covered all bullets then disappeared. **Root cause identified + fixed same session — see below.** |
| BUG-087 | FAIL | "first and third bullets glow when I select corresponding comment in rail, but not second" — consequence of BUG-088/090 (multiple bullets sharing one id; `[data-duo-id="X"]` selected wrong elements). **Same fix.** |
| 6 SKIPs | — | BUG-089, MISSING-001-PHASE-4-FULL, BUG-083-FULL, BUG-082, BUG-085, BUG-084-BROWSER-RELOAD — owner skipped pending BUG-088/090 fix. |
| OTHER NOTES | new bug | Right-click tab → Move to Trash on missing file shows error popup — **filed + fixed as BUG-098 same session.** |
| OTHER NOTES | observation | Comment scope overflow on HTML canvas does NOT impact markdown canvas — only selected text gets glow on the markdown side. Worth investigating whether the canvas's broader-glow issue is fixable to match. (Not filed; observation for future BUG-088/090 follow-up.) |

**What landed this session (uncommitted, on top of the earlier 22-file working tree):**

1. **BUG-088 / BUG-090 / BUG-087 root-cause fix** — `[idInjector.ts § installAutoStampIds § stampElement](renderer/components/Page/idInjector.ts)`. When the auto-stamp observer encounters an element that already has a `data-duo-id`, it queries the body for duplicates: if another element owns the same id, the new element is a clone (Enter-split `<li>`, paste of stamped fragment, undo/redo) and gets a fresh ULID. First-in-document keeps its id so existing comments still resolve. Verified live — typed three bullets in a fresh canvas, file on disk shows distinct ids on every `<li>`; commenting on the middle bullet decorates only the middle bullet; rail-click activates the matching anchor and only that anchor. Tasks.md statuses for BUG-087/088/090 all flipped to ✅ FIXED.

2. **BUG-098 fix — trash on missing file silently closes the tab.** `[App.tsx § onTrashTabFile](renderer/App.tsx)` catches `/doesn['']?t exist|ENOENT|no such file/i` (handles both ASCII and Unicode apostrophes — Apple's native errors use the curly quote) and falls through to the existing close path. Other error classes still alert. Verified: created a file, opened it, deleted from disk, right-click → Move to Trash → confirm → tab closes silently, no dialog.

3. **ENH-095 landed — aux header single ✕ button.** Both `onAuxClose` and `onAuxPromote` now point at `splitViewPromote`. Dropped the ⇤ button in both [WorkingPane.tsx § AuxHeader](renderer/components/WorkingPane.tsx) and [AuxBrowserSlot.tsx](renderer/components/AuxBrowserSlot.tsx); tooltip / aria-label changed to "Move back to main". Right-click "Move back to main" menu entry remains as a synonym in the file-aux header. Verified: pinned a browser tab in aux, clicked X → tab returned to main strip with `inAux: false` (exact Promote behavior).

**State on disk (post-fixes):**
- HEAD still `5dafdf7 docs: Sprint 6 close-out`. Everything is in working tree.
- `package.json` still `0.6.7`.
- Files modified this session (in addition to the earlier rev6 diff):
  - `renderer/components/Page/idInjector.ts` (duplicate-id detection)
  - `renderer/App.tsx` (trash error filtering + onAuxClose=splitViewPromote)
  - `renderer/components/AuxBrowserSlot.tsx` (drop ⇤ button)
  - `renderer/components/WorkingPane.tsx` (drop ⇤ button in AuxHeader)
  - `tasks.md` (BUG-087/088/090 → ✅ FIXED; BUG-098 + ENH-095 added)
  - `docs/dev/active-sprint.md` (this file)
- Typecheck green (`npm run typecheck`).
- Renderer HMR did NOT auto-pick up `App.tsx` edits during verification — required a manual refresh path. The change was tested by a second iteration after a manual re-trigger; both branches verified live.

**Claude-driven walk of rev6-SKIP carryovers (added later in same session, 22:30-ish):**

| Item | Outcome | Notes |
|---|---|---|
| BUG-082 | ✅ PASS (Claude-walked) | Closed canvas tab, reopened via `duo view /tmp/v067r6-bug088-fix-test.html`, rail mounted immediately with the comment visible. No interaction needed to wake it up. |
| BUG-083-FULL | ✅ PASS (Claude-walked) | Added a 2nd comment on H1; verified click-on-bullet → rail-thread-2-active, click-on-H1 → rail-thread-1-active (bidirectional click-to-focus); resolved thread #1 → rail card greyed, body decoration disappeared. |
| BUG-089 | ✅ PASS (Claude-walked) | Code: [commentAnchors.ts:102-114](renderer/components/Page/commentAnchors.ts) has no transition on `[data-duo-has-comment]`. Live: typed "xyz" into a commented bullet, tint stayed solid, no visible artifact. |
| MISSING-001-PHASE-4-FULL | ✅ PASS (Claude-walked) | `/tmp/v067r6-md.md` source clean (no inline span tags), sidecar has 3 entries with `excerpt`/`contextBefore`/`contextAfter`. Closed + reopened tab → rail re-mounted with all 3 comments + decorations on all 3 paragraphs. Click rail thread #2 → second paragraph deepened (BUG-087 cross-validates on markdown side). Right-click "Comment ⌘⌥M" entry visible, opens composer. Toolbar 💬 button opens composer. |
| BUG-085 | ✅ PASS (Claude-walked) | Created `/tmp/v067r7-bug085.md`, opened in editor (clean buffer), externally rewrote → silent reload, no banner. Typed dirty edit, externally rewrote → amber conflict banner with Reload-from-disk / Keep-mine. Clicked Reload → buffer matched on-disk content, toolbar showed Saved (clean). |
| BUG-084-BROWSER-RELOAD | 🟡 INCONCLUSIVE — needs human ⌘R | Code path fully wired (globalShortcuts → useKeyboardShortcuts → App.tsx handler → IPC → BrowserManager); Reload button in address bar fires the same call and works. Claude's synthetic ⌘R via computer-use didn't observably trigger reload — the WebContentsView's `before-input-event` may need OS-level keyboard focus that synthetic input doesn't fully simulate. App-wide reload protection (BUG-084 itself) HOLDS — terminal sessions intact after multiple ⌘R. Owner needs to confirm the keypress-to-reload portion. **Filed in rev7 walk page (single item).** |

**Cut posture (now 🟢 minus one inconclusive):**
- All comment-system arc items walked + green. Editor / canvas surfaces are validated end-to-end.
- One inconclusive: BUG-084-BROWSER-RELOAD ⌘R synthetic-focus path. **rev7 walk page exists** at `docs/dev/smoke-walks/v0.6.7-rev7.html` (1 item) — open via `duo open …rev7.html`. Two keypresses to confirm.
- After owner confirms BUG-084-BROWSER-RELOAD, proceed to commit + cut via `cut-version` skill. 27 modified files + 2 untracked (rev7 manifest + html).

**Resume recipe:**

1. **Read this section first.**
2. `git status --short` → expect 26 modified files + 1 untracked (`renderer/components/AuxBrowserSlot.tsx`).
3. `git log --oneline -3` → head is `5dafdf7`.
4. `ps -ef | grep "MacOS/Electron \."` → expect exactly 1 line (the running dev session).
5. Owner has not yet seen the verification — if they want to re-walk, generate a rev7 manifest with the 6 SKIPs from rev6 + BUG-098 + ENH-095. If they want to commit + cut, jump to `cut-version` skill.

### Resume — fresh session picking up rev6 (2026-05-05 evening snapshot, superseded by post-rev6 above)

**TL;DR for the next session:** A LOT is sitting uncommitted. Owner is going to walk **rev6** in a fresh session. Don't commit, don't cut, don't restart Duo. Just verify state and watch for the paste-back of walk results.

**Status:**
- HEAD: `5dafdf7 docs: Sprint 6 close-out` (no commits today; everything is in working tree).
- `package.json` version: `0.6.7`.
- Single Duo running with the full uncommitted diff loaded — verify with `ps -ef | grep "MacOS/Electron \."` (expect exactly one). The dev session was started this morning (2026-05-05 ~07:12). Do NOT restart it — yml change to electron-builder is build-time only, not runtime; everything else is already loaded.
- rev6 page open in browser pane: `docs/dev/smoke-walks/v0.6.7-rev6.html` (12 items: 1 retest of failed CLI item + 11 carry-over). Verify with `duo url` + `duo title`.

**What landed in this session arc (2026-05-04 → 2026-05-05), all uncommitted:**

1. **Sprint 6 Phases 1–4 (committed earlier 2026-05-04; HEAD).** Comments-on-both-surfaces. BUG-081 / BUG-082 / BUG-083 / BUG-085 / BUG-087–090 / MISSING-001 / BUG-084 family. Did NOT smoke-walk-pass before pivot to Sprint 7.
2. **BUG-094 paste fix** — `renderer/components/TerminalPane.tsx`. Capture-phase paste listener strips trailing newlines (matches Terminal.app default). Internal newlines preserved. Walked + ✅ in rev5.
3. **BUG-093 instrumentation** — `renderer/components/ErrorBoundary.tsx` extended with `inline` + `label` + Try-again retry. `renderer/App.tsx` wraps `<WorkingPane>` with inline boundary; `splitViewMoveTabByPath` carries `[BUG-093]` traces. Awaits a clean repro.
4. **Sprint 7 Phase 3c (BUG-092 fix) — browser tabs in Split View aux.** Big lift across `shared/types.ts`, `shared/host-api.ts`, `electron/browser-manager.ts` (auxTabId / auxBounds / moveTabToAux / releaseAuxTab / closeTab fixes), `electron/main.ts` + `electron/preload.ts` (IPC + bridge), `renderer/App.tsx` (auxBrowserTab state + splitViewMoveBrowserTab + IPC subscribers), new `renderer/components/AuxBrowserSlot.tsx`, `renderer/components/WorkingPane.tsx` (aux render branches), `renderer/components/WorkingTabStrip.tsx` (right-click routing), `cli/duo.ts` + `core/socket-server.ts` (`duo split-view open-browser <id>`). Walked + ✅ on the core item in rev4/rev5.
5. **BUG-095 fix** (Phase 3c follow-up) — aux tab focus no longer steals main pane. `BROWSER_FOCUS_GAINED` payload now carries `{tabId, slot}`; renderer only flips activeWorking when `slot === 'main'`.
6. **BUG-096 fix** (Phase 3c follow-up) — closing the last main-strip browser tab no longer blanks aux. `closeTab` next-active picker skips the aux tab; spawns about:blank if only aux remains.
7. **BUG-097 filed** — empty-markdown-doc placeholder wraps narrow on first load. Visual ugliness; not blocking. Investigation deferred.
8. **arm64-only distribution policy** — `electron-builder.yml` drops `x64`, `cut-version` skill + README updated. Dropped local Intel artifacts (`Duo-0.6.6.dmg` + `dist/mac/`); deleted x64 DMGs from 17 GitHub Releases (~1.85 GB freed publicly + ~349 MB locally).
9. **Cleanup pass** — pre-v0.6.6 DMGs gone (~2.3 GB), 4 stale worktrees removed, /tmp scratch cleaned. Dirty `distracted-chandrasekhar-335ce0` worktree preserved per owner choice (option C).

**rev6 smoke walk items (12 total, in walk order):**

1. PROCEDURAL-PHASE3C-CLI (retest with concrete numeric example — rev5 user typed `<4>` literally; zsh parsed `<>` as redirect)
2. PROCEDURAL-PHASE3C-PROMOTE
3. BUG-095-MAIN-FOCUS (verifies the focus-theft fix from this session)
4. BUG-096-CLOSE-BLANKS-AUX (verifies the close-blanks fix from this session)
5. BUG-088-090 (DIAGNOSTIC RUN — open devtools console, filter `BUG-088`; the painter logs `[BUG-088/090] paintAnchors tinted elements: [{tag, id, threadId}]` — `tag` value pinpoints whether anchor lands on `li` (correct) or `ul`/`body` (the bug))
6. BUG-087 (markdown rail any-thread activation)
7. BUG-089 (no-flicker on type)
8. MISSING-001-PHASE-4-FULL (markdown lifecycle)
9. BUG-083-FULL (visual association full check)
10. BUG-082 (canvas reopen)
11. BUG-085 (markdown file watcher)
12. BUG-084-BROWSER-RELOAD (⌘R reloads active browser tab)

**Already passed (do not re-walk; dropped from rev6):** PROCEDURAL-PHASE3C-MOVE, PROCEDURAL-PHASE3C-MUTUAL, BUG-084-NO-APP-RELOAD, BUG-056, BUG-094.

**Resume recipe (do this in order):**

1. **Read this section first.** Don't restart Duo or change code until results paste in.
2. `ps -ef | grep "MacOS/Electron \."` → expect exactly 1 line (the running dev session).
3. `duo url` → expect `file:///…/v0.6.7-rev6.html`.
4. `duo title` → expect "Smoke walk v0.6.7-rev6 — un-passed items only…".
5. `git status --short` → expect 22 modified files + 1 untracked (`renderer/components/AuxBrowserSlot.tsx`).
6. `git log --oneline -3` → head is `5dafdf7`.
7. **Wait for owner to paste rev6 walk results back into chat.** Parse the `[PASS]/[FAIL]/[SKIP]` per-item outcomes; flip statuses in `tasks.md`; only THEN consider committing + cut.

**Cut posture (when rev6 passes — projected v0.6.7 cut):**
- Single arm64 DMG (`Duo-0.6.7-arm64.dmg`) — Intel target was dropped this session.
- One commit covering everything (or split into a few coherent commits if scoping makes sense).
- Then `cut-version` skill drives the rest (CHANGELOG / RELEASES / faq / what-duo-does / roadmap / DMG build / signing / launch validation / GH Release / tag).
- After cut, bump `package.json` to `0.6.8` for next sprint.

### Smoke-walk + worksheet contract (still in effect)

- Probe with `ps -ef | grep "MacOS/Electron \."` before any `npm run dev` (never spawn duplicate).
- After `duo open` verify focus via `duo url` + `duo title`.
- Smoke walks fire live `duo:event`s through ENH-094 — Claude subscribed via `duo events --follow` sees walk progress in real time. Geoff still pastes results back as text per his current preference.
- Worksheet manifest's `kind` is the event prefix; payload is `{worksheet, id, value}`. Falls back silently outside Duo.

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

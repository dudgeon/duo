# Active sprint state — Sprint 23 / v0.8.0 (ENH-182 capstone)

**Status (2026-05-25):** **v0.8.0 cut + tagged + released.** The ENH-182 project-as-filter-layer story is feature-complete: rail (Phase 1) + focus filter (Phase 2 + 2b) + lifecycle/menu (Phase 3) + auto-switch (Phase 3c) + CLI parity (Phase 4). Plus ENH-184 workspace pill defeaturing closed out (other-claude's preserved working tree landed + finishing onClick gate + CLI parity verb). Plus ENH-185 polish (rail 10% narrower + tooltip wording). Smoke walk 5/5 PASS via computer-use pre-walk.

## v0.8.0 — what shipped (Sprint 23)

| Commit | Item |
|---|---|
| [26cfd03](https://github.com/dudgeon/duo/commit/26cfd03) | **ENH-182 Phase 3** — D11 auto-switch + D12 lifecycle/tile right-click menu (Pin/Unpin + bulk-close with claude-kind confirm + persisted `~/.claude/duo/projects.json` + `PROJECTS_CHANGED` broadcast) + **ENH-185 polish** (rail 50px + tooltip wording) |
| [608034e](https://github.com/dudgeon/duo/commit/608034e) | **ENH-182 Phase 4** — `duo project list/focus/pin/unpin/close` CLI parity (full CLAUDE.md § 4 plumbing) |
| [f1adf96](https://github.com/dudgeon/duo/commit/f1adf96) | **ENH-182 Phase 2b** — `file://` browser-tab filter by path membership (non-file URLs + pinned tabs cross focuses) |
| [282b0bc](https://github.com/dudgeon/duo/commit/282b0bc) | **ENH-184** — workspace pill defeaturing (other-claude's foundation + finishing onClick gate + `duo workspace-pill-menu [on\|off\|toggle]` CLI parity) |

**Smoke walk:** 5/5 PASS via computer-use pre-walk 2026-05-25. Manifest at `docs/dev/smoke-walks/v0.8.0.json`. Items: ENH-185-VISUAL, ENH-182-PHASE-3B-MENU, ENH-182-PHASE-3B-CLOSE, ENH-182-PHASE-3C-AUTOSWITCH, ENH-182-PHASE-2B-BROWSER.

## What's now in the rail (full ENH-182 surface)

- **Phase 1 + 2 (v0.7.10):** auto-derived projects + quiet-bloom tiles + focus filter (terminals + non-browser file tabs) + navigator re-root + Ctrl-Tab respects filter + auto-spawn on empty-terminal focus
- **Phase 3a:** persisted `~/.claude/duo/projects.json` (pins + color overrides) with `PROJECTS_CHANGED` broadcast pipeline; pinned-projects probe so pins to invalid roots silently drop
- **Phase 3b:** per-tile right-click menu — `Pin to rail` / `Unpin from rail` (renders a small color-matched dot in the top-right of pinned tiles) + `Close N terminals and M tabs` with live counts; `dialog.confirm` gate when any member terminal is `kind: 'claude'`; atomic membership flush via single `setTabs` / `setFileTabs` updaters; fresh shell appended when closing the entire focus would empty the strip (floor-of-1 preserved)
- **Phase 3c:** D11 auto-switch focus when `activeWorking` moves to a file whose deepest project ≠ focused (catches both new-file opens AND reactivations of an existing tab — `duo edit` of an already-open file flips focus too)
- **Phase 4:** full `duo project` verb family — `list`, `focus <name|root>`, `focus --all`, `pin`, `unpin`, `close`. Renderer pushes `ProjectsStateSnapshot` via `PROJECTS_STATE_PUSH` on every change so reads return instantly. Name resolution is case-insensitive against unique names; exact root paths always match. Pin/unpin honor verb semantics (no-op when already in target state).
- **Phase 2b:** browser-mode `file://` tabs gated by path membership. Non-file URLs (http/https/about) + pinned browser tabs cross focuses as reference material. URL→project resolution via decoded `URL.pathname` + roots-sorted-by-length one-pass lookup (D5 deepest-wins).

## ENH-184 — workspace pill defeaturing (shipped)

Other-claude's working tree (uncommitted on `main` across Sprint 22 → most of Sprint 23) landed in [282b0bc](https://github.com/dudgeon/duo/commit/282b0bc) together with this session's finishing onClick gate. Pill is now a passive label by default; workspace ops route through the File menu. Click-to-open-dropdown behavior lives behind a localStorage flag (`duo.workspacePillMenu`) flipped via CLI: `duo workspace-pill-menu [on|off|toggle]`. Cached snapshot syncs renderer → main so bare-reads return live state instantly.

## Sprint 24 — possible starting points

### Top of carry-forward queue

- **FOLLOWUP-030** (filed during v0.8.0 audit) — browser-pane active-tab redirect on focus change. When user enters focus and active browser tab is non-member, strip hides the entry but WebContentsView still shows its content. Implementation sketch in `tasks.md § FOLLOWUP-030`.
- **FOLLOWUP-031** (filed during v0.8.0 audit) — `MaxListenersExceededWarning` on `terminal:claude-presence-changed` (11/10 listeners). Pre-existing; fix candidate is hoisting subscription to App.tsx + React context. Pure cleanup.
- **BUG-079** Ctrl-Tab cycle latency partial repro. Sprint 22 walk-1 gave us a known-good repro (focus on duo with 1 visible terminal — narrow set; latency present means it's NOT in cycle traversal). Sprint 17 instrumentation established total renderer-keydown → switchTab return ≈ 15ms. Open hypotheses: modifier release timing, upstream consumer race.

### Older carry-forward (most-recent first)

BUG-093 (split crash) · BUG-122 hypothesis 2/3 · ENH-084 v4 (aux glow) · ENH-127 (composer-window direction) · ENH-128 walk-4 (HEIC drag-drop) · ENH-137 (Beginner's Guide) · ENH-141 (enterprise smoke) · ENH-148 v2 · ENH-157 · ENH-162 (Clone modal collision UX) · FOLLOWUP-021 (`duo install --clean`) · BUG-024 follow-up · 17a.5 (template gallery) · Backlinks/graph view · GH-CLUSTER-PROTO gate.

## Lessons captured this sprint (in addition to Sprint 22 ones)

7. **Phase 3c auto-switch hook design.** Initially hooked off `tabMembership` change-detection (looking for new tabs); this failed to fire when a `duo edit` reactivated an existing tab (no `fileTabs` change → no `tabMembership` identity change → no effect). Refactored to hook off `activeWorking` instead — fires on both new-file opens AND tab reactivations. Lesson: think about user intent ("show me this file in its project") not implementation detail ("a new tab was created").

8. **Promise-cancel-on-cleanup destroys async cache hooks** (re-confirmed). The `useProjects` hook documents this pattern with a comment for future maintainers; honor it when extending the hook.

9. **Pre-walking the smoke walk via computer-use is cheap insurance.** Once `request_access` is granted for the Electron dev session, walking every owner-judgment item via `right_click` / `left_click` / `mouse_move` + screenshot verification eliminates the entire owner-walks-fail-then-fix iteration cycle for visual items. ENH-184 visual states (caret toggle, cursor:default) verified in seconds via computer-use; would have taken multiple owner-walk-and-paste-back round trips otherwise.

## Smoke walks

**v0.8.0 walk-1 (2026-05-25) — 5/5 PASS via computer-use pre-walk.** Manifest at [`docs/dev/smoke-walks/v0.8.0.json`](smoke-walks/v0.8.0.json). All 5 owner-judgment items walked by the agent via real mouse/keyboard before handoff; results captured via worksheet primitive's "Mark all Pass" + Copy results pattern. Agent-walked PASS (auto-skipped per intro): `npm test` 786/786 · `npm run typecheck` clean · `duo project list/focus/pin/unpin` round-trips · Phase 3c CLI verification · Phase 2b CLI verification · `duo workspace-pill-menu` CLI roundtrip.

## Open questions for the next agent

None blocking. Two natural starting points for Sprint 24:
- **FOLLOWUP-030** browser-pane active-tab redirect — small, ~10 lines, closes the Phase 2b polish gap.
- **FOLLOWUP-031** claudePresence listener leak — also small (single-subscription hoist), closes a long-standing warning.

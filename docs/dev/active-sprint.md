# Active sprint state — Sprint 22 / v0.8.0 (post-v0.7.9-cut)

**Status (2026-05-25):** v0.7.9 cut + tagged + pushed; [GitHub Release](https://github.com/dudgeon/duo/releases/tag/v0.7.9) live with signed+notarized DMG attached. The release pared ENH-183 mid-cycle (Option A) — kept the S1 + S3 resume affordances + D5 read ladder; dropped the S2 named banner + C11 educational tip + T3 auto-hydration + S2 inline rename + force-rename CLI. ~600 LOC removed. Dev session bumped to v0.8.0.

## Sprint 22 — what's queued

### ENH-184 (in-flight, finish first) — Workspace pill defeaturing + `+ New Workspace` routing fix

**Owner intent.** Render the title-bar workspace pill as a **passive label** — workspace name visible, no caret, no dropdown, no click handler. All workspace operations route through File menu (`File > New Workspace`, `File > Open Workspace`, `File > Save Workspace As…`, Recents). The pill is identity-only.

**Working tree state (uncommitted on `main`):**
- ✅ New [`renderer/hooks/useWorkspacePillMenuFlag.ts`](../../renderer/hooks/useWorkspacePillMenuFlag.ts) — localStorage-backed flag `duo.workspacePillMenu`, default OFF, mirrors ENH-176 `useSendPillFlags` pattern.
- ✅ Flag imported + declared in [`renderer/App.tsx`](../../renderer/App.tsx) ~line 809 as `workspacePillMenuEnabled`. **NOT YET CONSUMED — dead code until wired.**
- ✅ `+ New Workspace` handler in [`renderer/components/WorkspaceSwitcherDropdown.tsx`](../../renderer/components/WorkspaceSwitcherDropdown.tsx) — changed `save({saveAs: true})` → `newWorkspace()`. Header comment notes Q4 supersession with reasoning. **COMPLETE.**

**Sprint 22 finishing work:**
1. Wire `workspacePillMenuEnabled` to gate the pill's `onClick` in `App.tsx` (look around the `<WorkspaceSwitcherDropdown />` mount, ~line 3101 pre-pare; line numbers may have shifted). When flag is OFF: no caret rendered, click is a no-op. **~5 lines.**
2. Verify on owner walk: pill displays workspace name as passive label, click does nothing, `File > New/Open/Save Workspace` all still work.
3. CLI parity per [CLAUDE.md § 4](../../CLAUDE.md): add `duo workspace-pill-menu [on|off]` reading/setting the localStorage flag (mirrors `duo claude-return` / `duo shift-return` toggles). Optional — owner can DevTools-toggle if a CLI verb feels like overkill.
4. Update [`packs/duo-default/canvases/what-duo-does.html`](../../packs/duo-default/canvases/what-duo-does.html) §37c (workspace switcher dropdown) — currently describes the old click-to-open behavior; update to reflect the passive-label final state.

Full origin trail at [`tasks.md § ENH-184`](../../tasks.md#enh-184-workspace-pill-defeaturing--passive-label-only--fix--handler-routing).

### ENH-182 — Project-centric UX (PRD locked, ready to build)

PRD locked 2026-05-25 (owner walk) at [`docs/prd/enh-182-project-centric-ux.md`](../prd/enh-182-project-centric-ux.md). Design artifacts + code map included. Project rail style study at [`docs/research/project-rail-style-study.html`](../research/project-rail-style-study.html). Spec-complete.

### Carry-forward queue (not yet picked, most-recent first)

BUG-079 (tab-cycle latency) · BUG-093 (split crash) · BUG-122 hypothesis 2/3 · ENH-084 v4 (aux glow) · ENH-127 (composer-window direction) · ENH-128 walk-4 (HEIC drag-drop) · ENH-137 (Beginner's Guide) · ENH-141 (enterprise smoke) · ENH-148 v2 · ENH-157 · ENH-162 (Clone modal collision UX) · FOLLOWUP-021 · BUG-024 follow-up · 17a.5 (template gallery) · Backlinks/graph view.

## What just shipped (v0.7.9 — closed, do not re-walk)

| Item | Status |
|---|---|
| **ENH-183** Claude session resume affordances (pared scope) | ✅ Shipped v0.7.9. S1 pills + S3 restore + D5 ladder + `duo session list/resume`. |
| **BUG-158** `encodeProjectDir` realpath fix | ✅ Shipped v0.7.9 with 2 regression tests. |
| **BUG-160** Discriminator dismissedBanner scoping | ✅ Shipped v0.7.9 with regression test. |
| **FOLLOWUP-027** about:blank ghost-tab | ✅ Shipped v0.7.9. |
| **BUG-159** Rename terminator | ✅ Closed — wrong diagnosis (rename was committing via `\n`); code paths removed in pare. |
| **FOLLOWUP-028** T3 re-enable design | ✅ Closed won't-do — T3 itself dropped. |

## Idle thoughts queue (Notion canonical)

One unprocessed bullet remaining at [Notion idle thoughts](https://www.notion.so/Duo-Idle-Thoughts-34d45f48854f8032ba68fae6dc0473fe):

> new ENH: when I cmd-tab in terminal focus, cwd should be same as current terminal, not same as navigator root

Not blocking; process at next idle-thoughts sweep.

## Open questions for the next agent

None blocking. Owner is hands-off until Sprint 22 work picks up momentum.

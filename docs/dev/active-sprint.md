# Active sprint state — Sprint 23 / v0.7.11 (post-v0.7.10-cut)

**Status (2026-05-25):** **v0.7.10 cut + tagged + pushed + released.** [GitHub Release v0.7.10](https://github.com/dudgeon/duo/releases/tag/v0.7.10) live with signed-notarized DMG attached. Originally drafted as v0.8.0; owner reframed mid-push to v0.7.10 — PATCH bump (0.7.9 → 0.7.10), not MINOR. The project-as-filter-layer feature is real and visible but Phase 2b + Phase 3 + Phase 4 are still pending; **v0.8.0 reserved for the feature-complete ENH-182 capstone.** Dev session bumped to v0.7.11.

## v0.7.10 — what shipped (Sprint 22 close)

| Commit | Item |
|---|---|
| [3b49e43](https://github.com/dudgeon/duo/commit/3b49e43) | **ENH-182 Phase 0** — Project model + pure derivation + persisted slice |
| [b3953e8](https://github.com/dudgeon/duo/commit/b3953e8) | **TabBar.tsx pare leftover** — drops `ui.collapsed` refs; unblocks typecheck |
| [db3829a](https://github.com/dudgeon/duo/commit/db3829a) | **iCloud Optimize Storage data-loss guard** — scripts + predev/pretest hooks + CLAUDE.md trap doc |
| [58dcc86](https://github.com/dudgeon/duo/commit/58dcc86) | **ENH-182 Phase 1** — read-only ProjectRail mounts left of files |
| [6bd1742](https://github.com/dudgeon/duo/commit/6bd1742) | **ENH-182 home-dir fix + IPC** — `isExcludedFromQualification` + `projects:has-marker` IPC |
| [9831cce](https://github.com/dudgeon/duo/commit/9831cce) | Sprint 22 docs refresh + lessons learned |
| [2a8a885](https://github.com/dudgeon/duo/commit/2a8a885) | **ENH-182 Phase 2 — focus filter** (the marquee) |
| [dfb0b52](https://github.com/dudgeon/duo/commit/dfb0b52) | **ENH-182 Phase 2 — auto-spawn** on empty-terminal focus |
| [ef6c1ee](https://github.com/dudgeon/duo/commit/ef6c1ee) | Walk-1 close-out docs + filed follow-ups |
| [fcbbbf8](https://github.com/dudgeon/duo/commit/fcbbbf8) | **release: v0.7.10** |
| [d41df25](https://github.com/dudgeon/duo/commit/d41df25) | chore: bump to v0.7.11 |

## Sprint 23 — what's next

### Top priority — close ENH-182 toward the v0.8.0 capstone

1. **Phase 3** — D11 auto-switch focus when opening a file from another project + D12 lifecycle (auto add/remove + pin) + tile right-click context menu (Pin/Unpin + "Close N terminals and M tabs" with live counts; confirm on live process). Uses the existing `FileTree.popupMenu()` pattern (PRD § 9 area 10).
2. **Phase 4** — CLI parity. `duo project list / focus [--all] / pin / unpin / close`. Full plumbing checklist per CLAUDE.md § 4.
3. **Phase 2b** — Browser-mode canvas tab (`file://`) filter by path membership. Phase 2 covers terminal + non-browser file tabs only; HTML files opened in browser mode stay visible across every focus. Defer was because URL→project resolution is the new bit.

### ENH-185 — Project rail refinements (filed from v0.7.10 walk-1 notes)

Cosmetic polish from owner walk-1 PASS-with-notes:
1. Rail 10% narrower (`w-14 → w-[50px]`).
2. Tooltip wording: `title="Project: {name}"` instead of the current `${project.name}\n${project.root}`. Root path stays on aria-label for accessibility.

Both in `renderer/components/ProjectRail/ProjectRail.tsx`. Fold into Phase 3 or land as a side commit.

### BUG-079 update — Ctrl-Tab cycle latency partial repro

Owner observed noticeable Ctrl-Tab latency on ENH-182-CTRL-TAB walk-1 (PASS with note). Phase 2 doesn't change the cycle implementation — same root cause as the long-standing carry-forward. Sprint 22 walk gives us a known-good repro condition (focused on duo with 1 visible terminal — narrow set; latency present even there means it's NOT in cycle traversal). Sprint 17 instrumentation established total renderer-keydown → switchTab return ≈ 15ms. Open hypotheses: modifier release timing, upstream consumer race.

### ENH-184 — workspace pill defeaturing (other-claude's working tree)

Still uncommitted on `main`:
- `renderer/hooks/useWorkspacePillMenuFlag.ts` (untracked)
- `renderer/App.tsx` (flag imported + declared, NOT consumed)
- `renderer/components/WorkspaceSwitcherDropdown.tsx` (handler fix complete)

Finishing work documented at [`tasks.md § ENH-184`](../../tasks.md). Whichever Claude picks it up: wire `workspacePillMenuEnabled` to gate the pill's `onClick`, owner walk, optional CLI parity verb.

### Carry-forward queue (not yet picked, most-recent first)

ENH-185 (rail refinements — see above) · BUG-079 latency (see above) · BUG-093 (split crash) · BUG-122 hypothesis 2/3 · ENH-084 v4 (aux glow) · ENH-127 (composer-window direction) · ENH-128 walk-4 (HEIC drag-drop) · ENH-137 (Beginner's Guide) · ENH-141 (enterprise smoke) · ENH-148 v2 · ENH-157 · ENH-162 (Clone modal collision UX) · FOLLOWUP-021 (`duo install --clean`) · BUG-024 follow-up · 17a.5 (template gallery) · Backlinks/graph view.

## Lessons captured this sprint (already codified)

1. **iCloud Optimize Storage is a class-1 dev hazard.** Permanent guard at `scripts/check-materialization.sh` + `scripts/materialize.sh` + `predev`/`pretest` npm hooks. Full trap doc in `CLAUDE.md § Build commands`.
2. **Promise-cancel-on-cleanup destroys async cache hooks** that target stable probe results. Pattern documented in `renderer/hooks/useProjects.ts` comment.
3. **Owner directive on `~/.claude` qualification.** Pure helper `isExcludedFromQualification(dir, homeDir)` in `shared/projects.ts` with 9 tests including 3 explicit `~/.claude editing scenario` integration tests. Subdirs of home qualify normally; only `$HOME` + `/` are excluded.
4. **Structural pares need same-commit grep-audit.** ENH-183 dropped `collapsed` from `SessionHeaderUiState` but left 3 references in TabBar.tsx. Apply [feedback_grep_all_implementations_before_rename.md](../../.claude/projects/-Users-geoffreydudgeon-Documents-GitHub-duo/memory/feedback_grep_all_implementations_before_rename.md) to type-field removals.
5. **Other-claude's working tree preservation pattern.** Revert-edit-restore dance documented in [`docs/dev/RESUME.md § 8`](RESUME.md).
6. **DMG version drift trap.** `dist-signed.sh` reads `package.json § version` at packaging time. Don't bump `package.json` during a background build. New guard at [`docs/dev/RESUME.md § 9`](RESUME.md).

## Smoke walks

**v0.7.10 walk-1 (2026-05-25) — 5/5 PASS.** Manifest at [`docs/dev/smoke-walks/v0.8.0.json`](smoke-walks/v0.8.0.json) (filename reflects the working version before the cut got renumbered to PATCH; results stand). Owner-walked items: ENH-182-RAIL-VISUAL · ENH-182-FOCUS-CLICK · ENH-182-FOCUS-NAV · ENH-182-CTRL-TAB · TABBAR-PARE-CLEANUP. Agent-walked PASS (auto-skipped per intro): iCloud guard scripts + predev hook + vitest 786/786 + typecheck + hash-stable colors across reload + ~/.claude qualification (3 tests). Two PASS-with-notes filed as Sprint 23 follow-ups (ENH-185, BUG-079 update).

## Open questions for the next agent

None blocking. Two natural starting points:
- Phase 3 (lifecycle + auto-switch + tile menu) — the largest remaining ENH-182 chunk.
- ENH-184 finish — small, ~5 lines, closes other-claude's preserved working tree.

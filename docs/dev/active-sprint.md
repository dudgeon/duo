# Active sprint state — Sprint 21 / v0.7.8 (post-v0.7.7-cut; planning open)

**Status (2026-05-23):** v0.7.7 cut + tagged + pushed; GitHub Release live with signed+notarized DMG attached. Sprint 21 known scope is two required re-ships (ENH-177 + ENH-178) plus a small detail folded into ENH-177's re-ship (banner reads `sessions-index.json` for title; ENH-180 closed). Real Sprint 21 scope-pick beyond those happens when owner returns.

## Immediate sprint-start tasks

None. v0.7.7 is shipped + tagged + released. Sprint 21's first move is the ENH-177 re-ship.

## Sprint 21 candidate scope

### Required re-ships (queued from v0.7.7 revert)

| ID | What | Source for re-ship |
|---|---|---|
| **ENH-177** | Claude session resume banner across workspace switch | Cherry-pick or re-implement from [f351719](https://github.com/dudgeon/duo/commit/f351719). Banner reads `~/.claude/projects/<encoded-cwd>/sessions-index.json` (prefers `summary` > `customName` > short UUID fallback) — see [enh-177-banner-mockup.html](../research/enh-177-banner-mockup.html). Owner walks workspace-switch → return → banner appears → click-Resume → claude resumes. |
| **ENH-178** | Browser blocklist refactor (three modes + `local-only` default) | Cherry-pick from [b03a8da](https://github.com/dudgeon/duo/commit/b03a8da). Owner walks: set local-only → `duo open https://example.com` → confirm system browser opens instead of Duo embedded; set filtered → URL renders in Duo; set unfiltered with `--i-understand` → IT warning + acceptance. |

### Closed during planning (2026-05-23)

| ID | Outcome |
|---|---|
| **ENH-180** | Closed same-day. Owner observation: Claude Code already writes a Haiku summary to `sessions-index.json` automatically — Duo doesn't need to generate its own title. The ~20-line "banner reads `sessions-index.json` and falls back to UUID" detail folds into ENH-177's re-ship. PRD at [`docs/prd/enh-180-session-rename.html`](../prd/enh-180-session-rename.html) preserved with closure banner + historical empirics under `<details>` (for the `/rename` mechanics + cost research, in case a v2 ever revisits). |

### Carry-forward backlog (not yet picked for Sprint 21)

- **BUG-079** tab-cycle latency — needs prod repro
- **BUG-093** split crash — needs clean repro
- **BUG-122 hypothesis 2/3** — Notion-race / OneDrive xattr — next-repro log gated
- **ENH-084 v4** aux glow — owner 60s walk owed
- **ENH-127** composer-window direction — if pain re-surfaces
- **ENH-128 walk-4** HEIC drag-drop — owner verification owed
- **ENH-137** Beginner's Guide
- **ENH-141** enterprise smoke
- **ENH-148 v2** cross-boundary selection — wait for owner ping
- **ENH-157** browser-pane comments
- **ENH-162** Clone modal destination collision UX
- **FOLLOWUP-021** `duo install --clean`
- **BUG-024 follow-up** combined Send + Comment pill
- **17a.5** template gallery
- **Backlinks / graph view** (Obsidian cluster)

## What shipped in v0.7.7 (closed)

| Item | Commit | Smoke-walked |
|---|---|---|
| **ENH-169** Navigator new-file / new-folder UX | [ce50e78](https://github.com/dudgeon/duo/commit/ce50e78) | ✅ owner walk-1 PASS |
| **ENH-170 v2** Top-level Settings menu | [342020a](https://github.com/dudgeon/duo/commit/342020a) | ✅ owner walk-2 PASS (post-BUG-154 fix) |
| **ENH-171** Workspace switcher dropdown | [2bde2f6](https://github.com/dudgeon/duo/commit/2bde2f6) | ✅ owner walk-2 PASS |
| **ENH-172** Show / hide hidden files | [600d16e](https://github.com/dudgeon/duo/commit/600d16e) | ✅ owner walk-1 PASS |
| **ENH-173** `duo view <folder>` Navigate-here button | [3daf480](https://github.com/dudgeon/duo/commit/3daf480) | ✅ owner walk-2 PASS |
| **ENH-174** Disable TipTap autolink | [ffd798b](https://github.com/dudgeon/duo/commit/ffd798b) | ✅ agent walked (insert + diff on /tmp fixture) |
| **ENH-175** `duo navigate <url>` opens new tab or focuses existing | [ffd798b](https://github.com/dudgeon/duo/commit/ffd798b) | ✅ agent walked both branches via CLI |
| **ENH-176** Send-pill agent + terminal variants (localStorage flags) | [3d331f0](https://github.com/dudgeon/duo/commit/3d331f0) | ✅ agent walked data path (flag round-trip) |
| **ENH-179** ⌘Z reopens last-closed tab | [21fa66a](https://github.com/dudgeon/duo/commit/21fa66a) | ✅ agent walked via computer-use ⌘Z |
| **BUG-149/150/151/152/154/155** | various | various walks ✅ |
| **ENH-180** PRD only | [c090064](https://github.com/dudgeon/duo/commit/c090064) | n/a |

## Deferred / reverted out of v0.7.7

| ID | Commits | Why deferred |
|---|---|---|
| **ENH-177** Claude session resume banner | [f351719](https://github.com/dudgeon/duo/commit/f351719) (build) · [49f4644](https://github.com/dudgeon/duo/commit/49f4644) (revert) | Owner walk owed before ship — needs full workspace-switch round-trip with claude resume |
| **ENH-178** Browser blocklist three modes | [b03a8da](https://github.com/dudgeon/duo/commit/b03a8da) (build) · [5295849](https://github.com/dudgeon/duo/commit/5295849) (revert) | Owner walk owed — needs to verify local-only → system browser bounce live |

## Process memory locked Sprint 20

- [feedback_open_every_modal_before_smoke_handoff](../../.claude/projects/-Users-geoffreydudgeon-Documents-GitHub-duo/memory/feedback_open_every_modal_before_smoke_handoff.md) — every modal/dropdown in a smoke-walk manifest gets opened via computer-use BEFORE handoff. Locked from BUG-153 (ENH-170 v1 modal occlusion under browser-pane WCV).

## Build / repo state

- Test count: 687 green (35 files), down 17 from pre-revert (claude-session-tracker 6 + browser-manager isLocalUrl 11 removed alongside ENH-177/178 reverts).
- Typecheck clean.
- `dist/Duo-0.7.7-arm64.dmg` (104 MB) signed + notarized + validated. Not yet uploaded to GitHub Releases (owner blesses the tag push first).
- Dev session running under v0.7.8 identity (post-cut bump).

## CLI driving etiquette (still in effect)

- Avoid `duo edit --reveal` and computer-use clicks unless owner is actively expecting eyes-on.
- Prefer `duo doc read <path>` over `duo edit <path>` for inspection.
- For modal/menu verification, ASK owner before invoking computer-use.

## When you next have context

1. Re-ship ENH-177 first (folds in the `sessions-index.json` read for banner title).
2. Re-ship ENH-178.
3. Pick Sprint 21 carry-forward items from the backlog above.

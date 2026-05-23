# Active sprint state — Sprint 21 / v0.7.9 (post-v0.7.8-cut)

**Status (2026-05-23):** v0.7.8 cut + tagged + pushed; [GitHub Release](https://github.com/dudgeon/duo/releases/tag/v0.7.8) live with signed+notarized DMG. ENH-178 (browser blocklist three modes) shipped as the lone behavior change. Sprint 21 remaining scope is the ENH-177 + ENH-181 bundle plus carry-forward picks.

## Sprint 21 candidate scope

### Remaining required re-ship

| ID | What | Source for re-ship |
|---|---|---|
| **ENH-177 + ENH-181** | Claude session resume banner + inline rename + collapse toggle | Cherry-pick or re-implement from [f351719](https://github.com/dudgeon/duo/commit/f351719); fold in ENH-181 (inline rename via PTY `/rename` inject, gated on claudePresence; collapse-to-tab-marker toggle; Esc-cancel during edit). Banner reads `~/.claude/projects/<encoded-cwd>/sessions-index.json` (prefers `customName` > `summary` > short UUID fallback) — see [enh-177-banner-mockup.html](../research/enh-177-banner-mockup.html) for all 7 states. Owner walks workspace-switch → marker on tab → tap to expand → click title → type new name → Return → confirm `/rename` lands in transcript → re-tap to collapse. |

### Shipped this sprint (2026-05-23)

| ID | What | Commit |
|---|---|---|
| **ENH-178** | Browser blocklist three modes (`local-only` default) | [d851296](https://github.com/dudgeon/duo/commit/d851296) (cherry-pick of [b03a8da](https://github.com/dudgeon/duo/commit/b03a8da)) |

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

## Deferred / reverted out of v0.7.7 (status)

| ID | Status |
|---|---|
| **ENH-177** Claude session resume banner | Still queued — re-shipping Sprint 21 bundled with ENH-181 (banner inline rename + collapse toggle). |
| **ENH-178** Browser blocklist three modes | ✅ Shipped v0.7.8 ([d851296](https://github.com/dudgeon/duo/commit/d851296)). |

## Process memory locked Sprint 20

- [feedback_open_every_modal_before_smoke_handoff](../../.claude/projects/-Users-geoffreydudgeon-Documents-GitHub-duo/memory/feedback_open_every_modal_before_smoke_handoff.md) — every modal/dropdown in a smoke-walk manifest gets opened via computer-use BEFORE handoff. Locked from BUG-153 (ENH-170 v1 modal occlusion under browser-pane WCV).

## Build / repo state

- Test count: 698 green (35 files; ENH-178 restored 11 browser-manager `isLocalUrlForBrowserMode` cases).
- Typecheck clean.
- `dist/Duo-0.7.8-arm64.dmg` (104 MB) signed + notarized + validated + uploaded to [GitHub Release v0.7.8](https://github.com/dudgeon/duo/releases/tag/v0.7.8).
- Dev session running under v0.7.9 identity (post-cut bump).

## CLI driving etiquette (still in effect)

- Avoid `duo edit --reveal` and computer-use clicks unless owner is actively expecting eyes-on.
- Prefer `duo doc read <path>` over `duo edit <path>` for inspection.
- For modal/menu verification, ASK owner before invoking computer-use.

## When you next have context

1. Re-ship ENH-177 + ENH-181 (banner + inline rename + collapse toggle).
2. Pick Sprint 21 carry-forward items from the backlog above.

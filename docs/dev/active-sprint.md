# Active sprint state — Sprint 16 (in flight; cut target v0.6.15)

**Theme (owner pick 2026-05-10):** **A+B combined — install/upgrade close-out + stability sweep.** Sprint 16 commits 1+2 (ENH-141 install-path hardening + BUG-121 about:blank respawn loop) shipped as v0.6.14 hotfix the same day Sprint 16 opened. The rest of the sprint pairs the natural continuation of the install-hardening chapter (ENH-140 orphan cleanup + pin URL auto-migration + op #8 pivot) with a focused stability pass on genuinely-open recurring bugs (BUG-085 layer-3 + BUG-079 latency probe + BUG-093 clean repro + ENH-084 aux glow v4).

> **Status: v0.6.14 shipped 2026-05-10; v0.6.15 cut target.** Sprint plan locked via 2-stage AUQ (theme pick + B-bucket pick) on 2026-05-10. v0.6.14 deliverables ([release](https://github.com/dudgeon/duo/releases/tag/v0.6.14)) detailed under "v0.6.14 cut record" below. Sprint 15 detail in § "Sprint 15 retrospective".

## Sprint 16 commits already shipped (v0.6.14)

| Item | Status |
|---|---|
| **ENH-141** — drop `duo` CLI into SHIM_DIR (`~/.claude/duo/bin/`) so it works inside Duo PTYs and Claude Code sandboxes without `.zshrc` edits + fold `addToShellPath` into the FirstLaunchBanner [Install] action so the click also auto-wires `~/.local/bin` to `~/.zshrc` for external Terminal/iTerm use | ✅ shipped v0.6.14 (smoke walk 2/PASS 3/SKIP — BANNER-UI + WORK-MACHINE rows pending the enterprise install) |
| **BUG-121** — closing the last browser tab respawns about:blank in a loop. Dropped BUG-020 + BUG-096 spawn-replacement guards (motivation retired in v0.6.13's FAQ removal); `tabs.length === 0` is now a supported empty state; null-guarded all `activeView()` callers | ✅ shipped v0.6.14 (CLI-verified end-to-end) |

## Sprint 16 remaining plan (post-v0.6.14, cut target v0.6.15)

### A-bucket — Install/upgrade close-out ✅ shipped Sprint 16 commits 3 + 5

| ID | Title | Status | Estimate |
|---|---|---|---|
| **BUG-119** | fsevents shutdown race — SIGABRT every Duo quit. Moved `filesService.dispose()` + `ptyManager.dispose()` + flushes into `before-quit` so chokidar releases its native fsevents handle before V8 isolate teardown. Verified via osascript Quit Apple Event: no new crash report. | ✅ Sprint 16 commit 3 | ~30 min (actual) |
| **ENH-140** | Orphan file cleanup on upgrade. **Design simplified:** reused existing `installed.json § files` SHA map (Stage 21e-iii) rather than a new `installed-files.json`. `cleanupOrphans(prevShas, newFiles)` runs post-write — matched-SHA orphans deleted, customized files preserved + logged. Empty-dir sweep handles `help/` etc. when last contained file retires. Verified live with injected fake files (matched-SHA → deleted ✅; mismatched-SHA → preserved ✅). **Known limitation:** v0.6.13/v0.6.14 legacy orphans (`help/faq.html`, retired pack dirs) aren't tracked in prevShas so they don't auto-clean; v0.6.15+ retirements going forward do. | ✅ Sprint 16 commit 5 | ~half-day |
| **FOLLOWUP: pin URL auto-migration** | `migrateStalePinUrls()` walks pins.json on every install, rewrites known v(N-1)→v(N) renames (PIN_RENAMES map: `duo/help/what-duo-does.html` → `duo/packs/duo-default/canvases/what-duo-does.html`), drops pins for retired-no-successor entries (`duo/help/faq.html` → null). Idempotent. Verified live: owner's stale `help/what-duo-does.html` pin migrated correctly + other user-pins preserved. Closes the documented "two WDD tabs" transient. | ✅ Sprint 16 commit 5 | ~1 hr |
| **FOLLOWUP: op #8 pivot to pack-defaults iteration** | `bootstrapPinsFromPackDefaults(sourceRoot)` reads each `packs/*/PACK.json` and seeds pins.json from `defaults[].kind === 'canvas' && defaults[].pin === true` entries. Pin title extracted from each canvas's `<title>` element (falls back to pack.title). Replaces hardcoded WDD literal. Verified live: renamed pins.json away → install → seeded with `What Duo Does` pin from duo-default pack manifest. | ✅ Sprint 16 commit 5 | ~1 hr |

**A-bucket total:** ~1 day. End state achieved: enterprise-friendly install + upgrade story closes cleanly — fresh installs bootstrap pins dynamically from pack manifests, upgrades clean up after themselves, stale pinned tabs auto-migrate.

### B-bucket — Stability sweep (owner picked all 4 candidates 2026-05-10)

| ID | Title | Status | Estimate |
|---|---|---|---|
| **FOLLOWUP-019** (was BUG-085 layer-3) | **2026-05-11 audit:** Owner picked "BUG-085 layer-3" thinking docs were owed; audit confirmed all 3 layers (watcher + pre-save reconciliation + skill/agent docs) already shipped in commit `a4c56dc` (Sprint 6). BUG-085 status entry was stale at 🔴 IMMEDIATE for 3 sprints. Real owed work: mirror the BUG-085 + BUG-099 fixes from `MarkdownEditor.tsx` to `PageTab.tsx` (HTML canvas) — same scope, same data-loss class, just the canvas surface. Parent BUG-085 disposition upgraded from (c) Deferred to (a) Mirrored per CLAUDE.md § 4. | 🟢 P0 — same data-loss class as markdown variant; closes editor-canvas parity gap | ~half-day |
| **BUG-093 clean-repro investigation** | Right-click tab → Move to Split View crashes the renderer. Instrumented in v0.6.7 (WorkingPane drops to localized error panel; rest of app keeps running). FOLLOWUP-013 is the clean-repro tracking item — needs a reliable trigger sequence to bisect. | 🟢 P0 — when it fires, real crash from real user gesture | ~half-day if repro lands quickly |
| **BUG-122 (swap-in 2026-05-11)** | Save-conflict banner re-surfaces in v0.6.14. ✅ Defensive hardening shipped (commit 7): TTL bump 2s→5s, widened echo normalization (BOM + CRLF + per-line trailing whitespace), `~/.claude/duo/logs/last-conflict.log` production-readable diagnostic. Verified live: log file lands with firstDiffOffset + head/tail excerpts + appVersion stamp. **Deeper-fix gate:** awaiting next repro's log contents — `firstDiffOffset` + head excerpts tell us deterministically whether it's hypothesis 2 (cloud-sync BOM/CRLF), 3 (TTL — already widened to 5s, may suffice), or 4 (tiptap round-trip non-idempotency). | ✅ Sprint 16 commit 7 — hardened | ~half-day (actual) |
| ~~**BUG-079 tab-cycle latency probe**~~ — bumped to v0.6.16 | ⌃⇧\` reverse-cycle has multi-second latency + requires re-presses. Bumped to make room for BUG-122. ~half-day diagnosis + fix when it returns. | 🟡 P1 → deferred | — |
| **ENH-084 aux focus glow v4** | Aux pane focus indicator (orange glow when active in side pane). Three v0.6.5 attempts all failed (v1 mousedownCapture missed iframe clicks; v2 gate-removal sacrificed exclusivity; v3 focusin listener didn't reach iframe focus). v4 needs a fresh architectural read — probably tracks main-process focus events via `before-input-event` + an IPC broadcast rather than fighting iframe focus boundaries from the renderer. | 🟡 P2 — owner explicitly green-lit a 4th attempt | ~half to full day (risky; bail-out plan: log v4 defect alongside v1-v3 + move on if no progress within ~3 hr) |

**B-bucket total:** ~1.5–2 days.

**Sprint 16 total budget:** ~2.5–3 days remaining work + cut.

## Recommended commit order

1. **BUG-119** (30 min) — smallest, fixes every-quit crash dialog. Standalone.
2. **FOLLOWUP-019** (half-day) — mirror BUG-085's watcher + pre-save reconciliation + echo guard from `MarkdownEditor.tsx` into `PageTab.tsx`. Code change (not docs); original "BUG-085 layer-3" item the owner picked turned out to be already shipped (Sprint 6 commit `a4c56dc`).
3. **ENH-140 + pin URL auto-migration + op #8 pivot** (~1 day) — A-bucket cluster, all touch `install-service.ts`. Land as one commit (or 2 if op #8 pivot wants its own diff).
4. **BUG-122** (half-day) — swap-in 2026-05-11 per owner directive. Defensive hardening first (TTL bump + better echo normalization + production-readable diagnostic log); deeper fix gated on next repro's captured data. BUG-079 latency probe deferred to v0.6.16.
5. **BUG-093 clean-repro** (half-day) — bisect via instrumented build. May complete in a single afternoon if repro lands; otherwise file owned findings + move on.
6. **ENH-084 v4** (last — risky) — set 3-hour bail-out; if no traction, log v4 defect alongside v1-v3 and defer to v0.6.16.
7. **v0.6.15 cut** via cut-version skill.

## Open questions still needing Geoff's input

| Question | Priority |
|---|---|
| **ENH-137 Beginner's Guide** — when's the owner-authored draft landing? Drops into `packs/duo-default/canvases/beginners-guide.html` via pack-version bump (existing users see it auto-fire). | Surfaces in v0.6.15+ when draft exists |
| **ENH-118 image-type handling** — animate GIFs by default vs freeze first-frame Slack-style? SVG safety review owed? HEIC/RAW reject vs convert? | Before any image-polish sprint |
| **ENH-101 expand/collapse chord semantic** — rail-collapse (new behavior orthogonal to ⌘⌥0/9) vs full-screen (redundant; kill the chord)? | When the chord re-surfaces |
| Stage 17a.5 directions A/E (template gallery / registry) | Before any code work on templates |
| BUG-024 follow-up — combine Send → Duo + Comment pills (single split-pill or hover flyout)? | Before further selection-pill iteration |
| Backlinks panel / graph view (Obsidian cluster) — anchor for a future sprint? Or defer further? | When wikilinks-autocomplete usage tells us whether the next-tier capability has demand |

## v0.6.14 cut record (2026-05-10)

Shipped same day Sprint 16 opened. [GitHub Release](https://github.com/dudgeon/duo/releases/tag/v0.6.14) (signed + notarized + stapled + validated DMG).

- **ENH-141** install-path hardening — `cli/duo install` tier-1 target moved from `~/.claude/bin/duo` → `~/.claude/duo/bin/duo` (the SHIM_DIR, already on PTY $PATH for the claude shim). Electron `installCli()` now also drops the SHIM_DIR symlink alongside its `~/.local/bin/duo` copy. FirstLaunchBanner [Install] click now folds `addToShellPath()` for external-terminal use. Reaches PTY $PATH inside both Duo terminals and managed Claude Code installs (where `.zshrc` writes are sandboxed out).
- **BUG-121** browser-tab respawn — Dropped BUG-020 + BUG-096 spawn-replacement guards (their motivation retired in v0.6.13's FAQ removal). `tabs.length === 0` is now a supported empty state; `activeView()` returns `WebContentsView | null`; all callers null-guarded. Closing the last browser tab no longer triggers an about:blank respawn loop. `navigate()` self-heals from the empty state via addTab+switchTab.
- **Smoke walk:** 2 PASS / 3 SKIP / 0 FAIL ([results](smoke-walks/v0.6.14.results.md)). 2 of the 3 SKIPs (BANNER-UI + WORK-MACHINE) are deferred to the production smoke on the enterprise install — owed before any "Sprint 16 done" claim.

---

## Sprint 15 retrospective (closed 2026-05-10)

**Theme:** Repo cleanup close-out + FTUX-content-→-packs migration + enterprise-friendly install hardening.

**Outcome:** v0.6.13 cut shipped. Tag pushed; DMG on GitHub Release. All P0 commitments landed. Two follow-ups filed (BUG-119, ENH-140) for Sprint 16.

### Shipped in v0.6.13 (5 sprint commits + cut + bump + 1 ledger entry)

| Commit | Item |
|---|---|
| `7a38fb1` | **ENH-136** — `git mv packs/claude-code-basics/ examples/lesson-pack-template/`. PACK.json renamed; internal `claude-code-basics` references bulk-renamed; new README walks the copy-customize flow. Skill cross-refs in `skill/lesson-runtime.md`, `skill/lesson-flythrough.md`, `skill/make-playground.md`, `skill/examples/curriculum-template/README.md`, `skill/examples/canvas-templates/lesson-scaffold.html` updated. |
| `20b83ca` | **BUG-118** — `cut-version` skill Step 4 adds `git diff --quiet cli/duo` post-`npm run build:cli` guard. Future cuts can no longer silently ship stale binaries. |
| `58c8fdf` | **ENH-138 + ENH-135 folded** — `packs/duo-default/` created with `PackManifest.builtIn: true` schema flag; `git mv help/what-duo-does.html → packs/duo-default/canvases/`; `git mv help/faq.html → docs/legacy/faq.html`; install-service op #8 pivoted (drops FAQ pin, repoints WDD URL to pack); `defaultLandingUrl()` + `helpUrl()` deleted from `browser-manager.ts`; `bootDefaultTab` constructor option dropped; `fork.config.default.json § helpPinnedFiles` drops `"faq.html"`. Comment refs throughout updated. |
| `3103ed2` | **BUG-116** — `scripts/dist-signed.sh:154` passes explicit version-pinned DMG path to `validate-dmg-launch.sh` (was: alphabetical glob silently validated v0.6.8 instead of v0.6.12 during the prior cut). |
| `ec0893b` | **Pack-canvas / pinned-tab idempotency contract ADR** — owner-raised at smoke walk close-out: "stale Duos on upgrade won't see the new WDD." First-launch hook in `electron/main.ts` reads `pins.json` membership; skips NAV_EDIT for URLs already pinned (avoids fresh-install double-open); fires NAV_EDIT for URLs not pinned (delivers new content to upgrade users). `openOnFirstLaunch: true` flipped back on (idempotency check makes it safe). Full design in `docs/DECISIONS.md § "Pack canvas / pinned tab idempotency contract"`. |
| `6d668af` | **release: v0.6.13** — CHANGELOG + RELEASES + roadmap + session-log updates. Tag `v0.6.13` (pushed). |
| `9d02b99` | **chore: bump to v0.6.14** for next sprint. |
| `243dbc7` | **docs(tasks): file BUG-119** — fsevents shutdown race producing SIGABRT every Duo quit. Pre-existing in v0.6.12; surfaced at Sprint 15 close-out. Fix scoped for Sprint 16. |

### Pre-cut commits (already on `main` before Sprint 15 work started)

These landed in the v0.6.12 → v0.6.13 cleanup batch (post-v0.6.12 cut, pre-Sprint-15 commit 1):

- `18725c7` — release: v0.6.12 (Sprint 14 — JSON/YAML viewer-editor pulled forward + visibility CLI + view-source panel-fill + image-handling close-out + Return semantics)
- `6822a66` — chore: bump to v0.6.13
- `ce74481` — chore(repo-clean): repo-root cleanup (rm RESUME.md, mv duo-brief.md → docs/, rm stray PNG, prune old DMGs)
- `32eab90` — docs(repo-clean): split README (535 → 168 lines + new `docs/dev/CONTRIBUTING.md` carrying dev content)
- `e4ff756` — docs(repo-clean): trim tasks.md (pruned BUG-001..BUG-017 era entries; -697 lines)
- `089521f` / `650609b` — docs(research): ENH-134 planning artifact + CLAUDE.md § 11 rule (planning artifacts default to HTML interactive playgrounds, not plain markdown)
- `bf8db68` — docs+fix: ENH-134 refocus + BUG-117 hardening + 4 follow-up filings (BUG-116, BUG-117, ENH-135, ENH-136, ENH-137)
- `8d1f96e` — fix(cli): rebuild stale cli/duo binary (v0.6.12 cut committed pre-rebuild copy)
- `e2b1f8c` — docs(tasks): file BUG-118
- `f04f113` — docs(install): file ENH-138 + capture "FTUX content → packs" principle in playground § 5
- `3e00bc7` — docs(breadcrumbs): close ENH-134 + capture decisions + Sprint 15 plan + ENH-139 schema-extension follow-on

### Smoke walk shape

- **`docs/dev/smoke-walks/v0.6.13.json`** — manifest with 3 items (existing-user-no-regression, ⌘T blank, DMG fresh-install deferred).
- **Walk-1 owner result:** 1 PASS + 2 FAIL. Both FAILs diagnosed as test-environment artifacts:
  - FAIL 1 (existing-user-upgrade): dev `pins.json` had developer-only repo-path pins (FAQ + WDD) pointing at moved files. Migrated to point at the new pack location + closed 3 broken tabs.
  - FAIL 2 (DMG fresh-install): owner ran `dist-signed.sh` pre-cut in wrong cwd; cleared at cut time when the script ran successfully end-to-end during Step 4.5.
- **Scenario B upgrade simulation (post-cut):** reverted `pins.json` WDD URL to v0.6.12-style + removed `duo-default@1.0.0` from `installed-packs.json` → installed v0.6.13 DMG over v0.6.12 → launched. First-launch hook fired correctly (`duo-default@1.0.0` re-flagged with new timestamp). Idempotency check ran. `openTab` deduped the pack URL against the existing session-restored tab (owner already had the pack URL open from dev work). Net: hook activated the pack-WDD tab rather than creating a duplicate. Two-tabs outcome from the ADR matrix is logically derived but not directly screenshotted in this dev-state run; would require also clearing session-state.json.

### Carry-forward to Sprint 16

Surfaced at close-out (now in the Sprint 16 Candidates table above):

- **BUG-119** — fsevents shutdown race. ~10 LOC fix; pre-existing pre-Sprint-15. Recommend as Sprint 16 commit 1.
- **ENH-140** — install-service should track + cleanup orphan files on upgrade (provenance manifest pattern, model after Stage 21d distro-pack-service's `InstalledFilesManifest`). The v0.6.13 cut left two known orphans on every upgrade user: `~/.claude/duo/help/faq.html` and `~/.claude/duo/packs/claude-code-basics/`. Pairs with the pin URL auto-migration follow-up.
- **Pin URL auto-migration follow-up** — install-service auto-rewrites `pins.json` entries pointing at v(N-1) paths to v(N) successors. Closes the "two WDD tabs" upgrade transient documented in v0.6.13 CHANGELOG as a known issue.
- **Op #8 pivot follow-up** — replace the hardcoded WDD URL literal in `install-service.ts § op #8` with iteration over `packs/*/PACK.json § defaults[].pin: true`. Removes the last duplicated default-pin code path.

### One callout deliberately deferred

The v0.6.13 GitHub Release notes do NOT explicitly call out the "two WDD tabs on first launch after upgrade" transient (the known-issue is in the CHANGELOG but not the release-body callout). Filed for later — install base is tiny (one owner, one or two machines) so end-user confusion isn't a near-term risk. Pin URL auto-migration follow-up will resolve the underlying issue before any wider rollout.

# Active sprint state — Sprint 16 (in flight; cut target v0.6.14)

**Theme: Install-path hardening.** Opened 2026-05-10 from an enterprise user report exposing that the `duo` CLI was unreachable by name inside Claude Code sandboxes (both install targets — `~/.claude/bin/duo` for `duo install`, `~/.local/bin/duo` for the Electron banner — landed at paths that aren't on PTY $PATH). Sprint 16 commit 1 is the urgent P0 fix (ENH-141); the rest of the sprint's shape depends on owner direction (BUG-119 quit-crash candidate + ENH-140 orphan cleanup pairs naturally with the install-service work just landed).

> **Status: Sprint 16 commit 1 in flight (ENH-141).** Code complete, typecheck clean, CLI binary rebuilt, CLI-side install path verified end-to-end via PTY-PATH simulation. Banner-side install end-to-end smoke deferred to v0.6.14 smoke walk (computer-use screenshot capture was OS-level broken during dev verification). Sprint 15 detail in § "Sprint 15 retrospective" below.

## Sprint 16 commits so far

| Item | Status |
|---|---|
| **ENH-141** — drop `duo` CLI into SHIM_DIR (`~/.claude/duo/bin/`) so it works inside Duo PTYs and Claude Code sandboxes without `.zshrc` edits + fold `addToShellPath` into the FirstLaunchBanner [Install] action so the click also auto-wires `~/.local/bin` to `~/.zshrc` for external Terminal/iTerm use | ✅ code complete, smoke walk pending |

## Sprint 16 candidates (carry-forward from Sprint 15)

| ID | Title | Status | Estimate |
|---|---|---|---|
| **BUG-119** | fsevents shutdown race — SIGABRT every Duo quit (pre-existing pre-v0.6.13; surfaced at Sprint 15 close-out) | 🟢 P0 candidate — fix is ~10 LOC in `electron/main.ts` (move `filesService.dispose()` from `window-all-closed` to `before-quit`) | ~30 min |
| **ENH-137** | Beginner's Guide content — drops into `packs/duo-default/canvases/beginners-guide.html` via pack-version bump | 🟡 awaiting owner-authored draft | Owner draft + Claude polish + 30 min plumbing |
| **ENH-140** | install-service should track + cleanup orphan files on upgrade (provenance manifest at `~/.claude/duo/installed-files.json`) | 🟡 P2 — graceful degradation works today (orphans are inert); meaningful work to do it right | ~half-day |
| **ENH-139** | PackManifest schema extension for markdown editable / markdown-preview / browser kinds | 🟡 deferred — gated on ENH-137 picking markdown OR a future pack needing explicit browser routing | ~half-day when triggered |
| **FOLLOWUP: pin URL auto-migration** | install-service detects `pins.json` entries pointing at v(N-1) paths and rewrites to v(N) successors (cleanest fix for the "two WDD tabs" upgrade transient documented in v0.6.13 CHANGELOG) | 🟡 P2 — pairs with ENH-140's provenance manifest | ~1 hr after ENH-140 |
| **FOLLOWUP: op #8 pivot to pack-defaults iteration** | install-service iterates `packs/*/PACK.json` for `defaults[].pin: true` and seeds pins.json dynamically (removes the hardcoded WDD URL literal that Sprint 15 left as transitional) | 🟡 P2 — depends on owner picking direction | ~1 hr |

## Open questions needing Geoff's input

| Question | Priority |
|---|---|
| Sprint 16 theme — which carry-forwards to commit to vs defer? BUG-119 quit-crash fix is the lowest-effort, highest-visibility win; ENH-137 Beginner's Guide needs owner draft as the gating input. | Start of Sprint 16 |
| **ENH-118 image-type handling** — animate GIFs by default vs freeze first-frame Slack-style? SVG safety review owed? HEIC/RAW reject vs convert? | Before Sprint 16 picks up any image-polish work |
| **ENH-101 expand/collapse chord semantic** — rail-collapse (new behavior orthogonal to ⌘⌥0/9) vs full-screen (redundant; kill the chord)? | When the chord re-surfaces |
| Stage 17a.5 directions A/E (template gallery / registry) | Before any code work on templates |
| BUG-024 follow-up — combine Send → Duo + Comment pills (single split-pill or hover flyout)? | Before further selection-pill iteration |
| Backlinks panel / graph view (Obsidian cluster) — anchor for a future sprint? Or defer further? | When wikilinks-autocomplete usage tells us whether the next-tier capability has demand |

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

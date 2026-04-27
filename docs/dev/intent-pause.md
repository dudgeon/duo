# Intent pause — Stage 21 signed-cut toolchain

**Filed:** 2026-04-27 (post-v0.4.0 cut, mid-sprint course-correct)
**Status:** Plan complete; pre-execution. Post-compact agent: read this end-to-end before any tool call.

## Reframe (the whole reason for this pause)

The owner course-corrected hard mid-sprint:

1. **The output of this work is NOT a single signed binary.** It's a refined, battle-tested toolchain + process that works reliably AND produces an app with no regressions, encoded in a skill.
2. **All exploration belongs off main** until the toolchain is proven.

I had been hammering at the codesign error trying to ship one DMG. That's the wrong artifact. Restart with the right shape of deliverable.

## Repository state at compact time

- **Main branch:** clean at `25a799d` (v0.4.0 release commit). Pushed. GitHub Release v0.4.0 exists with unsigned DMGs.
- **Working branch:** `stage-21-signing-toolchain`, one commit `d8ffac7` ("wip(stage-21): exploration of Sequoia codesign issue") capturing tonight's exploration that did NOT produce a working signed DMG. NOT pushed. Hold it as the starting point for execution.
- **Cert artifacts:** all in place per `docs/dev/cert-procurement.md`. Apple Developer Program ✓, Developer ID Application cert in macOS keychain ✓, App Store Connect API key at `~/Documents/duo-private/AuthKey_T8VVN9GF4M.p8` ✓, Team ID `R39EF29X3Y` ✓, env vars in `~/Documents/duo-private/.env` ✓.

## Learnings from tonight's exploration

| Finding | Impact on plan |
|---|---|
| **CSC_NAME format gotcha**: electron-builder rejects the `Developer ID Application: ` prefix even though that's macOS keychain's canonical form. Strip in script. | Already fixed in branch's `scripts/dist-signed.sh`. Keep. |
| **Cert resolution works.** Identity hash `25BCF46EBADAACE530ABB71260CF57BA6040C06B`. Keychain "Always Allow" from v0.2.0 persisted; no prompt fired tonight. | FOLLOWUP-005 keychain prompt is still a real risk on a fresh machine; document in skill, don't try to work around it. |
| **`com.apple.provenance` is the wall.** macOS Sequoia 15.x adds this as a **system-protected** xattr automatically applied to most binaries. `xattr -d` reports success but the attr persists. `xattr -cr` clears it momentarily but Sequoia re-applies before `codesign` reads the file. `ditto --norsrc --noextattr --noacl` strips at copy time but provenance comes back on disk. | This is the actual problem. Plan must address it head-on. |
| **afterPack hook ran but didn't help.** `[afterPack] xattrs/rsrc/acl stripped via ditto on .../Duo.app` logged successfully, then codesign failed milliseconds later with the same provenance error. Sequoia re-applies between hook return and codesign call. | afterPack alone is insufficient. Need either: (a) Sequoia-aware codesign wrapper that strips per-call right before each codesign, OR (b) bypass electron-builder's signing entirely. |
| **electron-builder 26.8.1 has the Sequoia fix per release notes** — but 26.x's bundled `@electron/rebuild` conflicts with our existing `electron-rebuild` postinstall. Naively upgrading produces `node-gyp` "paths[0] argument must be of type string. Received undefined" error. | Path A (upgrade) needs the postinstall conflict resolved. Worth trying first because it's the cleanest if it works. |
| **`scripts/dist-signed.sh`** runs the env-driven flow correctly. The wrapper logic is sound; the failure is downstream in electron-builder's codesign call. | Keep the wrapper shape; refine the codesign step. |

## Plan to execute (post-compact)

### Goal

A reproducible, regression-free signed-cut toolchain that lives in a skill, not in tribal knowledge. Definition of done at the bottom.

### Phase 1 — Make signing work on the branch (NOT main)

Try paths in order. Stop at the first one that produces a verifiable signed + notarized DMG.

**Path A — Upgrade electron-builder 24 → 26 cleanly.**
- Resolve the `electron-rebuild` postinstall conflict: remove the explicit `electron-rebuild` dep, let 26.x's bundled `@electron/rebuild` handle it (or pin a compatible electron-rebuild version).
- Address any yml schema drift (some fields renamed/relocated in 26.x — check the migration notes).
- Re-run `bash scripts/dist-signed.sh`. Hope 26.x's Sequoia codesign fix Just Works.

**Path B — Stay on 24.x, replace electron-builder's signing with a custom flow.**
- electron-builder 24.x builds the unpacked `.app` cleanly via `npm run pack`. We just need to replace its `signApp` / `notarize` steps.
- New `scripts/sign-and-notarize.js` invokes `@electron/osx-sign` directly with options: `optionsForFile` callback that strips xattrs immediately before each codesign call (per-binary, in a tight loop so Sequoia doesn't re-add between strip and sign).
- Notarize via `xcrun notarytool submit --wait --apple-id <APPLE_API_KEY_ID> --team-id $APPLE_TEAM_ID --key $APPLE_API_KEY --key-id $APPLE_API_KEY_ID`.
- Staple via `xcrun stapler staple`.
- Wrap into DMG via `electron-builder --prepackaged dist/mac-arm64/Duo.app` (electron-builder skips signing if the app is already signed). Or write the DMG manually with `hdiutil`.

**Path C — Pure-shell signing (always-works fallback).**
- Build unsigned via `CSC_IDENTITY_AUTO_DISCOVERY=false npm run pack`.
- Bash script: walk the .app bundle inside-out (Helpers first, then `.app` itself), for each binary: `xattr -c <file>; codesign --remove-signature <file>; codesign --sign $CSC_NAME --options runtime --entitlements build/entitlements.mac.plist --timestamp <file>`. Tight `xattr -c → codesign` pairing minimizes the Sequoia re-application window.
- Notarize + staple as Path B.
- DMG via `hdiutil create` from the signed .app.

**Stop condition:** signed DMG passes all three of `codesign --verify --deep --strict --verbose=2`, `spctl -a -t open --context context:primary-signature -vv`, `xcrun stapler validate`.

### Phase 2 — Regression-verify the signed app

Mount the signed DMG, drag `Duo.app` to `/Applications`, double-click to launch. Walk this matrix:

1. **First-launch experience.** No Gatekeeper warning ("Apple cannot check it for malicious software"). App opens directly to splash → main window.
2. **Terminal pane.** Default tab spawns; PTY echoes typing; ⌘T from terminal focus opens new claude tab; `claude` actually launches with the priming shim (verify by checking `~/.claude/duo/bin/claude` is on PATH inside the spawned shell).
3. **Browser pane.** Default landing renders (FAQ from `~/.claude/duo/help/faq.html` after install, or bundle path before).
4. **Canvas tab.** Open `~/.claude/duo/help/canvas-actions-demo.html` from the file tree (after running install). Click each `data-duo-action` button; Stage 23 actions fire (claude:spawn opens new tab, terminal:send writes payload, browser:open opens URL).
5. **Markdown editor.** ⌘N opens new-file interstitial; commit `foo.md`; type some markdown; ⌘S saves.
6. **Keyboard shortcut family (preventative architecture, v0.3.0).** ⌘T, ⌘N, ⌃Tab, ⌘W, ⌘B, ⌘`, ⌘L all fire from canvas focus and editor focus (the BUG-012/013/014 family).
7. **Install banner.** Click [Install] on a fresh `~/.claude/` (or after deleting `installed.json`); confirm skill, agent, help files, CLI binary, priming shim, SessionStart hook all install. Banner success state shows for ~3s then auto-dismisses.
8. **Stage 22 dual-pane navigator.** "Your Claude settings" pane up top with curated three (CLAUDE.md, skills/, agents/) + Show all toggle. "Project Claude context" group above the regular tree when applicable.
9. **GitHub update checker.** Banner appears IF the GH latest tag > running version. (For a v0.4.0-signed cut against a v0.4.0 GH release, no banner expected. For v0.4.1-signed against v0.4.0 latest, no banner. For v0.4.0-signed if v0.5.0 ever ships later, banner appears.)
10. **`duo` CLI.** From a Duo terminal: `duo --version` returns `0.4.0` (or whatever we cut). `duo external https://capitalone.com` triggers Stage 25 banner.
11. **Theme toggle.** "system" mode reads OS preference (BUG-017 fix from v0.3.1).
12. **Preventative kb-shortcut: dual editor.** Open both a markdown editor and a canvas tab. Walk shortcuts from each. ⌘⇧V (paste-as-plain-text) fires in both.

Any regression here = signing broke something. Diagnose before merging. Common culprits: hardenedRuntime entitlement misses (PTY spawn blocked, file-system access blocked), notarization stripping helper binaries.

### Phase 3 — Encode in a skill

Two options:

**Option A — Extend `cut-version` skill** with a "Step 4.5 alt — signed cut" branch. Existing Step 4.5 is the unsigned path; add a parallel branch the user can invoke when ready to ship a signed release.

**Option B — New sibling skill `sign-and-notarize`** that the cut-version skill delegates to. Cleaner separation; the signed flow is its own concern.

I'll pick B if the signing flow is meaningfully more than 30 lines of decision tree; A if it fits cleanly inside cut-version.

The skill captures:
- Env var sourcing from `~/Documents/duo-private/.env`
- `CSC_NAME` prefix-strip logic
- Path A/B/C selection (whichever won in Phase 1)
- afterPack hook pattern if we kept it
- Validation sequence (`scripts/validate-signed-dmg.sh`)
- **Failure modes**: keychain prompt timeout (FOLLOWUP-005), notarization timeout, notarization rejection, xattr re-application, cert renewal cadence (Developer ID Application certs expire; what to do when)
- **"What changed in macOS Sequoia" appendix** so the next operator (human or AI) doesn't waste a session rediscovering `com.apple.provenance`

### Phase 4 — Repeatability test

- `git clean -fdx dist/`
- Open a fresh shell (no env state leaked from this session)
- Run the skill end-to-end
- Pass: produces signed + notarized DMG that passes Phase 2 smoke, with zero manual interventions beyond the documented one-time keychain prompt
- Fail: skill needs more inputs than documented → iterate

### Phase 5 — Land on main

- Squash or rebase `stage-21-signing-toolchain` so it lands as one or two clean commits (drop the `wip` commit; ship the polished toolchain)
- Decide: **bump to v0.4.1** (signed release as a version bump) OR **replace v0.4.0 release assets** (same content, just signed). Default: cut v0.4.1 — release assets are harder to swap and downloaders may have cached v0.4.0 unsigned.
- Update CHANGELOG / RELEASES / ROADMAP / `docs/roadmap.html` / faq.html / what-duo-does.html for "Stage 21 ✅"
- Update `cert-procurement.md` with "Sequoia compatibility notes" appendix
- Run the cut-version skill (now signed-flow-aware) for v0.4.1
- Push tag, attach DMGs to GH release
- Update README install URLs to v0.4.1 (or to whatever version we cut)
- Move this `intent-pause.md` to `docs/dev/intent-conversations/2026-04-27-stage-21-signing.md` as the resolution artifact

## Files to read first post-compact

1. **This file** — `docs/dev/intent-pause.md` (you're reading it)
2. **`docs/dev/cert-procurement.md`** — cert artifacts location + state
3. **`scripts/dist-signed.sh`** (on `stage-21-signing-toolchain` branch) — current wrapper
4. **`scripts/electron-builder-afterPack.js`** (on branch) — current afterPack hook
5. **`electron-builder.yml`** (on branch) — current yml with afterPack wired
6. **`.claude/skills/cut-version/SKILL.md`** — existing cut skill to potentially extend

## Definition of done

1. ✅ `stage-21-signing-toolchain` branch produces a signed + notarized DMG via documented script invocation
2. ✅ Signed DMG passes `codesign --verify --deep --strict`, `spctl -a -t open --context context:primary-signature`, `xcrun stapler validate`
3. ✅ Signed app boots without Gatekeeper warning and passes the Phase 2 smoke matrix end-to-end
4. ✅ Skill encodes the process; Phase 4 repeatability test passes
5. ✅ Branch merges cleanly to main; main contains the toolchain + Stage 21 ✅ in roadmap
6. ✅ GitHub Release for v0.4.0 (or v0.4.1, depending on Phase 5 decision) carries the signed DMGs
7. ✅ This intent-pause.md migrates to `docs/dev/intent-conversations/` as a resolution artifact
8. ✅ Future Claude sessions can cut a signed release by invoking the skill — no rediscovery, no improvisation

## Open questions

- **Path A vs B vs C decision**: depends on what Phase 1 surfaces. Default: A first.
- **Bump to v0.4.1 or replace v0.4.0 assets**: lean v0.4.1 (cleaner release semantics).
- **electron-builder dep version**: stay 24 if Path B/C wins; upgrade if A.
- **Skill placement**: extend `cut-version` (A) or new `sign-and-notarize` (B). Decide after Phase 1 reveals how complex the flow actually is.

## Out of scope

- Auto-update channel (still v0.5.0+)
- Stage 14a markdown comments
- Stage 18b distro skill packs
- BUG-006 browser-pane Send→Duo pill (still pending design decision)
- Notarization caching / parallel signing optimizations

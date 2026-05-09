# Resume Sprint 12 — handoff to local Claude

> **Transient file.** This was written by the cloud Claude session
> that shipped Sprint 12 (PR #45, merged to main). Geoff's next
> local session uses it to pick up the smoke walk and the cut.
> **Delete this file as your last commit before tagging the cut**
> (see § Cleanup at the bottom). It is intentionally NOT linked
> from CLAUDE.md so it doesn't outlive its purpose.

## Context (one paragraph)

Sprint 12 shipped three things on top of the existing v0.6.10 work:
**ENH-111** image-viewer chrome (toolbar, zoom, pan, copy, context
menu — new file `renderer/components/ImageView.tsx` plus two new
IPCs: `files.stat` and `clipboard.writeImage`); **BUG-108** the
markdown table-cell-copy fix (new extension
`renderer/components/editor/extensions/TableCellCopy.ts`); and
**ENH-115** terminal-tab right-click → "Reveal in navigator" (small
addition in `TabBar.tsx` + `App.tsx`). Code is on `main` (PR #45
merged). Typecheck was clean at commit time. Cloud session had no
computer-use surface so the smoke walk is owed.

## What's owed

1. Walk the smoke-walk page and parse the user's results.
2. Fix any FAILs (small targeted fixes, not a re-do).
3. Run the `cut-version` skill for v0.6.10.

## Resume sequence

### 1. Pre-flight (mirrors smoke-walk skill § 4)

```bash
ps -ef | grep "MacOS/Electron \." | grep -v grep | awk '{print $2}'
```

- **Zero matches:** start dev:
  ```bash
  npm run dev   # via Bash run_in_background:true
  ```
  Then poll until the bridge is up:
  ```bash
  until duo doctor 2>&1 | grep -q "Unix socket"; do sleep 2; done
  ```
- **Exactly one match:** check whether it's the packed app
  (path contains `/Applications/Duo.app` or `dist/mac-arm64/`)
  vs a dev (path contains `node_modules/electron`). Packed app
  → quit it and start dev. Dev → adopt it; the new IPCs need
  a fresh main process so restart it (kill + spawn per CLAUDE.md
  § 7a) since this is BEFORE the user starts walking.
- **Two or more:** stop, name the PIDs, ask the user which to
  keep (mirrors the violated-2026-05-04 carve-out in the
  smoke-walk skill).

### 2. Verify the app is clean (smoke-walk § 5b)

```bash
duo doctor       # CLI version matches app version
duo nav-state    # renderer alive at IPC layer
```

If you have computer-use, `request_access` for Electron + screenshot
+ scan for any error overlay (React red panel, ErrorBoundary
fallback). If anything looks wrong, fix it before handoff.

If you don't have computer-use, exercise the walk's first
failure-prone step yourself via the CLI — for BUG-108 (which is
walk item 1) that's `duo edit /tmp/preflight-bug108.md` to mount
MarkdownEditor. If the editor mounts (file appears as a tab,
`duo url` matches), proceed. If not, root-cause first.

### 3. Open the smoke walk page

```bash
duo open docs/dev/smoke-walks/v0.6.10-sprint12.html
```

Verify focus landed on the page:

```bash
duo url      # should be file://...v0.6.10-sprint12.html
duo title    # should be "Smoke walk v0.6.10 · Sprint 12"
```

### 4. Hand off to Geoff

Brief — page is the spec:

> Smoke walk page is open as a browser tab. 3 items: BUG-108 first
> (table cell copy), ENH-111 second (image viewer), ENH-115 third
> (terminal-tab Reveal in navigator). Mark Pass/Fail, add notes,
> hit Send to Claude or Copy results.

### 5. Parse + react

When Geoff pastes results back:

- For each `[PASS]`: tasks.md entry stays ✅. No action.
- For each `[FAIL]`: re-open tasks.md entry, flip to 🟡, prepend
  user-verified failure note + today's date. Add to
  `docs/dev/active-sprint.md` carry-over section.
- For each `[SKIP]`: ask Geoff whether to defer or re-walk.

If everything passed → propose `cut-version` skill.
If anything failed → fix-and-recut. Re-walk for the same version
is fine.

## Sprint 12 file map (where the changes live)

```
shared/types.ts                                            # FILES_STAT + CLIPBOARD_WRITE_IMAGE constants
shared/host-api.ts                                         # FileStatResult type + ElectronFilesAPI.stat + ElectronClipboardAPI.writeImage
electron/files-service.ts                                  # FilesService.stat()
electron/main.ts                                           # FILES_STAT + CLIPBOARD_WRITE_IMAGE handlers, nativeImage import
electron/preload.ts                                        # files.stat + clipboard.writeImage bridges
renderer/components/ImageView.tsx                          # NEW — image viewer v2 (ENH-111)
renderer/components/FileRenderers.tsx                      # ImagePreview removed (graduated to ImageView.tsx)
renderer/components/WorkingPane.tsx                        # ImagePreview → ImageView import swap
renderer/components/TabBar.tsx                             # onContextMenu on Tab + onRevealCwd prop (ENH-115)
renderer/App.tsx                                           # onRevealCwd wiring (nav.actions.navigateTo + setRevealChip)
renderer/components/editor/extensions/TableCellCopy.ts     # NEW — clipboardTextSerializer for intra-table slices (BUG-108)
renderer/components/editor/MarkdownEditor.tsx              # TableCellCopy import + use (after TableShortcuts)
docs/dev/smoke-walks/v0.6.10-sprint12.json                 # walk manifest
docs/dev/smoke-walks/v0.6.10-sprint12.html                 # generated walk page (gitignored — regenerate if missing)
tasks.md                                                   # ENH-115 filed; BUG-108 closed
docs/dev/active-sprint.md                                  # Sprint 12 status section updated
```

If the generated HTML is missing locally:

```bash
node .claude/skills/worksheet/generate.mjs \
  docs/dev/smoke-walks/v0.6.10-sprint12.json \
  docs/dev/smoke-walks/v0.6.10-sprint12.html
```

(The smoke-walk skill calls `.claude/skills/smoke-walk/generate.mjs`
which delegates to the worksheet generator with smoke-walk
defaults.)

## Cleanup

When the cut completes (v0.6.10 tagged, RELEASES.md updated, the
post-cut version bump committed per `cut-version` skill § Step 7):

```bash
git rm RESUME.md
git commit -m "chore: remove RESUME.md handoff after v0.6.10 cut"
```

Don't forget. This file should not survive the sprint that
created it.

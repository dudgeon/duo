// Stage 21c Phase 1 — electron-updater integration.
//
// What this does
// --------------
//
// On every app launch (packaged builds only), check GitHub Releases for
// a newer signed Duo build. If one exists, download it in the
// background and prompt the user to install on next quit. The native
// Electron update dialogs are decent enough for v1 — no custom UI in
// this phase (Phase 1.5 / Phase 2 can replace them with a banner-
// integrated experience).
//
// Why this lives next to update-checker.ts (not as a replacement)
// ---------------------------------------------------------------
//
// `update-checker.ts` (shipped v0.4.0) is a thin GH-Releases-API banner
// — it surfaces "vX.Y.Z is available" and links to the GitHub release
// page so the user can re-download manually. It works on UNSIGNED
// builds because it doesn't try to verify or install the new binary.
//
// `electron-updater` (this file, Stage 21c) is the real auto-update
// path: signature-verifies the new build against the current cert
// chain, swaps it on next quit, restarts. Requires the running build
// to be signed (so the signed-update verification chain is rooted) —
// v0.4.1 onwards qualifies; v0.4.0 users will need one manual upgrade
// to v0.4.1 before auto-update kicks in.
//
// Both layers can run in parallel without conflict: update-checker is
// the informational banner; electron-updater handles the download +
// install. If electron-updater downloads silently before the banner
// renders, no harm — they're observing the same release independently.
// In a future phase we can wire them together (have the banner show
// "Downloaded — restart to install" once electron-updater finishes).
//
// What's required for this to actually work
// -----------------------------------------
//
// 1. The current running build must be SIGNED (Stage 21a). On macOS,
//    electron-updater verifies the new build's Developer ID matches
//    the running app's. If the running app is unsigned, verification
//    fails and the update is rejected.
//
// 2. `electron-builder.yml` must have a `publish:` block configured
//    with `provider: github` and the repo coordinates. This makes
//    `npm run dist` produce a `latest-mac.yml` file alongside the DMG
//    — the metadata file electron-updater fetches to know what's
//    available. The cut-version skill uploads `latest-mac.yml` to the
//    GH Release alongside the DMGs.
//
// 3. The GH Release must be PUBLISHED (not draft). electron-updater
//    queries `repos/dudgeon/duo/releases/latest`, which only returns
//    the latest *published* release.
//
// Failure modes (all non-fatal — silent + logged)
// -----------------------------------------------
//
// - Network down → silent
// - GH 5xx → silent
// - latest-mac.yml missing on the release → "no update available"
// - Signature mismatch → "Update has been rejected" in console
// - User says "Later" on the install prompt → install on next quit

import { app } from 'electron'

let started = false

/** Initialize electron-updater. Idempotent — safe to call once after
 *  `app.whenReady()`. Skipped in dev mode (`!app.isPackaged`) since
 *  there's no signed build to update from. */
export function initAutoUpdater(): void {
  if (started) return
  started = true

  if (!app.isPackaged) {
    console.log('[auto-updater] skipped (dev mode — no signed build to update from)')
    return
  }

  // Lazy import — pulling electron-updater into the main bundle in dev
  // mode adds startup cost for no benefit. Importing inside the
  // packaged-only branch keeps dev launches snappy.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { autoUpdater } = require('electron-updater') as typeof import('electron-updater')

  // Default to console-style logging. electron-updater accepts any
  // logger-shaped object; using console keeps it visible in
  // `~/Library/Logs/Duo/main.log` (Electron's default main-process log
  // target on packaged macOS apps).
  autoUpdater.logger = console

  // Background download once available; prompt to install on next
  // user-initiated quit. autoInstallOnAppQuit = true means even if the
  // user never sees a dialog, the next time they quit Duo cleanly the
  // installed-but-not-applied update kicks in.
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('error', (err) => {
    console.error('[auto-updater] error:', err?.message ?? err)
  })

  autoUpdater.on('checking-for-update', () => {
    console.log('[auto-updater] checking-for-update')
  })

  autoUpdater.on('update-available', (info) => {
    console.log('[auto-updater] update-available:', info?.version)
  })

  autoUpdater.on('update-not-available', (info) => {
    console.log('[auto-updater] update-not-available — running latest:', info?.version)
  })

  autoUpdater.on('download-progress', (progress) => {
    const pct = Math.round(progress.percent)
    console.log(`[auto-updater] download ${pct}% (${progress.transferred}/${progress.total} bytes)`)
  })

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[auto-updater] update-downloaded:', info?.version,
      '— will install on next quit (or sooner if user clicks Restart)')
  })

  // `checkForUpdatesAndNotify()` does the network check AND surfaces
  // the native macOS dialog when a download completes ("Restart Duo
  // to install update?"). For v1 that's our entire UI surface; future
  // phases can replace this with `checkForUpdates()` + custom banner.
  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    console.error('[auto-updater] initial check failed:', err?.message ?? err)
  })
}

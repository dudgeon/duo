// Stage 21 — afterPack hook to strip extended attributes from the
// packaged .app before electron-builder signs it.
//
// macOS Sequoia (15.x) added a system-protected xattr
// `com.apple.provenance` that's automatically applied to most
// binaries and can't be removed by user processes (`xattr -d` reports
// success but the attr stays). codesign rejects it with:
//
//   resource fork, Finder information, or similar detritus not allowed
//
// The standard workaround is `ditto --norsrc --noextattr --noacl`,
// which re-creates the bundle file by file via a copy that doesn't
// preserve any of the rejected metadata. The new files don't carry
// the provenance attr because they're created fresh.
//
// We do this in two steps to avoid the source-equals-destination
// case ditto rejects:
//   1. ditto into a sibling tmp dir
//   2. rm -rf the original
//   3. mv the tmp into place

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

exports.default = async function afterPack(context) {
  const appOutDir = context.appOutDir
  if (!appOutDir) return

  let entries
  try {
    entries = fs.readdirSync(appOutDir)
  } catch (err) {
    console.warn('[afterPack] cannot readdir appOutDir:', err.message)
    return
  }

  const apps = entries.filter(name => name.endsWith('.app'))
  if (apps.length === 0) return

  for (const appName of apps) {
    const appPath = path.join(appOutDir, appName)
    const tmpPath = appPath + '.xattr-strip-tmp'
    try {
      // ditto recreates the bundle without xattrs / resource forks /
      // ACLs. The new files have no com.apple.provenance because
      // they're freshly created by ditto.
      execSync(`ditto --norsrc --noextattr --noacl "${appPath}" "${tmpPath}"`)
      execSync(`rm -rf "${appPath}"`)
      execSync(`mv "${tmpPath}" "${appPath}"`)
      console.log(`[afterPack] xattrs/rsrc/acl stripped via ditto on ${appPath}`)
    } catch (err) {
      console.warn(`[afterPack] ditto-strip failed on ${appPath}:`, err.message)
      // Best-effort; if this fails, codesign will likely fail too.
      // Try removing the tmp dir if it's stranded.
      try { execSync(`rm -rf "${tmpPath}"`) } catch { /* ignore */ }
    }
  }
}

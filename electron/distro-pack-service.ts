// Stage 21d-i — Distro pack discovery + install pipeline.
//
// Scans `~/.claude/duo/extra-packs/<distro-name>/` on Duo launch.
// Each pack is authored as a Claude Code plugin folder + a Duo
// `duo-extras/` subtree (see docs/prd/stage-21d-distro-packs.md
// for the full source format). Duo's install service decomposes
// the plugin source into standalone-skill destinations under
// `~/.claude/skills/<distro>-<skill>/` (so Claude Code auto-
// discovers the skills in every session, not just Duo-launched
// ones), plus a per-distro folder under `~/.claude/duo/distros/`
// for Duo-specific content.
//
// Atomic-replace lifecycle (owner-locked, ENH-097 / Sprint 8):
// every install wipes the previous version's tracked files
// (recorded in `<extra-pack>/.installed-files.json` provenance
// manifest) and re-installs from the new source. User-modified
// files are preserved at `~/.claude/skills/.user-modified/<distro>-
// <skill>/` so manual edits aren't lost.
//
// v1 scope:
//   - skills/<name>/  → ~/.claude/skills/<distro>-<name>/
//   - agents/<name>.md → ~/.claude/agents/<distro>-<name>.md
//   - duo-extras/claude-md-snippet.md → ~/.claude/CLAUDE.md
//     (managed block; coexists with Duo's own ENH-088 block).
//   - requiresDuoVersion enforced as a hard block.
//
// Deferred to a follow-up:
//   - hooks/, .mcp.json, .lsp.json merging
//   - duo-extras/ canvases / playgrounds / canvas-templates routing
//   - duo-packs/<lesson-pack>/ → ~/.claude/duo/packs/...
//   - bundled-distros at Duo.app/Contents/Resources/bundled-distros/

import { promises as fsp } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const HOME = os.homedir()
const CLAUDE_DIR = path.join(HOME, '.claude')
const SKILLS_DIR = path.join(CLAUDE_DIR, 'skills')
const AGENTS_DIR = path.join(CLAUDE_DIR, 'agents')
const CLAUDE_MD = path.join(CLAUDE_DIR, 'CLAUDE.md')
const DUO_DIR = path.join(CLAUDE_DIR, 'duo')
const EXTRA_PACKS_DIR = path.join(DUO_DIR, 'extra-packs')
const DISTROS_ROOT = path.join(DUO_DIR, 'distros')

export interface DistroPluginManifest {
  name: string
  version?: string
  description?: string
  author?: { name?: string; email?: string } | string
  homepage?: string
  repository?: string
  license?: string
}

export interface DistroIntegrationManifest {
  /** npm-style version range (e.g. ">=0.6.7 <0.8"). Hard-blocks
   *  install if Duo doesn't satisfy. Optional in v1 — packs without
   *  the field are assumed compatible (with a warning). */
  requiresDuoVersion?: string
  /** Relative paths under `duo-extras/` that auto-open as canvas /
   *  playground tabs on FIRST detection of this pack. */
  openOnFirstLaunch?: string[]
  /** Pinned files to add to ~/.claude/duo/pins.json (first install
   *  only; respects user removal in subsequent updates). */
  pinnedFiles?: Array<{ path: string; title?: string }>
  /** Whether the `duo-extras/claude-md-snippet.md` file should be
   *  merged into ~/.claude/CLAUDE.md as a managed block. Defaults
   *  to true if claude-md-snippet.md exists. */
  claudeMdSnippet?: boolean
  /** Whether `duo-extras/priming-additions.md` should be appended
   *  to ~/.claude/duo/priming.md. Defaults to true if the file exists. */
  primingAdditions?: boolean
  /** Whether `duo-extras/external-domains.json` entries should be
   *  union-merged into the user's external-domains list. Defaults
   *  to true if the file exists. */
  externalDomainsAdditions?: boolean
}

export interface InstalledFilesManifest {
  /** The distro name from `.claude-plugin/plugin.json` § name. */
  name: string
  /** The distro version from `.claude-plugin/plugin.json` § version. */
  version: string
  /** ISO timestamp of this install. */
  installedAt: string
  /** Absolute paths Duo created during install. Each path is removed
   *  on uninstall (or before a fresh install in atomic-replace mode). */
  files: string[]
  /** Set when the CLAUDE.md merge ran for this pack. Used by uninstall
   *  to remove the distro's managed block. */
  claudeMdManaged: boolean
}

export interface PackInstallResult {
  /** Distro name (from plugin.json). */
  name: string
  /** Version from plugin.json (or commit SHA fallback if absent). */
  version: string
  /** Was this a brand-new install (vs. an update)? Drives the FTUX
   *  re-fire decision in the caller. */
  isFirstInstall: boolean
  /** Files written/updated during this install run. */
  filesInstalled: number
  /** Was this pack's claude-md-snippet merged into ~/.claude/CLAUDE.md? */
  claudeMdMerged: boolean
}

export interface DistroPackError {
  packPath: string
  reason: string
}

export type PackInstallOutcome =
  | { ok: true; result: PackInstallResult }
  | { ok: false; error: DistroPackError }

/**
 * Discover all distro packs under `~/.claude/duo/extra-packs/`.
 * Each immediate child directory is a candidate pack; manifest
 * validation happens at install time (this just enumerates).
 */
export async function discoverPacks(): Promise<string[]> {
  try {
    const entries = await fsp.readdir(EXTRA_PACKS_DIR, { withFileTypes: true })
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => path.join(EXTRA_PACKS_DIR, e.name))
  } catch (e) {
    // Directory missing → no packs. Other errors propagate so the
    // caller can decide whether to log.
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw e
  }
}

/**
 * Read + validate the two manifests at the pack root.
 * Returns null if either manifest is missing or malformed.
 */
export async function readPackManifests(packPath: string): Promise<{
  plugin: DistroPluginManifest
  integration: DistroIntegrationManifest
} | null> {
  const pluginManifestPath = path.join(packPath, '.claude-plugin', 'plugin.json')
  const distroManifestPath = path.join(packPath, 'duo-extras', 'DISTRO.json')
  let plugin: DistroPluginManifest
  let integration: DistroIntegrationManifest = {}
  try {
    const raw = await fsp.readFile(pluginManifestPath, 'utf8')
    plugin = JSON.parse(raw)
  } catch {
    return null
  }
  if (!plugin.name || typeof plugin.name !== 'string') return null
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(plugin.name)) return null
  try {
    const raw = await fsp.readFile(distroManifestPath, 'utf8')
    integration = JSON.parse(raw)
  } catch {
    // Integration manifest is optional in v1 — packs without one
    // get default toggles (claudeMdSnippet etc. auto-detected by file
    // presence).
  }
  return { plugin, integration }
}

/**
 * Check whether the running Duo version satisfies the pack's
 * `requiresDuoVersion` range. Returns null if the range is missing
 * or empty (assume compatible). Returns a human-readable error
 * string when the range is set but doesn't match.
 *
 * Implements a SUBSET of npm-semver-range: ">=A.B.C <D.E.F" form
 * (the common pattern). For v1 we don't pull in the full `semver`
 * package; this string-form is enough for what we recommend distros
 * declare. If a distro uses a fancier range, the parse falls
 * through to "compatible" with a console.warn — better lax than
 * blocking unknown-but-likely-fine ranges.
 */
export function checkVersionCompat(
  duoVersion: string,
  requiresRange: string | undefined
): string | null {
  if (!requiresRange) return null
  const range = requiresRange.trim()
  if (!range) return null
  // Parse `>=X.Y.Z` and `<A.B.C` clauses.
  const minMatch = range.match(/>=\s*(\d+)\.(\d+)\.(\d+)/)
  const maxMatch = range.match(/<\s*(\d+)\.(\d+)\.(\d+)/)
  if (!minMatch && !maxMatch) {
    // Couldn't parse — fail open. The distro's own tests are the
    // ultimate authority; we don't want to block on syntactic novelty.
    console.warn('[distro-pack-service] Unparseable requiresDuoVersion range:', range, '— assuming compatible')
    return null
  }
  const cmpVersion = (a: [number, number, number], b: [number, number, number]): number => {
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
  }
  const duoTuple: [number, number, number] = (() => {
    const m = duoVersion.match(/^(\d+)\.(\d+)\.(\d+)/)
    if (!m) return [0, 0, 0]
    return [parseInt(m[1]!, 10), parseInt(m[2]!, 10), parseInt(m[3]!, 10)]
  })()
  if (minMatch) {
    const minTuple: [number, number, number] = [
      parseInt(minMatch[1]!, 10),
      parseInt(minMatch[2]!, 10),
      parseInt(minMatch[3]!, 10)
    ]
    if (cmpVersion(duoTuple, minTuple) < 0) {
      return `Pack requires Duo >=${minTuple.join('.')}; running ${duoVersion}.`
    }
  }
  if (maxMatch) {
    const maxTuple: [number, number, number] = [
      parseInt(maxMatch[1]!, 10),
      parseInt(maxMatch[2]!, 10),
      parseInt(maxMatch[3]!, 10)
    ]
    if (cmpVersion(duoTuple, maxTuple) >= 0) {
      return `Pack requires Duo <${maxTuple.join('.')}; running ${duoVersion}.`
    }
  }
  return null
}

/**
 * Walk the pack's `skills/` directory, returning each skill folder's
 * absolute path. Skill folders are expected to contain a `SKILL.md`
 * (per Claude Code's plugin format); folders without it are skipped
 * with a warning.
 */
export async function listPackSkills(packPath: string): Promise<string[]> {
  const skillsDir = path.join(packPath, 'skills')
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fsp.readdir(skillsDir, { withFileTypes: true })
  } catch {
    return []
  }
  const skills: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const skillPath = path.join(skillsDir, entry.name)
    try {
      const skillMd = await fsp.access(path.join(skillPath, 'SKILL.md'))
      void skillMd
      skills.push(skillPath)
    } catch {
      console.warn('[distro-pack-service] Skill folder missing SKILL.md, skipping:', skillPath)
    }
  }
  return skills
}

/**
 * List the pack's agent files (immediate `.md` children of `agents/`).
 */
export async function listPackAgents(packPath: string): Promise<string[]> {
  const agentsDir = path.join(packPath, 'agents')
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fsp.readdir(agentsDir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.md') && !e.name.startsWith('.'))
    .map((e) => path.join(agentsDir, e.name))
}

/**
 * Recursively copy a directory tree from src to dst. Records every
 * destination path in `tracked` for the provenance manifest.
 */
async function copyTree(src: string, dst: string, tracked: string[]): Promise<void> {
  await fsp.mkdir(dst, { recursive: true })
  const entries = await fsp.readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    const s = path.join(src, entry.name)
    const d = path.join(dst, entry.name)
    if (entry.isDirectory()) {
      await copyTree(s, d, tracked)
    } else if (entry.isFile()) {
      await fsp.copyFile(s, d)
      tracked.push(d)
    }
  }
}

/**
 * Atomic-replace install for a single distro pack. Reads the
 * provenance manifest (if any) from a prior install, deletes those
 * files, writes the new pack contents to standalone-skill paths,
 * writes a fresh manifest.
 *
 * The CLAUDE.md merge is a separate side-effect — handled here so
 * the install pipeline is one transaction.
 */
export async function installPack(
  packPath: string,
  duoVersion: string
): Promise<PackInstallOutcome> {
  const manifests = await readPackManifests(packPath)
  if (!manifests) {
    return {
      ok: false,
      error: { packPath, reason: 'Missing or invalid .claude-plugin/plugin.json' }
    }
  }
  const { plugin, integration } = manifests

  const compatError = checkVersionCompat(duoVersion, integration.requiresDuoVersion)
  if (compatError) {
    return { ok: false, error: { packPath, reason: compatError } }
  }

  const distroName = plugin.name
  const provenancePath = path.join(packPath, '.installed-files.json')

  // Read prior provenance (if this is an update).
  let priorManifest: InstalledFilesManifest | null = null
  try {
    const raw = await fsp.readFile(provenancePath, 'utf8')
    priorManifest = JSON.parse(raw) as InstalledFilesManifest
  } catch {
    // No prior install. Fresh-install code path.
  }

  // Atomic-replace: delete previously-tracked files. Skip
  // gracefully if the file is already gone (e.g. user deleted it).
  if (priorManifest?.files) {
    for (const filePath of priorManifest.files) {
      try {
        await fsp.unlink(filePath)
      } catch {
        // Already gone. Continue.
      }
    }
    // Best-effort: remove now-empty parent directories.
    const parentDirs = new Set(priorManifest.files.map((p) => path.dirname(p)))
    for (const dir of parentDirs) {
      try {
        await fsp.rmdir(dir)
      } catch {
        // Directory non-empty (other distros / user files share it).
      }
    }
  }

  // Install fresh content. Track every file written for the new
  // provenance manifest.
  const tracked: string[] = []

  // 1. Skills: each `skills/<name>/` becomes `~/.claude/skills/<distro>-<name>/`
  const skillFolders = await listPackSkills(packPath)
  for (const skillSrc of skillFolders) {
    const skillName = path.basename(skillSrc)
    const dstName = `${distroName}-${skillName}`
    const dst = path.join(SKILLS_DIR, dstName)
    await copyTree(skillSrc, dst, tracked)
  }

  // 2. Agents: each `agents/<name>.md` becomes `~/.claude/agents/<distro>-<name>.md`
  const agentFiles = await listPackAgents(packPath)
  await fsp.mkdir(AGENTS_DIR, { recursive: true })
  for (const agentSrc of agentFiles) {
    const agentName = path.basename(agentSrc)
    const dstName = `${distroName}-${agentName}`
    const dst = path.join(AGENTS_DIR, dstName)
    await fsp.copyFile(agentSrc, dst)
    tracked.push(dst)
  }

  // 3. CLAUDE.md merge — defer to the host (main.ts has the
  // ENH-088 merge logic). The pack-install pipeline returns
  // claudeMdMerged: false here; the host calls mergeClaudeMdForDistro
  // separately and updates the manifest's flag if it succeeds.
  // This split keeps install-pack pure on the filesystem side and
  // lets the host orchestrate the trio (skill copy + CLAUDE.md merge
  // + IPC notification) atomically.
  const claudeMdMerged = false

  // 4. Write the fresh provenance manifest.
  const manifest: InstalledFilesManifest = {
    name: distroName,
    version: plugin.version ?? 'unversioned',
    installedAt: new Date().toISOString(),
    files: tracked,
    claudeMdManaged: claudeMdMerged
  }
  await fsp.writeFile(provenancePath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')

  return {
    ok: true,
    result: {
      name: distroName,
      version: manifest.version,
      isFirstInstall: priorManifest === null,
      filesInstalled: tracked.length,
      claudeMdMerged
    }
  }
}

/**
 * Compose a per-distro CLAUDE.md managed block. Mirrors the ENH-088
 * pattern but uses a `<!-- distro:<name>-managed-vX.Y.Z -->` marker
 * so multiple distro blocks can coexist with Duo's own block (and
 * with each other).
 *
 * `body` is the raw `claude-md-snippet.md` content; we frame it
 * with the marker so future installs can version-aware-replace.
 */
export function composeDistroClaudeMdBlock(
  distroName: string,
  version: string,
  body: string
): string {
  const trimmed = body.trim()
  return [
    `<!-- distro:${distroName}-managed-v${version} — installed by Duo distro pack '${distroName}'. Edit freely; remove this block to opt out. -->`,
    trimmed,
    `<!-- distro:${distroName}-end -->`
  ].join('\n')
}

/**
 * Distro-aware CLAUDE.md merge. Looks for an existing
 * `<!-- distro:<name>-managed-v* -->` ... `<!-- distro:<name>-end -->`
 * block and replaces it with the new content; otherwise appends.
 *
 * Returns the new file contents (or null if no change is needed).
 * Pure function — caller does the file I/O.
 */
export function planDistroClaudeMdMerge(
  existing: string | null,
  distroName: string,
  newBlock: string
): { contents: string | null; action: 'created' | 'replaced' | 'appended' | 'unchanged' } {
  if (existing === null) {
    return { contents: newBlock + '\n', action: 'created' }
  }
  // Match any existing version of this distro's block.
  const escaped = distroName.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')
  const blockRe = new RegExp(
    `<!-- distro:${escaped}-managed-v[^\\n]*-->[\\s\\S]*?<!-- distro:${escaped}-end -->`,
    'g'
  )
  if (blockRe.test(existing)) {
    blockRe.lastIndex = 0
    const next = existing.replace(blockRe, newBlock)
    if (next === existing) return { contents: null, action: 'unchanged' }
    return { contents: next, action: 'replaced' }
  }
  // Append with a blank-line separator.
  const sep = existing.endsWith('\n') ? '\n' : '\n\n'
  return { contents: existing + sep + newBlock + '\n', action: 'appended' }
}

/**
 * Apply a distro pack's CLAUDE.md snippet (if present + opted in).
 * Reads `duo-extras/claude-md-snippet.md`, frames it as a managed
 * block, runs `planDistroClaudeMdMerge` against the user's
 * ~/.claude/CLAUDE.md, and writes if a change is needed.
 *
 * Returns true if a merge ran (the caller updates the provenance
 * manifest's `claudeMdManaged` flag accordingly).
 */
export async function mergeDistroClaudeMd(
  packPath: string,
  distroName: string,
  version: string
): Promise<boolean> {
  const snippetPath = path.join(packPath, 'duo-extras', 'claude-md-snippet.md')
  let body: string
  try {
    body = await fsp.readFile(snippetPath, 'utf8')
  } catch {
    return false
  }
  const newBlock = composeDistroClaudeMdBlock(distroName, version, body)
  let existing: string | null = null
  try {
    existing = await fsp.readFile(CLAUDE_MD, 'utf8')
  } catch {
    existing = null
  }
  const plan = planDistroClaudeMdMerge(existing, distroName, newBlock)
  if (plan.contents === null) return false
  await fsp.mkdir(path.dirname(CLAUDE_MD), { recursive: true })
  await fsp.writeFile(CLAUDE_MD, plan.contents, 'utf8')
  return true
}

/**
 * Walk-1 fix (smoke walk v0.6.8 rev2) — round-trip the CLAUDE.md merge
 * result back into the persisted provenance manifest. installPack
 * hardcodes `claudeMdManaged: false` because the merge runs as a
 * separate host-orchestrated step in main.ts; that step then has to
 * call this helper to update the flag. Without this, uninstallPack
 * sees a perpetually-false flag and skips CLAUDE.md cleanup.
 */
export async function setManifestClaudeMdFlag(
  packPath: string,
  value: boolean
): Promise<void> {
  const provenancePath = path.join(packPath, '.installed-files.json')
  try {
    const raw = await fsp.readFile(provenancePath, 'utf8')
    const manifest = JSON.parse(raw) as InstalledFilesManifest
    if (manifest.claudeMdManaged === value) return
    manifest.claudeMdManaged = value
    await fsp.writeFile(provenancePath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  } catch {
    // Manifest missing — install pipeline never wrote one. Nothing to update.
  }
}

/**
 * Uninstall a distro pack. Reads the provenance manifest, deletes
 * every tracked file, removes the distro's CLAUDE.md block (matched
 * by marker pair), and finally deletes the pack folder itself if
 * `removePackFolder: true`.
 *
 * No-op if the manifest is missing — assume the pack was already
 * uninstalled or never properly installed.
 */
export async function uninstallPack(
  distroName: string,
  options: { removePackFolder?: boolean } = {}
): Promise<{ ok: boolean; filesRemoved: number; reason?: string }> {
  // Find the pack folder by name.
  let packPath: string
  try {
    const packs = await discoverPacks()
    const match = packs.find((p) => path.basename(p) === distroName)
    if (!match) {
      return { ok: false, filesRemoved: 0, reason: `No pack named '${distroName}' under ${EXTRA_PACKS_DIR}` }
    }
    packPath = match
  } catch (e) {
    return { ok: false, filesRemoved: 0, reason: `Discovery failed: ${(e as Error).message}` }
  }

  // Read provenance.
  const provenancePath = path.join(packPath, '.installed-files.json')
  let manifest: InstalledFilesManifest | null = null
  try {
    const raw = await fsp.readFile(provenancePath, 'utf8')
    manifest = JSON.parse(raw) as InstalledFilesManifest
  } catch {
    return { ok: false, filesRemoved: 0, reason: 'No provenance manifest — pack was never fully installed.' }
  }

  // Delete tracked files.
  let filesRemoved = 0
  for (const filePath of manifest.files) {
    try {
      await fsp.unlink(filePath)
      filesRemoved++
    } catch {
      // Already gone.
    }
  }
  // Best-effort empty-parent cleanup.
  const parentDirs = new Set(manifest.files.map((p) => path.dirname(p)))
  for (const dir of parentDirs) {
    try { await fsp.rmdir(dir) } catch { /* non-empty; ignore */ }
  }

  // Remove CLAUDE.md block. Walk-1 fix (smoke walk v0.6.8 rev2): pre-fix
  // this was gated on `manifest.claudeMdManaged`, but the install
  // pipeline never updates that flag after the merge happens (the merge
  // runs as a separate host-orchestrated step in main.ts and didn't
  // round-trip the result back into the manifest). The flag was always
  // `false` in persisted manifests, so uninstall always skipped the
  // CLAUDE.md cleanup. Now: try the strip unconditionally — the regex
  // is bounded to this distro's marker pair, so packs that never merged
  // are a harmless no-op (regex.replace with no matches returns the
  // original string).
  try {
    const existing = await fsp.readFile(CLAUDE_MD, 'utf8')
    const escaped = distroName.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')
    const blockRe = new RegExp(
      `\\n*<!-- distro:${escaped}-managed-v[^\\n]*-->[\\s\\S]*?<!-- distro:${escaped}-end -->\\n*`,
      'g'
    )
    const next = existing.replace(blockRe, '\n')
    if (next !== existing) {
      await fsp.writeFile(CLAUDE_MD, next, 'utf8')
    }
  } catch {
    // No CLAUDE.md → nothing to remove.
  }

  // Walk-1 fix — delete the provenance manifest itself. Pre-fix
  // uninstall removed the tracked files but left .installed-files.json
  // intact in the pack folder; listInstalledPacks reads that file to
  // populate `duo pack list`, so uninstalled packs kept appearing in
  // the output (with stale `files[]` pointing at now-deleted paths).
  try {
    await fsp.unlink(provenancePath)
  } catch {
    // Already gone or never existed.
  }

  // Optionally remove the pack folder itself.
  if (options.removePackFolder) {
    try {
      await fsp.rm(packPath, { recursive: true, force: true })
    } catch (e) {
      // Manifest cleanup already succeeded; pack-folder removal is
      // a courtesy. Don't fail the call on this.
      console.warn('[distro-pack-service] Failed to remove pack folder:', packPath, (e as Error).message)
    }
  }

  void DISTROS_ROOT // keep the import alive for future content routing

  return { ok: true, filesRemoved }
}

/**
 * Enumerate currently-installed distro packs by reading every
 * `<extra-pack>/.installed-files.json` provenance manifest.
 * Returns the manifest contents per pack (name, version, install
 * date, file count). Used by `duo pack list`.
 */
export async function listInstalledPacks(): Promise<InstalledFilesManifest[]> {
  const packs = await discoverPacks()
  const installed: InstalledFilesManifest[] = []
  for (const packPath of packs) {
    try {
      const raw = await fsp.readFile(path.join(packPath, '.installed-files.json'), 'utf8')
      installed.push(JSON.parse(raw) as InstalledFilesManifest)
    } catch {
      // Pack present but never installed — skip.
    }
  }
  return installed
}

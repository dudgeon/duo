// Stage 18 — first-launch self-install service.
//
// Bootstraps a fresh user's ~/.claude/ tree for Duo:
//   - skill/SKILL.md + skill/examples + skill/references → ~/.claude/skills/duo/
//   - agents/duo.md → ~/.claude/agents/duo.md
//   - external-domains.json bootstrap (only if absent — never clobber)
//   - help/*.html → ~/.claude/duo/help/ (so users can customize their
//     reference HTMLs; the bundle copy still works as a fallback)
//   - installed.json provenance file at ~/.claude/duo/installed.json
//
// Idempotent: re-running on an already-installed system overwrites the
// skill + subagent + help files (useful for upgrades) and rewrites
// installed.json with the current Duo version. external-domains.json
// is preserved verbatim — it can hold user-specific customizations.
//
// Deferred to Stage 18 Phase 2:
//   - cli/duo install onto a sandbox-safe PATH location. The
//     sandbox-tolerant transport ADR has notes on candidate paths
//     (~/.local/bin/duo vs /usr/local/bin/duo); deciding requires a
//     post-install PATH check and possibly a shell-rc snippet.
//
// Source paths use app.getAppPath() so the same code runs in dev
// (project root) and prod (asar root, with extraResources for the
// canonical skill/, agents/, cli/ directories that ship outside asar).

import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { app } from 'electron'
import type { InstallStatus, InstallResult } from '../shared/types'

const HOME = os.homedir()
const DUO_DIR = path.join(HOME, '.claude', 'duo')
const SKILLS_DUO_DIR = path.join(HOME, '.claude', 'skills', 'duo')
const AGENTS_DIR = path.join(HOME, '.claude', 'agents')
const INSTALLED_PATH = path.join(DUO_DIR, 'installed.json')
const EXTERNAL_DOMAINS_PATH = path.join(DUO_DIR, 'external-domains.json')
const HELP_DEST_DIR = path.join(DUO_DIR, 'help')

interface InstalledFile {
  version: string
  installedAt: string
}

export class InstallService {
  async status(): Promise<InstallStatus> {
    try {
      const raw = await fs.readFile(INSTALLED_PATH, 'utf8')
      const parsed = JSON.parse(raw) as Partial<InstalledFile>
      if (!parsed.version || !parsed.installedAt) {
        // Malformed provenance — treat as not-installed so the user
        // gets the consent banner and we rewrite cleanly.
        return { installed: false }
      }
      return {
        installed: true,
        version: parsed.version,
        installedAt: parsed.installedAt,
        needsUpdate: parsed.version !== app.getVersion()
      }
    } catch {
      return { installed: false }
    }
  }

  async run(): Promise<InstallResult> {
    try {
      const sourceRoot = this.sourceRoot()
      await fs.mkdir(DUO_DIR, { recursive: true })
      await fs.mkdir(SKILLS_DUO_DIR, { recursive: true })
      await fs.mkdir(path.join(SKILLS_DUO_DIR, 'examples'), { recursive: true })
      await fs.mkdir(path.join(SKILLS_DUO_DIR, 'references'), { recursive: true })
      await fs.mkdir(AGENTS_DIR, { recursive: true })
      await fs.mkdir(HELP_DEST_DIR, { recursive: true })

      // skill/SKILL.md → ~/.claude/skills/duo/SKILL.md
      await this.copyIfPresent(
        path.join(sourceRoot, 'skill', 'SKILL.md'),
        path.join(SKILLS_DUO_DIR, 'SKILL.md')
      )
      await this.copyDirContents(
        path.join(sourceRoot, 'skill', 'examples'),
        path.join(SKILLS_DUO_DIR, 'examples')
      )
      await this.copyDirContents(
        path.join(sourceRoot, 'skill', 'references'),
        path.join(SKILLS_DUO_DIR, 'references')
      )

      // agents/duo.md → ~/.claude/agents/duo.md
      await this.copyIfPresent(
        path.join(sourceRoot, 'agents', 'duo.md'),
        path.join(AGENTS_DIR, 'duo.md')
      )

      // help/*.html → ~/.claude/duo/help/*.html. User can customize the
      // installed copies; the bundle copies remain as a fallback.
      await this.copyDirContents(
        path.join(sourceRoot, 'help'),
        HELP_DEST_DIR
      )

      // external-domains.json — bootstrap only. Never clobber a user's
      // existing list.
      try {
        await fs.access(EXTERNAL_DOMAINS_PATH)
      } catch {
        await fs.writeFile(EXTERNAL_DOMAINS_PATH, JSON.stringify({ domains: [] }, null, 2) + '\n')
      }

      // Provenance — last write wins. Updated on every successful run
      // so an upgrade flow re-stamps the version + timestamp.
      const provenance: InstalledFile = {
        version: app.getVersion(),
        installedAt: new Date().toISOString()
      }
      await fs.writeFile(INSTALLED_PATH, JSON.stringify(provenance, null, 2) + '\n')

      return {
        ok: true,
        status: {
          installed: true,
          version: provenance.version,
          installedAt: provenance.installedAt,
          needsUpdate: false
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, error: msg }
    }
  }

  // In dev (`npm run dev`), source files live next to package.json at
  // app.getAppPath(). In prod (asar bundle), help/ ships inside the
  // asar at the same relative path; skill/, agents/, and cli/ ship as
  // extraResources at process.resourcesPath. We try the asar path
  // first (dev + prod-help), fall back to resourcesPath for the
  // extraResources tree.
  private sourceRoot(): string {
    return app.getAppPath()
  }

  private resourcesRoot(): string | null {
    return process.resourcesPath || null
  }

  // Copy a single file if the source exists. Silently skips when the
  // source is missing — lets the install succeed in dev environments
  // that don't have every directory populated.
  private async copyIfPresent(src: string, dest: string): Promise<void> {
    let resolved = src
    try {
      await fs.access(resolved)
    } catch {
      // Try resourcesPath fallback for the extraResources tree (skill,
      // agents, cli — they're outside asar in production).
      const res = this.resourcesRoot()
      if (!res) return
      resolved = path.join(res, path.basename(path.dirname(src)), path.basename(src))
      try {
        await fs.access(resolved)
      } catch {
        return
      }
    }
    await fs.mkdir(path.dirname(dest), { recursive: true })
    await fs.copyFile(resolved, dest)
  }

  private async copyDirContents(srcDir: string, destDir: string): Promise<void> {
    let resolved = srcDir
    try {
      await fs.access(resolved)
    } catch {
      const res = this.resourcesRoot()
      if (!res) return
      // For extraResources, electron-builder mirrors the directory name
      // (e.g. extraResources `from: skill/ to: skill/` lands at
      // `<resources>/skill/`). The basename of the source is what we
      // try.
      resolved = path.join(res, path.basename(srcDir))
      try {
        await fs.access(resolved)
      } catch {
        return
      }
    }
    await fs.mkdir(destDir, { recursive: true })
    const entries = await fs.readdir(resolved, { withFileTypes: true })
    for (const e of entries) {
      const s = path.join(resolved, e.name)
      const d = path.join(destDir, e.name)
      if (e.isDirectory()) {
        await this.copyDirContents(s, d)
      } else if (e.isFile()) {
        await fs.copyFile(s, d)
      }
    }
  }
}

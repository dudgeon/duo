// Stage 18 — first-launch self-install service.
//
// Bootstraps a fresh user's ~/.claude/ tree for Duo:
//   - skill/SKILL.md + skill/examples + skill/references → ~/.claude/skills/duo/
//   - agents/duo.md → ~/.claude/agents/duo.md
//   - external-domains.json bootstrap (only if absent — never clobber)
//   - help/*.html → ~/.claude/duo/help/ (so users can customize their
//     reference HTMLs; the bundle copy still works as a fallback)
//   - installed.json provenance file at ~/.claude/duo/installed.json
//   - cli/duo binary → ~/.local/bin/duo (Phase 2; chmod 755) plus a
//     PATH check so the banner can surface a shell-rc hint when needed
//
// Idempotent: re-running on an already-installed system overwrites the
// skill + subagent + help files + CLI binary (useful for upgrades) and
// rewrites installed.json with the current Duo version. external-
// domains.json is preserved verbatim — it can hold user-specific
// customizations.
//
// Why ~/.local/bin/duo (not /usr/local/bin/duo): no sudo required,
// user-owned, conventional XDG-style location, and works equally well
// inside Claude Code's Seatbelt sandbox (the sandbox restricts socket
// connections, not PATH lookups). The trade-off is that ~/.local/bin
// isn't on macOS zsh's default PATH, so we surface a one-line shell-rc
// snippet when we detect the gap.
//
// Source paths use app.getAppPath() so the same code runs in dev
// (project root) and prod (asar root, with extraResources for the
// canonical skill/, agents/, cli/ directories that ship outside asar).

import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { app } from 'electron'
import type { InstallStatus, InstallResult, CliInstallStatus } from '../shared/types'

const HOME = os.homedir()
const DUO_DIR = path.join(HOME, '.claude', 'duo')
const SKILLS_DUO_DIR = path.join(HOME, '.claude', 'skills', 'duo')
const AGENTS_DIR = path.join(HOME, '.claude', 'agents')
const INSTALLED_PATH = path.join(DUO_DIR, 'installed.json')
const EXTERNAL_DOMAINS_PATH = path.join(DUO_DIR, 'external-domains.json')
const HELP_DEST_DIR = path.join(DUO_DIR, 'help')
const CLI_DEST_DIR = path.join(HOME, '.local', 'bin')
const CLI_DEST_PATH = path.join(CLI_DEST_DIR, 'duo')

interface InstalledFile {
  version: string
  installedAt: string
  /** Phase 2 — track where we put the binary so a future uninstall /
   *  status check can find it. Recorded as the resolved absolute path
   *  rather than `~/...` so changes to $HOME don't break readback. */
  cliPath?: string
}

export class InstallService {
  async status(): Promise<InstallStatus> {
    const cli = await this.cliStatus()
    try {
      const raw = await fs.readFile(INSTALLED_PATH, 'utf8')
      const parsed = JSON.parse(raw) as Partial<InstalledFile>
      if (!parsed.version || !parsed.installedAt) {
        // Malformed provenance — treat as not-installed so the user
        // gets the consent banner and we rewrite cleanly.
        return { installed: false, cli }
      }
      return {
        installed: true,
        version: parsed.version,
        installedAt: parsed.installedAt,
        needsUpdate: parsed.version !== app.getVersion(),
        cli
      }
    } catch {
      return { installed: false, cli }
    }
  }

  /**
   * Phase 2 — independent of installed.json so the renderer can
   * surface PATH-missing hints even after the user has run install
   * (the binary could land at ~/.local/bin/duo successfully but the
   * user may still need to update their shell-rc).
   */
  async cliStatus(): Promise<CliInstallStatus> {
    let installed = false
    try {
      await fs.access(CLI_DEST_PATH, fs.constants.X_OK)
      installed = true
    } catch {
      installed = false
    }
    return {
      installed,
      path: installed ? CLI_DEST_PATH : undefined,
      onPath: this.isOnPath(CLI_DEST_DIR)
    }
  }

  /**
   * Check whether `targetDir` (an absolute path) is in the user's
   * shell $PATH at app boot. Note: Electron's `process.env.PATH` on
   * macOS reflects the LaunchServices-launched environment, which
   * may differ from a fresh shell's PATH (e.g. .zshrc-set entries
   * are absent because LaunchServices doesn't load .zshrc). For this
   * check we want what a freshly-spawned PTY would see — and PtyManager
   * spawns with `process.env`, so this matches the binary's actual
   * runtime visibility. False here = "user's CLI invocations from a
   * Duo terminal won't find duo" (worth a banner hint).
   */
  private isOnPath(targetDir: string): boolean {
    const pathEnv = process.env.PATH || ''
    const target = path.resolve(targetDir)
    return pathEnv.split(':').some(segment => {
      if (!segment) return false
      try {
        return path.resolve(segment) === target
      } catch {
        return false
      }
    })
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

      // Phase 2 — copy cli/duo to ~/.local/bin/duo, chmod 755.
      // Best-effort: if the binary copy fails (e.g. cli/duo missing
      // in dev because someone hasn't run `npm run build:cli`), the
      // skill+agent install still succeeds and we just report cli as
      // not installed in the result.
      const cli = await this.installCli()

      // Provenance — last write wins. Updated on every successful run
      // so an upgrade flow re-stamps the version + timestamp. Records
      // the CLI install path so later checks know where to look.
      const provenance: InstalledFile = {
        version: app.getVersion(),
        installedAt: new Date().toISOString(),
        cliPath: cli.installed ? cli.path : undefined
      }
      await fs.writeFile(INSTALLED_PATH, JSON.stringify(provenance, null, 2) + '\n')

      return {
        ok: true,
        status: {
          installed: true,
          version: provenance.version,
          installedAt: provenance.installedAt,
          needsUpdate: false,
          cli
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, error: msg }
    }
  }

  /**
   * Phase 2 — copy cli/duo to ~/.local/bin/duo, chmod 0o755.
   *
   * Source: <sourceRoot>/cli/duo in dev, <resourcesPath>/cli/duo in
   * prod (cli/ ships as extraResources). Best-effort: a missing
   * source (e.g. cli/duo not built yet) returns `installed: false`
   * rather than throwing — lets the rest of the install succeed.
   */
  private async installCli(): Promise<CliInstallStatus> {
    const candidates: string[] = []
    candidates.push(path.join(app.getAppPath(), 'cli', 'duo'))
    const res = this.resourcesRoot()
    if (res) candidates.push(path.join(res, 'cli', 'duo'))

    let source: string | null = null
    for (const c of candidates) {
      try {
        await fs.access(c)
        source = c
        break
      } catch {
        continue
      }
    }
    if (!source) {
      return {
        installed: false,
        onPath: this.isOnPath(CLI_DEST_DIR)
      }
    }

    try {
      await fs.mkdir(CLI_DEST_DIR, { recursive: true })
      await fs.copyFile(source, CLI_DEST_PATH)
      await fs.chmod(CLI_DEST_PATH, 0o755)
      return {
        installed: true,
        path: CLI_DEST_PATH,
        onPath: this.isOnPath(CLI_DEST_DIR)
      }
    } catch {
      return {
        installed: false,
        onPath: this.isOnPath(CLI_DEST_DIR)
      }
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

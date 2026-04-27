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
//   - skill/priming.md → ~/.claude/duo/priming.md (Stage 19b; bootstrap
//     only — never clobber user edits)
//   - PATH shim at ~/.claude/duo/bin/claude (Stage 19b; PRD D6/D12–D14):
//     load-bearing priming mechanism. Every PTY Duo spawns prepends
//     `~/.claude/duo/bin` to PATH so any `claude` invocation inside a
//     Duo terminal hits this wrapper, which `exec`s the real binary
//     with `--append-system-prompt "$(cat ~/.claude/duo/priming.md)"`.
//     Outside Duo (no `DUO_SESSION` env) the shim is a transparent
//     pass-through. Real-claude path is resolved via a login shell at
//     install time and inlined into the script.
//   - SessionStart hook merged into ~/.claude/settings.json (Stage 19b;
//     idempotent; tagged with `_duo` marker so we can find + replace
//     our own entry without touching anyone else's hooks). This is a
//     redundant safety net — Claude Code session hooks are not always
//     reliable (users disable them, settings.json gets reset, hook
//     execution can be skipped under certain CLI flags), so the shim
//     above is the load-bearing mechanism. The hook just `cat`s
//     priming.md as a belt-and-suspenders second injection; if both
//     fire, the priming text appears twice in the system prompt
//     (harmless additive context).
//
// Idempotent: re-running on an already-installed system overwrites the
// skill + subagent + help files + CLI binary + shim (useful for
// upgrades) and rewrites installed.json with the current Duo version.
// external-domains.json + priming.md are preserved verbatim — they
// can hold user-specific customizations.
//
// PRD spec note (Stage 19b D13): the PRD draft used a hypothetical
// `--append-system-prompt-file <path>` flag. That flag doesn't exist
// in Claude Code's CLI; only `--append-system-prompt <inline-string>`
// does. The shim therefore inlines the priming content via
// `"$(cat …)"` command-substitution — safe because the substituted
// value is passed as a single argv entry (no further shell parsing).
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
import { execFile } from 'child_process'
import { promisify } from 'util'
import { app } from 'electron'
import type { InstallStatus, InstallResult, CliInstallStatus, PrimingInstallStatus } from '../shared/types'
import { SHIM_DIR } from './constants'

const execFileAsync = promisify(execFile)

const HOME = os.homedir()
const DUO_DIR = path.join(HOME, '.claude', 'duo')
const SKILLS_DUO_DIR = path.join(HOME, '.claude', 'skills', 'duo')
const AGENTS_DIR = path.join(HOME, '.claude', 'agents')
const INSTALLED_PATH = path.join(DUO_DIR, 'installed.json')
const EXTERNAL_DOMAINS_PATH = path.join(DUO_DIR, 'external-domains.json')
const HELP_DEST_DIR = path.join(DUO_DIR, 'help')
const CLI_DEST_DIR = path.join(HOME, '.local', 'bin')
const CLI_DEST_PATH = path.join(CLI_DEST_DIR, 'duo')
const PRIMING_PATH = path.join(DUO_DIR, 'priming.md')
const PINS_PATH = path.join(DUO_DIR, 'pins.json')
const SETTINGS_PATH = path.join(HOME, '.claude', 'settings.json')
const SHIM_PATH = path.join(SHIM_DIR, 'claude')

// Stage 19b — duo-managed SessionStart hook marker. The `_duo` field
// is sibling to `hooks` inside the array entry so Claude Code's hook
// runtime ignores it (it only reads recognized fields), and our
// installer can find + replace our own entry without touching others.
// The version suffix lets future installs detect "old duo entry,
// replace it" vs "current — leave alone".
const HOOK_MARKER_KEY = '_duo'
const HOOK_MARKER_PREFIX = 'managed-v'

// The hook command itself: when DUO_SESSION is set (we're inside a
// Duo PTY), cat the priming file. The `2>/dev/null || true` keeps
// the hook from breaking SessionStart if priming.md has been deleted
// — better to skip priming than fail the session start.
const HOOK_COMMAND = `[ -n "$DUO_SESSION" ] && cat "$HOME/.claude/duo/priming.md" 2>/dev/null || true`

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
    const priming = await this.primingStatus()
    try {
      const raw = await fs.readFile(INSTALLED_PATH, 'utf8')
      const parsed = JSON.parse(raw) as Partial<InstalledFile>
      if (!parsed.version || !parsed.installedAt) {
        // Malformed provenance — treat as not-installed so the user
        // gets the consent banner and we rewrite cleanly.
        return { installed: false, cli, priming }
      }
      return {
        installed: true,
        version: parsed.version,
        installedAt: parsed.installedAt,
        needsUpdate: parsed.version !== app.getVersion(),
        cli,
        priming
      }
    } catch {
      return { installed: false, cli, priming }
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
      //
      // v0.4.0 — seed default off-host patterns. Cap One AIP cohort:
      // Trailblazers' Cap One web surfaces require the corporate-managed
      // browser for SSO + internal CDN certs + conditional access, and
      // don't render reliably in Duo's embedded WebContentsView; auto-
      // routing them saves a "wait, this didn't work, let me copy
      // the URL" round-trip.
      //
      // ENH-009 (v0.4.3) — expand the seeded list to cover the daily-
      // driver SaaS apps that Trailblazers (and most enterprise users)
      // hit constantly: Slack, Gmail + Google Workspace, Atlassian
      // (Jira/Confluence), Microsoft 365. All have SSO + conditional
      // access patterns that fight embedded browsers; routing them to
      // the user's system browser sidesteps those failure modes
      // entirely.
      //
      // Caveat for upgrades: bootstrap is "only-if-absent", so existing
      // users with a populated external-domains.json from a prior
      // version DON'T pick up the expanded list automatically. They can
      // either edit the file by hand or `rm ~/.claude/duo/external-
      // domains.json && relaunch` to re-bootstrap with the new list.
      // Stage 21e-iii (v0.5.0) will add an additive-merge upgrade path.
      try {
        await fs.access(EXTERNAL_DOMAINS_PATH)
      } catch {
        const defaults = {
          domains: [
            // Cap One AIP (existing default; v0.4.0)
            '*.capitalone.com',
            // ENH-009 (v0.4.3)
            '*.slack.com',
            'mail.google.com',
            'docs.google.com',
            'drive.google.com',
            'calendar.google.com',
            'meet.google.com',
            'chat.google.com',
            'accounts.google.com',
            '*.atlassian.net',
            '*.microsoftonline.com',
          ]
        }
        await fs.writeFile(EXTERNAL_DOMAINS_PATH, JSON.stringify(defaults, null, 2) + '\n')
      }

      // Stage 19b — priming.md bootstrap. Only write if absent so
      // re-installs don't clobber a user-edited copy. The bundled
      // copy at app.getAppPath()/skill/priming.md is the source.
      try {
        await fs.access(PRIMING_PATH)
      } catch {
        await this.copyIfPresent(
          path.join(sourceRoot, 'skill', 'priming.md'),
          PRIMING_PATH
        )
      }

      // ENH-003 (v0.3.1) — bootstrap pins.json with FAQ + What Duo
      // Does pre-pinned. Bootstrap-only: never clobber a user's
      // existing pin set. Pin URLs use the user-installed help copies
      // at `~/.claude/duo/help/*.html` (which we just installed
      // above) so they match `BrowserManager.defaultLandingUrl`
      // post-install. Until the user actually opens those tabs, the
      // pins are inert metadata; once they're opened, the strip
      // renders them with the pin glyph + sorts to leftmost.
      try {
        await fs.access(PINS_PATH)
      } catch {
        const faqUrl = `file://${path.join(HELP_DEST_DIR, 'faq.html')}`
        const wddUrl = `file://${path.join(HELP_DEST_DIR, 'what-duo-does.html')}`
        const defaultPins = {
          version: 1,
          pins: [
            { kind: 'browser', ref: faqUrl, title: 'Duo — FAQ' },
            { kind: 'browser', ref: wddUrl, title: 'Duo — What Duo Does' }
          ]
        }
        await fs.writeFile(PINS_PATH, JSON.stringify(defaultPins, null, 2) + '\n')
      }

      // Stage 19b — SessionStart hook merge. Idempotent: replaces our
      // own duo-tagged entry on re-run; leaves any non-Duo
      // SessionStart entries untouched. Reported back via priming
      // status (hookConflict surfaces "you have other hooks too").
      // Hook is the redundant safety net — see installShim() below
      // for the load-bearing priming path.
      await this.installSessionStartHook()

      // Stage 19b — PATH shim. Load-bearing priming mechanism. We
      // resolve real-claude via a login shell (so .zshrc PATH
      // additions are picked up) and inline the absolute path into
      // the shim script. If real-claude can't be resolved we skip the
      // shim install entirely; the SessionStart hook still gives the
      // session some priming, and the install banner can surface
      // "Claude Code not detected on PATH" so the user can fix and
      // re-install. Best-effort: shim install errors are non-fatal.
      try {
        await this.installShim()
      } catch {
        // Don't let a shim failure block the rest of the install.
        // Reported back via primingStatus().shimInstalled = false.
      }

      // Phase 2 — copy cli/duo to ~/.local/bin/duo, chmod 755.
      // Best-effort: if the binary copy fails (e.g. cli/duo missing
      // in dev because someone hasn't run `npm run build:cli`), the
      // skill+agent install still succeeds and we just report cli as
      // not installed in the result.
      const cli = await this.installCli()

      // Read priming status fresh so the result reflects what we
      // actually installed (hook merge could have hit a conflict).
      const priming = await this.primingStatus()

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
          cli,
          priming
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, error: msg }
    }
  }

  /**
   * Stage 19b — read priming state. Independent of installed.json so
   * we can detect "user deleted priming.md by hand" or "user edited
   * settings.json and removed our hook" cleanly. Also reads back the
   * real-claude path the shim was built against (or undefined if the
   * shim is absent / unreadable).
   */
  async primingStatus(): Promise<PrimingInstallStatus> {
    let primingFile = false
    try {
      await fs.access(PRIMING_PATH)
      primingFile = true
    } catch {
      primingFile = false
    }

    let shimInstalled = false
    let realClaudePath: string | undefined
    try {
      await fs.access(SHIM_PATH, fs.constants.X_OK)
      shimInstalled = true
      // Best-effort read of the inlined real-claude path so the
      // banner can show "shim wrapping <path>" if useful for debug.
      const shimContent = await fs.readFile(SHIM_PATH, 'utf8')
      const m = shimContent.match(/^REAL_CLAUDE='([^']+)'/m)
      if (m) realClaudePath = m[1]
    } catch {
      shimInstalled = false
    }

    let hookInstalled = false
    let hookVersion: string | undefined
    let hookConflict = false
    try {
      const raw = await fs.readFile(SETTINGS_PATH, 'utf8')
      const settings = JSON.parse(raw) as Record<string, unknown>
      const hooks = settings.hooks as Record<string, unknown> | undefined
      const sessionStart = hooks?.SessionStart
      if (Array.isArray(sessionStart)) {
        for (const entry of sessionStart) {
          if (entry && typeof entry === 'object') {
            const e = entry as Record<string, unknown>
            const marker = e[HOOK_MARKER_KEY]
            if (typeof marker === 'string' && marker.startsWith(HOOK_MARKER_PREFIX)) {
              hookInstalled = true
              hookVersion = marker
            } else {
              // Some other SessionStart hook present — note the
              // conflict so we can surface "your priming will run
              // alongside whatever else you had" in the banner.
              hookConflict = true
            }
          }
        }
      }
    } catch {
      // Settings file absent or malformed — leave defaults.
    }

    return { primingFile, shimInstalled, realClaudePath, hookInstalled, hookVersion, hookConflict }
  }

  /**
   * Stage 19b — install the load-bearing PATH shim at SHIM_PATH.
   *
   * 1. Resolve real-claude via a login shell so the user's .zshrc
   *    PATH additions are picked up (Electron's process.env.PATH on
   *    macOS is the LaunchServices PATH, which doesn't include
   *    .zshrc-set entries like ~/.local/bin).
   * 2. Filter out our own shim path (defensive — if the user has
   *    somehow added SHIM_DIR to their global PATH, `which claude`
   *    might point at us).
   * 3. Write the shim script with the resolved path inlined; chmod
   *    0o755. Atomic via tmp + rename so a partial write doesn't
   *    leave a broken executable on PATH.
   * 4. If real-claude can't be resolved, throw — the caller treats
   *    this as non-fatal and the priming status will report
   *    shimInstalled=false.
   */
  private async installShim(): Promise<void> {
    const realClaude = await this.resolveRealClaude()
    if (!realClaude) {
      // Don't install a broken shim that would shadow whatever the
      // user installs later. Better to be absent than wrong.
      // Clean up any prior install so we don't leave a stale shim
      // that points at an old path.
      try { await fs.unlink(SHIM_PATH) } catch { /* not present — fine */ }
      throw new Error('Claude Code not found on PATH; shim install skipped')
    }

    // Shell-quote the real-claude path defensively in case it contains
    // characters that would confuse `exec`. Single-quote the literal,
    // and escape any embedded single quotes via the standard
    // '\'' break-out trick. (In practice the path comes from `which`
    // and is unlikely to contain special chars, but cheap insurance.)
    const escapedReal = realClaude.replace(/'/g, "'\\''")
    const shimContent = `#!/bin/sh
# duo-managed PATH shim — installed by Duo's first-launch installer.
# Wraps the real \`claude\` binary so sessions launched inside a Duo
# PTY arrive with Duo-aware system-prompt context.
#
# Mechanism: when DUO_SESSION is set (set by Duo's PtyManager on every
# spawned shell), exec real-claude with --append-system-prompt
# pointing at the contents of ~/.claude/duo/priming.md. Outside Duo
# (no DUO_SESSION) this is a transparent pass-through.
#
# Re-run the install banner to refresh the inlined real-claude path
# after upgrading Claude Code or moving its binary. Safe to delete;
# Duo will re-create it on next install.

REAL_CLAUDE='${escapedReal}'
PRIMING_FILE="$HOME/.claude/duo/priming.md"

# Outside Duo, or priming missing/unreadable → pass through unchanged.
if [ -z "$DUO_SESSION" ] || [ ! -r "$PRIMING_FILE" ]; then
  exec "$REAL_CLAUDE" "$@"
fi

# Inside Duo: wrap with --append-system-prompt. The "$(cat …)"
# substitution passes the file contents as a single argv to claude;
# embedded quotes / dollar signs in priming.md are safe (no further
# shell parsing happens to the substituted value).
exec "$REAL_CLAUDE" --append-system-prompt "$(cat "$PRIMING_FILE")" "$@"
`
    await fs.mkdir(SHIM_DIR, { recursive: true })
    const tmpPath = `${SHIM_PATH}.tmp-${process.pid}`
    await fs.writeFile(tmpPath, shimContent)
    await fs.chmod(tmpPath, 0o755)
    await fs.rename(tmpPath, SHIM_PATH)
  }

  /**
   * Stage 19b — resolve the real `claude` binary via a login shell
   * (`zsh -l -c 'command -v claude'`). Login shells source .zshrc /
   * .zprofile so PATH additions there (commonly ~/.local/bin) are
   * picked up.
   *
   * Returns null if not found, or if the resolved path is inside our
   * own SHIM_DIR (defensive — we'd loop forever if our shim shadowed
   * the real binary).
   */
  private async resolveRealClaude(): Promise<string | null> {
    // Try a couple of login-shell flavors; the user's $SHELL might be
    // bash, zsh, fish — `command -v` is POSIX, so the simplest
    // formulation works across them all when run with `-l -c`.
    const shells = [process.env.SHELL || '/bin/zsh', '/bin/zsh', '/bin/bash']
    const seen = new Set<string>()
    for (const shell of shells) {
      if (seen.has(shell)) continue
      seen.add(shell)
      try {
        const { stdout } = await execFileAsync(shell, ['-l', '-c', 'command -v claude'], {
          timeout: 5000,
          // Inherit Electron's env but DO NOT include our SHIM_DIR
          // on PATH (we're trying to find real-claude, not ourselves).
          env: { ...process.env, PATH: this.pathWithoutShim() }
        })
        const resolved = stdout.trim()
        if (resolved && !resolved.startsWith(SHIM_DIR)) {
          return resolved
        }
      } catch {
        // Shell missing, command not found, or timeout — try next.
        continue
      }
    }
    return null
  }

  private pathWithoutShim(): string {
    const segments = (process.env.PATH || '').split(':').filter(s => {
      if (!s) return false
      try {
        return path.resolve(s) !== path.resolve(SHIM_DIR)
      } catch {
        return true
      }
    })
    return segments.join(':')
  }

  /**
   * Stage 19b — idempotent SessionStart hook merge.
   *
   * Reads `~/.claude/settings.json` (creates if absent), upserts our
   * duo-tagged entry into `hooks.SessionStart`, writes back atomically
   * via tmp + rename. We tag our entry with `_duo: "managed-v<N>"` so
   * subsequent installs find + replace it without disturbing other
   * user-authored hooks.
   *
   * The hook entry shape matches Claude Code's documented format:
   *   { hooks: [{ type: "command", command: "..." }] }
   * The `_duo` marker is a sibling of `hooks` and ignored by the
   * Claude Code runtime (it only reads recognized keys).
   */
  private async installSessionStartHook(): Promise<void> {
    let settings: Record<string, unknown> = {}
    try {
      const raw = await fs.readFile(SETTINGS_PATH, 'utf8')
      settings = JSON.parse(raw) as Record<string, unknown>
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
        settings = {}
      }
    } catch {
      // File doesn't exist or isn't valid JSON — start fresh.
      settings = {}
    }

    const hooks = (settings.hooks && typeof settings.hooks === 'object'
      ? settings.hooks as Record<string, unknown>
      : {}) as Record<string, unknown>

    const existing = Array.isArray(hooks.SessionStart) ? hooks.SessionStart as unknown[] : []

    // Drop any prior duo-tagged entry; preserve everything else.
    const filtered = existing.filter(entry => {
      if (!entry || typeof entry !== 'object') return true
      const e = entry as Record<string, unknown>
      const marker = e[HOOK_MARKER_KEY]
      return !(typeof marker === 'string' && marker.startsWith(HOOK_MARKER_PREFIX))
    })

    const duoEntry = {
      [HOOK_MARKER_KEY]: `${HOOK_MARKER_PREFIX}${app.getVersion()}`,
      hooks: [
        { type: 'command', command: HOOK_COMMAND }
      ]
    }

    hooks.SessionStart = [...filtered, duoEntry]
    settings.hooks = hooks

    // Atomic write via tmp + rename so a partial write doesn't corrupt
    // the user's settings file.
    await fs.mkdir(path.dirname(SETTINGS_PATH), { recursive: true })
    const tmpPath = `${SETTINGS_PATH}.tmp-${process.pid}`
    await fs.writeFile(tmpPath, JSON.stringify(settings, null, 2) + '\n')
    await fs.rename(tmpPath, SETTINGS_PATH)
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

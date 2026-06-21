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
//     PATH check so the banner can surface a shell-rc hint when needed.
//     ENH-141: also drops a symlink at ~/.claude/duo/bin/duo (SHIM_DIR),
//     which PtyManager prepends to PATH inside every Duo PTY — so the
//     CLI works inside Duo immediately without any shell-rc edit. The
//     ~/.local/bin/ copy still lands for external Terminal/iTerm use.
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
import type { Dirent } from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as crypto from 'crypto'
import { app } from 'electron'
import type { InstallStatus, InstallResult, CliInstallStatus, PrimingInstallStatus, AddToShellPathResult } from '../shared/types'
import { SHIM_DIR } from '../core/constants'
import { resolveClaudeBinary } from '../core/resolve-claude'

const HOME = os.homedir()
const DUO_DIR = path.join(HOME, '.claude', 'duo')
const SKILLS_DUO_DIR = path.join(HOME, '.claude', 'skills', 'duo')
const AGENTS_DIR = path.join(HOME, '.claude', 'agents')
const INSTALLED_PATH = path.join(DUO_DIR, 'installed.json')
const EXTERNAL_DOMAINS_PATH = path.join(DUO_DIR, 'external-domains.json')
const HELP_DEST_DIR = path.join(DUO_DIR, 'help')
// Stage 28 — distro lesson packs install at ~/.claude/duo/packs/.
// PackLoader scans this on app boot; first-launch defaults open
// declared canvases the first time a pack@version is encountered.
const PACKS_DEST_DIR = path.join(DUO_DIR, 'packs')
const CLI_DEST_DIR = path.join(HOME, '.local', 'bin')
const CLI_DEST_PATH = path.join(CLI_DEST_DIR, 'duo')
// ENH-141 — secondary CLI placement inside SHIM_DIR (~/.claude/duo/bin),
// which PtyManager prepends to PATH at PTY spawn. The Unix-bin copy at
// CLI_DEST_PATH still lands for external Terminal/iTerm use (auto-wired
// to ~/.zshrc by addToShellPath), but the SHIM_DIR symlink ensures the
// CLI works inside every Duo PTY without ANY shell-rc modification —
// the load-bearing fix for Claude Code sandboxes that block .zshrc
// writes. See user report 2026-05-10 (enterprise environment).
//
// ENH-156 — SHIM_DIR/duo is now the SOLE canonical CLI location. Boot-
// time `ensureCliShim()` self-heals it on every app launch; the symlink
// target is the in-app CLI binary (Duo.app/Contents/Resources/cli/duo)
// rather than ~/.local/bin/duo, so auto-updates carry the CLI forward
// automatically. See docs/DECISIONS.md → "Boot-time self-healing CLI
// shim — SHIM_DIR/duo as the sole canonical CLI location".
const CLI_SHIM_PATH = path.join(SHIM_DIR, 'duo')
const SHIM_LOG_DIR = path.join(DUO_DIR, 'logs')
const SHIM_LOG_PATH = path.join(SHIM_LOG_DIR, 'install-shim.log')
const PRIMING_PATH = path.join(DUO_DIR, 'priming.md')
const PINS_PATH = path.join(DUO_DIR, 'pins.json')
const SETTINGS_PATH = path.join(HOME, '.claude', 'settings.json')
const SHIM_PATH = path.join(SHIM_DIR, 'claude')
const USER_CLAUDE_MD_PATH = path.join(HOME, '.claude', 'CLAUDE.md')

// ENH-195 — warn-only PreToolUse "open-file guard" hook. The fail-open,
// DUO_SESSION-gated shell script ships in the repo at
// skill/scripts/duo-open-file-guard.sh; the installer copies it to
// HOOKS_DEST_DIR (chmod 755) and registers a PreToolUse entry in
// ~/.claude/settings.json pointing at PRETOOL_GUARD_COMMAND. The command
// uses $HOME (not the literal homedir) so the registered settings entry
// stays portable. Convenience-only — never load-bearing; a write failure
// is caught + warned and the install continues (mirrors the SessionStart
// hook's enterprise-locked-settings tolerance).
const HOOKS_DEST_DIR = path.join(DUO_DIR, 'hooks')
const PRETOOL_GUARD_DEST = path.join(HOOKS_DEST_DIR, 'duo-open-file-guard.sh')
const PRETOOL_GUARD_COMMAND = '$HOME/.claude/duo/hooks/duo-open-file-guard.sh'

// ENH-225 (F2/D9) — the "waiting on you" attention hook. Ships to
// ~/.claude/duo/hooks/duo-attention.sh and is registered on three events:
// Stop + Notification (→ `set`, the session went idle / is prompting) and
// UserPromptSubmit (→ `clear`, the user acted). The script reads $DUO_TAB and
// posts to Duo's socket via the CLI; a no-op outside Duo (never fails a hook).
const ATTENTION_HOOK_DEST = path.join(HOOKS_DEST_DIR, 'duo-attention.sh')
const ATTENTION_HOOK_COMMAND = '$HOME/.claude/duo/hooks/duo-attention.sh'
const ATTENTION_HOOK_EVENTS: { event: string; arg: 'set' | 'clear' }[] = [
  { event: 'Stop', arg: 'set' },
  { event: 'Notification', arg: 'set' },
  { event: 'UserPromptSubmit', arg: 'clear' },
]

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

// Stage 19e ENH-088 — managed block in ~/.claude/CLAUDE.md. Hook-
// independent — works even when Claude Code's hook runtime is
// disabled (enterprise managed installs, restrictive settings.json
// policies, etc.). Insert / version-aware replace / respect-removal
// logic mirrors mergeSessionStartHook above. The OPENING marker
// regex matches ANY version so future versions can find + replace
// older blocks; the version suffix on each install rotates so
// upgrades are observable.
const CLAUDE_MD_MARKER_OPEN_RE = /<!--\s*duo:managed-v[^>]*-->/
const CLAUDE_MD_MARKER_CLOSE = '<!-- duo:end -->'
const CLAUDE_MD_FULL_BLOCK_RE = /<!--\s*duo:managed-v[^>]*-->[\s\S]*?<!--\s*duo:end\s*-->/

interface InstalledFile {
  version: string
  installedAt: string
  /** Phase 2 — track where we put the binary so a future uninstall /
   *  status check can find it. Recorded as the resolved absolute path
   *  rather than `~/...` so changes to $HOME don't break readback. */
  cliPath?: string
  /** Stage 21e-iii — SHA-256 fingerprint of every Duo-shipped file
   *  at the time the install service wrote it. On the next install
   *  (e.g. version-bump upgrade), each file's disk SHA is compared
   *  against this map: match → user didn't modify, safe to
   *  overwrite; differ → user customized, skip + report as a
   *  preserved-conflict.
   *
   *  Keys are relative paths under `~/.claude/` (e.g.
   *  `skills/duo/SKILL.md`, `agents/duo.md`, `duo/help/canvas-actions-demo.html`).
   *  Bootstrap-only files (external-domains.json, priming.md,
   *  pins.json) are NOT tracked — they're already protected by
   *  "only write if absent" and any user edits there are by design.
   *
   *  Pre-21e-iii installs don't have this map; first upgrade after
   *  21e-iii ships overwrites freely (treats absent map as
   *  "trust the install") and starts tracking from there. */
  files?: Record<string, string>
  /** Stage 19e ENH-088 — set to true the first time the install
   *  service writes the managed block into ~/.claude/CLAUDE.md (or
   *  creates that file). Once set, never cleared. Lets a future
   *  install distinguish "the user removed our block" (flag = true,
   *  no marker in file → respect-removal) from "first-time install"
   *  (flag undefined/false, no marker → first-time append). */
  claudeMdManaged?: boolean
}

/** Result of a single file install attempt. */
interface FileInstallResult {
  /** Relative path under ~/.claude/ for use in installed.json's
   *  `files` map. */
  relPath: string
  /** What happened. */
  outcome: 'created' | 'overwritten' | 'preserved-conflict' | 'unchanged' | 'skipped-source-missing'
  /** New SHA-256 if outcome is `created` / `overwritten` /
   *  `unchanged`; previous SHA if `preserved-conflict` (so we keep
   *  tracking it). Undefined for `skipped-source-missing`. */
  sha?: string
}

const HOME_PREFIX_FOR_REL = path.join(HOME, '.claude') + path.sep

// Stage 19e ENH-088 — managed CLAUDE.md block helpers, pure functions.
// Exported for unit testing. The I/O wrapper (`mergeUserClaudeMd` on
// InstallService) is the only Electron-coupled part.

export interface ClaudeMdMergeInput {
  /** Existing CLAUDE.md content, or null if the file doesn't exist. */
  existing: string | null
  /** Prior `claudeMdManaged` flag from installed.json. Undefined or
   *  false means "we've never touched this file before"; true means
   *  "we previously wrote the managed block." */
  priorManaged: boolean
  /** Block text to insert/replace, including marker comments. */
  newBlock: string
}

export interface ClaudeMdMergeResult {
  /** Final file contents to write, or null if no change is needed
   *  (no-op cases like respect-removal or marker-only re-run). */
  contents: string | null
  /** New value of the `claudeMdManaged` flag. Sticky once set. */
  managed: boolean
  /** What action was taken — for diagnostics + tests. */
  action:
    | 'created'
    | 'replaced'
    | 'appended'
    | 'respected-removal'
    | 'no-op-marker-unchanged'
}

/**
 * Stage 19e ENH-088 — render the managed Duo block for the user's
 * `~/.claude/CLAUDE.md`. Pointers only; no inlined verb cheat-sheet
 * (priming.md handles in-Duo sessions; the skill body handles
 * triggered loads). The version suffix on the opening marker rotates
 * each release so subsequent installs find + replace older blocks.
 *
 * Hook-independent: this lands inside CLAUDE.md, which Claude Code's
 * core context loader reads on every session start regardless of
 * hook policy or settings.json restrictions. That's the load-bearing
 * design property.
 */
export function composeManagedClaudeMdBlock(version: string): string {
  return [
    `<!-- duo:managed-v${version} — installed by Duo. Edit freely; remove this block to opt out. -->`,
    '## Duo workspace integration',
    '',
    'Duo (https://github.com/dudgeon/duo) is installed on this machine — a desktop app pairing Claude Code terminals with an embedded browser, file tree, markdown editor, and HTML canvas. When the user references Duo\'s surfaces ("the browser pane", "the editor", "what\'s selected", a `duo` CLI verb), reach for the **`duo` skill** at `~/.claude/skills/duo/SKILL.md` or delegate multi-step CLI sequences to the **`duo` subagent**. If a `duo` command hangs or returns `ECONNREFUSED`, see `~/.claude/skills/duo/references/sandbox-troubleshooting.md`. For enterprise / managed Claude Code installs (hooks disabled, restrictive permissions), see `~/.claude/skills/duo/references/enterprise-deployments.md`.',
    '',
    '**Permission requests — batch within the task, stay scoped to it.** Matters most on managed / enterprise installs, where auto-approve is usually off and even reading a single file prompts the user:',
    '',
    '- *Batch approvals.* When work spans many files in the project, request the broadest scope the task legitimately needs in one prompt — ask to read the whole directory or repository rather than prompting file-by-file — so the user approves once instead of dozens of times.',
    '- *Stay scoped.* Request access only to what the current task touches. Don\'t ask to read unrelated applications\' data or OS surfaces (e.g. the macOS Music library) the work doesn\'t require. Narrow scope when IT policy demands it, but don\'t self-clamp below what the task legitimately needs.',
    '',
    `*Auto-managed by Duo v${version}. Re-runs on every Duo install/upgrade; the version above is the source of truth for whether the latest block landed.*`,
    '<!-- duo:end -->'
  ].join('\n')
}

/**
 * Stage 19e ENH-088 — pure decision logic for merging the managed
 * Duo block into ~/.claude/CLAUDE.md. The four scenarios from
 * docs/prd/stage-19e-user-context-onboarding.md § 4:
 *
 *   1. File doesn't exist → create with block.
 *   2. File has a `<!-- duo:managed-v* -->` marker → version-aware
 *      regex replace. Surrounding content untouched.
 *   3. File exists, no marker, prior managed flag != true →
 *      first-time append.
 *   4. File exists, no marker, prior managed flag === true →
 *      user removed the block. RESPECT THAT. No-op forever.
 */
export function planClaudeMdMerge(input: ClaudeMdMergeInput): ClaudeMdMergeResult {
  const { existing, priorManaged, newBlock } = input

  // Scenario 1 — file does not exist.
  if (existing === null) {
    return { contents: newBlock + '\n', managed: true, action: 'created' }
  }

  // Scenario 2 — managed marker present. Version-aware replace
  // (the regex matches ANY duo:managed-v marker).
  if (CLAUDE_MD_FULL_BLOCK_RE.test(existing)) {
    const next = existing.replace(CLAUDE_MD_FULL_BLOCK_RE, newBlock)
    if (next === existing) {
      // Marker matched but the block content was already current.
      return { contents: null, managed: true, action: 'no-op-marker-unchanged' }
    }
    return { contents: next, managed: true, action: 'replaced' }
  }

  // Scenario 4 — no marker, but we wrote one before. User removed
  // it; respect that. Never re-add.
  if (priorManaged) {
    return { contents: null, managed: true, action: 'respected-removal' }
  }

  // Scenario 3 — first-time append.
  // Two trailing newlines before the block so it sits separated from
  // whatever the user already had. If the file doesn't end in a
  // newline, the prepend pads to two — single \n at the start of the
  // separator brings the total to two. If the file already ends in
  // \n we still prepend one more for a blank-line separator.
  const sep = existing.endsWith('\n') ? '\n' : '\n\n'
  return {
    contents: existing + sep + newBlock + '\n',
    managed: true,
    action: 'appended'
  }
}

// ENH-156 — pure-function planning for the SHIM_DIR/duo symlink. Split
// out so the decision logic is unit-testable without filesystem fakes;
// the I/O wrapper (ensureCliShim) just applies the planned action.

export type ShimState =
  /** SHIM_DIR/duo does not exist. */
  | { kind: 'missing' }
  /** Exists as a symlink whose target resolves to a real file. */
  | { kind: 'symlink'; target: string }
  /** Exists as a symlink whose target does not exist (dangling). */
  | { kind: 'broken-symlink'; target: string }
  /** Exists as a regular file or directory — NOT a symlink. The user
   *  put something here manually; we refuse to clobber. */
  | { kind: 'non-symlink' }

export type ShimPlan =
  | { kind: 'create' }
  | { kind: 'replace' }
  | { kind: 'no-op' }
  | { kind: 'refuse-non-symlink' }

export function planCliShim(state: ShimState, desiredTarget: string): ShimPlan {
  if (state.kind === 'missing') return { kind: 'create' }
  if (state.kind === 'non-symlink') return { kind: 'refuse-non-symlink' }
  // symlink (current or broken) — heal if target differs from desired.
  if (state.target === desiredTarget) {
    // Broken symlink that nominally points at the right target still
    // replaces (no-op symlink ops are cheap; this catches the case
    // where Duo.app moved and the path is technically "the same string"
    // but won't resolve until the symlink is rewritten to point at the
    // new physical location). For target-equal-and-resolves, no-op.
    return state.kind === 'symlink' ? { kind: 'no-op' } : { kind: 'replace' }
  }
  return { kind: 'replace' }
}

export interface EnsureCliShimResult {
  ok: boolean
  /** What ensureCliShim did (or refused to do). */
  action: 'no-op' | 'created' | 'replaced' | 'no-source' | 'refused' | 'error'
  /** Absolute path of the shim we tried to manage. */
  shimPath: string
  /** Absolute path of the desired symlink target (the in-app CLI
   *  binary), when known. */
  target?: string
  /** When ok=false: short user-readable explanation. */
  error?: string
}

/** One Duo-managed hook to upsert: a Claude Code event name + the exact
 *  command string to register for it. */
export interface ManagedHookSpec {
  event: string
  command: string
}

/**
 * ENH-225 — PURE merge of Duo-managed hook entries into a Claude `settings`
 * object's `hooks` map (extracted from the install methods so the merge logic
 * is unit-testable, mirroring `planClaudeMdMerge`/`planCliShim`). For each spec
 * it drops our PRIOR entry from `hooks[event]` — identified by EITHER the `_duo`
 * marker OR an exact command match (a pre-marker / hand-mirrored orphan) — then
 * appends ONE freshly-marked entry. Foreign entries (no marker, not our command)
 * pass through untouched. Idempotent: same (settings, version) in → same out.
 * Returns a NEW settings object (the input is not mutated).
 */
export function planManagedHooksMerge(
  settings: Record<string, unknown>,
  version: string,
  specs: ManagedHookSpec[]
): Record<string, unknown> {
  const base = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {}
  const hooks: Record<string, unknown> = (base.hooks && typeof base.hooks === 'object' && !Array.isArray(base.hooks)
    ? { ...(base.hooks as Record<string, unknown>) }
    : {})

  for (const { event, command } of specs) {
    const existing = Array.isArray(hooks[event]) ? hooks[event] as unknown[] : []
    const filtered = existing.filter(entry => {
      if (!entry || typeof entry !== 'object') return true
      const e = entry as Record<string, unknown>
      const marker = e[HOOK_MARKER_KEY]
      const isMarkedDuo = typeof marker === 'string' && marker.startsWith(HOOK_MARKER_PREFIX)
      const inner = e.hooks
      const isOrphanDuoCommand = !isMarkedDuo && Array.isArray(inner) && inner.some(h =>
        h && typeof h === 'object' &&
        (h as Record<string, unknown>).command === command
      )
      return !(isMarkedDuo || isOrphanDuoCommand)
    })
    const duoEntry = {
      [HOOK_MARKER_KEY]: `${HOOK_MARKER_PREFIX}${version}`,
      hooks: [{ type: 'command', command }]
    }
    hooks[event] = [...filtered, duoEntry]
  }

  return { ...base, hooks }
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
      // ENH-195 — dest dir for the warn-only PreToolUse open-file guard.
      await fs.mkdir(HOOKS_DEST_DIR, { recursive: true })

      // Stage 21e-iii — read previous SHAs from installed.json so we
      // can detect user customizations on upgrade. Will be undefined
      // for first-ever installs and for upgrades from pre-21e-iii
      // versions (which didn't track files); both cases overwrite
      // freely and start tracking from this run forward.
      // Stage 19e ENH-088 — also read the prior `claudeMdManaged`
      // flag so the managed-block merge can distinguish first-time
      // append from respect-removal.
      let prevShas: Record<string, string> | undefined
      let priorClaudeMdManaged = false
      try {
        const raw = await fs.readFile(INSTALLED_PATH, 'utf8')
        const parsed = JSON.parse(raw) as Partial<InstalledFile>
        prevShas = parsed.files
        priorClaudeMdManaged = parsed.claudeMdManaged === true
      } catch { /* missing/corrupt — treat as first install */ }

      const fileResults: FileInstallResult[] = []

      // skill/SKILL.md → ~/.claude/skills/duo/SKILL.md
      fileResults.push(await this.safeOverwriteFile(
        path.join(sourceRoot, 'skill', 'SKILL.md'),
        path.join(SKILLS_DUO_DIR, 'SKILL.md'),
        prevShas
      ))
      // Stage 27 — skill/canvas-authoring.md → ~/.claude/skills/duo/canvas-authoring.md
      fileResults.push(await this.safeOverwriteFile(
        path.join(sourceRoot, 'skill', 'canvas-authoring.md'),
        path.join(SKILLS_DUO_DIR, 'canvas-authoring.md'),
        prevShas
      ))
      // Stage 27 (post-modularization) — skill/canvas-interaction.md →
      // ~/.claude/skills/duo/canvas-interaction.md. Companion to
      // canvas-authoring.md; covers opening / reading / driving
      // existing canvases (vs. authoring new ones). Split per
      // Anthropic's skill-design guidance on single-responsibility
      // scope.
      fileResults.push(await this.safeOverwriteFile(
        path.join(sourceRoot, 'skill', 'canvas-interaction.md'),
        path.join(SKILLS_DUO_DIR, 'canvas-interaction.md'),
        prevShas
      ))
      await this.safeOverwriteDirContents(
        path.join(sourceRoot, 'skill', 'examples'),
        path.join(SKILLS_DUO_DIR, 'examples'),
        prevShas,
        fileResults
      )
      await this.safeOverwriteDirContents(
        path.join(sourceRoot, 'skill', 'references'),
        path.join(SKILLS_DUO_DIR, 'references'),
        prevShas,
        fileResults
      )

      // agents/duo.md → ~/.claude/agents/duo.md
      fileResults.push(await this.safeOverwriteFile(
        path.join(sourceRoot, 'agents', 'duo.md'),
        path.join(AGENTS_DIR, 'duo.md'),
        prevShas
      ))

      // ENH-195 — skill/scripts/duo-open-file-guard.sh →
      // ~/.claude/duo/hooks/duo-open-file-guard.sh. Copied through the
      // SAME provenance-aware path as every other tracked Duo file (so
      // customization preservation + orphan cleanup apply), then chmod
      // 755 — safeOverwriteFile copies the bytes but not the exec bit,
      // and a PreToolUse hook must be executable.
      fileResults.push(await this.safeOverwriteFile(
        path.join(sourceRoot, 'skill', 'scripts', 'duo-open-file-guard.sh'),
        PRETOOL_GUARD_DEST,
        prevShas
      ))
      await fs.chmod(PRETOOL_GUARD_DEST, 0o755).catch(() => {})

      // ENH-225 — skill/scripts/duo-attention.sh → ~/.claude/duo/hooks/. Same
      // provenance-aware copy + chmod 755 as the guard (a hook must be exec).
      fileResults.push(await this.safeOverwriteFile(
        path.join(sourceRoot, 'skill', 'scripts', 'duo-attention.sh'),
        ATTENTION_HOOK_DEST,
        prevShas
      ))
      await fs.chmod(ATTENTION_HOOK_DEST, 0o755).catch(() => {})

      // help/*.html → ~/.claude/duo/help/*.html. User can customize the
      // installed copies; the bundle copies remain as a fallback.
      // Stage 21e-iii: customizations are now PRESERVED across
      // upgrades (previously the install action overwrote them
      // unconditionally on version-bump). Conflict surfaces as
      // `preserved-conflict` outcome → reported in InstallResult
      // for the banner UX.
      //
      // ENH-070 (v0.6.4) — dev-only symlink path. In dev (`npm run
      // dev`), the source and destination would otherwise be two
      // distinct files at two distinct paths, drifting apart over
      // time (the cut-version skill's Step 4 enforces "edit the
      // source repo, not the installed copy" precisely because of
      // this). Replacing the destination with a symlink to the
      // source eliminates the drift risk in dev, while production
      // users still get a real copy from the install bundle.
      // Customization preservation: if a user has somehow customized
      // the installed copy in dev, the symlink helper detects the
      // byte mismatch and leaves their file alone.
      if (app.isPackaged) {
        await this.safeOverwriteDirContents(
          path.join(sourceRoot, 'help'),
          HELP_DEST_DIR,
          prevShas,
          fileResults
        )
      } else {
        await this.maintainHelpSymlinksInDev(path.join(sourceRoot, 'help'))
      }

      // Stage 28 — distro lesson packs at packs/<name>/ in the repo
      // mirror to ~/.claude/duo/packs/<name>/ on disk. Recurses into
      // each pack so canvases/ + lesson-skill/ tag along. PackLoader
      // scans the destination on every app boot; the Stage 18b
      // first-launch defaults hook fires per-pack-version.
      // Customization preservation: same `safeOverwriteFile` path the
      // help/*.html copy uses, so a user-edited canvas survives an
      // upgrade with a `preserved-conflict` outcome.
      //
      // ENH-051 — fork-config opt-out. fork.config.json's
      // `packs.disabled` lists pack DIRECTORY NAMES this fork wants
      // to skip entirely. The Vite-injected __DUO_PACKS_DISABLED__
      // constant carries that list at runtime. We pass it as
      // `excludeTopLevel` so the recursive copy skips those root-
      // level entries — disabled packs never make it to
      // ~/.claude/duo/packs/ for fresh installs. Existing on-disk
      // packs (e.g. a user added then disabled) are NOT auto-deleted
      // — that's the user's data; an upgrade adding to
      // packs.disabled doesn't remove their files. PackLoader's
      // runtime filter catches the case where the dir exists but
      // is disabled.
      await this.safeOverwriteDirContents(
        path.join(sourceRoot, 'packs'),
        PACKS_DEST_DIR,
        prevShas,
        fileResults,
        new Set(__DUO_PACKS_DISABLED__)
      )

      // external-domains.json — bootstrap-or-additive-merge.
      //
      // v0.4.0 — seeded default off-host patterns. Upstream Duo seeds the
      // `*.capitalone.com` Cap One AIP entry plus (since ENH-009 in
      // v0.4.3) the daily-driver SaaS apps that fail in embedded
      // browsers due to SSO + conditional access: Slack, Gmail + full
      // Google Workspace, Atlassian (Jira/Confluence), Microsoft 365.
      // Routing those to the user's system browser sidesteps failure
      // modes that the embedded WebContentsView can't handle.
      //
      // Stage 21e-ii — the actual default LIST is in fork.config.json
      // (or fork.config.default.json fallback), Vite-injected as
      // `__DUO_BOOTSTRAP_EXTERNAL_DOMAINS__`. So a fork distributing
      // internally (e.g. JPMorgan Trailblazers-equivalent) can seed
      // their own host patterns by editing fork.config.json before
      // building.
      //
      // ENH-021 (v0.5.3) — additive-merge for existing users. Pre-
      // ENH-021 the bootstrap was "only-if-absent" which meant users
      // who installed before v0.4.3 still had only the original
      // single-entry default. Each install/upgrade now reads any
      // existing file, adds bundled defaults that aren't already
      // present (string-equal compare against `host` field), and
      // writes back. User-added entries are preserved verbatim.
      // Removed-defaults aren't re-added if they were never in this
      // user's file: we compare against the file as-it-stands, NOT
      // against a "previously-bundled-defaults" snapshot, so a
      // default the user explicitly deleted DOES come back on the
      // next install. v2 adds a "dismissed-defaults" sidecar to fix
      // that — deferred.
      await this.bootstrapOrMergeExternalDomains()

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

      // Sprint 16 op #8 pivot — bootstrap pins.json from packs/*/PACK.json
      // defaults[].pin: true (was hardcoded WDD URL literal; that drift-
      // prone duplication of pack-default-pinning shape is now gone).
      // Fresh install only — `await fs.access(PINS_PATH)` short-circuits
      // when a user pins.json already exists. Upgrade users go through
      // migrateStalePinUrls() instead (next block).
      await this.bootstrapPinsFromPackDefaults(sourceRoot)

      // Sprint 16 — pin URL auto-migration. Existing users may have
      // pins.json entries pointing at v(N-1) paths that moved or were
      // retired in this cut (e.g. v0.6.12 → v0.6.13 moved
      // `help/what-duo-does.html` → `packs/duo-default/canvases/`).
      // Rewrites known renames + drops pins pointing at files retired
      // with no successor (FAQ in v0.6.13). Closes the v0.6.13 known-
      // issue "two WDD tabs on upgrade".
      await this.migrateStalePinUrls()

      // Stage 19b — SessionStart hook merge. Idempotent: replaces our
      // own duo-tagged entry on re-run; leaves any non-Duo
      // SessionStart entries untouched. Reported back via priming
      // status (hookConflict surfaces "you have other hooks too").
      // Hook is the redundant safety net — see installShim() below
      // for the load-bearing priming path.
      //
      // BUG-117 (2026-05-10) — graceful failure for enterprise
      // installs where ~/.claude/settings.json is read-only / under
      // restrictive policy. The hook is NOT load-bearing (the PATH
      // shim below is the primary priming path; this hook is a
      // redundant safety net). A write failure should NOT abort the
      // install — log and continue. Mirrors the existing CLAUDE.md
      // merge pattern below, which also tolerates a write failure
      // for the same enterprise reason.
      try {
        await this.installSessionStartHook()
      } catch (err) {
        console.warn(
          '[install] SessionStart hook merge failed (likely enterprise-locked settings.json) — skipping. ' +
          'The PATH shim below remains the primary priming path; hook is a redundant safety net. ' +
          'Error:',
          (err as Error)?.message ?? err
        )
      }

      // ENH-195 — warn-only PreToolUse open-file-guard hook merge.
      // Idempotent like the SessionStart merge: replaces our own
      // duo-tagged PreToolUse entry on re-run; leaves any non-Duo
      // PreToolUse entries untouched. NON-LOAD-BEARING — the guard is a
      // convenience nudge, so a write failure (e.g. enterprise-locked
      // settings.json) must NOT abort the install. Same graceful-failure
      // pattern as the SessionStart hook above.
      try {
        await this.installPreToolUseHook()
      } catch (err) {
        console.warn(
          '[install] PreToolUse open-file-guard hook merge failed (likely enterprise-locked settings.json) — skipping. ' +
          'The guard is an advisory nudge, never load-bearing; the install proceeds without it. ' +
          'Error:',
          (err as Error)?.message ?? err
        )
      }

      // ENH-225 (F2/D9) — register the attention hooks (Stop/Notification → set,
      // UserPromptSubmit → clear). Same graceful-failure tolerance: the badge is
      // an advisory signal (the renderer also clears on focus), never load-bearing.
      try {
        await this.installAttentionHooks()
      } catch (err) {
        console.warn(
          '[install] attention hook merge failed (likely enterprise-locked settings.json) — skipping. ' +
          'The "waiting on you" badge is advisory, never load-bearing; the install proceeds without it. ' +
          'Error:',
          (err as Error)?.message ?? err
        )
      }

      // Stage 19e ENH-088 — managed Duo block in ~/.claude/CLAUDE.md.
      // Hook-INDEPENDENT primary path (the SessionStart hook above is
      // the redundant in-Duo safety net). Works in non-DUO_SESSION
      // Claude Code sessions and in enterprise managed installs where
      // hooks are policy-disabled. Best-effort: a write failure is
      // non-fatal — log and move on. Sticky `claudeMdManaged` flag
      // means a future install respects user removal.
      let claudeMdManaged = priorClaudeMdManaged
      try {
        claudeMdManaged = await this.mergeUserClaudeMd(priorClaudeMdManaged)
      } catch {
        // Don't block install on a CLAUDE.md write error. The flag
        // stays at its prior value so the next install can retry.
      }

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

      // ENH-141 — auto-wire shell PATH if CLI installed but its dir
      // isn't already on $PATH. Pre-fix this was a separate banner
      // row with an [Add to PATH] button that users dismissed without
      // clicking, leaving them with `duo: command not found` from
      // external terminals. Folding the wire-up into the same install
      // click keeps the one-click promise without changing the
      // consent surface — the [Install] button copy discloses both
      // actions in FirstLaunchBanner. Idempotent: addToShellPath's
      // fence-marker check is a no-op when the block is already
      // present. Best-effort: a failed wire-up doesn't block the
      // install — the result surfaces the failure so the banner can
      // show the manual `export PATH=...` fallback.
      let pathWiringResult: AddToShellPathResult | undefined
      if (cli.installed && cli.onPath === false) {
        try {
          pathWiringResult = await this.addToShellPath()
        } catch (err) {
          pathWiringResult = {
            ok: false,
            error: err instanceof Error ? err.message : String(err)
          }
        }
      }

      // Read priming status fresh so the result reflects what we
      // actually installed (hook merge could have hit a conflict).
      const priming = await this.primingStatus()

      // Stage 21e-iii — assemble the new SHA map + conflict list from
      // every safeOverwriteFile result. The new map becomes the
      // baseline for next-install comparison. Files we skipped due
      // to user customization carry forward their disk SHA (so next
      // install detects FURTHER changes against the user's version,
      // not the original Duo-shipped one).
      const newFiles: Record<string, string> = {}
      const preservedConflicts: string[] = []
      for (const r of fileResults) {
        if (r.sha) newFiles[r.relPath] = r.sha
        if (r.outcome === 'preserved-conflict') preservedConflicts.push(r.relPath)
      }

      // ENH-140 — orphan cleanup. Files present in prevShas (last
      // install's SHA map) but absent from newFiles (this install's)
      // are retired by the current bundle. Delete IFF the on-disk SHA
      // still matches the prior recorded SHA (user didn't customize).
      // User-modified copies are preserved in place + reported. Empty
      // directories left behind are removed via best-effort rmdir.
      // Best-effort: any single failure is logged + skipped — doesn't
      // block the install.
      if (prevShas) {
        await this.cleanupOrphans(prevShas, newFiles)
      }

      // Provenance — last write wins. Updated on every successful run
      // so an upgrade flow re-stamps the version + timestamp. Records
      // the CLI install path so later checks know where to look.
      // Stage 21e-iii adds the per-file SHA map for next-install
      // conflict detection.
      const provenance: InstalledFile = {
        version: app.getVersion(),
        installedAt: new Date().toISOString(),
        cliPath: cli.installed ? cli.path : undefined,
        files: newFiles,
        claudeMdManaged
      }
      await fs.writeFile(INSTALLED_PATH, JSON.stringify(provenance, null, 2) + '\n')

      return {
        ok: true,
        preservedConflicts: preservedConflicts.length > 0 ? preservedConflicts : undefined,
        pathWiringResult,
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
              // BUG-150 (Sprint 20 / v0.7.7) — before flagging as
              // foreign, check whether this unmarked entry is just a
              // command-equivalent orphan of OUR hook from a pre-marker
              // install. The next reinstall removes it (see
              // installSessionStartHook below); meanwhile the banner
              // shouldn't keep claiming "other hooks present" because
              // there ARE no other hooks — it's just our own ghost.
              const inner = e.hooks
              const isDuoCommandOrphan = Array.isArray(inner) && inner.some(h =>
                h && typeof h === 'object' &&
                typeof (h as Record<string, unknown>).command === 'string' &&
                ((h as Record<string, unknown>).command as string) === HOOK_COMMAND
              )
              if (!isDuoCommandOrphan) {
                // A genuinely-foreign SessionStart hook — note the
                // conflict so the banner surfaces "your priming will
                // run alongside whatever else you had".
                hookConflict = true
              }
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
   * Stage 19b — resolve the real `claude` binary so the priming shim
   * at ~/.claude/duo/bin/claude can `exec` it with
   * --append-system-prompt. Excludes our own SHIM_DIR from the PATH
   * the shell sees so we never resolve back to ourselves and loop.
   *
   * Implementation in `./resolve-claude.ts` is shared with main.ts's
   * isClaudeOnPath check (Stage 19c D23) so both detection sites
   * see the same shell PATH and never disagree. v0.4.4 had drift
   * between the two: install-service used `zsh -l -c` (no .zshrc),
   * main.ts used bare `which` (no rc files at all), and Finder-
   * launched users with PATH in .zshrc got "Claude not detected"
   * everywhere even though they had it installed.
   */
  private async resolveRealClaude(): Promise<string | null> {
    return resolveClaudeBinary({ excludeShimDir: true })
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
  /**
   * Stage 19e ENH-088 — idempotent managed-block merge into the
   * user's ~/.claude/CLAUDE.md. Hook-independent: lands inside
   * CLAUDE.md (read by Claude Code's core context loader on every
   * session start), so it works even when settings.json hooks are
   * disabled by enterprise policy.
   *
   * `priorManaged` comes from the `claudeMdManaged` flag on the
   * existing installed.json. Returns the new flag value, which the
   * caller stamps into the provenance record on the way out.
   *
   * Atomic write via tmp + rename so a partial write doesn't
   * corrupt user content.
   */
  private async mergeUserClaudeMd(priorManaged: boolean): Promise<boolean> {
    let existing: string | null = null
    try {
      existing = await fs.readFile(USER_CLAUDE_MD_PATH, 'utf8')
    } catch {
      existing = null
    }

    const newBlock = composeManagedClaudeMdBlock(app.getVersion())
    const result = planClaudeMdMerge({ existing, priorManaged, newBlock })

    if (result.contents === null) {
      // No-op cases (respect-removal or marker-already-current).
      return result.managed
    }

    await fs.mkdir(path.dirname(USER_CLAUDE_MD_PATH), { recursive: true })
    const tmpPath = `${USER_CLAUDE_MD_PATH}.tmp-${process.pid}`
    await fs.writeFile(tmpPath, result.contents)
    await fs.rename(tmpPath, USER_CLAUDE_MD_PATH)
    return result.managed
  }

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

    // BUG-150 (Sprint 20 / v0.7.7) — drop:
    //   (a) any prior duo-marked entry (the existing behavior; replaced by
    //       the fresh entry below so the version-suffix stays current), AND
    //   (b) any orphan unmarked entry that's command-equivalent to our hook
    //       — these are leftovers from earlier installs that wrote the
    //       hook BEFORE the `_duo` marker convention shipped (Stage 19b
    //       pre-marker), OR from a manual edit that mirrored our command.
    //       Without (b), every reinstall left the orphan in place and the
    //       priming would `cat priming.md` TWICE per session — and the
    //       install banner perpetually showed "you have other SessionStart
    //       hooks" since the orphan looked foreign.
    const isDuoCommand = (entry: unknown): boolean => {
      if (!entry || typeof entry !== 'object') return false
      const inner = (entry as Record<string, unknown>).hooks
      if (!Array.isArray(inner)) return false
      return inner.some(h =>
        h && typeof h === 'object' &&
        typeof (h as Record<string, unknown>).command === 'string' &&
        ((h as Record<string, unknown>).command as string) === HOOK_COMMAND
      )
    }
    const filtered = existing.filter(entry => {
      if (!entry || typeof entry !== 'object') return true
      const e = entry as Record<string, unknown>
      const marker = e[HOOK_MARKER_KEY]
      const isMarkedDuo = typeof marker === 'string' && marker.startsWith(HOOK_MARKER_PREFIX)
      const isOrphanDuoCommand = !isMarkedDuo && isDuoCommand(entry)
      // Drop both — we'll re-add a single freshly-marked entry below.
      return !(isMarkedDuo || isOrphanDuoCommand)
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
   * ENH-195 — idempotent PreToolUse open-file-guard hook merge.
   *
   * A near-copy of `installSessionStartHook()` above, targeting
   * `hooks.PreToolUse` with `matcher: "Edit|Write|MultiEdit"`. Reads
   * `~/.claude/settings.json` (creates if absent), upserts our duo-tagged
   * entry, writes back atomically via tmp + rename. Reuses the SAME
   * `_duo: "managed-v<N>"` marker convention as the SessionStart hook so
   * subsequent installs find + replace our own entry (refreshing the
   * version suffix) without disturbing any user-authored PreToolUse
   * hooks.
   *
   * Our prior entry is identified by EITHER the `_duo` marker key OR an
   * inner `hooks[].command === PRETOOL_GUARD_COMMAND` (catches a
   * pre-marker / hand-mirrored orphan, exactly like the SessionStart
   * merge's command-equivalence guard). Foreign entries — anything
   * without our marker and without our command — pass through untouched.
   *
   * The `_duo` marker is a sibling of `hooks`/`matcher` and ignored by
   * the Claude Code runtime (it only reads recognized keys).
   */
  private async installPreToolUseHook(): Promise<void> {
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

    const existing = Array.isArray(hooks.PreToolUse) ? hooks.PreToolUse as unknown[] : []

    // Drop:
    //   (a) any prior duo-marked entry (replaced by the fresh entry below
    //       so the version-suffix stays current), AND
    //   (b) any orphan unmarked entry that's command-equivalent to our
    //       guard — a leftover from a pre-marker install or a manual edit
    //       that mirrored our command. Mirrors installSessionStartHook's
    //       (a)+(b) filter so re-running never duplicates our entry.
    const isDuoCommand = (entry: unknown): boolean => {
      if (!entry || typeof entry !== 'object') return false
      const inner = (entry as Record<string, unknown>).hooks
      if (!Array.isArray(inner)) return false
      return inner.some(h =>
        h && typeof h === 'object' &&
        typeof (h as Record<string, unknown>).command === 'string' &&
        ((h as Record<string, unknown>).command as string) === PRETOOL_GUARD_COMMAND
      )
    }
    const filtered = existing.filter(entry => {
      if (!entry || typeof entry !== 'object') return true
      const e = entry as Record<string, unknown>
      const marker = e[HOOK_MARKER_KEY]
      const isMarkedDuo = typeof marker === 'string' && marker.startsWith(HOOK_MARKER_PREFIX)
      const isOrphanDuoCommand = !isMarkedDuo && isDuoCommand(entry)
      // Drop both — we'll re-add a single freshly-marked entry below.
      return !(isMarkedDuo || isOrphanDuoCommand)
    })

    const duoEntry = {
      [HOOK_MARKER_KEY]: `${HOOK_MARKER_PREFIX}${app.getVersion()}`,
      matcher: 'Edit|Write|MultiEdit',
      hooks: [
        { type: 'command', command: PRETOOL_GUARD_COMMAND }
      ]
    }

    hooks.PreToolUse = [...filtered, duoEntry]
    settings.hooks = hooks

    // Atomic write via tmp + rename so a partial write doesn't corrupt
    // the user's settings file.
    await fs.mkdir(path.dirname(SETTINGS_PATH), { recursive: true })
    const tmpPath = `${SETTINGS_PATH}.tmp-${process.pid}`
    await fs.writeFile(tmpPath, JSON.stringify(settings, null, 2) + '\n')
    await fs.rename(tmpPath, SETTINGS_PATH)
  }

  /**
   * ENH-225 (F2/D9) — register the "waiting on you" attention hooks. Upserts a
   * duo-tagged entry into hooks.Stop, hooks.Notification (both → the script with
   * `set`) and hooks.UserPromptSubmit (→ `clear`), reusing the SAME
   * `_duo: "managed-v<N>"` marker convention as the SessionStart/PreToolUse
   * merges so re-runs refresh our entries without disturbing user-authored
   * hooks. Reads + writes ~/.claude/settings.json ONCE (all three events in a
   * single atomic write). A foreign entry — no marker and not our command — is
   * untouched. Non-load-bearing (the renderer also clears on focus).
   */
  private async installAttentionHooks(): Promise<void> {
    let settings: Record<string, unknown> = {}
    try {
      const raw = await fs.readFile(SETTINGS_PATH, 'utf8')
      settings = JSON.parse(raw) as Record<string, unknown>
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)) settings = {}
    } catch {
      settings = {}
    }

    // Pure merge (unit-tested in install-service.test.ts). Each event's command
    // is `<script> <arg>`; the arg distinguishes the set vs clear registration.
    const specs = ATTENTION_HOOK_EVENTS.map(({ event, arg }) => ({
      event,
      command: `${ATTENTION_HOOK_COMMAND} ${arg}`,
    }))
    const merged = planManagedHooksMerge(settings, app.getVersion(), specs)

    await fs.mkdir(path.dirname(SETTINGS_PATH), { recursive: true })
    const tmpPath = `${SETTINGS_PATH}.tmp-${process.pid}`
    await fs.writeFile(tmpPath, JSON.stringify(merged, null, 2) + '\n')
    await fs.rename(tmpPath, SETTINGS_PATH)
  }

  /**
   * ENH-156 — locate the in-app CLI source binary. Used by both
   * `ensureCliShim()` (the boot-time self-heal) and `installCli()`
   * (the FirstLaunchBanner-triggered binary copy).
   *
   * In dev (`npm run dev`), cli/duo lives at `<app.getAppPath()>/cli/duo`.
   * In prod (asar bundle), cli/ ships as extraResources at
   * `<resourcesPath>/cli/duo`. Returns null when neither candidate
   * exists (e.g. dev session where `npm run build:cli` was never run).
   */
  private async findCliSource(): Promise<string | null> {
    const candidates: string[] = []
    candidates.push(path.join(app.getAppPath(), 'cli', 'duo'))
    const res = this.resourcesRoot()
    if (res) candidates.push(path.join(res, 'cli', 'duo'))
    for (const c of candidates) {
      try {
        const st = await fs.stat(c)
        if (st.isFile()) return c
      } catch {
        continue
      }
    }
    return null
  }

  /**
   * ENH-156 — boot-time self-heal for SHIM_DIR/duo. Idempotent. Called
   * from `app.whenReady()` in `electron/main.ts` so the symlink
   * invariant (*SHIM_DIR/duo points at the current Duo.app's CLI
   * binary*) is true on every launch, regardless of upgrade path or
   * prior install state.
   *
   * Failure modes:
   *  - No source binary found → no-op, logs to install-shim.log.
   *  - SHIM_DIR/duo exists as a regular file (user wrote something
   *    there manually) → refused, logs.
   *  - mkdir / symlink failed (rare; permission issues) → logs +
   *    returns ok=false. Renderer continues; Duo PTYs will still
   *    spawn but bare `duo` won't resolve until next successful
   *    self-heal or manual `duo install`.
   *
   * Logs are persistent at ~/.claude/duo/logs/install-shim.log
   * (timestamp + message; appended). Agents debugging
   * `command not found` can read this file directly.
   */
  async ensureCliShim(): Promise<EnsureCliShimResult> {
    const source = await this.findCliSource()
    if (!source) {
      const err = `no CLI binary found at ${path.join(app.getAppPath(), 'cli', 'duo')} or resourcesPath/cli/duo`
      await this.writeShimLog(err)
      return { ok: false, action: 'no-source', shimPath: CLI_SHIM_PATH, error: err }
    }
    const state = await readShimState(CLI_SHIM_PATH)
    const plan = planCliShim(state, source)

    if (plan.kind === 'no-op') {
      return { ok: true, action: 'no-op', shimPath: CLI_SHIM_PATH, target: source }
    }
    if (plan.kind === 'refuse-non-symlink') {
      const err = `${CLI_SHIM_PATH} exists but is not a symlink; refusing to overwrite`
      await this.writeShimLog(err)
      return { ok: false, action: 'refused', shimPath: CLI_SHIM_PATH, target: source, error: err }
    }

    try {
      await fs.mkdir(SHIM_DIR, { recursive: true })
      if (plan.kind === 'replace') {
        try { await fs.unlink(CLI_SHIM_PATH) } catch { /* race; symlink gone */ }
      }
      await fs.symlink(source, CLI_SHIM_PATH)
      return {
        ok: true,
        action: plan.kind === 'create' ? 'created' : 'replaced',
        shimPath: CLI_SHIM_PATH,
        target: source
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await this.writeShimLog(`symlink ${CLI_SHIM_PATH} → ${source}: ${msg}`)
      return { ok: false, action: 'error', shimPath: CLI_SHIM_PATH, target: source, error: msg }
    }
  }

  private async writeShimLog(message: string): Promise<void> {
    try {
      await fs.mkdir(SHIM_LOG_DIR, { recursive: true })
      const ts = new Date().toISOString()
      await fs.appendFile(SHIM_LOG_PATH, `[${ts}] ${message}\n`)
    } catch {
      // Last-resort: console only. Nothing else we can do.
    }
    console.warn('[install-service] ensureCliShim:', message)
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

      // ENH-156 — also (re)create the SHIM_DIR/duo symlink. Delegates
      // to ensureCliShim() so the FirstLaunchBanner path and the
      // boot-time self-heal path share the same logic + the same
      // persistent log file. Fire-and-forget: a shim failure here
      // doesn't break the primary install (the user can still invoke
      // ~/.local/bin/duo by absolute path); the failure is recorded
      // in install-shim.log and the next app boot will retry.
      void this.ensureCliShim()

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

  // ── Stage 21e-iii — provenance-aware install helpers ────────────────────────

  /** Compute SHA-256 of a file's contents. Returns hex digest. */
  private async computeFileSha(absPath: string): Promise<string> {
    const buf = await fs.readFile(absPath)
    return crypto.createHash('sha256').update(buf).digest('hex')
  }

  /** Relativize an absolute path to its location under ~/.claude/.
   *  Returns just the suffix (e.g. 'skills/duo/SKILL.md'). Used as
   *  the key in installed.json's `files` map. */
  private relPathUnderClaude(absPath: string): string {
    if (!absPath.startsWith(HOME_PREFIX_FOR_REL)) {
      // Defensive — should never happen for our managed paths.
      // Fall back to absolute so the SHA tracking still works,
      // just less neatly.
      return absPath
    }
    return absPath.slice(HOME_PREFIX_FOR_REL.length)
  }

  /** Stage 21e-iii — write `dest` from `src`, but only if the user
   *  hasn't customized `dest` since the last install. Returns the
   *  outcome + new SHA for the file.
   *
   *  Conflict detection logic:
   *  - dest doesn't exist → write, outcome 'created' (no conflict possible)
   *  - dest exists, no prevSha (pre-21e-iii state, or first
   *    install) → write, outcome 'overwritten' (we trust the
   *    install; subsequent installs will track from here)
   *  - dest exists, prevSha matches disk SHA → write, outcome
   *    'overwritten' (user didn't touch the file since last
   *    install)
   *  - dest exists, prevSha differs from disk SHA → SKIP, outcome
   *    'preserved-conflict' (user customized; their copy stays).
   *    The recorded SHA becomes the user's modified version so
   *    next install detects further changes against that baseline.
   */
  /**
   * ENH-021 — bootstrap-or-additive-merge for `external-domains.json`.
   *
   * - File missing → write bundled defaults verbatim (the original
   *   bootstrap behavior).
   * - File present + parseable → merge in any bundled defaults whose
   *   `host` isn't already in the file. User-added entries and
   *   custom reasons preserved. Order: user entries first (insertion
   *   order), then any newly-merged defaults appended at the end.
   * - File present + UNPARSEABLE (corrupt JSON, wrong shape) → leave
   *   alone. We don't want to clobber a user's edit-in-progress.
   *   The runtime ExternalDomainsService handles parse failures
   *   gracefully (empty list, no routing); the user notices via the
   *   blocklist not working and re-bootstraps by hand.
   *
   * Schema accepted: both string entries (`"*.foo.com"`) and the
   * extended object form (`{host, reason}`). Comparison key is the
   * `host` string in both cases.
   */
  /**
   * Sprint 16 — known v(N-1) → v(N) pin path renames. Used by
   * `migrateStalePinUrls` to rewrite existing users' pins.json
   * entries that pointed at files we moved or retired in this cut.
   *
   * Keys are old absolute paths under `~/.claude/duo/`; values are
   * either a new path (rename) or null (retired with no successor —
   * drop the pin entirely). Matched against the SUFFIX of each pin
   * `ref` after stripping any `file://` prefix, so the same map
   * works regardless of how the pin was originally written.
   */
  private readonly PIN_RENAMES: Record<string, string | null> = {
    // ENH-138 (v0.6.13) — WDD canvas moved from help/ into the
    // built-in duo-default pack.
    'duo/help/what-duo-does.html': 'duo/packs/duo-default/canvases/what-duo-does.html',
    // ENH-135 (v0.6.13) — FAQ retired entirely (moved to
    // docs/legacy/ in the repo; no longer installed for users).
    // Drop any pin pointing at the old location.
    'duo/help/faq.html': null
  }

  /**
   * Sprint 16 — bootstrap pins.json from each pack's PACK.json on a
   * fresh install. Replaces the prior hardcoded WDD URL literal in
   * op #8. Iterates every pack with `defaults[].kind === 'canvas'`
   * AND `defaults[].pin === true`; pulls each canvas's pin title from
   * its `<title>` element (falls back to the pack title) so the
   * existing "Duo — What Duo Does" display string is preserved
   * without a hardcoded literal.
   *
   * Bootstrap-only: returns early if pins.json already exists. The
   * upgrade case goes through `migrateStalePinUrls` instead.
   */
  private async bootstrapPinsFromPackDefaults(sourceRoot: string): Promise<void> {
    try {
      await fs.access(PINS_PATH)
      return  // user pins.json already exists; never clobber
    } catch { /* fresh install — proceed */ }

    const pins: Array<{ kind: 'browser'; ref: string; title: string }> = []
    const packsSrcDir = await this.resolvePacksSrcDir(sourceRoot)
    if (!packsSrcDir) {
      // No packs source directory found — write an empty pins.json so
      // the file exists (later code paths read it expecting valid JSON).
      await fs.writeFile(PINS_PATH, JSON.stringify({ version: 1, pins: [] }, null, 2) + '\n')
      return
    }

    let entries: Dirent[]
    try {
      entries = await fs.readdir(packsSrcDir, { withFileTypes: true })
    } catch {
      // Unreadable — write an empty pins.json and return.
      await fs.writeFile(PINS_PATH, JSON.stringify({ version: 1, pins }, null, 2) + '\n')
      return
    }

    for (const e of entries) {
      if (!e.isDirectory()) continue
      const packName = e.name
      const manifestPath = path.join(packsSrcDir, packName, 'PACK.json')
      let manifest: { defaults?: Array<{ kind?: string; path?: string; pin?: boolean }>; title?: string } | null = null
      try {
        const raw = await fs.readFile(manifestPath, 'utf8')
        manifest = JSON.parse(raw)
      } catch { continue /* missing / malformed — skip pack */ }
      if (!manifest?.defaults) continue
      for (const def of manifest.defaults) {
        if (def.kind !== 'canvas' || def.pin !== true || !def.path) continue
        // Pin ref points at the INSTALLED location (PACKS_DEST_DIR),
        // not the source — the user opens the installed copy.
        const destPath = path.join(PACKS_DEST_DIR, packName, def.path)
        const ref = `file://${destPath}`
        const title = await this.extractCanvasTitle(path.join(packsSrcDir, packName, def.path))
          ?? manifest.title
          ?? packName
        pins.push({ kind: 'browser', ref, title })
      }
    }

    await fs.writeFile(PINS_PATH, JSON.stringify({ version: 1, pins }, null, 2) + '\n')
  }

  /** Locate the packs/ source directory across dev + prod layouts. */
  private async resolvePacksSrcDir(sourceRoot: string): Promise<string | null> {
    const candidates = [path.join(sourceRoot, 'packs')]
    const res = this.resourcesRoot()
    if (res) candidates.push(path.join(res, 'packs'))
    for (const c of candidates) {
      try {
        await fs.access(c)
        return c
      } catch { continue }
    }
    return null
  }

  /** Best-effort `<title>` extraction from an HTML file. Returns null
   *  on read failure / missing title element. Used to preserve the
   *  existing per-canvas pin title without a hardcoded literal. */
  private async extractCanvasTitle(htmlPath: string): Promise<string | null> {
    try {
      const raw = await fs.readFile(htmlPath, 'utf8')
      const m = raw.match(/<title[^>]*>([^<]*)<\/title>/i)
      return m ? m[1].trim() : null
    } catch {
      return null
    }
  }

  /**
   * Sprint 16 — rewrite stale v(N-1) pin URLs in an existing user's
   * pins.json. For each entry whose ref ends with a known renamed path
   * (PIN_RENAMES map above), rewrite to the new location. For each
   * entry whose ref ends with a known retirement (PIN_RENAMES value =
   * null), drop the entry.
   *
   * Idempotent: pins already pointing at new paths are untouched.
   * Conservative: only acts on PIN_RENAMES entries — unknown stale
   * pins (e.g. pointing at user files that moved) are preserved.
   *
   * Safe-mode: if pins.json is unparseable, leave it alone — don't
   * clobber an in-progress user edit.
   */
  private async migrateStalePinUrls(): Promise<void> {
    let raw: string
    try {
      raw = await fs.readFile(PINS_PATH, 'utf8')
    } catch {
      return  // no pins.json — nothing to migrate (op #8 will bootstrap)
    }

    let parsed: { version?: number; pins?: Array<{ kind?: string; ref?: string; title?: string }> }
    try {
      parsed = JSON.parse(raw)
    } catch {
      console.warn('[install-service] pins.json unparseable; skipping pin-url migration')
      return
    }
    if (!Array.isArray(parsed.pins)) return

    const claudeDir = path.join(HOME, '.claude')
    let changed = false
    const newPins: Array<{ kind?: string; ref?: string; title?: string }> = []

    for (const pin of parsed.pins) {
      const ref = pin.ref
      if (typeof ref !== 'string') {
        newPins.push(pin)
        continue
      }
      // Strip file:// prefix + ~/.claude/ prefix to get the relative
      // path under .claude/ — that's the suffix our PIN_RENAMES keys
      // are written against.
      const localPath = ref.startsWith('file://') ? ref.slice('file://'.length) : ref
      let relUnderClaude: string | null = null
      if (localPath.startsWith(claudeDir + path.sep)) {
        relUnderClaude = localPath.slice(claudeDir.length + 1)
      }

      if (relUnderClaude !== null && Object.prototype.hasOwnProperty.call(this.PIN_RENAMES, relUnderClaude)) {
        const successor = this.PIN_RENAMES[relUnderClaude]
        if (successor === null) {
          // Retired with no successor — drop the entry.
          console.log(`[install-service] migrating pins.json: dropping retired entry ${relUnderClaude}`)
          changed = true
          continue
        }
        // Rename — rewrite ref.
        const newRef = `file://${path.join(claudeDir, successor)}`
        if (newRef !== ref) {
          console.log(`[install-service] migrating pins.json: ${relUnderClaude} -> ${successor}`)
          newPins.push({ ...pin, ref: newRef })
          changed = true
          continue
        }
      }
      newPins.push(pin)
    }

    if (!changed) return
    const next = { ...parsed, pins: newPins }
    await fs.writeFile(PINS_PATH, JSON.stringify(next, null, 2) + '\n')
  }

  /**
   * ENH-140 — delete files that were in the previous install's SHA map
   * but aren't in this install's. Only deletes when the on-disk SHA
   * still matches the prior recorded SHA (i.e. user didn't customize).
   * User-modified copies stay in place; the user can remove them by
   * hand if they want.
   *
   * After per-file deletion, walks the unique parent directories and
   * tries `fs.rmdir` (non-recursive) on each — succeeds only when the
   * directory has become empty. Cleans up `help/` and similar after
   * their last contained file is retired.
   *
   * Best-effort throughout: any single failure is logged + skipped.
   */
  private async cleanupOrphans(
    prevShas: Record<string, string>,
    newFiles: Record<string, string>
  ): Promise<void> {
    const orphanedKeys = Object.keys(prevShas).filter(k => !(k in newFiles))
    if (orphanedKeys.length === 0) return

    const claudeDir = path.join(HOME, '.claude')
    const parentDirs = new Set<string>()

    for (const relPath of orphanedKeys) {
      const absPath = path.join(claudeDir, relPath)
      try {
        const diskSha = await this.computeFileSha(absPath)
        if (diskSha !== prevShas[relPath]) {
          console.log(`[install-service] preserving customized orphan: ${relPath} (disk SHA differs from prior install)`)
          continue
        }
        await fs.unlink(absPath)
        console.log(`[install-service] cleaned up orphan file: ${relPath}`)
        parentDirs.add(path.dirname(absPath))
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code
        if (code === 'ENOENT') {
          // Already gone — count its parent for empty-dir cleanup
          // anyway in case other orphans in that dir landed.
          parentDirs.add(path.dirname(absPath))
          continue
        }
        console.warn(`[install-service] orphan cleanup failed for ${relPath}:`, (err as Error)?.message ?? err)
      }
    }

    // Empty-dir cleanup — process deepest first so nested empties cascade.
    const sortedDirs = [...parentDirs].sort((a, b) => b.length - a.length)
    for (const dir of sortedDirs) {
      // Never try to remove ~/.claude/ itself or anything above it.
      if (!dir.startsWith(claudeDir + path.sep)) continue
      try {
        await fs.rmdir(dir)  // non-recursive: only succeeds when empty
        console.log(`[install-service] removed empty orphan dir: ${path.relative(claudeDir, dir)}`)
        // Walk up: parent of this dir may now be empty too.
        const parent = path.dirname(dir)
        if (parent.startsWith(claudeDir + path.sep)) {
          try { await fs.rmdir(parent) } catch { /* not empty — fine */ }
        }
      } catch {
        // Not empty (still has content) or permission — fine, skip.
      }
    }
  }

  private async bootstrapOrMergeExternalDomains(): Promise<void> {
    const bundled = (__DUO_BOOTSTRAP_EXTERNAL_DOMAINS__ as readonly string[]) ?? []
    let existing: Array<string | { host: string; reason?: string }> | null = null
    try {
      const raw = await fs.readFile(EXTERNAL_DOMAINS_PATH, 'utf8')
      const parsed = JSON.parse(raw) as { domains?: Array<string | { host: string; reason?: string }> }
      if (Array.isArray(parsed.domains)) existing = parsed.domains
    } catch {
      existing = null
    }

    if (existing === null) {
      // Bootstrap-from-scratch. Includes the case where the file
      // exists but is malformed — we leave it alone (see jsdoc).
      try {
        await fs.access(EXTERNAL_DOMAINS_PATH)
        // File exists but parse failed → don't touch.
        return
      } catch {
        const defaults = { domains: bundled }
        await fs.writeFile(EXTERNAL_DOMAINS_PATH, JSON.stringify(defaults, null, 2) + '\n')
        return
      }
    }

    // Additive merge. Compare by `host` string.
    const existingHosts = new Set(
      existing.map(e => (typeof e === 'string' ? e : e.host)).filter((h): h is string => typeof h === 'string')
    )
    const missing = bundled.filter(b => !existingHosts.has(b))
    if (missing.length === 0) return

    const merged = [...existing, ...missing]
    await fs.writeFile(EXTERNAL_DOMAINS_PATH, JSON.stringify({ domains: merged }, null, 2) + '\n')
  }

  private async safeOverwriteFile(
    src: string,
    dest: string,
    prevShas: Record<string, string> | undefined
  ): Promise<FileInstallResult> {
    const relPath = this.relPathUnderClaude(dest)

    // Resolve src against resourcesRoot fallback (mirror copyIfPresent's logic).
    let resolved = src
    try {
      await fs.access(resolved)
    } catch {
      const res = this.resourcesRoot()
      if (!res) return { relPath, outcome: 'skipped-source-missing' }
      resolved = path.join(res, path.basename(path.dirname(src)), path.basename(src))
      try {
        await fs.access(resolved)
      } catch {
        return { relPath, outcome: 'skipped-source-missing' }
      }
    }

    // Check existing dest state.
    let destExists = false
    try {
      await fs.access(dest)
      destExists = true
    } catch { /* dest absent */ }

    if (destExists && prevShas) {
      const prevSha = prevShas[relPath]
      if (prevSha) {
        const diskSha = await this.computeFileSha(dest)
        if (diskSha !== prevSha) {
          // User customized this file. Preserve their copy; record
          // their SHA as the new baseline for next-install
          // comparison.
          return { relPath, outcome: 'preserved-conflict', sha: diskSha }
        }
      }
    }

    await fs.mkdir(path.dirname(dest), { recursive: true })
    await fs.copyFile(resolved, dest)
    const newSha = await this.computeFileSha(dest)
    return {
      relPath,
      outcome: destExists ? 'overwritten' : 'created',
      sha: newSha
    }
  }

  /** ENH-070 (v0.6.4) — dev-only: replace `~/.claude/duo/help/*.html`
   *  files with symlinks pointing back at the source repo's `help/`,
   *  so editing the repo file is reflected immediately in the
   *  installed copy with zero drift.
   *
   *  Customization preservation: if the destination file's bytes
   *  differ from the source, leave it alone — that's a user
   *  customization (rare in dev but possible) and we don't want to
   *  trample it. If the destination is already a symlink to the
   *  right path, no-op. If it's a symlink to a stale path (e.g.
   *  user moved the repo), recreate. If it's a regular file
   *  byte-identical to source, replace with a symlink.
   *
   *  Production path is unchanged — `safeOverwriteDirContents`
   *  still copies real files when `app.isPackaged === true`.
   *
   *  Single-level only — `help/` has no subdirectories today (one
   *  flat .html file: canvas-actions-demo.html, post-ENH-135 +
   *  ENH-138). If that changes, this helper needs to recurse. */
  private async maintainHelpSymlinksInDev(sourceHelpDir: string): Promise<void> {
    try {
      await fs.access(sourceHelpDir)
    } catch {
      // Source dir doesn't exist (weird env). Skip silently — the
      // app should still launch even if help/ is unmaintained.
      return
    }
    await fs.mkdir(HELP_DEST_DIR, { recursive: true })
    const entries = await fs.readdir(sourceHelpDir, { withFileTypes: true })
    for (const e of entries) {
      if (!e.isFile()) continue
      const sourcePath = path.join(sourceHelpDir, e.name)
      const destPath = path.join(HELP_DEST_DIR, e.name)
      let shouldSymlink = true
      try {
        const stat = await fs.lstat(destPath)
        if (stat.isSymbolicLink()) {
          const linkTarget = await fs.readlink(destPath)
          if (linkTarget === sourcePath) {
            // Already correct — nothing to do.
            shouldSymlink = false
          } else {
            // Stale symlink (e.g. repo moved). Replace.
            await fs.unlink(destPath)
          }
        } else if (stat.isFile()) {
          const sourceBuf = await fs.readFile(sourcePath)
          const destBuf = await fs.readFile(destPath)
          if (!sourceBuf.equals(destBuf)) {
            // User customized the installed copy (uncommon in dev).
            // Leave alone — don't trample their edits.
            shouldSymlink = false
          } else {
            // Byte-identical — safe to replace with a symlink.
            await fs.unlink(destPath)
          }
        } else {
          // Directory or other — leave alone.
          shouldSymlink = false
        }
      } catch {
        // Destination didn't exist — fall through to create symlink.
      }
      if (shouldSymlink) {
        try {
          await fs.symlink(sourcePath, destPath)
        } catch (err) {
          // Best-effort. Symlink creation can fail on read-only
          // file systems or weird perms; falling back means the
          // user sees the stale (but still readable) help file.
          console.warn(
            `[install] dev-symlink ${destPath} -> ${sourcePath} failed:`,
            (err as Error)?.message ?? err
          )
        }
      }
    }
  }

  /** Recursive directory variant. Walks `srcDir` and applies
   *  `safeOverwriteFile` to each file; recurses into sub-dirs. */
  private async safeOverwriteDirContents(
    srcDir: string,
    destDir: string,
    prevShas: Record<string, string> | undefined,
    results: FileInstallResult[],
    excludeTopLevel?: Set<string>
  ): Promise<void> {
    let resolved = srcDir
    try {
      await fs.access(resolved)
    } catch {
      const res = this.resourcesRoot()
      if (!res) return
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
      // ENH-051 — `excludeTopLevel` is consulted ONLY for entries at
      // this top level (the recursive call below doesn't propagate
      // it). Used by the packs/ copy to skip fork-disabled packs at
      // the root without affecting the recursion into kept packs'
      // canvases/ + lesson-skill/ subdirs.
      if (excludeTopLevel?.has(e.name)) continue
      const s = path.join(resolved, e.name)
      const d = path.join(destDir, e.name)
      if (e.isDirectory()) {
        await this.safeOverwriteDirContents(s, d, prevShas, results)
      } else if (e.isFile()) {
        const result = await this.safeOverwriteFile(s, d, prevShas)
        results.push(result)
      }
    }
  }

  // ── Legacy helpers (kept for the bootstrap-only paths) ──────────────────────

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

  /**
   * ENH-017 — banner-driven "Add ~/.local/bin to PATH" action.
   *
   * Detects the user's shell from `$SHELL`, picks the right rc file
   * (`~/.zshrc`, `~/.bash_profile`, `~/.config/fish/config.fish`),
   * and appends a fenced block that prepends `~/.local/bin` to PATH.
   *
   * Idempotent: re-running detects the fence and returns
   * `{ alreadyPresent: true }` without rewriting.
   *
   * Failure modes (all surface as `{ ok: false, error }`): unrecognized
   * shell, rc file not writable, fs error.
   */
  async addToShellPath(): Promise<AddToShellPathResult> {
    const shellEnv = process.env.SHELL ?? ''
    const basename = path.basename(shellEnv)
    let shell: 'zsh' | 'bash' | 'fish'
    let rcFile: string
    let block: string

    // Fenced block markers — we look for these on re-runs to detect
    // a prior install. Keep simple + grep-able so the user can find
    // them if they want to remove the line by hand.
    const FENCE_OPEN = '# >>> duo PATH (added by Duo installer; safe to remove or move) >>>'
    const FENCE_CLOSE = '# <<< duo PATH <<<'

    if (basename === 'zsh') {
      shell = 'zsh'
      rcFile = path.join(HOME, '.zshrc')
      block = `\n${FENCE_OPEN}\nexport PATH="$HOME/.local/bin:$PATH"\n${FENCE_CLOSE}\n`
    } else if (basename === 'bash') {
      shell = 'bash'
      // macOS Terminal launches login shells, which read ~/.bash_profile
      // (NOT ~/.bashrc). Use .bash_profile as the canonical write target.
      rcFile = path.join(HOME, '.bash_profile')
      block = `\n${FENCE_OPEN}\nexport PATH="$HOME/.local/bin:$PATH"\n${FENCE_CLOSE}\n`
    } else if (basename === 'fish') {
      shell = 'fish'
      rcFile = path.join(HOME, '.config', 'fish', 'config.fish')
      // Fish uses different syntax (no `export`, separate `set` for PATH).
      block = `\n${FENCE_OPEN}\nset -gx PATH $HOME/.local/bin $PATH\n${FENCE_CLOSE}\n`
    } else {
      return {
        ok: false,
        error: `Unrecognized shell: ${shellEnv || '(unset)'}. Add this line to your shell rc manually: export PATH="$HOME/.local/bin:$PATH"`
      }
    }

    // Read existing content (or fall through to "create new file"). The
    // fish rc file may live in a directory that doesn't exist yet.
    let existing = ''
    try {
      existing = await fs.readFile(rcFile, 'utf8')
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code
      if (code !== 'ENOENT') {
        return { ok: false, error: `Could not read ${rcFile}: ${(err as Error).message}` }
      }
      // ENOENT — file doesn't exist; we'll create it below.
    }

    if (existing.includes(FENCE_OPEN)) {
      return { ok: true, rcFile, shell, alreadyPresent: true }
    }

    try {
      // Ensure parent dir exists (matters for fish's nested config dir).
      await fs.mkdir(path.dirname(rcFile), { recursive: true })
      await fs.appendFile(rcFile, block, 'utf8')
    } catch (err) {
      return { ok: false, error: `Could not write to ${rcFile}: ${(err as Error).message}` }
    }

    return { ok: true, rcFile, shell, alreadyPresent: false }
  }
}

/**
 * ENH-156 — inspect SHIM_DIR/duo and return a structured state for
 * `planCliShim`. Exported for testing the I/O wrapper indirectly (the
 * pure planner is the primary test surface).
 *
 * `lstat` rather than `stat` so we see the symlink itself rather than
 * what it points at. For symlinks, we then `stat` to detect the
 * dangling case (`stat` follows the link; ENOENT on `stat` after
 * successful `lstat` means broken).
 */
export async function readShimState(shimPath: string): Promise<ShimState> {
  let lst
  try {
    lst = await fs.lstat(shimPath)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code
    if (code === 'ENOENT') return { kind: 'missing' }
    throw err
  }
  if (!lst.isSymbolicLink()) return { kind: 'non-symlink' }
  let target: string
  try {
    target = await fs.readlink(shimPath)
  } catch {
    return { kind: 'broken-symlink', target: '' }
  }
  try {
    await fs.stat(shimPath)
    return { kind: 'symlink', target }
  } catch {
    return { kind: 'broken-symlink', target }
  }
}

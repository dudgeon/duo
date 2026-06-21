// ENH-223 — building (and safety-gating) the `claude` command a scheduled
// run types into its terminal tab. Pure + dependency-free + unit-tested.
//
// The established Duo pattern for "spawn a tab running a specific `claude …`
// invocation" is `dispatchNewTabToWindow({ kind: 'shell', cwd, cmd })` where
// `cmd` is the full line WITH a trailing newline (so the shell auto-runs it).
// We mirror `buildResumeCommand` (electron/claude-session-tracker.ts) for the
// resume path and add fresh + positional-prompt builders here.
//
// Confirmed Claude Code primitives (claude-code-guide, ENH-223 §5):
//   fresh  : claude --session-id <uuid> "<instruction>"   (pre-allocate id, D3)
//   resume : claude --resume <uuid> "<instruction>"       (same cwd only)
// Both stay INTERACTIVE (no `-p`). The instruction is the positional prompt
// (D2) — single-quoted, control-chars stripped, so a prompt that happens to
// contain `--print` is an inert quoted arg, never a flag.

import { randomUUID } from 'node:crypto'

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// Control chars to strip from a prompt before quoting. A raw newline would
// prematurely submit to Claude; the rest (CR, NUL, other C0/C1, U+2028/9 line
// separators) have no place in a single-line shell argument.
const CONTROL_CHARS = /[\u0000-\u001F\u007F\u0080-\u009F\u2028\u2029]+/g

/** Mint a fresh session id to pre-allocate for a run (D3). */
export function mintSessionId(): string {
  return randomUUID()
}

/** Canonical 8-4-4-4-12 lowercase UUID (what `--session-id`/`--resume` need). */
export function isCanonicalUuid(s: string): boolean {
  return CANONICAL_UUID.test(s)
}

/**
 * POSIX single-quote a string for safe interpolation as one shell argument.
 * Control characters (newlines especially) are collapsed to spaces first;
 * embedded single quotes use the `'\''` break-out idiom. An empty /
 * whitespace-only result returns `''`.
 */
export function shellQuoteArg(s: string): string {
  const cleaned = s.replace(CONTROL_CHARS, ' ').trim()
  if (cleaned === '') return "''"
  return "'" + cleaned.replace(/'/g, "'\\''") + "'"
}

function assertUuid(uuid: string): void {
  if (!isCanonicalUuid(uuid)) {
    throw new Error(`cron: session id must be a canonical UUID, got "${uuid}"`)
  }
}

/**
 * Fresh-run command: pre-allocate `uuid` via `--session-id` so the job can
 * resume exactly this session next time (D3). Trailing newline auto-runs it.
 * When the instruction is empty, the positional prompt is omitted.
 */
export function buildFreshRunCommand(uuid: string, instruction: string): string {
  assertUuid(uuid)
  const prompt = instruction.trim() ? ` ${shellQuoteArg(instruction)}` : ''
  return `claude --session-id ${uuid}${prompt}\n`
}

/**
 * Resume-run command: continue the prior session `uuid`, seeding the next
 * instruction (D3). Caller must have confirmed the session still exists.
 */
export function buildResumeRunCommand(uuid: string, instruction: string): string {
  assertUuid(uuid)
  const prompt = instruction.trim() ? ` ${shellQuoteArg(instruction)}` : ''
  return `claude --resume ${uuid}${prompt}\n`
}

// Headless triggers we refuse unless FEATURE_HEADLESS_CRON is on (D4). These
// are matched as whole tokens OUTSIDE single quotes, so a quoted instruction
// containing one of these words is never mistaken for a flag.
const HEADLESS_TOKENS = new Set(['-p', '--print', '--bare'])
const HEADLESS_PREFIXES = ['--output-format']

/** Split a command line into whitespace-delimited tokens, IGNORING anything
 *  inside single quotes (which is how we quote the instruction). */
function tokenizeOutsideQuotes(command: string): string[] {
  const tokens: string[] = []
  let cur = ''
  let inQuote = false
  for (const ch of command) {
    if (ch === "'") {
      inQuote = !inQuote
      continue
    }
    if (!inQuote && /\s/.test(ch)) {
      if (cur) {
        tokens.push(cur)
        cur = ''
      }
      continue
    }
    if (!inQuote) cur += ch
  }
  if (cur) tokens.push(cur)
  return tokens
}

/**
 * Defense-in-depth gate (D4): throw if `command` carries a headless trigger
 * unless `headlessAllowed`. Our own builders never emit one, so for Tier 1
 * this always passes — it's load-bearing only if/when raw commands are ever
 * accepted. Returns the command unchanged when it passes (convenient to wrap).
 */
export function assertInteractiveCommand(command: string, opts: { headlessAllowed: boolean }): string {
  if (opts.headlessAllowed) return command
  for (const tok of tokenizeOutsideQuotes(command)) {
    if (HEADLESS_TOKENS.has(tok) || HEADLESS_PREFIXES.some((p) => tok === p || tok.startsWith(p + '='))) {
      throw new Error(
        `cron: headless runs are disabled — the command uses "${tok}". Scheduled runs are interactive only ` +
          `(Duo does session start + initial instruction). Enable FEATURE_HEADLESS_CRON to allow headless.`
      )
    }
  }
  return command
}

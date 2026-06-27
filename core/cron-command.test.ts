// ENH-223 — command building + the headless (-p) gate.
import { describe, it, expect } from 'vitest'
import {
  mintSessionId,
  isCanonicalUuid,
  shellQuoteArg,
  buildFreshRunCommand,
  buildResumeRunCommand,
  buildShellCommand,
  validateShellCommand,
  assertInteractiveCommand,
} from './cron-command'

const UUID = '550e8400-e29b-41d4-a716-446655440000'

describe('mintSessionId / isCanonicalUuid', () => {
  it('mints canonical UUIDs', () => {
    const id = mintSessionId()
    expect(isCanonicalUuid(id)).toBe(true)
  })
  it('rejects non-canonical ids', () => {
    expect(isCanonicalUuid('not-a-uuid')).toBe(false)
    expect(isCanonicalUuid('550E8400-E29B-41D4-A716-446655440000')).toBe(false) // uppercase
    expect(isCanonicalUuid('')).toBe(false)
  })
})

describe('shellQuoteArg', () => {
  it('quotes a normal prompt', () => {
    expect(shellQuoteArg('review open PRs')).toBe("'review open PRs'")
  })
  it('escapes embedded single quotes with the break-out idiom', () => {
    expect(shellQuoteArg("it's done")).toBe("'it'\\''s done'")
  })
  it('collapses newlines/control chars to a space (no premature submit)', () => {
    expect(shellQuoteArg('line one\nline two')).toBe("'line one line two'")
    expect(shellQuoteArg('a\tb\r\nc')).toBe("'a b c'")
  })
  it('returns empty quotes for blank input', () => {
    expect(shellQuoteArg('   ')).toBe("''")
  })
  it('leaves shell metacharacters inert inside single quotes ($ , backtick, backslash)', () => {
    // $, a backtick, $(...) command substitution, and a backslash are ALL inert
    // inside POSIX single quotes — the shell does no expansion there. So they
    // must pass through verbatim with no escaping (escaping them would actually
    // change the literal text the prompt carries). Single quotes wrap the
    // unchanged content.
    const meta = 'cost $5 `whoami` $(rm -rf /) back\\slash'
    expect(shellQuoteArg(meta)).toBe("'cost $5 `whoami` $(rm -rf /) back\\slash'")
  })
  it('breaks out embedded single quotes safely', () => {
    // The only character single-quoting can't carry literally is the single
    // quote itself; the standard break-out idiom is close-quote, escaped quote,
    // reopen-quote → '\''.
    expect(shellQuoteArg("it's a test")).toBe("'it'\\''s a test'")
  })
})

describe('buildFreshRunCommand', () => {
  it('pre-allocates the session id and seeds the prompt', () => {
    expect(buildFreshRunCommand(UUID, 'do the thing')).toBe(`claude --session-id ${UUID} 'do the thing'\n`)
  })
  it('omits the positional prompt when the instruction is empty', () => {
    expect(buildFreshRunCommand(UUID, '   ')).toBe(`claude --session-id ${UUID}\n`)
  })
  it('rejects a non-canonical uuid', () => {
    expect(() => buildFreshRunCommand('bad', 'x')).toThrow(/canonical UUID/)
  })
})

describe('buildResumeRunCommand', () => {
  it('resumes with the seeded prompt', () => {
    expect(buildResumeRunCommand(UUID, 'continue')).toBe(`claude --resume ${UUID} 'continue'\n`)
  })
})

describe('buildShellCommand (shell jobs)', () => {
  it('returns the raw command verbatim plus a trailing newline (no quoting)', () => {
    expect(buildShellCommand('qmd update && qmd embed')).toBe('qmd update && qmd embed\n')
  })
  it('trims surrounding whitespace before appending the newline', () => {
    expect(buildShellCommand('  echo hi  ')).toBe('echo hi\n')
  })
  it('rejects an empty / whitespace-only command', () => {
    expect(() => buildShellCommand('')).toThrow(/must not be empty/)
    expect(() => buildShellCommand('   ')).toThrow(/must not be empty/)
  })
  it('rejects an embedded newline (would split / inject a command)', () => {
    expect(() => buildShellCommand('echo one\necho two')).toThrow(/single line/)
    expect(() => buildShellCommand('echo one\r\necho two')).toThrow(/single line/)
  })
})

describe('validateShellCommand', () => {
  it('returns the trimmed command WITHOUT a trailing newline (storage form)', () => {
    expect(validateShellCommand('  qmd update  ')).toBe('qmd update')
  })
  it('rejects empty + multiline the same way buildShellCommand does', () => {
    expect(() => validateShellCommand('   ')).toThrow(/must not be empty/)
    expect(() => validateShellCommand('a\nb')).toThrow(/single line/)
  })
})

describe('assertInteractiveCommand (D4 headless gate)', () => {
  it('passes our own fresh/resume commands', () => {
    const cmd = buildFreshRunCommand(UUID, 'review PRs')
    expect(() => assertInteractiveCommand(cmd, { headlessAllowed: false })).not.toThrow()
  })

  it('ignores headless words INSIDE the quoted instruction', () => {
    // The instruction literally says "--print" — but it's single-quoted, so
    // it's an inert positional arg, not a flag.
    const cmd = buildFreshRunCommand(UUID, 'explain the --print flag')
    expect(() => assertInteractiveCommand(cmd, { headlessAllowed: false })).not.toThrow()
  })

  it('rejects an actual headless flag when the flag is off', () => {
    expect(() => assertInteractiveCommand(`claude -p 'x'\n`, { headlessAllowed: false })).toThrow(/headless/)
    expect(() => assertInteractiveCommand(`claude --print 'x'\n`, { headlessAllowed: false })).toThrow(/headless/)
    expect(() => assertInteractiveCommand(`claude --output-format json 'x'\n`, { headlessAllowed: false })).toThrow(
      /headless/
    )
    expect(() => assertInteractiveCommand(`claude --bare 'x'\n`, { headlessAllowed: false })).toThrow(/headless/)
  })

  it('allows headless flags when the feature flag is on', () => {
    expect(() => assertInteractiveCommand(`claude -p 'x'\n`, { headlessAllowed: true })).not.toThrow()
  })
})

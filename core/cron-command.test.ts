// ENH-223 — command building + the headless (-p) gate.
import { describe, it, expect } from 'vitest'
import {
  mintSessionId,
  isCanonicalUuid,
  shellQuoteArg,
  buildFreshRunCommand,
  buildResumeRunCommand,
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

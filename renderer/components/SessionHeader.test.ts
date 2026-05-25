import { describe, it, expect } from 'vitest'
import { computeSessionHeaderState } from './SessionHeader'

describe('computeSessionHeaderState', () => {
  it('S0 — no captured session UUID, no claude → no header', () => {
    expect(computeSessionHeaderState({
      lastClaudeSession: null,
      claudePresence: 'no-pty',
      dismissedBanner: false,
    })).toBe('S0')
  })

  it('S0 — no captured session UUID even when claude is running', () => {
    expect(computeSessionHeaderState({
      lastClaudeSession: null,
      claudePresence: 'claude',
      dismissedBanner: false,
    })).toBe('S0')
  })

  it('S0 — undefined lastClaudeSession degrades safely to S0', () => {
    expect(computeSessionHeaderState({
      lastClaudeSession: undefined,
      claudePresence: 'shell',
      dismissedBanner: false,
    })).toBe('S0')
  })

  it('S0 — S3 banner dismissed (claude still not running), no render', () => {
    expect(computeSessionHeaderState({
      lastClaudeSession: { id: 'abc-123', capturedAt: Date.now() },
      claudePresence: 'shell',
      dismissedBanner: true,
    })).toBe('S0')
  })

  it('BUG-160 — dismissedBanner only suppresses S3, never short-circuits globally', () => {
    // Pre-fix: dismissedBanner short-circuited to S0 for ALL states.
    // Post-fix: it only affects the S3 branch. Combined with the
    // 2026-05-25 Option-A pare-back (no S2 surface), the live-claude
    // case returns S0 regardless of dismissedBanner — but for the
    // RIGHT reason (no banner needed; tab title carries the name),
    // not because the flag short-circuited.
    expect(computeSessionHeaderState({
      lastClaudeSession: { id: 'abc-123', capturedAt: Date.now() },
      claudePresence: 'claude',
      dismissedBanner: true,
    })).toBe('S0')

    // The actual bite of BUG-160: shell + UUID + dismissed should NOT
    // re-fire S3 (would loop endlessly). Stays S0.
    expect(computeSessionHeaderState({
      lastClaudeSession: { id: 'abc-123', capturedAt: Date.now() },
      claudePresence: 'shell',
      dismissedBanner: true,
    })).toBe('S0')
  })

  it('Option-A pare — captured UUID + claude live → S0 (no S2 banner)', () => {
    // Pre-pare (2026-05-25): returned S2 (named-session banner above
    // xterm with title + inline-rename affordance). Owner observed it
    // was redundant with the tab title's ✳ Haiku-derived name and
    // directed the pare-back. Live claude → no Duo banner.
    expect(computeSessionHeaderState({
      lastClaudeSession: { id: 'abc-123', capturedAt: Date.now() },
      claudePresence: 'claude',
      dismissedBanner: false,
    })).toBe('S0')

    expect(computeSessionHeaderState({
      lastClaudeSession: { id: 'abc-123', capturedAt: Date.now() },
      claudePresence: 'starting',
      dismissedBanner: false,
    })).toBe('S0')
  })

  it('S3 — captured UUID + shell (no claude yet) → restore offer', () => {
    expect(computeSessionHeaderState({
      lastClaudeSession: { id: 'abc-123', capturedAt: Date.now() },
      claudePresence: 'shell',
      dismissedBanner: false,
    })).toBe('S3')
  })

  it('S3 — captured UUID + no-pty → restore offer (tab not yet spawned)', () => {
    expect(computeSessionHeaderState({
      lastClaudeSession: { id: 'abc-123', capturedAt: Date.now() },
      claudePresence: 'no-pty',
      dismissedBanner: false,
    })).toBe('S3')
  })

  it('S1 — no UUID + no claude + prior sessions exist → resume pills', () => {
    expect(computeSessionHeaderState({
      lastClaudeSession: null,
      claudePresence: 'shell',
      dismissedBanner: false,
      priorSessionsCount: 3,
    })).toBe('S1')
  })

  it('S1 — no UUID + no claude + many prior sessions → still S1', () => {
    expect(computeSessionHeaderState({
      lastClaudeSession: null,
      claudePresence: 'no-pty',
      dismissedBanner: false,
      priorSessionsCount: 80,
    })).toBe('S1')
  })

  it('S0 — no UUID + claude already live → no pills (would be redundant)', () => {
    expect(computeSessionHeaderState({
      lastClaudeSession: null,
      claudePresence: 'claude',
      dismissedBanner: false,
      priorSessionsCount: 5,
    })).toBe('S0')
  })

  it('S0 — no UUID + no prior sessions → no header at all', () => {
    expect(computeSessionHeaderState({
      lastClaudeSession: null,
      claudePresence: 'shell',
      dismissedBanner: false,
      priorSessionsCount: 0,
    })).toBe('S0')
  })

  it('Option-A pare — captured UUID + claude live + prior sessions → S0 (no banner)', () => {
    // Pre-pare: would have returned S2 (named banner takes precedence
    // over S1 pills). Post-pare: live claude with UUID returns S0
    // unconditionally — tab title carries the session name.
    expect(computeSessionHeaderState({
      lastClaudeSession: { id: 'abc', capturedAt: 1 },
      claudePresence: 'claude',
      dismissedBanner: false,
      priorSessionsCount: 5,
    })).toBe('S0')
  })

  it('S3 takes precedence over S1 when both could apply', () => {
    expect(computeSessionHeaderState({
      lastClaudeSession: { id: 'abc', capturedAt: 1 },
      claudePresence: 'shell',
      dismissedBanner: false,
      priorSessionsCount: 5,
    })).toBe('S3')
  })

  it('dismissedBanner overrides everything', () => {
    expect(computeSessionHeaderState({
      lastClaudeSession: null,
      claudePresence: 'shell',
      dismissedBanner: true,
      priorSessionsCount: 10,
    })).toBe('S0')
  })
})

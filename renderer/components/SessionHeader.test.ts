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

  it('S0 — banner dismissed, no further render even with captured UUID', () => {
    expect(computeSessionHeaderState({
      lastClaudeSession: { id: 'abc-123', capturedAt: Date.now() },
      claudePresence: 'shell',
      dismissedBanner: true,
    })).toBe('S0')
  })

  it('S2 — captured UUID + claude running → S2 (lands in C5)', () => {
    expect(computeSessionHeaderState({
      lastClaudeSession: { id: 'abc-123', capturedAt: Date.now() },
      claudePresence: 'claude',
      dismissedBanner: false,
    })).toBe('S2')
  })

  it('S2 — captured UUID + claude starting → S2 (Claude is booting)', () => {
    expect(computeSessionHeaderState({
      lastClaudeSession: { id: 'abc-123', capturedAt: Date.now() },
      claudePresence: 'starting',
      dismissedBanner: false,
    })).toBe('S2')
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

  it('S2 takes precedence over S1 when both could apply', () => {
    // Captured UUID + claude live + prior sessions exist → S2 wins.
    expect(computeSessionHeaderState({
      lastClaudeSession: { id: 'abc', capturedAt: 1 },
      claudePresence: 'claude',
      dismissedBanner: false,
      priorSessionsCount: 5,
    })).toBe('S2')
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

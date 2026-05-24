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
})

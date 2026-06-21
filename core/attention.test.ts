import { describe, it, expect } from 'vitest'
import { attentionForEvent } from './attention'

describe('attentionForEvent (ENH-225 clear-behavior contract)', () => {
  it('SETS attention on idle / prompting events', () => {
    expect(attentionForEvent('Stop')).toBe(true)
    expect(attentionForEvent('Notification')).toBe(true)
    expect(attentionForEvent('set')).toBe(true)
  })

  it('CLEARS on the activity event + explicit clears', () => {
    expect(attentionForEvent('UserPromptSubmit')).toBe(false)
    expect(attentionForEvent('clear')).toBe(false)
    expect(attentionForEvent('active')).toBe(false)
  })

  it('fails toward needs-attention on an unknown event', () => {
    // a new Claude hook event must NOT silently no-op the badge
    expect(attentionForEvent('SessionEnd')).toBe(true)
    expect(attentionForEvent('')).toBe(true)
  })

  it('trims surrounding whitespace', () => {
    expect(attentionForEvent('  UserPromptSubmit  ')).toBe(false)
    expect(attentionForEvent('  Stop ')).toBe(true)
  })
})

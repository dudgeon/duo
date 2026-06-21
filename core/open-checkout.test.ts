// ENH-224 Phase 1 — pure helpers of the managed checkout. The clone itself is
// network/git (verified live), so these pin the deterministic-dir + SHA-detect
// logic that decides where a doc lands and whether it needs --branch vs checkout.

import { describe, it, expect } from 'vitest'
import { managedCheckoutDir, isLikelySha } from './open-checkout'

describe('managedCheckoutDir — opaque deterministic dir (DR6)', () => {
  it('owner-repo@ref under the base dir', () => {
    expect(managedCheckoutDir('dudgeon', 'duo', 'main', '/base')).toBe('/base/dudgeon-duo@main')
  })

  it('sanitizes a slashed branch ref into one segment', () => {
    expect(managedCheckoutDir('o', 'r', 'release/1.x', '/base')).toBe('/base/o-r@release-1.x')
  })

  it('keeps dots + dashes (tags like v1.2.3)', () => {
    expect(managedCheckoutDir('o', 'r', 'v1.2.3', '/base')).toBe('/base/o-r@v1.2.3')
  })

  it('an empty ref falls back to @HEAD', () => {
    expect(managedCheckoutDir('o', 'r', '', '/base')).toBe('/base/o-r@HEAD')
  })

  it('is deterministic (same inputs → same dir, for idempotent reuse)', () => {
    const a = managedCheckoutDir('o', 'r', 'main', '/base')
    const b = managedCheckoutDir('o', 'r', 'main', '/base')
    expect(a).toBe(b)
  })
})

describe('isLikelySha — picks the clone+checkout path vs --branch', () => {
  it('7–40 char hex → SHA', () => {
    expect(isLikelySha('abc1234')).toBe(true)
    expect(isLikelySha('0123456789abcdef0123456789abcdef01234567')).toBe(true)
    expect(isLikelySha('DEADBEEF')).toBe(true) // case-insensitive
  })

  it('branch/tag names → not a SHA', () => {
    expect(isLikelySha('main')).toBe(false)
    expect(isLikelySha('v1.0.0')).toBe(false)
    expect(isLikelySha('release/1.x')).toBe(false)
  })

  it('too short (<7) or non-hex → not a SHA', () => {
    expect(isLikelySha('123456')).toBe(false) // 6 chars
    expect(isLikelySha('abc123z')).toBe(false) // z is not hex
  })
})

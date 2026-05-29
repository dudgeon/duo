// BUG-167 (folded into ENH-182) — pins the prune util's invariants so
// the navigator's mount-time cleanup can't regress silently. The
// load-bearing cases are (a) probe failure keeps the entry (no
// speculative drops) and (b) ancestor walk stops at the fallback when
// the whole chain is gone.

import { describe, it, expect, vi } from 'vitest'
import { findDeadExpandedPaths, nearestExistingAncestor } from './pruneDeadPaths'

describe('findDeadExpandedPaths', () => {
  it('returns paths whose probe resolved false', async () => {
    const probe = vi.fn(async (p: string) =>
      p === '/alive' || p === '/also-alive'
    )
    const dead = await findDeadExpandedPaths(
      ['/alive', '/dead', '/also-alive', '/also-dead'],
      probe
    )
    expect(dead.sort()).toEqual(['/also-dead', '/dead'])
  })

  it('keeps entries whose probe threw (transient IPC failure)', async () => {
    // A throw must NOT be classified as dead — that would let a
    // permission flake or socket hiccup wipe legit nav state.
    const probe = vi.fn(async (p: string) => {
      if (p === '/throws') throw new Error('boom')
      return false
    })
    const dead = await findDeadExpandedPaths(['/throws', '/dead'], probe)
    expect(dead).toEqual(['/dead'])
  })

  it('returns [] for an empty set without calling the probe', async () => {
    const probe = vi.fn(async () => false)
    expect(await findDeadExpandedPaths([], probe)).toEqual([])
    expect(probe).not.toHaveBeenCalled()
  })

  it('probes in parallel (one Promise.all, not serial)', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const probe = vi.fn(async (_p: string) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise(r => setTimeout(r, 1))
      inFlight--
      return true
    })
    await findDeadExpandedPaths(['/a', '/b', '/c', '/d'], probe)
    expect(maxInFlight).toBe(4)
  })
})

describe('nearestExistingAncestor', () => {
  it('returns the first ancestor whose probe resolves true', async () => {
    const probe = async (p: string) => p === '/Users/x'
    const out = await nearestExistingAncestor(
      '/Users/x/dead-project/skills/setup-check-workspace',
      probe,
      '/'
    )
    expect(out).toBe('/Users/x')
  })

  it('returns the fallback when no ancestor exists below root', async () => {
    const probe = async () => false
    const out = await nearestExistingAncestor('/Users/x/gone', probe, '/fallback')
    expect(out).toBe('/fallback')
  })

  it('keeps walking past a probe that threw', async () => {
    // A thrown probe is "unknown", not "dead" — the loop continues
    // upward rather than treating the throw as truth.
    const probe = async (p: string) => {
      if (p === '/Users/x/mid') throw new Error('eperm')
      return p === '/Users/x'
    }
    const out = await nearestExistingAncestor(
      '/Users/x/mid/gone',
      probe,
      '/'
    )
    expect(out).toBe('/Users/x')
  })

  it('stops at the root boundary even if probe never resolves true', async () => {
    // Pathological case: the loop must terminate even when nothing
    // qualifies. `/` is always assumed to exist via the fallback.
    const probe = async () => false
    const out = await nearestExistingAncestor('/a/b/c', probe, '/')
    expect(out).toBe('/')
  })
})

// BUG-167 (folded into ENH-182) — pins the prune util's invariants so
// the navigator's mount-time cleanup can't regress silently. The
// load-bearing cases are (a) probe failure keeps the entry (no
// speculative drops) and (b) ancestor walk stops at the fallback when
// the whole chain is gone.

import { describe, it, expect, vi } from 'vitest'
import { findDeadExpandedPaths, nearestExistingAncestor, pathIsWithin } from './pruneDeadPaths'

// ENH-221 (D6) — the worktree-removal heal keys on pathIsWithin to decide
// whether a dead cwd is the just-removed worktree (revert to its main) vs.
// an unrelated dead path (ancestor fallback). The boundary case is the
// regression risk: a sibling whose name PREFIXES the worktree's.
describe('pathIsWithin', () => {
  const wt = '/Users/me/duo/.claude/worktrees/q3-pricing'
  it('matches the worktree root itself and any nested path', () => {
    expect(pathIsWithin(wt, wt)).toBe(true)
    expect(pathIsWithin(wt + '/src/index.ts', wt)).toBe(true)
    expect(pathIsWithin(wt + '/', wt)).toBe(true)
  })
  it('does NOT match a sibling whose name prefixes the worktree', () => {
    expect(pathIsWithin('/Users/me/duo/.claude/worktrees/q3-pricing-v2', wt)).toBe(false)
    expect(pathIsWithin('/Users/me/duo/.claude/worktrees', wt)).toBe(false)
    expect(pathIsWithin('/Users/me/other', wt)).toBe(false)
  })
  it('is false for an empty ancestor (no revert target captured)', () => {
    expect(pathIsWithin(wt, '')).toBe(false)
  })
})

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

// ENH-224 Phase 3 — unit tests for the pure clone-match helper. The async
// matchLocalClone (git + fs reads) is verified live, like the other run*/probe*
// functions.

import { describe, it, expect } from 'vitest'
import { remoteMatchesRepo } from './local-clone-match'

describe('local-clone-match — remoteMatchesRepo', () => {
  it('matches an https remote (with/without .git)', () => {
    expect(remoteMatchesRepo('https://github.com/octocat/Spoon-Knife.git', 'octocat', 'Spoon-Knife')).toBe(true)
    expect(remoteMatchesRepo('https://github.com/octocat/Spoon-Knife', 'octocat', 'Spoon-Knife')).toBe(true)
  })
  it('matches an ssh / git@ remote', () => {
    expect(remoteMatchesRepo('git@github.com:octocat/Spoon-Knife.git', 'octocat', 'Spoon-Knife')).toBe(true)
    expect(remoteMatchesRepo('ssh://git@github.com/octocat/Spoon-Knife.git', 'octocat', 'Spoon-Knife')).toBe(true)
  })
  it('is case-insensitive on owner/repo (GitHub is)', () => {
    expect(remoteMatchesRepo('https://github.com/OctoCat/spoon-knife', 'octocat', 'Spoon-Knife')).toBe(true)
  })
  it('rejects a different repo / owner', () => {
    expect(remoteMatchesRepo('https://github.com/octocat/Hello-World', 'octocat', 'Spoon-Knife')).toBe(false)
    expect(remoteMatchesRepo('https://github.com/someone/Spoon-Knife', 'octocat', 'Spoon-Knife')).toBe(false)
  })
  it('rejects an unparseable / empty remote', () => {
    expect(remoteMatchesRepo('', 'octocat', 'Spoon-Knife')).toBe(false)
    expect(remoteMatchesRepo('not a url', 'octocat', 'Spoon-Knife')).toBe(false)
  })
  it('matches an enterprise GitHub host (host-agnostic on owner/repo)', () => {
    expect(remoteMatchesRepo('https://github.acme.com/team/proj.git', 'team', 'proj')).toBe(true)
  })
})

// Vitest coverage for core/git/remote-url.ts — ENH-155 helper.
//
// Pure-function tests; no I/O. The `gitHubUrlFor` async wrapper isn't
// covered here (would need a git fixture) — exercised in the dev session
// directly via right-click on a file in this repo.

import { describe, expect, it } from 'vitest'
import {
  parseRemoteUrl,
  isGitHubHost,
  composeGitHubUrl
} from './remote-url'

describe('parseRemoteUrl()', () => {
  it('parses https://github.com/owner/repo', () => {
    expect(parseRemoteUrl('https://github.com/dudgeon/duo')).toEqual({
      host: 'github.com', owner: 'dudgeon', repo: 'duo'
    })
  })

  it('parses https://github.com/owner/repo.git', () => {
    expect(parseRemoteUrl('https://github.com/dudgeon/duo.git')).toEqual({
      host: 'github.com', owner: 'dudgeon', repo: 'duo'
    })
  })

  it('parses git@github.com:owner/repo.git', () => {
    expect(parseRemoteUrl('git@github.com:dudgeon/duo.git')).toEqual({
      host: 'github.com', owner: 'dudgeon', repo: 'duo'
    })
  })

  it('parses ssh://git@github.com/owner/repo.git', () => {
    expect(parseRemoteUrl('ssh://git@github.com/dudgeon/duo.git')).toEqual({
      host: 'github.com', owner: 'dudgeon', repo: 'duo'
    })
  })

  it('parses github enterprise host', () => {
    expect(parseRemoteUrl('https://github.acme.com/team/project.git')).toEqual({
      host: 'github.acme.com', owner: 'team', repo: 'project'
    })
  })

  it('parses git@github-enterprise-host:owner/repo', () => {
    expect(parseRemoteUrl('git@github.acme.com:team/project.git')).toEqual({
      host: 'github.acme.com', owner: 'team', repo: 'project'
    })
  })

  it('returns null for empty / whitespace', () => {
    expect(parseRemoteUrl('')).toBeNull()
    expect(parseRemoteUrl('   ')).toBeNull()
  })

  it('returns null for unparseable garbage', () => {
    expect(parseRemoteUrl('not a url')).toBeNull()
  })
})

describe('isGitHubHost()', () => {
  it('recognises github.com', () => {
    expect(isGitHubHost('github.com')).toBe(true)
  })

  it('recognises github enterprise .com hosts', () => {
    expect(isGitHubHost('github.acme.com')).toBe(true)
  })

  it('recognises github.<company> hosts (no .com suffix)', () => {
    expect(isGitHubHost('github.internal')).toBe(true)
  })

  it('rejects gitlab', () => {
    expect(isGitHubHost('gitlab.com')).toBe(false)
  })

  it('rejects bitbucket', () => {
    expect(isGitHubHost('bitbucket.org')).toBe(false)
  })

  it('handles null / undefined / empty', () => {
    expect(isGitHubHost(null)).toBe(false)
    expect(isGitHubHost(undefined)).toBe(false)
    expect(isGitHubHost('')).toBe(false)
  })
})

describe('composeGitHubUrl()', () => {
  it('composes /blob/ URL for a file', () => {
    const r = composeGitHubUrl({
      remote: 'https://github.com/dudgeon/duo.git',
      branch: 'main',
      relPath: 'src/main.ts',
      isFolder: false
    })
    expect(r.url).toBe('https://github.com/dudgeon/duo/blob/main/src/main.ts')
    expect(r.host).toBe('github.com')
  })

  it('composes /tree/ URL for a folder', () => {
    const r = composeGitHubUrl({
      remote: 'git@github.com:dudgeon/duo.git',
      branch: 'main',
      relPath: 'docs/',
      isFolder: true
    })
    expect(r.url).toBe('https://github.com/dudgeon/duo/tree/main/docs')
  })

  it('returns repo-root URL for empty relPath', () => {
    const r = composeGitHubUrl({
      remote: 'https://github.com/dudgeon/duo.git',
      branch: 'main',
      relPath: '',
      isFolder: true
    })
    expect(r.url).toBe('https://github.com/dudgeon/duo')
  })

  it('URL-encodes branch with special chars', () => {
    const r = composeGitHubUrl({
      remote: 'https://github.com/dudgeon/duo.git',
      branch: 'feature/x y',
      relPath: 'file.md',
      isFolder: false
    })
    expect(r.url).toBe('https://github.com/dudgeon/duo/blob/feature%2Fx%20y/file.md')
  })

  it('preserves slashes in path while encoding segments', () => {
    const r = composeGitHubUrl({
      remote: 'https://github.com/dudgeon/duo.git',
      branch: 'main',
      relPath: 'src/sub dir/file name.ts',
      isFolder: false
    })
    expect(r.url).toBe('https://github.com/dudgeon/duo/blob/main/src/sub%20dir/file%20name.ts')
  })

  it('returns null url for unparseable remote', () => {
    const r = composeGitHubUrl({
      remote: 'not a url',
      branch: 'main',
      relPath: 'x',
      isFolder: false
    })
    expect(r.url).toBeNull()
    expect(r.host).toBeNull()
  })

  it('returns null url for non-GH host (gitlab)', () => {
    const r = composeGitHubUrl({
      remote: 'https://gitlab.com/team/proj.git',
      branch: 'main',
      relPath: 'x',
      isFolder: false
    })
    expect(r.url).toBeNull()
    expect(r.host).toBe('gitlab.com')
  })

  it('composes for GH Enterprise host (v1-Q4 yes-detect)', () => {
    const r = composeGitHubUrl({
      remote: 'https://github.acme.com/team/project.git',
      branch: 'main',
      relPath: 'README.md',
      isFolder: false
    })
    expect(r.url).toBe('https://github.acme.com/team/project/blob/main/README.md')
    expect(r.host).toBe('github.acme.com')
  })
})

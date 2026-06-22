import { describe, it, expect } from 'vitest'
import { absolutizeOpenPath } from './openPathResolve'

const HOME = '/Users/x'
const CWD = '/Users/x/proj'

describe('absolutizeOpenPath', () => {
  it('expands a bare ~ to the home dir', () => {
    expect(absolutizeOpenPath('~', HOME, CWD)).toBe('/Users/x')
  })

  it('expands ~/x to home + /x', () => {
    expect(absolutizeOpenPath('~/notes.md', HOME, CWD)).toBe('/Users/x/notes.md')
    expect(absolutizeOpenPath('~/a/b/c.md', HOME, CWD)).toBe('/Users/x/a/b/c.md')
  })

  it('does not double-slash when home has a trailing slash', () => {
    expect(absolutizeOpenPath('~/notes.md', `${HOME}/`, CWD)).toBe('/Users/x/notes.md')
  })

  it('leaves an absolute path unchanged', () => {
    expect(absolutizeOpenPath('/etc/hosts', HOME, CWD)).toBe('/etc/hosts')
    expect(absolutizeOpenPath('/Users/y/other.md', HOME, CWD)).toBe('/Users/y/other.md')
  })

  it('resolves a bare relative path against cwd', () => {
    expect(absolutizeOpenPath('draft.md', HOME, CWD)).toBe('/Users/x/proj/draft.md')
  })

  it('resolves a ./relative path against cwd', () => {
    expect(absolutizeOpenPath('./draft.md', HOME, CWD)).toBe('/Users/x/proj/./draft.md')
  })

  it('does not double-slash when cwd has a trailing slash', () => {
    expect(absolutizeOpenPath('draft.md', HOME, `${CWD}/`)).toBe('/Users/x/proj/draft.md')
  })

  it('falls back to home when cwd is undefined', () => {
    expect(absolutizeOpenPath('draft.md', HOME, undefined)).toBe('/Users/x/draft.md')
    expect(absolutizeOpenPath('draft.md', HOME)).toBe('/Users/x/draft.md')
  })

  it('resolves an empty input against cwd (joins to a trailing slash)', () => {
    // An empty raw path is not absolute, not ~, so it joins onto cwd.
    expect(absolutizeOpenPath('', HOME, CWD)).toBe('/Users/x/proj/')
  })
})

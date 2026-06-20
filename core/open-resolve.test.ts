import { describe, it, expect } from 'vitest'
import { resolveOpenTarget } from './open-resolve'

describe('resolveOpenTarget — local paths', () => {
  it('absolute path', () => {
    expect(resolveOpenTarget('/Users/me/notes/x.md')).toEqual({
      kind: 'local-path',
      path: '/Users/me/notes/x.md',
    })
  })

  it('tilde path', () => {
    expect(resolveOpenTarget('~/docs/roadmap.md')).toEqual({
      kind: 'local-path',
      path: '~/docs/roadmap.md',
    })
  })

  it('relative paths', () => {
    expect(resolveOpenTarget('./rel/x.md').kind).toBe('local-path')
    expect(resolveOpenTarget('../up/x.md').kind).toBe('local-path')
    expect(resolveOpenTarget('docs/roadmap.md')).toEqual({
      kind: 'local-path',
      path: 'docs/roadmap.md',
    })
  })

  it('trims surrounding whitespace', () => {
    expect(resolveOpenTarget('   /abs/x.md  ')).toEqual({
      kind: 'local-path',
      path: '/abs/x.md',
    })
  })

  it('empty input → empty local path', () => {
    expect(resolveOpenTarget('   ')).toEqual({ kind: 'local-path', path: '' })
  })

  it('file:// URL → local path (decoded)', () => {
    expect(resolveOpenTarget('file:///Users/me/x%20y.md')).toEqual({
      kind: 'local-path',
      path: '/Users/me/x y.md',
    })
  })

  it('bare owner/repo is a local path (not GitHub shorthand) by design', () => {
    expect(resolveOpenTarget('dudgeon/duo')).toEqual({
      kind: 'local-path',
      path: 'dudgeon/duo',
    })
  })
})

describe('resolveOpenTarget — GitHub file URLs', () => {
  it('blob URL', () => {
    expect(resolveOpenTarget('https://github.com/dudgeon/duo/blob/main/docs/roadmap.md')).toEqual({
      kind: 'github-file',
      owner: 'dudgeon',
      repo: 'duo',
      ref: 'main',
      filePath: 'docs/roadmap.md',
      canonical: 'https://github.com/dudgeon/duo/blob/main/docs/roadmap.md',
    })
  })

  it('strips a #L line anchor and query', () => {
    const t = resolveOpenTarget('https://github.com/dudgeon/duo/blob/main/docs/roadmap.md?plain=1#L42')
    expect(t.kind).toBe('github-file')
    if (t.kind === 'github-file') {
      expect(t.filePath).toBe('docs/roadmap.md')
      expect(t.canonical).toBe('https://github.com/dudgeon/duo/blob/main/docs/roadmap.md')
    }
  })

  it('raw view URL (github.com/.../raw/...)', () => {
    const t = resolveOpenTarget('https://github.com/dudgeon/duo/raw/main/assets/logo.png')
    expect(t).toMatchObject({ kind: 'github-file', ref: 'main', filePath: 'assets/logo.png' })
  })

  it('raw.githubusercontent.com URL', () => {
    expect(resolveOpenTarget('https://raw.githubusercontent.com/dudgeon/duo/main/docs/roadmap.md')).toEqual({
      kind: 'github-file',
      owner: 'dudgeon',
      repo: 'duo',
      ref: 'main',
      filePath: 'docs/roadmap.md',
      canonical: 'https://github.com/dudgeon/duo/blob/main/docs/roadmap.md',
    })
  })

  it('scheme-less github.com paste normalizes to https', () => {
    const t = resolveOpenTarget('github.com/dudgeon/duo/blob/main/README.md')
    expect(t).toMatchObject({ kind: 'github-file', owner: 'dudgeon', repo: 'duo', filePath: 'README.md' })
  })

  it('www.github.com host', () => {
    expect(resolveOpenTarget('https://www.github.com/o/r/blob/dev/a.md').kind).toBe('github-file')
  })

  it('slashed branch — documented v1 limitation (ref=first segment)', () => {
    const t = resolveOpenTarget('https://github.com/o/r/blob/feature/x/docs/a.md')
    expect(t).toMatchObject({ kind: 'github-file', ref: 'feature', filePath: 'x/docs/a.md' })
  })

  it('decodes percent-encoded path segments', () => {
    const t = resolveOpenTarget('https://github.com/o/r/blob/main/docs/a%20b.md')
    if (t.kind === 'github-file') expect(t.filePath).toBe('docs/a b.md')
    else throw new Error('expected github-file')
  })
})

describe('resolveOpenTarget — GitHub repo URLs', () => {
  it('bare repo URL', () => {
    expect(resolveOpenTarget('https://github.com/dudgeon/duo')).toEqual({
      kind: 'github-repo',
      owner: 'dudgeon',
      repo: 'duo',
      cloneUrl: 'https://github.com/dudgeon/duo',
    })
  })

  it('trailing slash', () => {
    expect(resolveOpenTarget('https://github.com/dudgeon/duo/').kind).toBe('github-repo')
  })

  it('strips .git', () => {
    const t = resolveOpenTarget('https://github.com/dudgeon/duo.git')
    expect(t).toMatchObject({ kind: 'github-repo', repo: 'duo' })
  })

  it('tree URL with ref + subdir', () => {
    expect(resolveOpenTarget('https://github.com/dudgeon/duo/tree/main/docs')).toEqual({
      kind: 'github-repo',
      owner: 'dudgeon',
      repo: 'duo',
      ref: 'main',
      subPath: 'docs',
      cloneUrl: 'https://github.com/dudgeon/duo',
    })
  })

  it('tree URL with ref only', () => {
    const t = resolveOpenTarget('https://github.com/dudgeon/duo/tree/main')
    expect(t).toMatchObject({ kind: 'github-repo', ref: 'main', subPath: undefined })
  })

  it('blob URL missing a file path falls back to repo', () => {
    expect(resolveOpenTarget('https://github.com/dudgeon/duo/blob/main').kind).toBe('github-repo')
  })
})

describe('resolveOpenTarget — other URLs', () => {
  it('non-GitHub https → url', () => {
    expect(resolveOpenTarget('https://example.com/page')).toEqual({
      kind: 'url',
      url: 'https://example.com/page',
    })
  })

  it('gist.github.com is not github.com → url (gists deferred)', () => {
    expect(resolveOpenTarget('https://gist.github.com/me/abc123').kind).toBe('url')
  })

  it('github.com owner-only → url', () => {
    expect(resolveOpenTarget('https://github.com/dudgeon').kind).toBe('url')
  })

  it('github.com/.../pulls (non-openable verb) → url', () => {
    expect(resolveOpenTarget('https://github.com/o/r/pulls').kind).toBe('url')
  })

  it('non-web scheme (mailto) → url', () => {
    expect(resolveOpenTarget('mailto:a@b.com')).toEqual({ kind: 'url', url: 'mailto:a@b.com' })
  })
})

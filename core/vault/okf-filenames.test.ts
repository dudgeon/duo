// ENH-245 — dual OKF listing-filename convention: `_index.md`/`_log.md` is
// the default for anything Duo writes fresh; `index.md`/`log.md` (the
// original ENH-216/D4/D8 marker) is still detected and honored for vaults
// that already use it. Covers detection, scaffold defaults, writeListings'
// filename resolution, and the log-pairs-with-index rule.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  resolveIndexFilename,
  resolveLogFilename,
  resolveIndexFilenameForDir,
  isGeneratedListingBasename,
  OKF_INDEX_FILENAME_DEFAULT,
  OKF_LOG_FILENAME_DEFAULT,
} from './okf-filenames'
import { detectVaultMode, readOkfVersion, isVaultRoot } from './detect'
import { initVault } from './scaffold'
import { writeListings, generateLog, LISTING_FENCE } from './listings'

let root: string
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-okf-filenames-'))
})
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

function write(rel: string, content: string): void {
  const abs = path.join(root, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
}

describe('defaults', () => {
  it('the underscore-prefixed forms are the default', () => {
    expect(OKF_INDEX_FILENAME_DEFAULT).toBe('_index.md')
    expect(OKF_LOG_FILENAME_DEFAULT).toBe('_log.md')
  })

  it('resolveIndexFilename/resolveLogFilename default to underscore-prefixed on a brand-new folder', () => {
    expect(resolveIndexFilename(root)).toBe('_index.md')
    expect(resolveLogFilename(root)).toBe('_log.md')
  })
})

describe('detection accepts either convention', () => {
  it('detects an okf vault marked by the legacy index.md', () => {
    write('index.md', '---\nokf_version: "0.1"\ntitle: Legacy\ntype: index\n---\n')
    expect(detectVaultMode(root)).toBe('okf')
    expect(readOkfVersion(root)).toBe('0.1')
    expect(isVaultRoot(root)).toBe(true)
  })

  it('detects an okf vault marked by the new _index.md', () => {
    write('_index.md', '---\nokf_version: "0.1"\ntitle: Underscore\ntype: index\n---\n')
    expect(detectVaultMode(root)).toBe('okf')
    expect(readOkfVersion(root)).toBe('0.1')
    expect(isVaultRoot(root)).toBe(true)
  })

  it('_index.md wins if both are somehow present (declaration order)', () => {
    write('_index.md', '---\nokf_version: "2"\ntitle: New\ntype: index\n---\n')
    write('index.md', '---\nokf_version: "1"\ntitle: Old\ntype: index\n---\n')
    expect(readOkfVersion(root)).toBe('2')
  })

  // Regression test — review fix: readOkfVersion used to `return null` on the
  // FIRST existing candidate that lacked `okf_version`, never trying the
  // next one. A stray `_index.md` (no frontmatter, e.g. a user's own note)
  // sitting next to a real legacy `index.md` marker made the vault
  // undetectable.
  it('falls through to the next candidate when the first exists but has no okf_version (a stray _index.md note)', () => {
    write('_index.md', 'Just a note, no frontmatter at all.\n')
    write('index.md', '---\nokf_version: "0.1"\ntitle: Legacy\ntype: index\n---\n')
    expect(readOkfVersion(root)).toBe('0.1')
    expect(detectVaultMode(root)).toBe('okf')
    expect(isVaultRoot(root)).toBe(true)
  })

  it('still returns null when NEITHER candidate has okf_version', () => {
    write('_index.md', 'Just a note, no frontmatter at all.\n')
    write('index.md', '---\ntitle: Also not a marker\n---\n')
    expect(readOkfVersion(root)).toBeNull()
    expect(detectVaultMode(root)).toBeNull()
  })
})

// Regression tests — review fix: resolveIndexFilename/resolveOutputDir used
// bare fs.existsSync, which also matches a directory. A directory literally
// named `_index.md` (or a file literally named `output`) would be selected
// as the "resolved" marker/folder, and a caller's later readFileSync/mkdirSync
// on that path would throw an unguarded EISDIR/ENOTDIR far from the resolver.
describe('resolvers only match the correct filesystem entry type', () => {
  it('resolveIndexFilename skips a directory literally named _index.md', () => {
    fs.mkdirSync(path.join(root, '_index.md'), { recursive: true })
    write('index.md', '---\nokf_version: "0.1"\n---\n')
    expect(resolveIndexFilename(root)).toBe('index.md')
  })

  it('resolveIndexFilename falls back to the default when only a directory collision exists', () => {
    fs.mkdirSync(path.join(root, '_index.md'), { recursive: true })
    expect(resolveIndexFilename(root)).toBe('_index.md') // the default filename, not a match against the dir
  })
})

describe('resolveIndexFilename / resolveLogFilename honor an already-on-disk convention', () => {
  it('resolves to the legacy filenames when only they exist', () => {
    write('index.md', '---\nokf_version: "0.1"\n---\n')
    write('log.md', '# Log\n')
    expect(resolveIndexFilename(root)).toBe('index.md')
    expect(resolveLogFilename(root)).toBe('log.md')
  })

  it('a legacy index.md with NO log yet still resolves the log to the PAIRED legacy name, not a mixed _log.md', () => {
    write('index.md', '---\nokf_version: "0.1"\n---\n')
    expect(resolveIndexFilename(root)).toBe('index.md')
    expect(resolveLogFilename(root)).toBe('log.md')
  })

  it('an on-disk log file wins outright even if it does not match the index convention', () => {
    write('index.md', '---\nokf_version: "0.1"\n---\n')
    write('_log.md', '# Log\n') // hand-mixed state — explicit disk state is never overridden
    expect(resolveLogFilename(root)).toBe('_log.md')
  })
})

describe('resolveIndexFilenameForDir', () => {
  it('prefers a subfolder-local file over the fallback', () => {
    fs.mkdirSync(path.join(root, 'people'), { recursive: true })
    write('people/index.md', '# People\n')
    expect(resolveIndexFilenameForDir(path.join(root, 'people'), '_index.md')).toBe('index.md')
  })

  it('inherits the fallback when the subfolder has neither', () => {
    fs.mkdirSync(path.join(root, 'people'), { recursive: true })
    expect(resolveIndexFilenameForDir(path.join(root, 'people'), '_index.md')).toBe('_index.md')
  })
})

describe('isGeneratedListingBasename', () => {
  it('recognizes all four filenames and rejects everything else', () => {
    expect(isGeneratedListingBasename('_index.md')).toBe(true)
    expect(isGeneratedListingBasename('index.md')).toBe(true)
    expect(isGeneratedListingBasename('_log.md')).toBe(true)
    expect(isGeneratedListingBasename('log.md')).toBe(true)
    expect(isGeneratedListingBasename('alice.md')).toBe(false)
  })
})

describe('initVault defaults new vaults to the underscore-prefixed convention', () => {
  it('writes _index.md, not index.md', () => {
    const v = initVault(path.join(root, 'v')).root
    expect(fs.existsSync(path.join(v, '_index.md'))).toBe(true)
    expect(fs.existsSync(path.join(v, 'index.md'))).toBe(false)
  })
})

describe('writeListings honors a legacy vault end-to-end', () => {
  it('a vault scaffolded with index.md keeps writing index.md + log.md on publish', () => {
    write('index.md', `---\nokf_version: "0.1"\ntitle: Legacy\ntype: index\n---\n${LISTING_FENCE}\n`)
    write('people/alice.md', '---\ntype: person\ntitle: Alice\n---\nAlice.\n')
    const r = writeListings(root)
    expect(r.mode).toBe('okf')
    expect(r.written.sort()).toEqual(['index.md', 'log.md'])
    expect(fs.existsSync(path.join(root, '_index.md'))).toBe(false)
    expect(fs.existsSync(path.join(root, '_log.md'))).toBe(false)
    expect(fs.readFileSync(path.join(root, 'index.md'), 'utf8')).toContain('Alice')
  })

  it('a freshly initVault-scaffolded vault publishes _index.md + _log.md', () => {
    const v = initVault(path.join(root, 'v')).root
    const r = writeListings(v)
    expect(r.written.sort()).toEqual(['_index.md', '_log.md'])
  })
})

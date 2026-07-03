// ENH-246 — dual output-folder convention: `output/` is the default for
// anything Duo scaffolds fresh; the legacy `out/` (ENH-208/ENH-229) is still
// detected and honored for a vault that already has one. Covers resolution,
// scaffold defaults, and skip-set membership for both names.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { resolveOutputDir, OUTPUT_DIR_DEFAULT, OUTPUT_DIR_CANDIDATES } from './output-dir'
import { SKIP_DIRS } from './parse'
import { SEARCH_SKIP_DIRS } from './search'
import { isVaultRoot, findVaultRoot } from './detect'
import { initVault } from './scaffold'

let root: string
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-output-dir-'))
})
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('defaults', () => {
  it('output/ is the default', () => {
    expect(OUTPUT_DIR_DEFAULT).toBe('output')
  })

  it('resolveOutputDir defaults to output/ on a brand-new folder', () => {
    expect(resolveOutputDir(root)).toBe('output')
  })
})

describe('resolveOutputDir honors an already-on-disk convention', () => {
  it('resolves to the legacy out/ when only it exists', () => {
    fs.mkdirSync(path.join(root, 'out'))
    expect(resolveOutputDir(root)).toBe('out')
  })

  it('resolves to output/ when only it exists', () => {
    fs.mkdirSync(path.join(root, 'output'))
    expect(resolveOutputDir(root)).toBe('output')
  })

  it('prefers output/ if both are somehow present (declaration order)', () => {
    fs.mkdirSync(path.join(root, 'output'))
    fs.mkdirSync(path.join(root, 'out'))
    expect(resolveOutputDir(root)).toBe('output')
  })
})

describe('skip sets recognize both names', () => {
  it('SKIP_DIRS (the corpus/graph walk) skips both', () => {
    for (const name of OUTPUT_DIR_CANDIDATES) expect(SKIP_DIRS.has(name)).toBe(true)
  })

  it('SEARCH_SKIP_DIRS (the ⌘⇧F palette) skips both', () => {
    for (const name of OUTPUT_DIR_CANDIDATES) expect(SEARCH_SKIP_DIRS.has(name)).toBe(true)
  })
})

describe('initVault scaffolds output/, not out/', () => {
  it('OKF mode', () => {
    const v = initVault(path.join(root, 'okf'), { format: 'okf' }).root
    expect(fs.existsSync(path.join(v, 'output'))).toBe(true)
    expect(fs.existsSync(path.join(v, 'out'))).toBe(false)
  })

  it('Obsidian mode', () => {
    const v = initVault(path.join(root, 'obs'), { format: 'obsidian' }).root
    expect(fs.existsSync(path.join(v, 'output'))).toBe(true)
    expect(fs.existsSync(path.join(v, 'out'))).toBe(false)
  })
})

// Regression test — review fix: resolveOutputDir used bare fs.existsSync,
// which also matches a FILE (not just a directory). A stray file literally
// named `output` sitting at the vault root would be selected as the
// "resolved" output folder, and a caller's later mkdirSync/writeFileSync
// into that path would throw an unguarded ENOTDIR/EEXIST far from here.
describe('resolveOutputDir only matches a directory, not a file', () => {
  it('skips a file literally named output and falls through to the legacy out/ dir', () => {
    fs.writeFileSync(path.join(root, 'output'), 'not a folder\n')
    fs.mkdirSync(path.join(root, 'out'))
    expect(resolveOutputDir(root)).toBe('out')
  })

  it('falls back to the default filename when only a file-vs-dir collision exists', () => {
    fs.writeFileSync(path.join(root, 'output'), 'not a folder\n')
    expect(resolveOutputDir(root)).toBe('output') // the default name, not a match against the file
  })
})

describe('vault detection is unaffected by either output-folder name', () => {
  it('a legacy vault with an out/ folder still detects fine', () => {
    fs.mkdirSync(path.join(root, '.obsidian'), { recursive: true })
    fs.mkdirSync(path.join(root, 'out'), { recursive: true })
    expect(isVaultRoot(root)).toBe(true)
    // out/ itself isn't a vault root — walking up from inside it finds the
    // enclosing vault, same as any other subfolder (compare basenames to
    // sidestep /tmp vs. /private/tmp symlink normalization on macOS).
    expect(path.basename(findVaultRoot(path.join(root, 'out'))!)).toBe(path.basename(root))
  })
})

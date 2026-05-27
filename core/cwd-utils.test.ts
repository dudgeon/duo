import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { resolveExistingCwd } from './cwd-utils'

describe('resolveExistingCwd', () => {
  let root: string
  let nested: string

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-cwd-'))
    nested = path.join(root, 'a', 'b', 'c')
    fs.mkdirSync(nested, { recursive: true })
  })

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('keeps an existing path as-is', () => {
    const r = resolveExistingCwd(nested, root)
    expect(r.cwd).toBe(nested)
    expect(r.substituted).toBe(false)
  })

  it('walks up to the nearest surviving ancestor when the dir is gone', () => {
    const gone = path.join(root, 'a', 'deleted', 'deeper')
    const r = resolveExistingCwd(gone, os.homedir())
    // root/a exists; root/a/deleted does not.
    expect(r.cwd).toBe(path.join(root, 'a'))
    expect(r.substituted).toBe(true)
  })

  it('falls all the way up to the surviving root ancestor', () => {
    const gone = path.join(root, 'totally', 'gone')
    const r = resolveExistingCwd(gone, '/nonexistent-fallback')
    expect(r.cwd).toBe(root)
    expect(r.substituted).toBe(true)
  })

  it('uses the fallback when desired is empty', () => {
    const r = resolveExistingCwd('', root)
    expect(r.cwd).toBe(root)
    expect(r.substituted).toBe(true)
  })

  it('uses the fallback for a non-absolute desired path that does not exist', () => {
    const r = resolveExistingCwd('not/absolute/missing', root)
    expect(r.cwd).toBe(root)
    expect(r.substituted).toBe(true)
  })

  it('lands on / when neither desired nor fallback exist', () => {
    const r = resolveExistingCwd('/totally-made-up-xyz/deep', '/also-not-real-xyz')
    expect(r.cwd).toBe('/')
    expect(r.substituted).toBe(true)
  })
})

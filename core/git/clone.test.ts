// ENH-224 Phase 1 — the depth/ref clone-flag builder. Pure, so it pins the
// exact git args the managed checkout relies on without spawning git.

import { describe, it, expect } from 'vitest'
import { cloneExtraArgs } from './clone'

describe('cloneExtraArgs — depth/ref flags', () => {
  it('no depth, no ref → no extra flags (the File ▸ Clone… default)', () => {
    expect(cloneExtraArgs({})).toEqual([])
  })

  it('depth → --depth N', () => {
    expect(cloneExtraArgs({ depth: 1 })).toEqual(['--depth', '1'])
  })

  it('ref → --branch=<ref> (attached form — a leading-dash ref cannot be read as a flag)', () => {
    expect(cloneExtraArgs({ ref: 'main' })).toEqual(['--branch=main'])
    // ENH-224 security regression: the value stays attached, never a separate arg.
    expect(cloneExtraArgs({ ref: '--upload-pack=x' })).toEqual(['--branch=--upload-pack=x'])
  })

  it('depth + ref → both, depth first', () => {
    expect(cloneExtraArgs({ depth: 1, ref: 'release/1.x' })).toEqual([
      '--depth', '1', '--branch=release/1.x',
    ])
  })

  it('depth 0 / negative is ignored (treated as full history)', () => {
    expect(cloneExtraArgs({ depth: 0 })).toEqual([])
    expect(cloneExtraArgs({ depth: -1 })).toEqual([])
  })
})

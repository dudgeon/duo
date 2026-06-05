// ENH-195 — coverage for the structured-edit helpers behind `duo json
// set|merge`, including the prototype-pollution guard added after the
// adversarial review caught it (the helpers run in the Electron MAIN process
// on the disk-direct path, so pollution there poisons the whole app).

import { describe, it, expect } from 'vitest'
import { parseDotPath, applyJsonPointer, deepMerge } from './jsonOps'

describe('parseDotPath', () => {
  it('empty / dot → root', () => {
    expect(parseDotPath('')).toEqual([])
    expect(parseDotPath('.')).toEqual([])
  })
  it('object keys + array indices', () => {
    expect(parseDotPath('a.b')).toEqual(['a', 'b'])
    expect(parseDotPath('a[0].c')).toEqual(['a', 0, 'c'])
    expect(parseDotPath('a.0.c')).toEqual(['a', 0, 'c'])
    expect(parseDotPath('a[0][1]')).toEqual(['a', 0, 1])
  })
})

describe('applyJsonPointer', () => {
  it('sets a nested object key, creating intermediates', () => {
    expect(applyJsonPointer({}, 'a.b.c', 1)).toEqual({ a: { b: { c: 1 } } })
  })
  it('creates arrays for numeric segments', () => {
    expect(applyJsonPointer({}, 'a[0].x', 9)).toEqual({ a: [{ x: 9 }] })
  })
  it('empty pointer replaces the root', () => {
    expect(applyJsonPointer({ a: 1 }, '', 42)).toBe(42)
  })
  it('mutates an existing object in place', () => {
    const root: Record<string, unknown> = { keep: true }
    applyJsonPointer(root, 'added', 1)
    expect(root).toEqual({ keep: true, added: 1 })
  })

  it('REFUSES to write through __proto__ (no prototype pollution)', () => {
    expect(() => applyJsonPointer({}, '__proto__.polluted', 'YES')).toThrow()
    // The canonical sentinel: a fresh object must NOT have inherited the key.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
  it('REFUSES constructor / prototype segments too', () => {
    expect(() => applyJsonPointer({}, 'constructor.x', 1)).toThrow()
    expect(() => applyJsonPointer({}, 'a.prototype.x', 1)).toThrow()
  })
})

describe('deepMerge', () => {
  it('merges nested plain objects key-by-key', () => {
    expect(deepMerge({ a: { x: 1 }, b: 2 }, { a: { y: 3 } })).toEqual({ a: { x: 1, y: 3 }, b: 2 })
  })
  it('arrays and primitives in the patch replace the target', () => {
    expect(deepMerge({ a: [1, 2] }, { a: [9] })).toEqual({ a: [9] })
    expect(deepMerge({ a: 1 }, { a: 'x' })).toEqual({ a: 'x' })
  })
  it('a non-object patch replaces wholesale', () => {
    expect(deepMerge({ a: 1 }, 5)).toBe(5)
  })
  it('SKIPS __proto__ in the patch (no prototype pollution)', () => {
    const out = deepMerge({}, JSON.parse('{"__proto__":{"pwn":"YES"},"ok":1}')) as Record<string, unknown>
    expect(({} as Record<string, unknown>).pwn).toBeUndefined() // Object.prototype clean
    expect(out.ok).toBe(1)
  })
})

// ENH-195 — pure structured-edit helpers for `duo json set|merge`.
//
// Shared between the disk-direct path (core/socket-server.ts, when the
// file is closed) and the buffer path (renderer/components/Json/JsonView,
// when the JSON / YAML viewer has it open) so the two routes can't drift.
// No file IO, no DOM, no YAML — operate on already-parsed JS values.

/**
 * Parse a dotted JSON pointer into a list of segments. Supports object
 * keys (`a.b.c`) and array indices (`a[0].b`, `a.0.b`). An empty string
 * or `.` means "the root" → returns `[]`.
 *
 * Examples:
 *   ''         → []
 *   '.'        → []
 *   'a.b'      → ['a', 'b']
 *   'a[0].c'   → ['a', 0, 'c']
 *   'a.0.c'    → ['a', 0, 'c']      (bare-number segments index arrays)
 */
/** ENH-195 (review) — keys that walk/poison the prototype chain. Rejected by
 *  both helpers so `duo json set foo.__proto__.x 1` (or a `{"__proto__":…}`
 *  merge patch) can't pollute Object.prototype in the renderer OR the
 *  Electron main process. */
function isUnsafeKey(k: string | number): boolean {
  return k === '__proto__' || k === 'constructor' || k === 'prototype'
}

export function parseDotPath(pointer: string): Array<string | number> {
  const trimmed = pointer.trim()
  if (trimmed === '' || trimmed === '.') return []
  const segs: Array<string | number> = []
  // Split on dots that aren't inside brackets; also pull `[n]` out as
  // its own numeric segment.
  for (const raw of trimmed.split('.')) {
    if (raw === '') continue
    // Pull leading key + any number of trailing [n] groups: e.g. `a[0][1]`.
    const m = raw.match(/^([^[\]]*)((?:\[\d+\])*)$/)
    if (!m) {
      // Fallback: treat the whole chunk as a literal key.
      segs.push(raw)
      continue
    }
    const key = m[1]
    if (key !== '') {
      // A bare-number key (`a.0.c`) indexes an array.
      if (/^\d+$/.test(key)) segs.push(Number(key))
      else segs.push(key)
    }
    const brackets = m[2]
    if (brackets) {
      for (const bm of brackets.matchAll(/\[(\d+)\]/g)) {
        segs.push(Number(bm[1]))
      }
    }
  }
  return segs
}

/**
 * Set `value` at the dotted `pointer` inside `root`, returning the new
 * root (mutates in place where possible; reassigns the root when the
 * pointer is empty). Intermediate containers are created as needed: a
 * numeric segment creates an array, a string segment creates an object.
 *
 * Empty pointer → the value REPLACES the root entirely.
 */
export function applyJsonPointer(root: unknown, pointer: string, value: unknown): unknown {
  const segs = parseDotPath(pointer)
  if (segs.length === 0) return value // reassign root
  if (segs.some(isUnsafeKey)) {
    throw new Error('refusing to write through a prototype-polluting key (__proto__/constructor/prototype)')
  }

  // Ensure the root is a container we can descend into.
  let cur: any = root
  if (cur === null || typeof cur !== 'object') {
    cur = typeof segs[0] === 'number' ? [] : {}
    root = cur
  }

  for (let i = 0; i < segs.length - 1; i++) {
    const seg = segs[i]
    const nextSeg = segs[i + 1]
    const want = typeof nextSeg === 'number' ? 'array' : 'object'
    const existing = cur[seg]
    if (existing === null || typeof existing !== 'object') {
      cur[seg] = want === 'array' ? [] : {}
    }
    cur = cur[seg]
  }
  cur[segs[segs.length - 1]] = value
  return root
}

/**
 * Deep-merge `patch` into `target`, returning the merged value.
 * - Plain objects merge key-by-key, recursing on nested plain objects.
 * - Arrays and primitives in `patch` REPLACE the target value (no
 *   element-wise array merge — that's rarely what an agent means).
 * - A `null` in `patch` overwrites with null (explicit clear).
 * `target` is mutated in place when it's a plain object.
 */
export function deepMerge(target: unknown, patch: unknown): unknown {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return patch
  }
  const base: any = (target !== null && typeof target === 'object' && !Array.isArray(target))
    ? target
    : {}
  for (const key of Object.keys(patch as Record<string, unknown>)) {
    if (isUnsafeKey(key)) continue // never merge through the prototype chain
    const pv = (patch as Record<string, unknown>)[key]
    if (pv !== null && typeof pv === 'object' && !Array.isArray(pv)) {
      base[key] = deepMerge(base[key], pv)
    } else {
      base[key] = pv
    }
  }
  return base
}

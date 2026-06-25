// ENH-228 — the inbox listing: newest-first, `captured:` parsing, the
// "stale > 1 week" threshold (matching bases/processing.base).

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { initVault } from './scaffold'
import { listInbox } from './inbox'

let root: string
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-inbox-'))
})
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

function writeInbox(v: string, name: string, fm: string, body = ''): void {
  const abs = path.join(v, 'inbox', name)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, `---\n${fm}\n---\n${body}`)
}

describe('listInbox (ENH-228)', () => {
  it('returns [] when there is no inbox/ folder', () => {
    // A bare dir (not even a vault) — no inbox/.
    expect(listInbox(root)).toEqual([])
  })

  it('parses captured + title, sorts newest-first, flags stale at the 1-week boundary', () => {
    const v = initVault(path.join(root, 'v')).root
    const asOf = new Date('2026-06-24T12:00:00Z')

    // exactly 7 days old → NOT stale (threshold is strict `<`)
    writeInbox(v, '2026-06-17-090000.md', 'captured: 2026-06-17', 'On the boundary')
    // 8 days old → stale
    writeInbox(v, '2026-06-16-090000.md', 'captured: 2026-06-16', 'Older than a week')
    // today → fresh; title from frontmatter (wins over the body line)
    writeInbox(v, '2026-06-24-090000.md', 'captured: 2026-06-24\ntitle: Has A Title', '# a heading\nmore body')

    const items = listInbox(v, { asOf })

    // newest-first by captured
    expect(items.map((i) => i.captured)).toEqual(['2026-06-24', '2026-06-17', '2026-06-16'])

    const today = items.find((i) => i.captured === '2026-06-24')!
    expect(today.title).toBe('Has A Title')
    expect(today.stale).toBe(false)

    const boundary = items.find((i) => i.captured === '2026-06-17')!
    expect(boundary.stale).toBe(false) // exactly 1 week → not stale
    expect(boundary.title).toBe('On the boundary') // title falls back to first body line

    const old = items.find((i) => i.captured === '2026-06-16')!
    expect(old.stale).toBe(true)
  })

  it('a capture with no captured: date is never stale and sorts after dated ones', () => {
    const v = initVault(path.join(root, 'v')).root
    writeInbox(v, 'undated.md', 'type: note', 'no captured field')
    writeInbox(v, '2026-06-01-090000.md', 'captured: 2026-06-01', 'dated')
    const items = listInbox(v, { asOf: new Date('2026-06-24T12:00:00Z') })
    const undated = items.find((i) => i.captured === null)!
    expect(undated.stale).toBe(false)
    // dated entries sort before undated ones
    expect(items[0].captured).toBe('2026-06-01')
    expect(items[1].captured).toBeNull()
  })
})

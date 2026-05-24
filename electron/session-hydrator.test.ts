// ENH-183 C8 — Session hydrator tests.
//
// Same fixture pattern as claude-session-tracker.test.ts: write real
// JSONL files into ~/.claude/projects/<encoded-cwd>/ with unique test
// paths, exercise maybeHydrate, capture the PTY write payload, then
// clean up.

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import { encodeProjectDir } from './claude-session-tracker'
import {
  maybeHydrate,
  resetHydrationTracking,
  _hasBeenHydrated,
  HYDRATION_THRESHOLD,
} from './session-hydrator'

describe('maybeHydrate — ENH-183 C8', () => {
  let sandbox: string
  let cwd: string
  let captured: Array<{ tabId: string; data: string }> = []

  beforeEach(async () => {
    const uniq = `enh-183-c8-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    cwd = `/tmp/${uniq}`
    const encoded = encodeProjectDir(cwd)
    sandbox = path.join(os.homedir(), '.claude', 'projects', encoded)
    await fs.mkdir(sandbox, { recursive: true })
    captured = []
    resetHydrationTracking()
  })

  afterEach(async () => {
    await fs.rm(sandbox, { recursive: true, force: true })
    resetHydrationTracking()
  })

  async function writeJsonl(uuid: string, lines: object[]): Promise<void> {
    const content = lines.map((l) => JSON.stringify(l)).join('\n') + '\n'
    await fs.writeFile(path.join(sandbox, `${uuid}.jsonl`), content, 'utf8')
  }

  const ptyWrite = (tabId: string, data: string) => {
    captured.push({ tabId, data })
  }

  it('hydrates a 3-user-message unnamed session via cleaned first prompt', async () => {
    const uuid = 'aaaaaaaa-1111-1111-1111-111111111111'
    await writeJsonl(uuid, [
      { type: 'user', message: { content: 'please fix the parser bug we discussed' } },
      { type: 'assistant', content: 'sure' },
      { type: 'user', message: { content: 'follow-up' } },
      { type: 'assistant', content: 'noted' },
      { type: 'user', message: { content: 'ship it' } },
    ])
    const r = await maybeHydrate({ tabId: 'T1', sessionUuid: uuid, cwd, ptyWrite })
    expect(r).toEqual({ hydrated: true, reason: 'injected', title: 'Fix the parser bug we discussed' })
    expect(captured).toEqual([{ tabId: 'T1', data: '\r/rename Fix the parser bug we discussed\n' }])
    expect(_hasBeenHydrated(uuid)).toBe(true)
  })

  it('skips when message count is below threshold', async () => {
    const uuid = 'bbbbbbbb-2222-2222-2222-222222222222'
    await writeJsonl(uuid, [
      { type: 'user', message: { content: 'hi' } },
      { type: 'assistant', content: 'hello' },
      { type: 'user', message: { content: 'still hi' } },
    ])
    // 2 user messages — below HYDRATION_THRESHOLD (3).
    // Actually that's 2, let me fix above… wait the fixture has 2 user messages. Below threshold.
    const r = await maybeHydrate({ tabId: 'T2', sessionUuid: uuid, cwd, ptyWrite })
    expect(r.hydrated).toBe(false)
    expect(r.reason).toMatch(/^messageCount<3/)
    expect(captured).toEqual([])
    expect(_hasBeenHydrated(uuid)).toBe(false)
  })

  it('skips when the session already has a customTitle', async () => {
    const uuid = 'cccccccc-3333-3333-3333-333333333333'
    await writeJsonl(uuid, [
      { type: 'user', message: { content: 'one' } },
      { type: 'user', message: { content: 'two' } },
      { type: 'user', message: { content: 'three' } },
      { type: 'custom-title', customTitle: 'already named', sessionId: uuid },
    ])
    const r = await maybeHydrate({ tabId: 'T3', sessionUuid: uuid, cwd, ptyWrite })
    expect(r).toEqual({ hydrated: false, reason: 'already-has-customTitle' })
    expect(captured).toEqual([])
  })

  it('skips when the session already has an aiTitle (Haiku summary)', async () => {
    const uuid = 'dddddddd-4444-4444-4444-444444444444'
    await writeJsonl(uuid, [
      { type: 'user', message: { content: 'one' } },
      { type: 'user', message: { content: 'two' } },
      { type: 'user', message: { content: 'three' } },
      { type: 'ai-title', aiTitle: 'haiku gave it a name', sessionId: uuid },
    ])
    const r = await maybeHydrate({ tabId: 'T4', sessionUuid: uuid, cwd, ptyWrite })
    expect(r).toEqual({ hydrated: false, reason: 'already-has-aiTitle' })
    expect(captured).toEqual([])
  })

  it('idempotent — second call on same session is a no-op', async () => {
    const uuid = 'eeeeeeee-5555-5555-5555-555555555555'
    await writeJsonl(uuid, [
      { type: 'user', message: { content: 'add comment support to wikilinks' } },
      { type: 'user', message: { content: 'two' } },
      { type: 'user', message: { content: 'three' } },
    ])
    const first = await maybeHydrate({ tabId: 'T5', sessionUuid: uuid, cwd, ptyWrite })
    expect(first.hydrated).toBe(true)
    const second = await maybeHydrate({ tabId: 'T5', sessionUuid: uuid, cwd, ptyWrite })
    expect(second).toEqual({ hydrated: false, reason: 'already-hydrated-this-run' })
    expect(captured).toHaveLength(1) // only the first call wrote
  })

  it('skips when source is uuid (no derivable title — JSONL has no user msg)', async () => {
    const uuid = 'ffffffff-6666-6666-6666-666666666666'
    // No user messages — just assistant entries. Could happen if a
    // JSONL is malformed or the conversation started with an
    // unsolicited assistant turn.
    await writeJsonl(uuid, [
      { type: 'assistant', content: 'first' },
      { type: 'system', content: 'sys' },
      { type: 'assistant', content: 'second' },
    ])
    const r = await maybeHydrate({ tabId: 'T6', sessionUuid: uuid, cwd, ptyWrite })
    // 0 user messages — falls below threshold first.
    expect(r.hydrated).toBe(false)
    expect(r.reason).toMatch(/^messageCount<3/)
  })

  it('HYDRATION_THRESHOLD is 3 (locked PRD value)', () => {
    expect(HYDRATION_THRESHOLD).toBe(3)
  })

  it('resetHydrationTracking clears the in-memory set', async () => {
    const uuid = 'gggggggg-7777-7777-7777-777777777777'
    await writeJsonl(uuid, [
      { type: 'user', message: { content: 'one' } },
      { type: 'user', message: { content: 'two' } },
      { type: 'user', message: { content: 'three' } },
    ])
    const r1 = await maybeHydrate({ tabId: 'T7', sessionUuid: uuid, cwd, ptyWrite })
    expect(r1.hydrated).toBe(true)
    resetHydrationTracking()
    const r2 = await maybeHydrate({ tabId: 'T7', sessionUuid: uuid, cwd, ptyWrite })
    expect(r2.hydrated).toBe(true)
    expect(captured).toHaveLength(2)
  })
})

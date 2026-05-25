// ENH-177 — encodeProjectDir tests against real Claude Code directory
// names observed on disk 2026-05-23.
// ENH-183 C4 — cleanAndTruncate + readBannerTitle + readMessageCount.

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import {
  encodeProjectDir,
  cleanAndTruncate,
  readBannerTitle,
  readMessageCount,
} from './claude-session-tracker'

describe('encodeProjectDir — ENH-177', () => {
  it('encodes a simple home path', () => {
    expect(encodeProjectDir('/Users/geoffreydudgeon')).toBe('-Users-geoffreydudgeon')
  })

  it('encodes Documents/GitHub/duo (the canonical repo path)', () => {
    expect(encodeProjectDir('/Users/geoffreydudgeon/Documents/GitHub/duo'))
      .toBe('-Users-geoffreydudgeon-Documents-GitHub-duo')
  })

  it('encodes ~/.claude/skills/duo (dot → dash)', () => {
    expect(encodeProjectDir('/Users/geoffreydudgeon/.claude/skills/duo'))
      .toBe('-Users-geoffreydudgeon--claude-skills-duo')
  })

  it('encodes a worktree path with .claude embedded', () => {
    expect(encodeProjectDir('/Users/geoffreydudgeon/Documents/GitHub/duo/.claude/worktrees/amazing-hertz-9f5e6c'))
      .toBe('-Users-geoffreydudgeon-Documents-GitHub-duo--claude-worktrees-amazing-hertz-9f5e6c')
  })

  it('preserves dashes inside path segments', () => {
    expect(encodeProjectDir('/foo/bar-baz/qux'))
      .toBe('-foo-bar-baz-qux')
  })

  it('handles multi-segment dotfile paths', () => {
    expect(encodeProjectDir('/a/.b/.c/d'))
      .toBe('-a--b--c-d')
  })

  it('resolves symlinks before encoding (BUG-158)', () => {
    // macOS: /tmp is a symlink to /private/tmp. Claude resolves
    // symlinks before writing to ~/.claude/projects/, so a session
    // started at /tmp/X is written to -private-tmp-X, not -tmp-X.
    // Skip on non-darwin where /tmp may not have this symlink.
    if (process.platform !== 'darwin') return
    expect(encodeProjectDir('/tmp')).toBe('-private-tmp')
  })

  it('falls back to literal encoding when path does not exist (BUG-158)', () => {
    // realpath throws ENOENT for non-existent paths — encoder should
    // catch + fall back to literal encoding (same behavior as before
    // the BUG-158 fix for non-existent paths).
    expect(encodeProjectDir('/this/path/does/not/exist/abc123'))
      .toBe('-this-path-does-not-exist-abc123')
  })
})

describe('cleanAndTruncate — ENH-183 C4', () => {
  it('returns empty string for empty input', () => {
    expect(cleanAndTruncate('')).toBe('')
    expect(cleanAndTruncate('   ')).toBe('')
  })

  it('strips ide_opened_file sentinel wrappers', () => {
    const raw = '<ide_opened_file>The user opened the file /tmp/foo.ts in the IDE. This may or may not be related to the current task.</ide_opened_file>fix the typo'
    expect(cleanAndTruncate(raw)).toBe('Fix the typo')
  })

  it('strips orphan ide_opened_file open/close tags (no body to keep)', () => {
    expect(cleanAndTruncate('<ide_opened_file>fix it</ide_opened_file>')).toBe('')
    // Trailing user text after the wrapper survives.
    expect(cleanAndTruncate('<ide_opened_file>noise</ide_opened_file>fix it'))
      .toBe('Fix it')
    // Orphan unmatched closing tag is still stripped.
    expect(cleanAndTruncate('please </ide_opened_file>fix it'))
      .toBe('Fix it')
  })

  it('drops conversational prefixes case-insensitively', () => {
    expect(cleanAndTruncate('please fix the bug')).toBe('Fix the bug')
    expect(cleanAndTruncate('Could you add a test?')).toBe('Add a test?')
    expect(cleanAndTruncate('can you check this')).toBe('Check this')
    expect(cleanAndTruncate('Hey, what is wrong here')).toBe('What is wrong here')
  })

  it('collapses multi-line input to a single line', () => {
    expect(cleanAndTruncate('refactor\n\n  the\tparser')).toBe('Refactor the parser')
  })

  it('truncates at 60 chars on a word boundary with ellipsis', () => {
    const raw = 'add a feature flag to gate the new browser blocklist behavior for enterprise users only please'
    const out = cleanAndTruncate(raw)
    expect(out.length).toBeLessThanOrEqual(61) // +1 for the …
    expect(out.endsWith('…')).toBe(true)
    expect(out).not.toContain('  ')
  })

  it('handles very-long single-token strings with hard cut + ellipsis', () => {
    const raw = 'a'.repeat(120)
    const out = cleanAndTruncate(raw)
    expect(out.length).toBeLessThanOrEqual(61)
    expect(out.endsWith('…')).toBe(true)
  })

  it('returns text unchanged if already short + clean', () => {
    expect(cleanAndTruncate('Refactor X')).toBe('Refactor X')
  })
})

// Integration tests for readBannerTitle / readMessageCount.
// These write real JSONL fixtures into a sandboxed projects dir, point
// the SUT at it via cwd-encoding, and confirm the read ladder fires
// each rung correctly. Cleanup deletes the entire sandbox dir.
describe('readBannerTitle + readMessageCount — ENH-183 C4 integration', () => {
  let sandbox: string
  let cwd: string

  // Stub the Claude projects directory inside a temp dir. We achieve
  // this by overriding os.homedir for the encoder — but encodeProjectDir
  // uses absolute paths, so the simpler trick is to set up the real
  // path under the real ~/.claude/projects/ with a unique fake cwd we
  // know won't collide.
  beforeEach(async () => {
    const uniq = `enh-183-c4-test-${process.pid}-${Date.now()}`
    cwd = `/tmp/${uniq}`
    const encoded = encodeProjectDir(cwd)
    sandbox = path.join(os.homedir(), '.claude', 'projects', encoded)
    await fs.mkdir(sandbox, { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(sandbox, { recursive: true, force: true })
  })

  async function writeJsonl(uuid: string, lines: object[]): Promise<void> {
    const content = lines.map((l) => JSON.stringify(l)).join('\n') + '\n'
    await fs.writeFile(path.join(sandbox, `${uuid}.jsonl`), content, 'utf8')
  }

  it('rung 1 — picks the latest custom-title entry', async () => {
    const uuid = '11111111-1111-1111-1111-111111111111'
    await writeJsonl(uuid, [
      { type: 'user', message: { content: 'hello there' } },
      { type: 'custom-title', customTitle: 'first rename', sessionId: uuid },
      { type: 'ai-title', aiTitle: 'haiku summary', sessionId: uuid },
      { type: 'custom-title', customTitle: 'second rename', sessionId: uuid },
    ])
    const r = await readBannerTitle(uuid, cwd)
    expect(r).toEqual({ title: 'second rename', source: 'customTitle' })
  })

  it('rung 2 — falls back to ai-title when no custom-title exists', async () => {
    const uuid = '22222222-2222-2222-2222-222222222222'
    await writeJsonl(uuid, [
      { type: 'user', message: { content: 'do the thing' } },
      { type: 'ai-title', aiTitle: 'doing the thing', sessionId: uuid },
    ])
    const r = await readBannerTitle(uuid, cwd)
    expect(r).toEqual({ title: 'doing the thing', source: 'aiTitle' })
  })

  it('rung 3 — falls back to cleaned first user message', async () => {
    const uuid = '33333333-3333-3333-3333-333333333333'
    await writeJsonl(uuid, [
      { type: 'system', content: 'system bootstrap' },
      { type: 'user', message: { content: 'please fix the bug in the parser' } },
      { type: 'assistant', content: 'sure' },
    ])
    const r = await readBannerTitle(uuid, cwd)
    expect(r).toEqual({ title: 'Fix the bug in the parser', source: 'jsonl-firstmsg' })
  })

  it('rung 3 — handles array-shaped user content blocks', async () => {
    const uuid = '44444444-4444-4444-4444-444444444444'
    await writeJsonl(uuid, [
      { type: 'user', message: { content: [{ type: 'text', text: 'add a regression test' }] } },
    ])
    const r = await readBannerTitle(uuid, cwd)
    expect(r).toEqual({ title: 'Add a regression test', source: 'jsonl-firstmsg' })
  })

  it('rung 4 — falls back to short UUID when JSONL is empty', async () => {
    const uuid = '55555555-5555-5555-5555-555555555555'
    await writeJsonl(uuid, [])
    const r = await readBannerTitle(uuid, cwd)
    expect(r).toEqual({ title: '55555555', source: 'uuid' })
  })

  it('rung 4 — falls back to short UUID when JSONL is missing', async () => {
    const uuid = '66666666-6666-6666-6666-666666666666'
    // Don't write the file.
    const r = await readBannerTitle(uuid, cwd)
    expect(r).toEqual({ title: '66666666', source: 'uuid' })
  })

  it('readMessageCount — counts type:user entries only', async () => {
    const uuid = '77777777-7777-7777-7777-777777777777'
    await writeJsonl(uuid, [
      { type: 'user', message: { content: 'one' } },
      { type: 'assistant', content: 'reply' },
      { type: 'user', message: { content: 'two' } },
      { type: 'system', content: 'sys' },
      { type: 'user', message: { content: 'three' } },
      { type: 'custom-title', customTitle: 'x' },
    ])
    expect(await readMessageCount(uuid, cwd)).toBe(3)
  })

  it('readMessageCount — returns 0 when JSONL is missing', async () => {
    const uuid = '88888888-8888-8888-8888-888888888888'
    expect(await readMessageCount(uuid, cwd)).toBe(0)
  })
})

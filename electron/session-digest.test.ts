// ENH-231 — session-digest extractor tests. Fixtures mirror the Claude Code
// JSONL shapes confirmed against live ~/.claude/projects transcripts (TodoWrite
// `{todos:[{content,activeForm,status}]}`, ExitPlanMode tool_use, top-level
// `toolUseResult:{type:'create',filePath}`, error STRINGs, PR URLs). Covers:
// every field, each attention reason in isolation, the no-inference (no-clock)
// guarantee, and the §D9 delete-cache → byte-identical-rebuild invariant.

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import {
  extractSessionDigest,
  deriveState,
  extractGoal,
} from './session-digest'
import { SessionDigestStore } from '../core/session-digest-store'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'duo-digest-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

async function writeJsonl(records: unknown[]): Promise<string> {
  const file = path.join(dir, 'session.jsonl')
  await fs.writeFile(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
  return file
}

const userMsg = (text: string, extra: Record<string, unknown> = {}) => ({
  type: 'user',
  message: { role: 'user', content: text },
  ...extra,
})
const asstText = (text: string) => ({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'text', text }] },
})
const asstTool = (name: string, input: Record<string, unknown>, id = 't1') => ({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
})

describe('extractSessionDigest — deterministic field extraction', () => {
  it('pulls goal, youAsked, todos, files, gitBranch and snippet', async () => {
    const file = await writeJsonl([
      userMsg('Please migrate the analytics events to the v2 schema', {
        cwd: '/repo',
        gitBranch: 'claude/analytics-v2',
      }),
      asstTool('TodoWrite', {
        todos: [
          { content: 'Add v2 schema', status: 'completed' },
          { content: 'Dual-emit v1 + v2', status: 'in_progress' },
          { content: 'Migrate 40 call-sites', status: 'pending' },
        ],
      }),
      asstTool('Edit', { file_path: '/repo/events/schema.ts' }, 'e1'),
      userMsg('Actually, keep v1 emitting in parallel'),
      asstText('Done — kept v1 emitting alongside v2.'),
    ])

    const d = await extractSessionDigest(file, 'uuid-1')
    expect(d).not.toBeNull()
    expect(d!.goal).toBe('Migrate the analytics events to the v2 schema')
    expect(d!.youAsked).toBe('Actually, keep v1 emitting in parallel')
    expect(d!.todos).toEqual([
      { text: 'Add v2 schema', status: 'completed' },
      { text: 'Dual-emit v1 + v2', status: 'in_progress' },
      { text: 'Migrate 40 call-sites', status: 'pending' },
    ])
    expect(d!.files).toEqual([{ path: '/repo/events/schema.ts', kind: 'edited' }])
    expect(d!.gitBranch).toBe('claude/analytics-v2')
    expect(d!.cwd).toBe('/repo')
    expect(d!.fallbackSnippet).toBe('Done — kept v1 emitting alongside v2.')
    expect(d!.lastActivityAt).toBeGreaterThan(0)
  })

  it('labels a Write-created file `created` only when the result proves it', async () => {
    const file = await writeJsonl([
      userMsg('write a report'),
      asstTool('Write', { file_path: '/repo/report.md' }, 'w1'),
      {
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 'w1', content: 'ok' }] },
        toolUseResult: { type: 'create', filePath: '/repo/report.md' },
      },
      asstTool('Edit', { file_path: '/repo/existing.ts' }, 'e1'),
    ])
    const d = await extractSessionDigest(file, 'u')
    expect(d!.files).toContainEqual({ path: '/repo/report.md', kind: 'created' })
    expect(d!.files).toContainEqual({ path: '/repo/existing.ts', kind: 'edited' })
    expect(d!.artifacts.createdFiles).toEqual(['/repo/report.md'])
  })

  it('captures a PR artifact with number + url from gh stdout', async () => {
    const file = await writeJsonl([
      userMsg('open a PR'),
      asstTool('Bash', { command: 'gh pr create --fill' }, 'b1'),
      {
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 'b1', content: 'done' }] },
        toolUseResult: 'https://github.com/dudgeon/duo/pull/214\n',
      },
    ])
    const d = await extractSessionDigest(file, 'u')
    expect(d!.artifacts.pr).toEqual({ number: 214, url: 'https://github.com/dudgeon/duo/pull/214' })
  })

  it('returns empty todos (never inferred) when no TodoWrite ran', async () => {
    const file = await writeJsonl([userMsg('hi'), asstText('hello')])
    const d = await extractSessionDigest(file, 'u')
    expect(d!.todos).toEqual([])
    expect(d!.files).toEqual([])
    expect(d!.attention).not.toBeNull() // ends on assistant text → question
  })

  it('returns null only on I/O failure', async () => {
    const d = await extractSessionDigest(path.join(dir, 'missing.jsonl'), 'u')
    expect(d).toBeNull()
  })
})

describe('extractAttentionReason — via the digest', () => {
  it('plan-to-approve: ExitPlanMode with no following human turn', async () => {
    const file = await writeJsonl([
      userMsg('redesign onboarding'),
      asstTool('ExitPlanMode', { plan: 'do the thing' }, 'p1'),
    ])
    const d = await extractSessionDigest(file, 'u')
    expect(d!.attention).toEqual({ reason: 'plan-to-approve' })
  })

  it('plan-to-approve is cleared once the human replies after the plan', async () => {
    const file = await writeJsonl([
      userMsg('redesign onboarding'),
      asstTool('ExitPlanMode', { plan: 'do the thing' }, 'p1'),
      userMsg('approved, go'),
      asstTool('Edit', { file_path: '/x.ts' }, 'e1'),
      asstText('working on it'),
    ])
    const d = await extractSessionDigest(file, 'u')
    // No longer plan-to-approve; ends on assistant text → question.
    expect(d!.attention).toEqual({ reason: 'question' })
  })

  it('blocked: last tool_result is_error', async () => {
    const file = await writeJsonl([
      userMsg('upgrade react'),
      asstTool('Bash', { command: 'npm run build' }, 'b1'),
      {
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 'b1', content: 'boom', is_error: true }] },
        toolUseResult: 'Error: build failed',
      },
    ])
    const d = await extractSessionDigest(file, 'u')
    expect(d!.attention).toEqual({ reason: 'blocked' })
  })

  it('question: ends on an assistant text turn', async () => {
    const file = await writeJsonl([
      userMsg('which option?'),
      asstText('Should I use X or Y?'),
    ])
    const d = await extractSessionDigest(file, 'u')
    expect(d!.attention).toEqual({ reason: 'question' })
  })

  it('no attention when the session ends on a tool result that is not an error', async () => {
    const file = await writeJsonl([
      userMsg('run tests'),
      asstTool('Bash', { command: 'echo hi' }, 'b1'),
      {
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 'b1', content: 'hi' }] },
        toolUseResult: 'hi',
      },
    ])
    const d = await extractSessionDigest(file, 'u')
    expect(d!.attention).toBeNull()
  })
})

describe('extractGoal — the title/summary → recap → command → first-prompt ladder', () => {
  const customTitle = (t: string) => ({ type: 'custom-title', customTitle: t })
  const aiTitle = (t: string) => ({ type: 'ai-title', aiTitle: t })
  const compactSummary = (content: string) => ({
    type: 'user',
    message: { role: 'user', content },
    isCompactSummary: true,
  })
  const commandMsg = (name: string, expansion: string) => ({
    type: 'user',
    message: { role: 'user', content: `<command-message>${name}</command-message>\n<command-name>${name}</command-name>\n${expansion}` },
  })

  it('prefers a custom-title (the user /rename) over everything', async () => {
    const file = await writeJsonl([
      commandMsg('review', 'You are an expert code reviewer. Follow these steps:'),
      aiTitle('AI generated title'),
      customTitle('cron-for-duo-local-build'),
    ])
    const d = await extractSessionDigest(file, 'u')
    expect(d!.goal).toBe('cron-for-duo-local-build')
  })

  it('prefers the ai-title (Claude\'s summary) over the first prompt', async () => {
    const file = await writeJsonl([
      userMsg('You are an expert code reviewer. Follow these steps: 1. …'),
      aiTitle('Code review of open PRs'),
    ])
    const d = await extractSessionDigest(file, 'u')
    expect(d!.goal).toBe('Code review of open PRs')
  })

  it('uses the recap "Primary Request and Intent" for a compacted, untitled session', async () => {
    const file = await writeJsonl([
      compactSummary(
        'This session is being continued from a previous conversation that ran out of context.\n\nSummary:\n1. Primary Request and Intent:\n   Build the rate-limiting middleware for the public API.\n\n2. Key Technical Concepts:\n   - token bucket',
      ),
      asstText('Continuing…'),
    ])
    const d = await extractSessionDigest(file, 'u')
    expect(d!.goal).toBe('Build the rate-limiting middleware for the public API.')
  })

  it('falls back to the slash-command name when the opening turn is a command', async () => {
    // no title, no recap → the <command-name> beats the expanded prompt
    const file = await writeJsonl([
      commandMsg('design-sync', 'Base directory for this skill: /tmp/skills/design-sync # Sync a design system…'),
    ])
    const d = await extractSessionDigest(file, 'u')
    expect(d!.goal).toBe('/design-sync')
  })

  it('falls back to the first real prompt, skipping recap boilerplate', () => {
    const lines = [
      { isCompactSummary: true, type: 'user', message: { role: 'user', content: 'This session is being continued…' } },
      { type: 'user', message: { role: 'user', content: 'Add OAuth refresh-token rotation' } },
    ]
    expect(extractGoal(lines, lines.map((l) => JSON.stringify(l)))).toBe('Add OAuth refresh-token rotation')
  })
})

describe('deriveState', () => {
  it('needs-you when attention is set, regardless of liveness', () => {
    expect(deriveState(false, 'plan-to-approve')).toBe('needs-you')
    expect(deriveState(true, 'blocked')).toBe('needs-you')
  })
  it('working when live with no attention; done otherwise', () => {
    expect(deriveState(true, null)).toBe('working')
    expect(deriveState(false, null)).toBe('done')
  })
})

describe('no inference at open — the extractor never reads the clock', () => {
  it('does not call Date.now()', async () => {
    const file = await writeJsonl([userMsg('hi'), asstText('there')])
    const spy = vi.spyOn(Date, 'now')
    await extractSessionDigest(file, 'u')
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('§D9 — the digest cache is rebuildable byte-identical from the transcript', () => {
  it('delete cache → re-extract → deep-equal the original', async () => {
    const file = await writeJsonl([
      userMsg('add rate limiting', { cwd: '/repo', gitBranch: 'claude/rate-limit' }),
      asstTool('TodoWrite', { todos: [{ content: 'middleware', status: 'completed' }] }),
      asstTool('Edit', { file_path: '/repo/mw/rateLimit.ts' }, 'e1'),
      asstText('Shipped the token bucket.'),
    ])
    const original = await extractSessionDigest(file, 'uuid-x')
    expect(original).not.toBeNull()

    const storePath = path.join(dir, 'session-digests.json')
    const store = new SessionDigestStore(storePath)
    await store.load()
    await store.setDigest('uuid-x', original!)
    await store.whenIdle()

    // Nuke the cache file entirely.
    await fs.rm(storePath, { force: true })
    const cold = new SessionDigestStore(storePath)
    await cold.load()
    expect(cold.getDigest('uuid-x')).toBeUndefined()

    // Rebuild from the transcript — must equal the original.
    const rebuilt = await extractSessionDigest(file, 'uuid-x')
    expect(rebuilt).toEqual(original)
  })
})

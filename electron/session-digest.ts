// ENH-231 — deterministic per-session DIGEST extractor (the "no inference at
// open" spine). PURE: no clock (`lastActivityAt` is the file mtime, a
// deterministic file fact, not `Date.now()`), no network, no LLM. Missing data
// is empty (`todos:[]`, `attention:null`) — NEVER guessed. Reuses the
// claude-session-tracker JSONL primitives so parsing never diverges.
//
// SHAPE CONFIRMED (2026-06-23, against live ~/.claude/projects/*/*.jsonl):
// TodoWrite input is `{todos:[{content,activeForm,status}]}`; ExitPlanMode is a
// `{type:'tool_use', name:'ExitPlanMode'}` block; a created file surfaces as a
// top-level `toolUseResult:{type:'create', filePath}`; a blocked tool surfaces
// as a `toolUseResult` STRING starting `"Error:"` (and/or a `tool_result` block
// with `is_error:true`); a PR URL matches /github.com/o/r/pull/N/. All scanners
// below read those shapes. (`{type:'tool_use', name, input}` blocks live inside
// an assistant `message.content` array; `toolUseResult` is carried top-level on
// the following user record.)

import { promises as fs } from 'fs'
import {
  readJsonlLines,
  safeParse,
  extractAssistantText,
  extractUserMessageText,
  cleanAndTruncate,
} from './claude-session-tracker'
import type {
  SessionDigest,
  DigestTodo,
  DigestFile,
  DigestArtifacts,
  AttentionReason,
  DigestState,
} from '../shared/types'

type Rec = Record<string, unknown>
interface ToolUse { id?: string; name: string; input: Rec }

const PR_URL_RE = /https:\/\/github\.com\/[^/\s"]+\/[^/\s"]+\/pull\/(\d+)/
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const TEST_CMD_RE = /\b(vitest|jest|pytest|mocha|go test|cargo test|npm (?:run )?test|yarn test|pnpm test)\b/i

/** Max characters kept for the "You asked" line + the fallback snippet. */
const YOU_ASKED_MAX = 200
const SNIPPET_MAX = 2000

function contentBlocks(parsed: Rec | null): unknown[] {
  const message = parsed?.message as Rec | undefined
  const content = message?.content
  return Array.isArray(content) ? content : []
}

function toolUsesOf(parsed: Rec | null): ToolUse[] {
  const out: ToolUse[] = []
  for (const b of contentBlocks(parsed)) {
    if (b && typeof b === 'object') {
      const blk = b as Rec
      if (blk.type === 'tool_use' && typeof blk.name === 'string') {
        out.push({
          id: typeof blk.id === 'string' ? blk.id : undefined,
          name: blk.name,
          input: (blk.input as Rec) ?? {},
        })
      }
    }
  }
  return out
}

function clampLine(s: string, max = YOU_ASKED_MAX): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t
}

// ── Scanners (each a deterministic pass; exported for unit tests) ────────────

/** Latest `TodoWrite` tool call → its `todos[]`. Empty when none — never
 *  inferred. */
export function scanTodoWrite(parsedLines: (Rec | null)[]): DigestTodo[] {
  for (let i = parsedLines.length - 1; i >= 0; i--) {
    for (const tu of toolUsesOf(parsedLines[i])) {
      if (tu.name === 'TodoWrite') {
        const raw = Array.isArray(tu.input.todos) ? (tu.input.todos as unknown[]) : []
        const todos = raw.map(normalizeTodo).filter((t): t is DigestTodo => t !== null)
        return todos
      }
    }
  }
  return []
}

function normalizeTodo(t: unknown): DigestTodo | null {
  if (!t || typeof t !== 'object') return null
  const o = t as Rec
  // Claude Code todos carry `content`; tolerate `text` too.
  const text = typeof o.content === 'string' ? o.content : typeof o.text === 'string' ? o.text : ''
  if (!text.trim()) return null
  const st = o.status
  const status: DigestTodo['status'] = st === 'in_progress' || st === 'completed' ? st : 'pending'
  return { text: text.trim(), status }
}

/** Paths edited via Edit/Write/MultiEdit/NotebookEdit, deduped in first-seen
 *  order. `created` only when a Write `toolUseResult.type === 'create'` proves
 *  it (review fix: "Write to unseen path ⇒ created" mislabels overwrite) —
 *  otherwise conservatively `edited`. */
export function scanFiles(parsedLines: (Rec | null)[]): DigestFile[] {
  const created = createdPaths(parsedLines)
  const seen = new Set<string>()
  const out: DigestFile[] = []
  for (const p of parsedLines) {
    for (const tu of toolUsesOf(p)) {
      if (!EDIT_TOOLS.has(tu.name)) continue
      const fp =
        typeof tu.input.file_path === 'string'
          ? tu.input.file_path
          : typeof tu.input.notebook_path === 'string'
            ? tu.input.notebook_path
            : ''
      if (fp && !seen.has(fp)) {
        seen.add(fp)
        out.push({ path: fp, kind: created.has(fp) ? 'created' : 'edited' })
      }
    }
  }
  return out
}

/** Paths a Write/create tool-result reported as newly created. */
function createdPaths(parsedLines: (Rec | null)[]): Set<string> {
  const set = new Set<string>()
  for (const p of parsedLines) {
    const r = p?.toolUseResult
    if (r && typeof r === 'object') {
      const ro = r as Rec
      if (ro.type === 'create' && typeof ro.filePath === 'string') set.add(ro.filePath)
    }
  }
  return set
}

/** Detected work products. PR captured with its URL (deep-link, no open-time
 *  lookup). Tests are a coarse pass/fail heuristic. */
export function scanArtifacts(parsedLines: (Rec | null)[], rawLines: string[]): DigestArtifacts {
  const art: DigestArtifacts = {}

  // PR — newest URL across all raw lines (covers `gh pr create` stdout in a
  // toolUseResult string AND an mcp create_pull_request result object).
  for (let i = rawLines.length - 1; i >= 0; i--) {
    const m = PR_URL_RE.exec(rawLines[i])
    if (m) {
      art.pr = { number: Number(m[1]), url: m[0] }
      break
    }
  }

  // Created files.
  const created = [...createdPaths(parsedLines)]
  if (created.length) art.createdFiles = created

  // Tests — coarse: did a test runner run, and did the output read pass/fail?
  let ranTests = false
  let failed = false
  let passed = false
  for (const tu of parsedLines.flatMap((p) => toolUsesOf(p))) {
    if (tu.name === 'Bash' && typeof tu.input.command === 'string' && TEST_CMD_RE.test(tu.input.command)) {
      ranTests = true
    }
  }
  if (ranTests) {
    for (const line of rawLines) {
      if (/\b\d+ (?:failed|failing)\b|✗|FAIL\b/.test(line)) failed = true
      else if (/\b\d+ (?:passed|passing)\b|✓ |\ball tests? pass/i.test(line)) passed = true
    }
    art.tests = failed ? 'fail' : passed ? 'pass' : 'unknown'
  }
  return art
}

/** Attention reason from the transcript shape, in priority order. Heuristic
 *  where noted; a wrong guess only changes a reason chip, never the column
 *  (all three map to "Needs you"). The live ENH-225 attention flag, when
 *  present at Stop-hook time, is OR-ed in by the caller for the `question`
 *  case. */
export function extractAttentionReason(parsedLines: (Rec | null)[]): AttentionReason | null {
  // plan-to-approve — last ExitPlanMode tool_use with no following human turn.
  let exitIdx = -1
  for (let i = parsedLines.length - 1; i >= 0; i--) {
    if (toolUsesOf(parsedLines[i]).some((t) => t.name === 'ExitPlanMode')) {
      exitIdx = i
      break
    }
  }
  if (exitIdx >= 0) {
    const humanAfter = parsedLines
      .slice(exitIdx + 1)
      .some((p) => p?.type === 'user' && !!extractUserMessageText(p))
    if (!humanAfter) return 'plan-to-approve'
  }

  // blocked — the last user record carrying a tool_result is error-shaped.
  for (let i = parsedLines.length - 1; i >= 0; i--) {
    const p = parsedLines[i]
    if (!p || p.type !== 'user') continue
    if (userHasToolResult(p)) {
      return userHasErrorResult(p) ? 'blocked' : breakNull()
    }
  }

  // question — ends on an assistant text turn with no pending tool_use.
  const last = lastMeaningful(parsedLines)
  if (last && last.type === 'assistant' && toolUsesOf(last).length === 0 && extractAssistantText(last)) {
    return 'question'
  }
  return null
}

// Helper so the blocked-branch reads as "first tool-result from the end decides;
// if it's not an error, stop looking for blocked" without an early `return null`
// that TypeScript can't see through the loop.
function breakNull(): null {
  return null
}

function userHasToolResult(parsed: Rec): boolean {
  return contentBlocks(parsed).some(
    (b) => b && typeof b === 'object' && (b as Rec).type === 'tool_result',
  )
}

function userHasErrorResult(parsed: Rec): boolean {
  for (const b of contentBlocks(parsed)) {
    if (b && typeof b === 'object' && (b as Rec).type === 'tool_result' && (b as Rec).is_error === true) {
      return true
    }
  }
  // Claude Code carries a top-level `toolUseResult` that is a STRING for errors
  // (confirmed live: `"Error: Path does not exist: …"`).
  const r = parsed.toolUseResult
  if (typeof r === 'string' && /^error\b/i.test(r.trim())) return true
  if (r && typeof r === 'object' && (r as Rec).is_error === true) return true
  return false
}

function lastMeaningful(parsedLines: (Rec | null)[]): Rec | null {
  for (let i = parsedLines.length - 1; i >= 0; i--) {
    const p = parsedLines[i]
    if (p && (p.type === 'user' || p.type === 'assistant')) return p
  }
  return null
}

/** needs-you when blocked/asking; working when a live process is attributed;
 *  else done. `isLive` is the caller's liveness signal (assembly), not in the
 *  transcript — so the cached digest stores the not-live derivation and the
 *  catch-up assembly re-derives with real liveness. */
export function deriveState(isLive: boolean, attention: AttentionReason | null): DigestState {
  if (attention) return 'needs-you'
  return isLive ? 'working' : 'done'
}

/** Build a SessionDigest from a session JSONL. Returns null only on I/O
 *  failure. Every field is a deterministic scan — no inference. */
export async function extractSessionDigest(
  jsonlPath: string,
  uuid: string,
): Promise<SessionDigest | null> {
  let rawLines: string[]
  try {
    rawLines = await readJsonlLines(jsonlPath)
  } catch {
    return null
  }
  const parsedLines = rawLines.map(safeParse)

  let lastActivityAt = 0
  try {
    lastActivityAt = (await fs.stat(jsonlPath)).mtimeMs
  } catch {
    // mtime unavailable — leave 0; assembly sorts it to the bottom.
  }

  let cwd = ''
  for (const p of parsedLines) {
    if (p && typeof p.cwd === 'string' && p.cwd) {
      cwd = p.cwd
      break
    }
  }

  let goal = ''
  for (const p of parsedLines) {
    const t = extractUserMessageText(p)
    if (t) {
      const cleaned = cleanAndTruncate(t)
      if (cleaned) {
        goal = cleaned
        break
      }
    }
  }

  let youAsked = ''
  for (let i = parsedLines.length - 1; i >= 0; i--) {
    const t = extractUserMessageText(parsedLines[i])
    if (t) {
      const cleaned = clampLine(t)
      if (cleaned) {
        youAsked = cleaned
        break
      }
    }
  }

  let fallbackSnippet: string | undefined
  for (let i = parsedLines.length - 1; i >= 0; i--) {
    const p = parsedLines[i]
    if (p?.type === 'assistant' && p.isSidechain !== true) {
      const t = extractAssistantText(p)
      if (t) {
        fallbackSnippet = clampLine(t, SNIPPET_MAX)
        break
      }
    }
  }

  let gitBranch: string | null = null
  for (let i = parsedLines.length - 1; i >= 0; i--) {
    const p = parsedLines[i]
    if (p && typeof p.gitBranch === 'string' && p.gitBranch) {
      gitBranch = p.gitBranch
      break
    }
  }

  const reason = extractAttentionReason(parsedLines)

  return {
    uuid,
    cwd,
    goal,
    youAsked,
    todos: scanTodoWrite(parsedLines),
    files: scanFiles(parsedLines),
    artifacts: scanArtifacts(parsedLines, rawLines),
    attention: reason ? { reason } : null,
    state: deriveState(false, reason),
    fallbackSnippet,
    gitBranch,
    lastActivityAt,
  }
}

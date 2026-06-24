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

// ── goal ladder (ENH-231 owner directive 2026-06-23) ────────────────────────
// The goal is the session's BEST available label, not the raw first prompt: a
// command-expansion or skill preamble as the goal reads as machinery, not
// intent. Ladder (highest first), mirroring + extending the ENH-212 title
// ladder so a session reads the same in Projects and Catch-up:
//   1. custom-title  — the user's `/rename`.
//   2. ai-title      — Claude Code's generated summary/title.
//   3. recap         — a compacted session's "Primary Request and Intent".
//   4. command       — `/<name>` when the first turn is a slash-command/skill
//                      invocation (a `<command-name>` wrapper).
//   5. first prompt  — the first real user message (skipping recap boilerplate),
//                      cleaned. The owner-accepted fallback when nothing better.

const RECAP_INTENT_RE = /Primary Request and Intent:\s*([\s\S]+?)(?:\n\s*\n|\n\s*\d+\.\s)/
const COMMAND_NAME_RE = /<command-name>\s*\/?([^<\s][^<]*?)\s*<\/command-name>/

/** Rungs 1–2: the latest custom-title, else the latest ai-title. */
function scanTitle(parsedLines: (Rec | null)[]): string | null {
  for (let i = parsedLines.length - 1; i >= 0; i--) {
    const p = parsedLines[i]
    if (p?.type === 'custom-title' && typeof p.customTitle === 'string' && p.customTitle.trim()) {
      return p.customTitle.trim()
    }
  }
  for (let i = parsedLines.length - 1; i >= 0; i--) {
    const p = parsedLines[i]
    if (p?.type === 'ai-title' && typeof p.aiTitle === 'string' && p.aiTitle.trim()) {
      return p.aiTitle.trim()
    }
  }
  return null
}

function isCompactSummary(p: Rec | null): boolean {
  return !!p && (p.isCompactSummary === true || p.isCompactSummary === 'True')
}

/** Rung 3: a compacted session's recap distills the prior arc; its "Primary
 *  Request and Intent" is the real goal (the continuation boilerplate is not). */
function scanRecapIntent(parsedLines: (Rec | null)[]): string | null {
  for (const p of parsedLines) {
    if (!isCompactSummary(p)) continue
    const text = extractUserMessageText(p)
    if (!text) continue
    const m = RECAP_INTENT_RE.exec(text)
    if (m) {
      const intent = m[1].replace(/\*\*/g, '').replace(/^[-•\s"]+/, '').trim()
      const firstSentence = intent.split(/(?<=[.:])\s/)[0] ?? intent
      const cleaned = cleanAndTruncate(firstSentence)
      if (cleaned) return cleaned
    }
  }
  return null
}

/** Rung 4: when the opening turn is a slash-command / skill invocation, the
 *  command name (`/review`, `/design-sync`) is a far better goal than its
 *  expanded prompt. Reads the raw line so the `<command-name>` wrapper is
 *  visible even when `extractUserMessageText` would surface the expansion. */
function scanCommandName(rawLines: string[]): string | null {
  for (const line of rawLines.slice(0, 12)) {
    if (!line.includes('<command-name>')) continue
    const m = COMMAND_NAME_RE.exec(line)
    if (m && m[1].trim()) return `/${m[1].trim()}`
  }
  return null
}

/** Rung 5: the first real user message, skipping recap boilerplate. */
function firstPromptGoal(parsedLines: (Rec | null)[]): string {
  for (const p of parsedLines) {
    if (isCompactSummary(p)) continue
    const t = extractUserMessageText(p)
    if (t) {
      const cleaned = cleanAndTruncate(t)
      if (cleaned) return cleaned
    }
  }
  // Last resort: even recap boilerplate beats an empty goal.
  for (const p of parsedLines) {
    const t = extractUserMessageText(p)
    if (t) {
      const cleaned = cleanAndTruncate(t)
      if (cleaned) return cleaned
    }
  }
  return ''
}

/** The session goal — Claude's title/summary if it generated one, else the
 *  recap, else the slash-command, else the first prompt (owner ladder). */
export function extractGoal(parsedLines: (Rec | null)[], rawLines: string[]): string {
  return (
    scanTitle(parsedLines) ??
    scanRecapIntent(parsedLines) ??
    scanCommandName(rawLines) ??
    firstPromptGoal(parsedLines)
  )
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

const PR_CREATE_CMD_RE = /\bgh\s+pr\s+create\b/

/** Detected work products. PR captured with its URL (deep-link, no open-time
 *  lookup). Tests are a coarse pass/fail heuristic. */
export function scanArtifacts(parsedLines: (Rec | null)[], rawLines: string[]): DigestArtifacts {
  const art: DigestArtifacts = {}

  // PR — ONLY when this session actually OPENED one: a `gh pr create` Bash
  // command or an `…create_pull_request` (mcp) tool call, with the URL captured
  // from a TOOL RESULT (the command's output), NOT from assistant prose. A pull
  // URL merely *mentioned* in a message (reviewing/referencing a PR) is NOT a
  // created artifact — that loose "any pull URL anywhere" match wrongly flagged
  // nearly every session as having produced a PR (live-data finding).
  const openedPr = parsedLines
    .flatMap((p) => toolUsesOf(p))
    .some(
      (tu) =>
        /create_pull_request/.test(tu.name) ||
        (tu.name === 'Bash' && typeof tu.input.command === 'string' && PR_CREATE_CMD_RE.test(tu.input.command)),
    )
  if (openedPr) {
    for (let i = parsedLines.length - 1; i >= 0; i--) {
      const r = parsedLines[i]?.toolUseResult
      const text = typeof r === 'string' ? r : r && typeof r === 'object' ? JSON.stringify(r) : ''
      const m = text ? PR_URL_RE.exec(text) : null
      if (m) {
        art.pr = { number: Number(m[1]), url: m[0] }
        break
      }
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

  // ENH-231 — goal ladder: Claude's title/summary → recap → command → first
  // prompt (the owner directive — never machinery when a real label exists).
  const goal = extractGoal(parsedLines, rawLines)

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

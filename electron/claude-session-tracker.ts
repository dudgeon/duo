// ENH-177 (Sprint 20 / v0.7.7) — Claude session-id capture for the
// workspace autosave path. Claude Code writes per-session JSONL
// files at `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl` —
// one file per active session, named with the session UUID, updated
// on every turn. We scrape the most-recently-modified `.jsonl` in
// the encoded-cwd directory to identify the live session and persist
// the ID in workspace metadata so a future workspace switch can
// offer a one-click `claude --resume <id>`.
//
// ENH-183 C4 (Sprint 21 / v0.7.9) — adds the read-ladder + JSONL-
// primary derivation logic the polymorphic SessionHeader needs:
// `readBannerTitle`, `readMessageCount`, `cleanAndTruncate`. Per C1
// empirics, JSONL is the source of truth — sessions-index.json is
// not consulted.
//
// Pure file system scan; no Claude internals. The shape is stable
// (Claude Code v2.x as of 2026-05).

import { promises as fs, realpathSync } from 'fs'
import path from 'path'
import os from 'os'

/**
 * Build the PTY command line for re-entering a Claude session, shared by the
 * Home click contract (HOME_SESSION_ACTION) and the `duo session open` CLI
 * verb so UI and CLI never diverge.
 *
 * `fork: true` appends `--fork-session`, which tells Claude to branch a NEW
 * session id from the current state instead of continuing the existing one.
 * This is the FORK path — taken only when the user *forces* re-entry into a
 * session that is still live OUTSIDE Duo (another terminal / the desktop app).
 * Without `--fork-session` a second `--resume` on a still-running session would
 * attach two writers to the same JSONL and clobber the original's transcript.
 *
 * `fork: false` (the default) is a plain resume — continue a genuinely-closed
 * session in place. The trailing newline auto-runs the command in the spawned
 * shell (parity with the legacy sessionResume PTY write).
 *
 * Callers must validate `uuid` (UUID regex) before passing it here.
 */
export function buildResumeCommand(uuid: string, opts?: { fork?: boolean }): string {
  return opts?.fork
    ? `claude --resume ${uuid} --fork-session\n`
    : `claude --resume ${uuid}\n`
}

/**
 * Encode an absolute filesystem path the way Claude Code does to map
 * a cwd to its `~/.claude/projects/<dir>/` subdirectory. Both `/` and
 * `.` are mapped to `-` — verified against the live filesystem:
 *
 *   /Users/geoffreydudgeon/Documents/GitHub/duo
 *     → -Users-geoffreydudgeon-Documents-GitHub-duo
 *   /Users/geoffreydudgeon/.claude/skills/duo
 *     → -Users-geoffreydudgeon--claude-skills-duo
 *   /Users/geoffreydudgeon/Documents/GitHub/duo/.claude/worktrees/X
 *     → -Users-geoffreydudgeon-Documents-GitHub-duo--claude-worktrees-X
 *
 * BUG-158 (2026-05-24): Claude RESOLVES SYMLINKS before encoding —
 * `/tmp` on macOS is a symlink to `/private/tmp`, so a Claude session
 * started at `/tmp/X` is written to `~/.claude/projects/-private-tmp-X/`,
 * not `~/.claude/projects/-tmp-X/`. We must do the same so our lookups
 * match. Best-effort: if realpath fails (path doesn't exist), fall back
 * to the literal path — same encoding as before.
 */
export function encodeProjectDir(absPath: string): string {
  let resolved = absPath
  try {
    resolved = realpathSync(absPath)
  } catch {
    // Path doesn't exist or no perms — fall back to literal.
  }
  return resolved.replace(/[/.]/g, '-')
}

export interface DetectedClaudeSession {
  id: string
  capturedAt: number
  /** Modification time of the JSONL file at scan time. Useful for
   *  staleness pruning at restore. */
  jsonlModifiedAt: number
}

/**
 * Find the most-recently-modified `.jsonl` under
 * `~/.claude/projects/<encoded-cwd>/`. Returns `null` if the
 * directory is missing, empty, or otherwise unreadable — best-effort
 * by design (never crash the save path).
 *
 * Optional `maxAgeMs` — if the most-recent file is older than this,
 * returns null. Defaults to no limit. Callers that want to skip
 * stale captures can pass e.g. 24h.
 */
export async function detectLatestClaudeSession(
  cwd: string,
  maxAgeMs?: number
): Promise<DetectedClaudeSession | null> {
  try {
    const projectDir = path.join(os.homedir(), '.claude', 'projects', encodeProjectDir(cwd))
    const entries = await fs.readdir(projectDir, { withFileTypes: true })
    let best: { id: string; mtimeMs: number } | null = null
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.jsonl')) continue
      const id = e.name.slice(0, -'.jsonl'.length)
      // Skip empty/garbage names.
      if (!id) continue
      const stat = await fs.stat(path.join(projectDir, e.name)).catch(() => null)
      if (!stat) continue
      if (!best || stat.mtimeMs > best.mtimeMs) {
        best = { id, mtimeMs: stat.mtimeMs }
      }
    }
    if (!best) return null
    const now = Date.now()
    if (maxAgeMs !== undefined && now - best.mtimeMs > maxAgeMs) return null
    return {
      id: best.id,
      capturedAt: now,
      jsonlModifiedAt: best.mtimeMs
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// ENH-183 C4 — read ladder + message count + first-prompt cleanup
// ---------------------------------------------------------------------------

/** Threshold for full-file reads. Files at or below this are slurped
 *  whole; bigger files get head+tail partial reads (HEAD_BYTES from
 *  the start + TAIL_BYTES from the end) so we still catch
 *  `custom-title` entries regardless of where they sit. The 17MB
 *  empirical session on this machine has its `custom-title` at line
 *  654 (near the head); the 131MB ones could have it anywhere. */
const FULL_READ_BYTES = 4 * 1024 * 1024
const HEAD_BYTES = 1 * 1024 * 1024
const TAIL_BYTES = 1 * 1024 * 1024

export type BannerTitleSource =
  | 'customTitle'
  | 'aiTitle'
  | 'jsonl-firstmsg'
  | 'uuid'

export interface BannerTitleResult {
  title: string
  source: BannerTitleSource
}

/**
 * D5 read ladder. Returns the title to display + which rung produced
 * it. JSONL-primary per C1 empirics — sessions-index.json is never
 * consulted.
 *
 *   1. Latest `{"type":"custom-title","customTitle":"..."}` JSONL entry.
 *   2. Latest `{"type":"ai-title","aiTitle":"..."}` JSONL entry.
 *   3. First `type:"user"` JSONL entry → cleanAndTruncate.
 *   4. Short UUID (first 8 chars).
 *
 * Best-effort: any I/O failure degrades gracefully to a shorter UUID.
 */
export async function readBannerTitle(
  sessionUuid: string,
  cwd: string
): Promise<BannerTitleResult> {
  const jsonlPath = jsonlPathFor(sessionUuid, cwd)
  const lines = await readJsonlLines(jsonlPath).catch(() => null)
  if (!lines || lines.length === 0) {
    return { title: shortUuid(sessionUuid), source: 'uuid' }
  }
  return titleFromLines(lines) ?? { title: shortUuid(sessionUuid), source: 'uuid' }
}

/** Rungs 1–3 of the D5 title ladder over an already-read set of JSONL
 *  lines. Shared by `readBannerTitle` (full read ladder) and
 *  `readSessionHeadMeta` (ENH-212 head-16KB read). Returns null when
 *  no rung fires — callers fall back to the short UUID. (The ENH-231 digest
 *  has its OWN richer goal ladder, `extractGoal`, which also honors these.) */
function titleFromLines(lines: string[]): BannerTitleResult | null {
  // Reverse scan for the latest custom-title entry.
  for (let i = lines.length - 1; i >= 0; i--) {
    const parsed = safeParse(lines[i])
    if (parsed?.type === 'custom-title' && typeof parsed.customTitle === 'string' && parsed.customTitle.length > 0) {
      return { title: parsed.customTitle, source: 'customTitle' }
    }
  }

  // Reverse scan for the latest ai-title entry.
  for (let i = lines.length - 1; i >= 0; i--) {
    const parsed = safeParse(lines[i])
    if (parsed?.type === 'ai-title' && typeof parsed.aiTitle === 'string' && parsed.aiTitle.length > 0) {
      return { title: parsed.aiTitle, source: 'aiTitle' }
    }
  }

  // Forward scan for the first user message.
  for (const line of lines) {
    const parsed = safeParse(line)
    const userText = extractUserMessageText(parsed)
    if (userText) {
      const cleaned = cleanAndTruncate(userText)
      if (cleaned) return { title: cleaned, source: 'jsonl-firstmsg' }
    }
  }

  return null
}

/**
 * D13 — count user-role messages in the session JSONL.
 *
 * No caching (D9 invariant). Returns 0 if the JSONL is missing or
 * unreadable; callers can use messageCount ≥ 3 as a hydration trigger
 * (T1) safely against a 0 reading.
 */
export async function readMessageCount(
  sessionUuid: string,
  cwd: string
): Promise<number> {
  const jsonlPath = jsonlPathFor(sessionUuid, cwd)
  const lines = await readJsonlLines(jsonlPath).catch(() => null)
  if (!lines) return 0
  let count = 0
  for (const line of lines) {
    const parsed = safeParse(line)
    if (parsed?.type === 'user') count += 1
  }
  return count
}

/**
 * Strip noise and shorten a raw first-prompt string for use as a
 * session title. Exported because C8's hydrator derivation uses the
 * same logic (T1 trigger writes the same cleaned-and-truncated
 * value via `/rename`).
 *
 * Cleaning order:
 *   1. Strip `<ide_opened_file>…</ide_opened_file>` (and `</ide_opened_file>`)
 *      sentinel wrappers — Claude Code prepends these when an IDE
 *      file is open.
 *   2. Collapse whitespace runs to a single space.
 *   3. Drop leading conversational fillers ("please ", "could you ",
 *      "can you ").
 *   4. Truncate to 60 chars on a word boundary; append "…" if cut.
 *
 * Returns the empty string if nothing usable remains.
 */
/** Wrapper / machinery tags that the harness injects into the FIRST "user"
 *  message — slash-command plumbing, local-command caveats + stdout, IDE
 *  hints, system reminders. Stripped (paired content + lone tags) so a
 *  session whose opener is pure machinery yields an empty title and the
 *  forward scan falls through to the first REAL prompt (round-2 feedback:
 *  titles like "<local-command-caveat>Caveat: …" leaked through). */
const TITLE_WRAPPER_TAGS = [
  'ide_opened_file',
  'local-command-caveat',
  'local-command-stdout',
  'command-name',
  'command-message',
  'command-args',
  'command-contents',
  'system-reminder',
]

export function cleanAndTruncate(raw: string): string {
  if (!raw) return ''
  let s = raw

  // Strip each wrapper family — paired (with content) first, then any lone
  // opening/closing tags left behind.
  for (const tag of TITLE_WRAPPER_TAGS) {
    s = s.replace(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, 'g'), ' ')
    s = s.replace(new RegExp(`</?${tag}>`, 'g'), ' ')
  }

  // Collapse whitespace + trim.
  s = s.replace(/\s+/g, ' ').trim()
  if (!s) return ''

  // Drop common conversational fillers (case-insensitive, repeated).
  // Iterate so "please, could you ..." normalizes to "...".
  const fillers = /^(please|could you|can you|would you|kindly|hey,?|hi,?)[ ,]+/i
  while (fillers.test(s)) s = s.replace(fillers, '')

  s = s.trim()
  if (!s) return ''

  // Capitalize first letter for display niceness — opt-in, low risk.
  s = s.charAt(0).toUpperCase() + s.slice(1)

  // Truncate to ~60 chars on a word boundary.
  const MAX = 60
  if (s.length <= MAX) return s
  const cut = s.slice(0, MAX)
  const lastSpace = cut.lastIndexOf(' ')
  const truncated = lastSpace > MAX * 0.5 ? cut.slice(0, lastSpace) : cut
  return `${truncated}…`
}

// ---------------------------------------------------------------------------
// Helpers (not exported except where tests need them).
// ---------------------------------------------------------------------------

function jsonlPathFor(sessionUuid: string, cwd: string): string {
  return path.join(
    os.homedir(),
    '.claude',
    'projects',
    encodeProjectDir(cwd),
    `${sessionUuid}.jsonl`,
  )
}

/** Read JSONL into an array of trimmed line strings. Empty lines are
 *  dropped. For files larger than `FULL_READ_BYTES`, returns a
 *  head-bytes + tail-bytes splice so we catch custom-title entries
 *  regardless of where they sit in the file. Partial first/last
 *  lines from chunked reads are discarded. */
// ENH-231 — exported (was file-private) so the session-digest extractor reuses
// the exact same JSONL read/parse logic rather than duplicating it.
export async function readJsonlLines(filePath: string): Promise<string[]> {
  const stat = await fs.stat(filePath)
  if (stat.size <= FULL_READ_BYTES) {
    const buf = await fs.readFile(filePath)
    return splitLines(buf)
  }

  // Dual head + tail read for large files.
  const handle = await fs.open(filePath, 'r')
  try {
    const headBuf = Buffer.alloc(HEAD_BYTES)
    await handle.read(headBuf, 0, HEAD_BYTES, 0)
    // Drop the trailing partial line from the head read.
    const headLastNewline = headBuf.lastIndexOf(0x0a /* \n */)
    const head = headLastNewline >= 0 ? headBuf.subarray(0, headLastNewline) : headBuf

    const tailBuf = Buffer.alloc(TAIL_BYTES)
    await handle.read(tailBuf, 0, TAIL_BYTES, stat.size - TAIL_BYTES)
    // Drop the leading partial line from the tail read.
    const tailFirstNewline = tailBuf.indexOf(0x0a /* \n */)
    const tail = tailFirstNewline >= 0 ? tailBuf.subarray(tailFirstNewline + 1) : tailBuf

    return [...splitLines(head), ...splitLines(tail)]
  } finally {
    await handle.close()
  }
}

function splitLines(buf: Buffer): string[] {
  return buf.toString('utf8').split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
}

export function safeParse(line: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(line)
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function shortUuid(uuid: string): string {
  return uuid.length > 8 ? uuid.slice(0, 8) : uuid
}

// ---------------------------------------------------------------------------
// ENH-183 C6 — list prior sessions in a CWD for the S1 resume pills
// ---------------------------------------------------------------------------

export interface PriorSessionListing {
  uuid: string
  title: string
  source: BannerTitleSource
  /** JSONL line count of `type:"user"` entries. */
  messageCount: number
  /** Mtime of the JSONL file in ms epoch. */
  modifiedAt: number
}

/**
 * List the N most-recently-modified Claude sessions in a CWD. Each
 * entry includes a derived banner title (via the D5 read ladder) +
 * user-message count + JSONL mtime.
 *
 * Best-effort: bad reads degrade to short UUID titles. Excluded UUIDs
 * (e.g. the live `lastClaudeSession.id` already captured in workspace
 * metadata) are filtered out so the pills don't duplicate S3's offer.
 */
export async function listPriorSessions(
  cwd: string,
  opts?: { limit?: number; excludeUuid?: string }
): Promise<PriorSessionListing[]> {
  const limit = opts?.limit ?? 10
  const exclude = opts?.excludeUuid
  try {
    const projectDir = path.join(os.homedir(), '.claude', 'projects', encodeProjectDir(cwd))
    const entries = await fs.readdir(projectDir, { withFileTypes: true })
    const candidates: Array<{ uuid: string; modifiedAt: number }> = []
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.jsonl')) continue
      const uuid = e.name.slice(0, -'.jsonl'.length)
      if (!uuid || uuid === exclude) continue
      const stat = await fs.stat(path.join(projectDir, e.name)).catch(() => null)
      if (!stat) continue
      candidates.push({ uuid, modifiedAt: stat.mtimeMs })
    }
    candidates.sort((a, b) => b.modifiedAt - a.modifiedAt)
    const top = candidates.slice(0, limit)
    const out: PriorSessionListing[] = []
    for (const c of top) {
      const [titleR, msgCount] = await Promise.all([
        readBannerTitle(c.uuid, cwd).catch(() => ({ title: c.uuid.slice(0, 8), source: 'uuid' as const })),
        readMessageCount(c.uuid, cwd).catch(() => 0),
      ])
      out.push({
        uuid: c.uuid,
        title: titleR.title,
        source: titleR.source,
        messageCount: msgCount,
        modifiedAt: c.modifiedAt,
      })
    }
    return out
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// ENH-212 — Home data primitives (stat-only enumeration + seek-based
// head/tail metadata reads)
// ---------------------------------------------------------------------------

/** Tail-read growth ladder for `readSessionTailMeta`. Single JSONL
 *  lines on the reference machine reach ~400KB (giant thinking
 *  blocks), so a fixed 64KB window can yield ZERO complete lines —
 *  grow exponentially, capped at 2MB (PRD ENH-212 § 4.2 [V]). */
const TAIL_META_LADDER = [64 * 1024, 256 * 1024, 1024 * 1024, 2 * 1024 * 1024]

/** Head window for `readSessionHeadMeta`. Head lines (queue ops, the
 *  first user/system entries) are small — 16KB covers the cwd
 *  evidence + the first-message title rung cheaply. */
const HEAD_META_BYTES = 16 * 1024

/** Tail window for `readSessionHeadMeta`'s TITLE scan. A `/rename`
 *  (`custom-title`) or auto `ai-title` entry is appended WHEN the user
 *  runs it — usually deep in the session, not the head. So the title
 *  ladder also scans a tail window; without this, Home showed the first
 *  prompt for renamed sessions (round-2 feedback). cwd still comes from
 *  the head only (it lives in the first entries). */
const TAIL_META_BYTES = 16 * 1024

export interface TopLevelSessionStat {
  /** Session UUID (the `.jsonl` basename). */
  id: string
  mtimeMs: number
  sizeBytes: number
}

/**
 * Stat-only enumeration of the top-level `<uuid>.jsonl` files in a
 * `~/.claude/projects/<encoded-cwd>/` directory. Subagent transcripts
 * live under `<uuid>/subagents/**` SUBDIRECTORIES (observed live
 * 2026-06-12, incl. nested `subagents/workflows/<wf>/agent-*.jsonl`)
 * and are excluded structurally — only direct-child regular files are
 * considered. Never throws; missing/unreadable dir → [].
 */
export async function listTopLevelSessions(projectDir: string): Promise<TopLevelSessionStat[]> {
  try {
    const entries = await fs.readdir(projectDir, { withFileTypes: true })
    const out: TopLevelSessionStat[] = []
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.jsonl')) continue
      const id = e.name.slice(0, -'.jsonl'.length)
      if (!id) continue
      const stat = await fs.stat(path.join(projectDir, e.name)).catch(() => null)
      if (!stat) continue
      out.push({ id, mtimeMs: stat.mtimeMs, sizeBytes: stat.size })
    }
    return out
  } catch {
    return []
  }
}

export interface SessionTailMeta {
  /** Text of the last non-sidechain assistant entry; falls back to
   *  the `lastPrompt` text of a `last-prompt` record when no
   *  assistant text is within the read window. */
  snippet: string | null
  gitBranch: string | null
  sessionId: string | null
  /** Latest `timestamp` seen in the tail window, ms epoch. */
  timestamp: number | null
}

const EMPTY_TAIL_META: SessionTailMeta = {
  snippet: null,
  gitBranch: null,
  sessionId: null,
  timestamp: null
}

/**
 * Seek-based tail read of a session JSONL (fd + position — NEVER a
 * full-file read; sessions reach 270MB). Reads the trailing window,
 * trimming the leading partial line after any seek, and parses for:
 *
 *   - snippet: last `type:"assistant"` entry with `!isSidechain` and
 *     a text content block (`last-prompt.lastPrompt` fallback)
 *   - gitBranch / sessionId / latest timestamp
 *
 * Window grows 64KB → 256KB → 1MB → 2MB (cap), stopping as soon as an
 * assistant snippet is found or the window covers the whole file.
 * Never throws — corrupt/missing files degrade to all-null fields.
 */
export async function readSessionTailMeta(file: string): Promise<SessionTailMeta> {
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null
  try {
    handle = await fs.open(file, 'r')
    const stat = await handle.stat()
    let last: SessionTailMeta = EMPTY_TAIL_META
    for (const want of TAIL_META_LADDER) {
      const len = Math.min(want, stat.size)
      const position = stat.size - len
      const buf = Buffer.alloc(len)
      await handle.read(buf, 0, len, position)
      let slice = buf
      if (position > 0) {
        // Seeked mid-file — drop the leading partial line.
        const firstNewline = buf.indexOf(0x0a /* \n */)
        slice = firstNewline >= 0 ? buf.subarray(firstNewline + 1) : Buffer.alloc(0)
      }
      const scan = scanTailLines(splitLines(slice))
      last = {
        snippet: scan.assistantSnippet ?? scan.lastPromptText,
        gitBranch: scan.gitBranch,
        sessionId: scan.sessionId,
        timestamp: scan.timestamp
      }
      // Stop growing once the needed kind (assistant snippet) is in
      // hand, or once the window already covers the whole file.
      if (scan.assistantSnippet !== null || len >= stat.size) return last
    }
    return last
  } catch {
    return EMPTY_TAIL_META
  } finally {
    await handle?.close().catch(() => {})
  }
}

interface TailScan {
  assistantSnippet: string | null
  lastPromptText: string | null
  gitBranch: string | null
  sessionId: string | null
  timestamp: number | null
}

/** Reverse scan of tail-window lines: latest-wins for every field. */
function scanTailLines(lines: string[]): TailScan {
  const scan: TailScan = {
    assistantSnippet: null,
    lastPromptText: null,
    gitBranch: null,
    sessionId: null,
    timestamp: null
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    const parsed = safeParse(lines[i])
    if (!parsed) continue
    if (scan.gitBranch === null && typeof parsed.gitBranch === 'string' && parsed.gitBranch.length > 0) {
      scan.gitBranch = parsed.gitBranch
    }
    if (scan.sessionId === null && typeof parsed.sessionId === 'string' && parsed.sessionId.length > 0) {
      scan.sessionId = parsed.sessionId
    }
    if (scan.timestamp === null && typeof parsed.timestamp === 'string') {
      const ts = Date.parse(parsed.timestamp)
      if (!Number.isNaN(ts)) scan.timestamp = ts
    }
    if (scan.assistantSnippet === null && parsed.type === 'assistant' && parsed.isSidechain !== true) {
      const text = extractAssistantText(parsed)
      if (text) scan.assistantSnippet = text
    }
    if (scan.lastPromptText === null && parsed.type === 'last-prompt' && typeof parsed.lastPrompt === 'string' && parsed.lastPrompt.length > 0) {
      scan.lastPromptText = parsed.lastPrompt
    }
  }
  return scan
}

/** Pull the last text content block from a `type:"assistant"` entry.
 *  Assistant content is a block array (thinking / text / tool_use…);
 *  the LAST text block is the user-visible closing line. */
export function extractAssistantText(parsed: Record<string, unknown>): string | null {
  const message = parsed.message as Record<string, unknown> | undefined
  const content = message?.content
  if (typeof content === 'string') return content.trim() || null
  if (!Array.isArray(content)) return null
  for (let i = content.length - 1; i >= 0; i--) {
    const block = content[i]
    if (block && typeof block === 'object') {
      const b = block as Record<string, unknown>
      if (b.type === 'text' && typeof b.text === 'string') {
        const text = b.text.trim()
        if (text) return text
      }
    }
  }
  return null
}

export interface SessionHeadMeta {
  /** ROLLUP evidence (PRD ENH-212 D8 [V]): the cwd recorded on the
   *  first user/system entry — never a reversed encodeProjectDir. */
  cwd: string | null
  title?: string
  titleSource?: BannerTitleSource
}

/**
 * Seek-based head-16KB read. The head lines are small (queue ops +
 * the first user/system entries), so 16KB covers both the cwd
 * evidence and the title ladder in one cheap read. The trailing
 * partial line of the window is dropped. Never throws — degrades to
 * `{ cwd: null }`.
 */
export async function readSessionHeadMeta(file: string): Promise<SessionHeadMeta> {
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null
  try {
    handle = await fs.open(file, 'r')
    const stat = await handle.stat()
    const len = Math.min(HEAD_META_BYTES, stat.size)
    const buf = Buffer.alloc(len)
    await handle.read(buf, 0, len, 0)
    let slice = buf
    if (len < stat.size) {
      // Window ends mid-file — drop the trailing partial line.
      const lastNewline = buf.lastIndexOf(0x0a /* \n */)
      slice = lastNewline >= 0 ? buf.subarray(0, lastNewline) : Buffer.alloc(0)
    }
    const lines = splitLines(slice)

    // cwd: first user/system entry carrying one; any-entry fallback
    // (assistant entries carry cwd too — equally valid evidence).
    let cwd: string | null = null
    let anyCwd: string | null = null
    for (const line of lines) {
      const parsed = safeParse(line)
      if (!parsed || typeof parsed.cwd !== 'string' || parsed.cwd.length === 0) continue
      if (anyCwd === null) anyCwd = parsed.cwd
      if (parsed.type === 'user' || parsed.type === 'system') {
        cwd = parsed.cwd
        break
      }
    }

    // Title ladder over head + a TAIL window: a `/rename` (custom-title) or
    // ai-title entry usually sits late in the session, so a head-only scan
    // would miss it and fall back to the first prompt. Skip the tail when the
    // head already covers the whole file; cap the tail so it never overlaps
    // the head (no duplicate lines for files just over HEAD_META_BYTES).
    let titleLines = lines
    if (len < stat.size) {
      const tailLen = Math.min(TAIL_META_BYTES, stat.size - len)
      const tailBuf = Buffer.alloc(tailLen)
      await handle.read(tailBuf, 0, tailLen, stat.size - tailLen)
      const firstNewline = tailBuf.indexOf(0x0a /* \n */)
      const tailSlice = firstNewline >= 0 ? tailBuf.subarray(firstNewline + 1) : tailBuf
      titleLines = [...lines, ...splitLines(tailSlice)]
    }

    const title = titleFromLines(titleLines)
    return {
      cwd: cwd ?? anyCwd,
      ...(title ? { title: title.title, titleSource: title.source } : {})
    }
  } catch {
    return { cwd: null }
  } finally {
    await handle?.close().catch(() => {})
  }
}

/** Pull out the human-typed text from a `type:"user"` JSONL entry.
 *  Claude Code's user-role entries are nested:
 *    { type: "user", message: { content: "...", role: "user" } }
 *  …or content can be an array of `{type:'text', text:'...'}` blocks. */
export function extractUserMessageText(parsed: Record<string, unknown> | null): string | null {
  if (!parsed || parsed.type !== 'user') return null
  const message = parsed.message as Record<string, unknown> | undefined
  if (!message) return null
  const content = message.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block && typeof block === 'object') {
        const b = block as Record<string, unknown>
        if (b.type === 'text' && typeof b.text === 'string') return b.text
      }
    }
  }
  return null
}

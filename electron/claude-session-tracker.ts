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

  return { title: shortUuid(sessionUuid), source: 'uuid' }
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
export function cleanAndTruncate(raw: string): string {
  if (!raw) return ''
  let s = raw

  // Strip ide_opened_file wrappers, with or without closing tag.
  s = s.replace(/<ide_opened_file>[\s\S]*?<\/ide_opened_file>/g, ' ')
  s = s.replace(/<\/?ide_opened_file>/g, ' ')

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
async function readJsonlLines(filePath: string): Promise<string[]> {
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

function safeParse(line: string): Record<string, unknown> | null {
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

/** Pull out the human-typed text from a `type:"user"` JSONL entry.
 *  Claude Code's user-role entries are nested:
 *    { type: "user", message: { content: "...", role: "user" } }
 *  …or content can be an array of `{type:'text', text:'...'}` blocks. */
function extractUserMessageText(parsed: Record<string, unknown> | null): string | null {
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

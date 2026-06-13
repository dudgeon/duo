// ENH-013 — Send → Duo pill gating: front terminal's PTY tree must
// contain a live `claude` descendant for the pill to be enabled.
//
// Strict mode (the spec's option a): only the FRONT-of-terminal-column
// PTY is checked. The renderer pushes that PID up to main on every
// tab activation; we poll its descendant tree every 500ms and emit a
// state change whenever the prober's verdict flips.
//
// State machine:
//   - 'no-pty'   — no active terminal (or it disconnected).
//   - 'shell'    — PTY exists, no `claude` descendant in its tree.
//   - 'claude'   — `claude` (or known variant) found in the descendant
//                  process tree.
//   - 'starting' — within a grace window after a Claude tab was just
//                  spawned but no descendant is visible yet. Treated
//                  as live so the pill doesn't flicker off during the
//                  ~500ms gap between PTY launch and `claude` exec.
//
// `claude` matching: we look for a process whose `comm` (basename,
// last path segment) equals `claude`. This covers Stage 19b's PATH
// shim — the shim's `exec real-claude --append-system-prompt …` ends
// up with `claude` (or a node binary named claude) as the descendant.

import { spawn } from 'child_process'

export type ClaudePresenceState = 'no-pty' | 'shell' | 'claude' | 'starting'

const POLL_INTERVAL_MS = 500
const STARTING_GRACE_MS = 1500

export interface ProbeTarget {
  pid: number | null
  /** Tab kind at activation time. `'claude'` arms the starting-grace
   *  window so the pill stays live during the launch gap. */
  kind: 'claude' | 'shell' | null
}

export class ClaudePresenceProbe {
  private target: ProbeTarget = { pid: null, kind: null }
  private state: ClaudePresenceState = 'no-pty'
  private graceStart = 0
  private timer: NodeJS.Timeout | null = null
  // ENH-191 P3-S8d — start() called, stop() not yet. Gates the park logic so a
  // setTarget after teardown can't resurrect the poll loop.
  private running = false
  private listeners = new Set<(state: ClaudePresenceState) => void>()
  private probing = false

  setTarget(target: ProbeTarget): void {
    const changed = target.pid !== this.target.pid || target.kind !== this.target.kind
    this.target = target
    if (target.kind === 'claude' && target.pid) {
      this.graceStart = Date.now()
    }
    if (changed) {
      // Probe immediately on target change so the pill flips fast.
      void this.probe()
    }
    // ENH-191 P3-S8d (NFR-1.3) — park the poll loop when there's no hosting
    // target. A pid:null probe can only ever compute 'no-pty', so the 500ms ps
    // spawn is pure idle waste; arm on a hosting target, disarm on pid:null.
    this.syncPolling()
  }

  start(): void {
    this.running = true
    this.syncPolling()
  }

  stop(): void {
    this.running = false
    this.clearTimer()
  }

  /** ENH-191 P3-S8d — true when the poll interval is armed (test/diagnostic). */
  isPolling(): boolean {
    return this.timer !== null
  }

  // Arm the poll interval iff started AND there's a hosting target; otherwise
  // disarm (park). Idempotent — safe to call on every setTarget/start/stop.
  private syncPolling(): void {
    if (this.running && this.target.pid != null) {
      if (!this.timer) this.timer = setInterval(() => { void this.probe() }, POLL_INTERVAL_MS)
    } else {
      this.clearTimer()
    }
  }

  private clearTimer(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** Subscribe to state changes. Returns an unsubscribe function. */
  onChange(cb: (state: ClaudePresenceState) => void): () => void {
    this.listeners.add(cb)
    // Fire immediately with current state so subscribers don't have to
    // wait for the next poll for an initial value.
    cb(this.state)
    return () => { this.listeners.delete(cb) }
  }

  getState(): ClaudePresenceState {
    return this.state
  }

  private async probe(): Promise<void> {
    if (this.probing) return // skip overlapping probes
    this.probing = true
    try {
      const next = await this.computeState()
      if (next !== this.state) {
        this.state = next
        for (const cb of this.listeners) cb(next)
      }
    } finally {
      this.probing = false
    }
  }

  private async computeState(): Promise<ClaudePresenceState> {
    if (!this.target.pid) return 'no-pty'
    const live = await hasClaudeDescendant(this.target.pid)
    if (live) return 'claude'
    if (this.target.kind === 'claude' && Date.now() - this.graceStart < STARTING_GRACE_MS) {
      return 'starting'
    }
    return 'shell'
  }
}

/**
 * BFS the process tree starting at `rootPid`; return true if any
 * descendant's basename is `claude`. Uses one `ps -ax -o pid,ppid,comm`
 * call (~1ms on macOS) instead of recursive `pgrep -P` (which fires
 * once per parent and adds latency).
 */
function hasClaudeDescendant(rootPid: number): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('ps', ['-ax', '-o', 'pid,ppid,comm'], { stdio: ['ignore', 'pipe', 'ignore'] })
    let stdout = ''
    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.on('error', () => resolve(false))
    child.on('close', () => {
      const byParent = parsePsByParent(stdout)
      resolve(treeHasClaude(byParent, rootPid))
    })
  })
}

// ENH-212 — Home open-session detection. The front-tab probe above checks
// ONE pid; Home needs a per-root verdict for many roots at once + the set
// of live claude processes that aren't owned by any Duo terminal (the
// live-but-idle guard, § 4.3 [V]). One `ps -ax` parse serves both.

/** Parse `ps -ax -o pid,ppid,comm` stdout into a parent→children adjacency
 *  map. Shared by hasClaudeDescendant + probeAllTabs so both read the same
 *  line shape. */
function parsePsByParent(stdout: string): Map<number, Array<{ pid: number; comm: string }>> {
  const byParent = new Map<number, Array<{ pid: number; comm: string }>>()
  const lines = stdout.split('\n').slice(1) // drop header
  for (const line of lines) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line)
    if (!m) continue
    const pid = parseInt(m[1], 10)
    const ppid = parseInt(m[2], 10)
    const comm = m[3]
    const list = byParent.get(ppid)
    if (list) list.push({ pid, comm })
    else byParent.set(ppid, [{ pid, comm }])
  }
  return byParent
}

/** Whether any descendant of `rootPid` has basename `claude`. */
function treeHasClaude(
  byParent: Map<number, Array<{ pid: number; comm: string }>>,
  rootPid: number
): boolean {
  const queue = [rootPid]
  const visited = new Set<number>()
  while (queue.length > 0) {
    const cur = queue.shift()!
    if (visited.has(cur)) continue
    visited.add(cur)
    const children = byParent.get(cur)
    if (!children) continue
    for (const c of children) {
      const basename = c.comm.split('/').pop() ?? c.comm
      if (basename === 'claude') return true
      queue.push(c.pid)
    }
  }
  return false
}

/** Collect the pids of every descendant of `rootPid` (inclusive ranges
 *  excluded — the root itself is omitted). Used to mark which live claude
 *  processes are OWNED by a Duo terminal so the rest are "unattributed". */
function collectDescendantPids(
  byParent: Map<number, Array<{ pid: number; comm: string }>>,
  rootPid: number,
  into: Set<number>
): void {
  const queue = [rootPid]
  const visited = new Set<number>()
  while (queue.length > 0) {
    const cur = queue.shift()!
    if (visited.has(cur)) continue
    visited.add(cur)
    const children = byParent.get(cur)
    if (!children) continue
    for (const c of children) {
      into.add(c.pid)
      queue.push(c.pid)
    }
  }
}

export interface ProbeAllTabsResult {
  /** Per-root verdict: true when `claude` lives anywhere in that root pid's
   *  descendant tree. Keyed by the root pid passed in. */
  claudeByRoot: Map<number, boolean>
  /** Pids of every live `claude` process NOT inside any supplied root's
   *  descendant tree — a concurrently-running claude Duo's terminals don't
   *  host (e.g. a bare `claude` in the user's external Terminal.app). The
   *  Home join uses this to confirm-gate `--resume` against a session that
   *  fails all attribution legs but may still be live (§ 4.3 live-but-idle
   *  guard [V]). */
  unattributedClaudePids: number[]
}

/**
 * ONE async `ps -ax` parse → BFS descendant walk per root pid. Generalizes
 * the front-tab `hasClaudeDescendant` to many roots in a single spawn (the
 * Home snapshot would otherwise fire N ps calls). Best-effort — a ps
 * failure resolves to all-false verdicts + no unattributed pids.
 */
export function probeAllTabs(rootPids: number[]): Promise<ProbeAllTabsResult> {
  const empty: ProbeAllTabsResult = {
    claudeByRoot: new Map(rootPids.map((p) => [p, false])),
    unattributedClaudePids: []
  }
  return new Promise((resolve) => {
    const child = spawn('ps', ['-ax', '-o', 'pid,ppid,comm'], { stdio: ['ignore', 'pipe', 'ignore'] })
    let stdout = ''
    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.on('error', () => resolve(empty))
    child.on('close', () => {
      const byParent = parsePsByParent(stdout)

      // Per-root verdict + the union of all roots' descendant pids (so we
      // can subtract owned claude pids from the live-claude set below).
      const claudeByRoot = new Map<number, boolean>()
      const ownedPids = new Set<number>()
      for (const root of rootPids) {
        claudeByRoot.set(root, treeHasClaude(byParent, root))
        ownedPids.add(root)
        collectDescendantPids(byParent, root, ownedPids)
      }

      // Every live `claude` pid anywhere on the box, minus the ones owned by
      // a supplied root → the unattributed set.
      const unattributedClaudePids: number[] = []
      for (const children of byParent.values()) {
        for (const c of children) {
          const basename = c.comm.split('/').pop() ?? c.comm
          if (basename === 'claude' && !ownedPids.has(c.pid)) {
            unattributedClaudePids.push(c.pid)
          }
        }
      }

      resolve({ claudeByRoot, unattributedClaudePids })
    })
  })
}

/** One live `claude` process + the Duo terminal that owns it. */
export interface LiveClaudeProc {
  pid: number
  /** The Duo PTY shell pid whose descendant tree contains this claude, or
   *  null when the claude runs OUTSIDE any Duo terminal (external terminal,
   *  the desktop app). Drives the `duo` vs `external` open attribution. */
  ownerPtyPid: number | null
}

/**
 * Find EVERY live `claude` process on the box and attribute each to the Duo
 * PTY shell that owns it (claude is a descendant of that pid), if any. One
 * `ps -ax -o pid,ppid,comm` parse + an upward parent walk per claude pid.
 * `duoPtyPids` is the set of Duo terminal shell pids (PtyManager.listAllLive).
 *
 * This is the process-primary liveness signal for Home (ENH-212 round-2): a
 * running claude is ground truth that a session is live — covering Duo tabs,
 * external terminals, and the desktop app alike — so the open-pill / never-
 * fork guarantee no longer depends on the laggy persisted pointer. Never
 * throws — resolves to [] on `ps` failure.
 */
export function mapLiveClaudeOwners(duoPtyPids: number[]): Promise<LiveClaudeProc[]> {
  const duoSet = new Set(duoPtyPids)
  return new Promise((resolve) => {
    const child = spawn('ps', ['-ax', '-o', 'pid,ppid,comm'], { stdio: ['ignore', 'pipe', 'ignore'] })
    let stdout = ''
    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.on('error', () => resolve([]))
    child.on('close', () => {
      const byParent = parsePsByParent(stdout)
      // child → parent index for the upward walk.
      const parentOf = new Map<number, number>()
      for (const [ppid, kids] of byParent) for (const k of kids) parentOf.set(k.pid, ppid)
      // every live claude pid.
      const out: LiveClaudeProc[] = []
      for (const kids of byParent.values()) {
        for (const k of kids) {
          const basename = k.comm.split('/').pop() ?? k.comm
          if (basename !== 'claude') continue
          // walk up the ancestry; first Duo PTY pid hit owns this claude.
          let cur: number | undefined = k.pid
          const seen = new Set<number>()
          let owner: number | null = null
          while (cur != null && !seen.has(cur)) {
            seen.add(cur)
            if (duoSet.has(cur)) { owner = cur; break }
            cur = parentOf.get(cur)
          }
          out.push({ pid: k.pid, ownerPtyPid: owner })
        }
      }
      resolve(out)
    })
  })
}

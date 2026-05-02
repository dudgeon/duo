// Stage 27 — Duo event bus.
//
// In-memory pub/sub with a bounded ring buffer. Powers the `duo:event`
// canvas-action verb and `duo events --follow` streaming CLI: any time a
// canvas button (or, later, an editor / browser / main subsystem) wants
// to surface a structured event to the running Claude agent, it calls
// `bus.emit(...)`. Subscribers — the streaming socket case for the CLI,
// plus any future renderer-side hooks — receive a normalized DuoEvent.
//
// Why ring + cursor: a fresh `duo events --follow` invocation can ask
// for everything since a known cursor and avoid missing events that
// landed between `duo events` snapshot calls. The cursor format
// `<unix-ms>-<seq-within-ms>` is monotonic and orderable as strings
// (zero-padded ms component would be needed for true lexicographic
// order, but the parsed-integer comparison in compareCursor handles it
// without padding).
//
// Why bounded: the bus runs forever in main. A canvas button mashed by
// a user, or a runaway agent emitting events in a tight loop, must not
// blow main's heap. 200 events covers any reasonable replay window
// (~minutes of activity) without becoming a memory liability. Override
// via `DUO_EVENT_RING_SIZE` for tests / heavy-event-rate scenarios.
//
// Single-process, single-bus assumption: there is exactly one EventBus
// in main, shared by every subscriber. The renderer doesn't host its
// own bus — renderer emits round-trip through IPC.DUO_EVENT_EMIT and
// receive on a future IPC.DUO_EVENT_BROADCAST channel (Stage 27.5
// extension; not wired in v1 since `duo events --follow` is the only
// consumer for the lesson packs).

export type DuoEventSource = 'canvas' | 'editor' | 'cli' | 'main' | 'renderer'

export interface DuoEvent {
  /** Monotonic, sortable. Format: `<unix-ms>-<seq>` so two events at
   *  the same millisecond stay ordered. */
  cursor: string
  /** ISO 8601 wall-clock timestamp. */
  ts: string
  /** Where the event originated. */
  source: DuoEventSource
  /** Free-form event name; convention `<noun>-<verb>` e.g.
   *  `lesson-step-done`, `selection-changed`. */
  name: string
  /** Optional structured payload. */
  payload?: Record<string, unknown>
}

const DEFAULT_RING_SIZE = 200

function readRingSizeFromEnv(): number {
  const raw = process.env.DUO_EVENT_RING_SIZE
  if (!raw) return DEFAULT_RING_SIZE
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_RING_SIZE
  return parsed
}

/**
 * Compare two cursors. Returns >0 when `a` is more recent than `b`,
 * <0 when older, 0 when identical. Cursors of the form `<ms>-<seq>`
 * compare numerically across both components (avoiding string-order
 * ambiguity when ms widths differ).
 */
export function compareCursor(a: string, b: string): number {
  const [aMsRaw, aSeqRaw] = a.split('-')
  const [bMsRaw, bSeqRaw] = b.split('-')
  const aMs = Number.parseInt(aMsRaw, 10)
  const bMs = Number.parseInt(bMsRaw, 10)
  if (aMs !== bMs) return aMs - bMs
  const aSeq = Number.parseInt(aSeqRaw ?? '0', 10)
  const bSeq = Number.parseInt(bSeqRaw ?? '0', 10)
  return aSeq - bSeq
}

export class EventBus {
  private ring: DuoEvent[] = []
  private readonly maxSize: number
  private readonly subscribers = new Set<(event: DuoEvent) => void>()
  private lastMs = 0
  private seqWithinMs = 0

  constructor(maxSize: number = readRingSizeFromEnv()) {
    this.maxSize = Math.max(1, maxSize)
  }

  /**
   * Publish a new event. Mints `cursor` + `ts`, appends to the ring
   * (evicting the oldest when over capacity), then notifies every live
   * subscriber synchronously. Throwing subscribers are logged + skipped
   * — they never starve the others.
   */
  emit(input: Omit<DuoEvent, 'cursor' | 'ts'>): DuoEvent {
    const now = Date.now()
    if (now === this.lastMs) {
      this.seqWithinMs += 1
    } else {
      this.lastMs = now
      this.seqWithinMs = 0
    }
    const cursor = `${now}-${this.seqWithinMs}`
    const ts = new Date(now).toISOString()
    const event: DuoEvent = { cursor, ts, ...input }
    this.ring.push(event)
    if (this.ring.length > this.maxSize) this.ring.shift()
    for (const cb of this.subscribers) {
      try {
        cb(event)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[EventBus] subscriber threw:', err)
      }
    }
    return event
  }

  /**
   * Attach a live subscriber. Returns an unsubscribe function. When
   * `since` is provided, replays every event in the ring with cursor >
   * since (in chronological order) BEFORE attaching the live listener,
   * so a CLI client can resume from a known cursor and not miss events
   * that landed between its snapshot poll and the follow attach.
   */
  subscribe(
    cb: (event: DuoEvent) => void,
    opts?: { since?: string }
  ): () => void {
    if (opts?.since !== undefined) {
      for (const e of this.listSince(opts.since)) {
        try { cb(e) } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[EventBus] replay subscriber threw:', err)
        }
      }
    }
    this.subscribers.add(cb)
    return () => { this.subscribers.delete(cb) }
  }

  /**
   * Snapshot read. With no cursor, returns the entire ring (or the
   * tail when `limit` is supplied). With a cursor, returns events with
   * cursor strictly greater than `since`. `limit` truncates the head
   * (most recent N when no since; oldest N after since otherwise).
   */
  listSince(cursor?: string, limit?: number): DuoEvent[] {
    if (!cursor) {
      const slice = this.ring.slice()
      return limit !== undefined ? slice.slice(-limit) : slice
    }
    const idx = this.ring.findIndex(e => compareCursor(e.cursor, cursor) > 0)
    if (idx < 0) return []
    const slice = this.ring.slice(idx)
    return limit !== undefined ? slice.slice(0, limit) : slice
  }

  /** Subscriber count — useful for tests + smoke verification. */
  get subscriberCount(): number {
    return this.subscribers.size
  }
}

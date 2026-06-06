// Phase H (ENH-191 Cut 0) — write-serialization primitives.
//
// Why this exists: the shared on-disk JSON writers (pins, nav-pins,
// projects, session-state) each do an async read-modify-write —
// `const cur = await read()` then `await write(next)` — with two await
// points and no mutex. Two callers interleave at those await points: a
// `duo` CLI command over the socket + a renderer click over IPC (and,
// once ENH-191 lands, two windows). Both read the old value, both
// compute `next` from it, the second write clobbers the first — a lost
// update. Separately, a *fixed* shared temp path lets two in-flight
// atomic writes race the same `rename`.
//
// `createWriteQueue` serializes RMW ops so each runs to completion
// before the next starts. `uniqueTmpPath` gives every atomic write its
// own temp file so concurrent renames (e.g. two Duo processes) can
// never collide. Both are pure / node-only and unit-tested in
// isolation (write-queue.test.ts) with a lost-update negative control.

import { randomBytes } from 'node:crypto'

/**
 * Returns an `enqueue` function that runs each async op strictly after
 * the previous one has fully settled (resolved OR rejected), so a
 * read-modify-write executes atomically with respect to other ops on
 * the same queue. The caller still receives that op's own result or
 * rejection; a failing op never wedges the queue for later ops.
 *
 * One queue per resource (e.g. per service instance) — ops on
 * different queues run independently.
 */
export function createWriteQueue(): <T>(op: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve()
  return function enqueue<T>(op: () => Promise<T>): Promise<T> {
    // Run `op` once `tail` settles, regardless of HOW it settled
    // (op is passed as both the fulfilled and rejected handler).
    const run: Promise<T> = tail.then(op, op)
    // The next enqueue waits for THIS op to settle, but the chain must
    // never reject — swallow so one failing op can't wedge the queue.
    tail = run.then(swallow, swallow)
    return run
  }
}

function swallow(): void {
  /* keep the queue alive regardless of the prior op's outcome */
}

/**
 * A collision-proof temp path for an atomic write (`writeFile` to tmp,
 * then `rename` over the final path). Includes the pid + random bytes
 * so two writers — even in separate Duo processes — never target the
 * same temp file and race the rename.
 *
 * @param finalPath the destination file the tmp will be renamed onto
 * @param ext       trailing extension (default `duo.tmp`; session-state
 *                  uses `tmp` to match its historical suffix)
 */
export function uniqueTmpPath(finalPath: string, ext = 'duo.tmp'): string {
  return `${finalPath}.${process.pid}.${randomBytes(4).toString('hex')}.${ext}`
}

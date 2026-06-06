// Phase H (ENH-191 Cut 0) — write-serialization primitive tests.
//
// The load-bearing test is the lost-update pair: the SAME read-modify-
// write run through the queue keeps both updates, but run un-serialized
// loses one. The negative control proves the test actually exercises
// the race the queue fixes (a test with no failing-without-the-fix case
// proves nothing).

import { describe, it, expect } from 'vitest'
import { createWriteQueue, uniqueTmpPath } from './write-queue'

/** Yield to the macrotask queue — the interleave window where an
 *  un-serialized read-modify-write loses an update. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** Models a service toggle: read a shared value, await (yield), write
 *  value+1. Two concurrent runs that both read before either writes
 *  collapse to a single increment — the lost update. */
function makeRmw(store: { value: number }) {
  return async (): Promise<number> => {
    const cur = store.value
    await tick()
    store.value = cur + 1
    return store.value
  }
}

describe('createWriteQueue', () => {
  it('serializes read-modify-write so concurrent ops do NOT lose updates', async () => {
    const enqueue = createWriteQueue()
    const store = { value: 0 }
    const rmw = makeRmw(store)
    await Promise.all([enqueue(rmw), enqueue(rmw)])
    // Each op runs after the prior settles → 0→1→2.
    expect(store.value).toBe(2)
  })

  it('NEGATIVE CONTROL: the same RMW run UN-serialized loses an update', async () => {
    const store = { value: 0 }
    const rmw = makeRmw(store)
    // No queue: both read 0, both write 1 → one increment is lost.
    await Promise.all([rmw(), rmw()])
    expect(store.value).toBe(1)
  })

  it('preserves enqueue order under contention', async () => {
    const enqueue = createWriteQueue()
    const order: number[] = []
    await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        enqueue(async () => {
          await tick()
          order.push(n)
        })
      )
    )
    expect(order).toEqual([1, 2, 3, 4, 5])
  })

  it('a failing op does NOT wedge the queue (later ops still run)', async () => {
    const enqueue = createWriteQueue()
    const order: string[] = []
    const bad = enqueue(async () => {
      order.push('bad')
      throw new Error('boom')
    })
    await expect(bad).rejects.toThrow('boom')
    const good = await enqueue(async () => {
      order.push('good')
      return 42
    })
    expect(good).toBe(42)
    expect(order).toEqual(['bad', 'good'])
  })

  it('returns each op\'s own result / rejection to its caller', async () => {
    const enqueue = createWriteQueue()
    await expect(enqueue(async () => 'a')).resolves.toBe('a')
    await expect(
      enqueue(async () => {
        throw new Error('b')
      })
    ).rejects.toThrow('b')
  })
})

describe('uniqueTmpPath', () => {
  it('produces a distinct path per call (no fixed shared tmp)', () => {
    const a = uniqueTmpPath('/x/pins.json')
    const b = uniqueTmpPath('/x/pins.json')
    expect(a).not.toBe(b)
    expect(a.startsWith('/x/pins.json.')).toBe(true)
    expect(a.endsWith('.duo.tmp')).toBe(true)
  })

  it('honors a custom extension', () => {
    expect(uniqueTmpPath('/x/session-state.json', 'tmp').endsWith('.tmp')).toBe(true)
  })
})

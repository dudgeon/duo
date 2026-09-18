// BUG-271 — regression coverage for the '[[' / '@' popover lifecycle. The
// "persistent popover" bug has now come back three times (walk-1 v4,
// walk-2 v2/v3, BUG-271 — an orphaned "Searching vault…" box pinned to the
// window's top-left after a tab switch), so the state machine is pinned
// here rather than left to a smoke-checklist line.

import { describe, it, expect, vi } from 'vitest'
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion'
import { createSuggestionLifecycle, type MountedPopover } from './suggestionLifecycle'
import type { SuggestionPopoverProps } from '../primitives/SuggestionPopover'

interface Fake extends MountedPopover {
  props: SuggestionPopoverProps
  destroyed: boolean
}

function harness(onKeyDown: (e: KeyboardEvent) => boolean = () => false) {
  const mounted: Fake[] = []
  const lifecycle = createSuggestionLifecycle(
    () => false,
    (popoverProps) => {
      const fake: Fake = {
        props: popoverProps,
        destroyed: false,
        ref: { onKeyDown },
        updateProps(next) { fake.props = { ...fake.props, ...next } },
        destroy() { fake.destroyed = true }
      }
      mounted.push(fake)
      return fake
    }
  )
  return { mounted, lifecycle, r: lifecycle.render() }
}

const sProps = (query = '') =>
  ({ items: [], command: vi.fn(), clientRect: () => new DOMRectStub(), query } as unknown as SuggestionProps)
const key = (k: string) => ({ event: { key: k } } as unknown as SuggestionKeyDownProps)
class DOMRectStub { top = 10; left = 10; bottom = 30; right = 10; width = 0; height = 20 }
const flush = () => new Promise<void>((res) => queueMicrotask(res))
const live = (m: Fake[]) => m.filter((f) => !f.destroyed)

describe('suggestion lifecycle (BUG-271)', () => {
  it('suspend() hides then destroys the open popover', async () => {
    const { mounted, lifecycle, r } = harness()
    r.onStart(sProps())
    lifecycle.suspend()
    expect(mounted[0].props.visible).toBe(false)
    await flush()
    expect(live(mounted)).toHaveLength(0)
  })

  it('resumes a suspended session on the next update (user came back and typed)', async () => {
    const { mounted, lifecycle, r } = harness()
    r.onStart(sProps())
    lifecycle.suspend()
    await flush()
    r.onUpdate(sProps('f'))
    expect(live(mounted)).toHaveLength(1)
    expect(live(mounted)[0].props.visible).toBe(true)
    r.onUpdate(sProps('fo'))
    expect(mounted).toHaveLength(2) // resumed once, not per keystroke
  })

  it('a remount landing before the destroy microtask is not the one destroyed', async () => {
    const { mounted, lifecycle, r } = harness()
    r.onStart(sProps())
    lifecycle.suspend()
    r.onUpdate(sProps('f'))
    await flush()
    expect(mounted[0].destroyed).toBe(true)
    expect(mounted[1].destroyed).toBe(false)
  })

  it('suspend() is a no-op with nothing open, and never invents a popover', () => {
    const { mounted, lifecycle, r } = harness()
    lifecycle.suspend()
    r.onUpdate(sProps('x'))
    expect(mounted).toHaveLength(0)
  })

  it('Escape dismisses for the rest of the session — typing on does not remount', async () => {
    const { mounted, lifecycle, r } = harness()
    r.onStart(sProps())
    expect(r.onKeyDown(key('Escape'))).toBe(true)
    await flush()
    lifecycle.suspend() // a later tab-hide must not flip it to "resumable"
    r.onUpdate(sProps('f'))
    expect(live(mounted)).toHaveLength(0)
    expect(r.onKeyDown(key('Escape'))).toBe(false) // second Escape falls through
  })

  it('a pick (Enter) hides the popover and a later tab-hide does not resurrect it', () => {
    const { mounted, lifecycle, r } = harness(() => true)
    r.onStart(sProps())
    expect(r.onKeyDown(key('Enter'))).toBe(true)
    lifecycle.suspend()
    r.onUpdate(sProps('f'))
    expect(mounted).toHaveLength(1)
    expect(mounted[0].props.visible).toBe(false)
  })

  it('onExit -> onUpdate -> onStart (a moved+changed session) mounts exactly once', () => {
    const { mounted, r } = harness()
    r.onStart(sProps())
    r.onExit()
    r.onUpdate(sProps('a'))
    r.onStart(sProps('a'))
    expect(live(mounted)).toHaveLength(1)
  })

  it('onExit clears a suspension so a stale flag cannot remount into the next session', async () => {
    const { mounted, lifecycle, r } = harness()
    r.onStart(sProps())
    lifecycle.suspend()
    await flush()
    r.onExit()
    r.onUpdate(sProps('a'))
    expect(live(mounted)).toHaveLength(0)
  })
})

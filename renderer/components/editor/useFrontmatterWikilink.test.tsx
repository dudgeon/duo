// @vitest-environment jsdom
// BUG-271 / BUG-273 — the frontmatter raw-YAML suggester's two body-portaled
// overlays (the '[[' popover and the new-note type picker) both anchor on a
// rect SNAPSHOTTED at input time, so nothing about them notices the host tab
// going display:none. A non-mouse tab switch (an agent's 'duo edit', the
// quick switcher + Enter) used to leave them floating — and live — over the
// next tab. Pin: 'active' flipping false closes both.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { act, render, cleanup, fireEvent } from '@testing-library/react'
import { useRef, useState } from 'react'
import { useFrontmatterWikilink } from './useFrontmatterWikilink'

const realRect = Element.prototype.getBoundingClientRect
const realDOMRect = globalThis.DOMRect

beforeEach(() => {
  // jsdom has no layout; give the caret-rect mirror a laid-out answer so the
  // popover's anchor guard (BUG-271) lets it render.
  Element.prototype.getBoundingClientRect = function () {
    const v = { x: 100, y: 200, width: 12, height: 18 }
    return { ...v, top: v.y, left: v.x, right: v.x + v.width, bottom: v.y + v.height, toJSON: () => v } as DOMRect
  }
  ;(window as unknown as { electron: unknown }).electron = {
    vault: { types: vi.fn(async () => ({ ok: true, types: ['person'] })), stub: vi.fn(), createType: vi.fn() }
  }
})
afterEach(() => {
  Element.prototype.getBoundingClientRect = realRect
  globalThis.DOMRect = realDOMRect
  delete (window as unknown as { electron?: unknown }).electron
  cleanup()
})

function Host({ active }: { active: boolean }) {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  const [value, setValue] = useState('title: x\n')
  const fm = useFrontmatterWikilink({
    textareaRef: ref,
    setValue,
    vaultFiles: [],
    vaultLoading: false,
    vaultRoot: '/vault',
    active
  })
  return (
    <>
      <textarea
        ref={ref}
        data-testid="ta"
        value={value}
        onChange={(e) => { setValue(e.target.value); fm.onInput() }}
        onKeyDown={(e) => { fm.onKeyDown(e) }}
      />
      <output data-testid="open">{String(fm.isOpen)}</output>
      {fm.overlay}
    </>
  )
}

const boxes = () => [...document.body.querySelectorAll('.duo-suggestion-popover')].map((e) => e.textContent ?? '')
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

async function typeTrigger(view: ReturnType<typeof render>) {
  const ta = view.getByTestId('ta') as HTMLTextAreaElement
  const next = 'title: x\nrelated: [[Zedwalk'
  await act(async () => {
    fireEvent.change(ta, { target: { value: next } })
    ta.setSelectionRange(next.length, next.length)
  })
  // onInput read the caret before setSelectionRange landed; re-run it the way
  // the next real keystroke would.
  await act(async () => { fireEvent.change(ta, { target: { value: next + 'x' } }) })
  await settle()
  return ta
}

describe('useFrontmatterWikilink — tab hide (BUG-271 / BUG-273)', () => {
  it("closes the '[[' popover when the tab goes inactive", async () => {
    const view = render(<Host active />)
    await typeTrigger(view)
    expect(boxes().some((t) => t.includes('New:'))).toBe(true)

    view.rerender(<Host active={false} />)
    await settle()
    expect(boxes()).toHaveLength(0)
    expect(view.getByTestId('open').textContent).toBe('false')
  })

  it('closes the new-note TYPE PICKER when the tab goes inactive, and does not reopen on return', async () => {
    const view = render(<Host active />)
    const ta = await typeTrigger(view)
    await act(async () => { fireEvent.keyDown(ta, { key: 'Enter' }) }) // pick the New: row
    await settle()
    expect(boxes().some((t) => t.includes('pick a type'))).toBe(true)

    view.rerender(<Host active={false} />)
    await settle()
    expect(boxes()).toHaveLength(0)

    view.rerender(<Host active />)
    await settle()
    expect(boxes()).toHaveLength(0)
    // The placeholder the pick inserted stays — same outcome as a click-outside cancel.
    expect(ta.value).toContain('[[Zedwalkx]]')
  })
})

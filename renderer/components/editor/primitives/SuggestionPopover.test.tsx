// @vitest-environment jsdom
// BUG-271 — the popover portals to document.body, so it escapes a
// display:none ancestor. An editor hidden mid-'[[' measures its anchor as
// an all-zero rect, which positionStyle clamps to the window's top-left —
// the orphaned "Searching vault…" box the owner screenshotted. Pin the
// guard: no laid-out anchor, no popover.

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { SuggestionPopover, isAnchorLaidOut } from './SuggestionPopover'

const rect = (x: number, y: number, w: number, h: number) =>
  ({ x, y, width: w, height: h, top: y, left: x, right: x + w, bottom: y + h, toJSON: () => ({}) }) as DOMRect

afterEach(cleanup)

describe('SuggestionPopover anchor guard (BUG-271)', () => {
  it('renders nothing when the anchor is not laid out (hidden editor => zero rect)', () => {
    render(<SuggestionPopover items={[]} command={() => {}} clientRect={() => rect(0, 0, 0, 0)} loading />)
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(document.body.textContent).not.toContain('Searching vault')
  })

  it('renders at the caret for a laid-out anchor', () => {
    render(<SuggestionPopover items={[]} command={() => {}} clientRect={() => rect(120, 300, 14, 18)} loading />)
    const box = screen.getByRole('listbox')
    expect(box.textContent).toContain('Searching vault')
    expect(box.style.left).toBe('120px')
    expect(box.style.top).toBe('322px')
  })

  it('treats a collapsed caret (zero width, real line height) as laid out', () => {
    expect(isAnchorLaidOut(rect(40, 40, 0, 18))).toBe(true)
    expect(isAnchorLaidOut(rect(0, 0, 0, 0))).toBe(false)
  })
})

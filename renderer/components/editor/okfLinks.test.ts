// ENH-216 OKF Vault Mode (U7) — coverage for the renderer-side link seam.
// Pins okfLinkInsert (D3 expand-on-resolve: the BODY gesture writes a
// standard markdown relative link, link text = the supplied display/slug
// per D6). FOLLOWUP-051 removed the frontmatter commit-rewrite — a
// frontmatter `[[ ]]` now persists AS `[[ ]]` (a bare rel-path isn't a graph
// edge in Duo or Obsidian), so there's no frontmatter serializer to cover.

import { describe, it, expect } from 'vitest'
import { okfLinkInsert } from './okfLinks'

describe('okfLinkInsert (D3 / D6)', () => {
  it('writes a standard markdown relative link with the supplied display text', () => {
    // Existing-note pick: link text = the on-disk slug (D6).
    expect(
      okfLinkInsert('customer-orders', 'people/alice.md', 'sales/customer-orders.md'),
    ).toBe('[customer-orders](../sales/customer-orders.md)')
  })

  it('uses the HUMAN name as link text for a freshly-created stub (D6)', () => {
    expect(
      okfLinkInsert('Customer Orders', 'people/alice.md', 'sales/customer-orders.md'),
    ).toBe('[Customer Orders](../sales/customer-orders.md)')
  })

  it('./-anchors a same-directory target', () => {
    expect(okfLinkInsert('Bob', 'people/alice.md', 'people/bob.md')).toBe(
      '[Bob](./bob.md)',
    )
  })

  it('computes the same rel link from absolute paths sharing the vault root', () => {
    // The editor hands ABSOLUTE paths (docPath + item.absPath); relLink only
    // cares about the relationship, so the abs form matches its rel twin.
    expect(
      okfLinkInsert(
        'customer-orders',
        '/vault/people/alice.md',
        '/vault/sales/customer-orders.md',
      ),
    ).toBe('[customer-orders](../sales/customer-orders.md)')
  })
})

// ENH-216 OKF Vault Mode (U7) — coverage for the renderer-side link seam.
// Pins okfLinkInsert (D3 expand-on-resolve: the BODY gesture writes a
// standard markdown relative link, link text = the supplied display/slug
// per D6). ENH-266 (2026-07-09) reverses FOLLOWUP-051: OKF frontmatter
// values are now QUOTED markdown links (okfFrontmatterLinkInsert below),
// not `[[ ]]` wikilinks — see okfLinks.ts's ENH-266 header comment for the
// live-Obsidian-validated rationale.

import { describe, it, expect } from 'vitest'
import { okfLinkInsert, okfFrontmatterLinkInsert } from './okfLinks'

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

describe('okfFrontmatterLinkInsert (ENH-266)', () => {
  it('writes a QUOTED markdown relative link (YAML-safe frontmatter value)', () => {
    expect(
      okfFrontmatterLinkInsert('Alice Park', 'initiatives/q3-launch.md', 'people/alice-park.md'),
    ).toBe('"[Alice Park](../people/alice-park.md)"')
  })

  it('./-anchors a same-directory target, still quoted', () => {
    expect(okfFrontmatterLinkInsert('Bob', 'people/alice.md', 'people/bob.md')).toBe(
      '"[Bob](./bob.md)"',
    )
  })

  it('escapes an embedded double-quote in the display text', () => {
    expect(
      okfFrontmatterLinkInsert('The "Growth" Initiative', 'people/alice.md', 'initiatives/growth.md'),
    ).toBe('"[The \\"Growth\\" Initiative](../initiatives/growth.md)"')
  })
})

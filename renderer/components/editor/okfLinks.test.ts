// ENH-216 OKF Vault Mode (U7) — coverage for the renderer-side link seam.
// Pins okfLinkInsert (D3 expand-on-resolve: the gesture writes a standard
// markdown relative link, link text = the supplied display/slug per D6)
// and rewriteFrontmatterWikilinks (D7: [[Name]] inside a frontmatter value
// becomes a quoted relative-path string on commit; unresolved names + the
// alias form + the no-op fast path all covered).

import { describe, it, expect } from 'vitest'
import { okfLinkInsert, rewriteFrontmatterWikilinks } from './okfLinks'

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

describe('rewriteFrontmatterWikilinks (D7)', () => {
  it('rewrites [[Name]] inside a value to a quoted relative-path string', async () => {
    const fm = 'owner: [[Alice]]\nstatus: open'
    const resolve = (name: string) =>
      name === 'Alice' ? 'people/alice.md' : null
    const { text, rewritten } = await rewriteFrontmatterWikilinks(
      fm,
      'projects/launch.md',
      resolve,
    )
    expect(rewritten).toBe(1)
    expect(text).toBe('owner: "../people/alice.md"\nstatus: open')
  })

  it('uses the alias-stripped target name for resolution', async () => {
    const fm = 'lead: [[Alice|Alice Smith]]'
    const seen: string[] = []
    const resolve = (name: string) => {
      seen.push(name)
      return 'people/alice.md'
    }
    const { text } = await rewriteFrontmatterWikilinks(fm, 'projects/launch.md', resolve)
    expect(seen).toEqual(['Alice'])
    expect(text).toBe('lead: "../people/alice.md"')
  })

  it('leaves an unresolved [[Name]] verbatim', async () => {
    const fm = 'owner: [[Ghost]]'
    const { text, rewritten } = await rewriteFrontmatterWikilinks(
      fm,
      'projects/launch.md',
      () => null,
    )
    expect(rewritten).toBe(0)
    expect(text).toBe('owner: [[Ghost]]')
  })

  it('rewrites multiple distinct links and resolves each name once', async () => {
    const fm = 'owner: [[Alice]]\nreviewer: [[Bob]]\nbackup: [[Alice]]'
    const calls: string[] = []
    const resolve = (name: string) => {
      calls.push(name)
      return name === 'Alice' ? 'people/alice.md' : 'people/bob.md'
    }
    const { text, rewritten } = await rewriteFrontmatterWikilinks(
      fm,
      'index.md',
      resolve,
    )
    expect(rewritten).toBe(3)
    // Each unique name resolved once (cache), even though Alice appears twice.
    expect(calls.sort()).toEqual(['Alice', 'Bob'])
    expect(text).toBe(
      'owner: "./people/alice.md"\nreviewer: "./people/bob.md"\nbackup: "./people/alice.md"',
    )
  })

  it('is a no-op (no resolve calls) when the text has no wikilink gesture', async () => {
    const fm = 'owner: "./people/alice.md"\nstatus: open'
    let called = false
    const resolve = () => {
      called = true
      return 'x'
    }
    const { text, rewritten } = await rewriteFrontmatterWikilinks(fm, 'index.md', resolve)
    expect(called).toBe(false)
    expect(rewritten).toBe(0)
    expect(text).toBe(fm)
  })

  it('supports a synchronous resolver', async () => {
    const fm = 'owner: [[Alice]]'
    const { text } = await rewriteFrontmatterWikilinks(
      fm,
      'index.md',
      (name) => (name === 'Alice' ? 'people/alice.md' : null),
    )
    expect(text).toBe('owner: "./people/alice.md"')
  })
})

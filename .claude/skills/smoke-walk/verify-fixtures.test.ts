// Unit tests for the smoke-walk fixture guard's parsing. The live `duo`
// calls in verify-fixtures.mjs aren't unit-tested (they need the running
// app), but the extraction — which is what lets the guard SEE a fixture it
// must check — is. A regression here would let a bad fixture slip past
// unverified, which is the exact failure this guard exists to prevent.

import { describe, it, expect } from 'vitest'
import { extractFixtures, extractBareWarnings, manifestHaystacks } from './verify-fixtures.mjs'

describe('smoke-walk fixture guard — extraction', () => {
  it('pulls backtick-wrapped `duo open|edit <target>` from steps + intro', () => {
    const manifest = {
      intro: 'Open it first: `duo open https://github.com/octocat/Spoon-Knife/blob/main/README.md`',
      items: [
        {
          what_fixes: 'see `duo edit ~/.claude/duo/checkouts/x@main/index.html`',
          steps: [
            'Run `duo open https://github.com/octocat/Spoon-Knife/blob/main/.github/FUNDING.yml`',
            'Then confirm the footer.',
          ],
        },
      ],
    }
    const fixtures = extractFixtures(manifest)
    expect(fixtures).toEqual([
      { verb: 'open', target: 'https://github.com/octocat/Spoon-Knife/blob/main/README.md' },
      { verb: 'edit', target: '~/.claude/duo/checkouts/x@main/index.html' },
      { verb: 'open', target: 'https://github.com/octocat/Spoon-Knife/blob/main/.github/FUNDING.yml' },
    ])
  })

  it('distinguishes open vs edit (the footer-verb crux)', () => {
    const manifest = {
      items: [{ steps: ['`duo edit /a/page.html`', '`duo open /a/page.html`'] }],
    }
    const fixtures = extractFixtures(manifest)
    expect(fixtures.map((f) => f.verb)).toEqual(['edit', 'open'])
    expect(new Set(fixtures.map((f) => f.target))).toEqual(new Set(['/a/page.html']))
  })

  it('dedupes identical verb+target pairs', () => {
    const manifest = {
      items: [
        { steps: ['`duo edit /x/README.md`'] },
        { steps: ['`duo edit /x/README.md`', '`duo edit /x/README.md`'] },
      ],
    }
    expect(extractFixtures(manifest)).toEqual([{ verb: 'edit', target: '/x/README.md' }])
  })

  it('finds nothing when there are no duo open|edit commands', () => {
    const manifest = { intro: 'Press ⌘O and pick a recent.', items: [{ steps: ['Click Browse…'] }] }
    expect(extractFixtures(manifest)).toEqual([])
  })

  it('flags an un-backticked duo open|edit so it cannot slip past unverified', () => {
    const manifest = {
      items: [{ steps: ['Run duo open /tmp/forgot-the-backticks.md and confirm.'] }],
    }
    const warnings = extractBareWarnings(manifest)
    expect(warnings.length).toBe(1)
    expect(warnings[0]).toContain('duo open /tmp/forgot-the-backticks.md')
    // ...and the fenced extractor (correctly) does NOT pick it up.
    expect(extractFixtures(manifest)).toEqual([])
  })

  it('does NOT bare-warn on properly backticked commands', () => {
    const manifest = { items: [{ steps: ['Run `duo edit /tmp/ok.md`.'] }] }
    expect(extractBareWarnings(manifest)).toEqual([])
  })

  it('gathers haystacks from intro, intro_html, what_fixes, and steps', () => {
    const manifest = {
      intro: 'A',
      intro_html: 'B',
      items: [{ what_fixes: 'C', steps: ['D', 'E'] }],
    }
    expect(manifestHaystacks(manifest)).toEqual(['A', 'B', 'C', 'D', 'E'])
  })
})

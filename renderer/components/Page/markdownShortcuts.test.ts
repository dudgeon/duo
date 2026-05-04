// Unit tests for the block-trigger matcher in markdownShortcuts.ts.
//
// Why this test file exists (BUG-061 history):
// - v1 (commit `1b3b132`, 2026-05-02): strict equality on the block
//   text. Failed when caret block resolved to <body> with sibling
//   content (textContent concatenates descendants).
// - v2 (commit `4baba8b`, 2026-05-02): switched heading match to
//   start-match regex; bullet/ordered/blockquote stayed strict by
//   oversight. Owner walk-3 reported PASS on heading, FAIL on
//   bullet/ordered/blockquote.
// - v3 (commit `56e986b`, 2026-05-03): all four triggers now use
//   `\s` to match both U+0020 (literal space) AND U+00A0 (the nbsp
//   Chromium auto-converts trailing literal spaces to in
//   contentEditable). Live DOM inspection during the smoke walk
//   confirmed `<h1>-&nbsp;</h1>` was the actual rendered shape.
//
// Recurring-regression class — owner memory feedback explicitly
// flagged this kind of fix as needing durable test coverage. These
// tests lock the v3 shape in so a v4 iteration will catch regressions
// at unit-test time, not at smoke-walk time.

import { describe, it, expect } from 'vitest'
import { matchBlockTrigger, matchEnterTrigger } from './markdownShortcuts'

const NBSP = ' '  // U+00A0 — what Chromium converts trailing literal spaces to
const SPACE = ' '       // U+0020 — what the user actually types

describe('matchBlockTrigger', () => {
  describe('heading triggers (`#`…`######` followed by a space)', () => {
    for (const level of [1, 2, 3, 4, 5, 6] as const) {
      it(`matches level ${level} with literal space (U+0020)`, () => {
        const hashes = '#'.repeat(level)
        expect(matchBlockTrigger(`${hashes}${SPACE}`)).toEqual({ kind: 'heading', level })
      })
      it(`matches level ${level} with nbsp (U+00A0) — BUG-061 v3`, () => {
        const hashes = '#'.repeat(level)
        expect(matchBlockTrigger(`${hashes}${NBSP}`)).toEqual({ kind: 'heading', level })
      })
    }

    it('does NOT match `#######` (7 hashes) — only 1-6 are valid heading levels', () => {
      expect(matchBlockTrigger(`#######${SPACE}`)).toBeNull()
    })

    it('does NOT match `# ` followed by other content (start-match needs the space at end-of-block)', () => {
      // Trigger fires only when caret has typed the prefix and the
      // space — not after typing more characters. The handler runs
      // on every input event; this restricts the conversion to the
      // exact moment the trigger character lands.
      expect(matchBlockTrigger(`#${SPACE}H`)).toBeNull()
    })
  })

  describe('unordered list triggers (`-`, `*`, `+` followed by a space)', () => {
    // BUG-073 — the marker character now rides on the trigger so the
    // converter can stamp `data-list-marker` for marker-aware list-
    // style rendering (`-` → dash, `+` → plus, `*` → default disc).
    // Pre-BUG-073 the trigger was just `{ kind: 'ul' }`; the regex
    // matched `[-*+]` but discarded which character fired. These
    // tests lock the new shape so a future regression to character-
    // discarding behavior is caught at unit-test time.
    const cases: Array<[string, 'dash' | 'asterisk' | 'plus']> = [
      ['-', 'dash'],
      ['*', 'asterisk'],
      ['+', 'plus']
    ]
    for (const [marker, expected] of cases) {
      it(`matches \`${marker} \` with literal space → marker=${expected}`, () => {
        expect(matchBlockTrigger(`${marker}${SPACE}`)).toEqual({ kind: 'ul', marker: expected })
      })
      it(`matches \`${marker} \` with nbsp — BUG-061 v3 → marker=${expected}`, () => {
        expect(matchBlockTrigger(`${marker}${NBSP}`)).toEqual({ kind: 'ul', marker: expected })
      })
    }

    it('does NOT match `-` alone (no trailing space)', () => {
      expect(matchBlockTrigger('-')).toBeNull()
    })

    it('does NOT match `--` (double dash)', () => {
      expect(matchBlockTrigger(`--${SPACE}`)).toBeNull()
    })
  })

  describe('ordered list trigger (`1.` followed by a space)', () => {
    it('matches `1. ` with literal space', () => {
      expect(matchBlockTrigger(`1.${SPACE}`)).toEqual({ kind: 'ol' })
    })

    it('matches `1. ` with nbsp — BUG-061 v3', () => {
      expect(matchBlockTrigger(`1.${NBSP}`)).toEqual({ kind: 'ol' })
    })

    it('does NOT match `2. ` (only `1.` is the ordered-list trigger)', () => {
      // Markdown editors typically only fire the conversion on `1.`
      // because that signals "start a numbered list"; `2. ` is just
      // a typed character. Same in canvas.
      expect(matchBlockTrigger(`2.${SPACE}`)).toBeNull()
    })

    it('does NOT match `1.` without a trailing space', () => {
      expect(matchBlockTrigger('1.')).toBeNull()
    })
  })

  describe('blockquote trigger (`>` followed by a space)', () => {
    it('matches `> ` with literal space', () => {
      expect(matchBlockTrigger(`>${SPACE}`)).toEqual({ kind: 'blockquote' })
    })

    it('matches `> ` with nbsp — BUG-061 v3', () => {
      expect(matchBlockTrigger(`>${NBSP}`)).toEqual({ kind: 'blockquote' })
    })

    it('does NOT match `>` alone', () => {
      expect(matchBlockTrigger('>')).toBeNull()
    })

    it('does NOT match `>>` (double angle bracket)', () => {
      expect(matchBlockTrigger(`>>${SPACE}`)).toBeNull()
    })
  })

  describe('non-trigger inputs return null', () => {
    it('empty string', () => {
      expect(matchBlockTrigger('')).toBeNull()
    })

    it('plain text', () => {
      expect(matchBlockTrigger('hello world')).toBeNull()
    })

    it('text that looks like a trigger but has prefix content', () => {
      // The regex anchors with `^`. A canvas <body> with prior
      // siblings concatenates into textContent; if the trigger
      // doesn't sit at the START, no match.
      expect(matchBlockTrigger(`some prefix\n#${SPACE}`)).toBeNull()
    })
  })
})

describe('matchEnterTrigger', () => {
  describe('horizontal-rule trigger', () => {
    it('matches `---` exactly → hr', () => {
      expect(matchEnterTrigger('---')).toEqual({ kind: 'hr' })
    })

    it('matches `***` exactly → hr', () => {
      expect(matchEnterTrigger('***')).toEqual({ kind: 'hr' })
    })

    it('does NOT match `--` (only two dashes)', () => {
      expect(matchEnterTrigger('--')).toBeNull()
    })

    it('does NOT match `----` (more than three dashes)', () => {
      // Strict equality match: only `---` exactly. Four-dashes don't
      // become hr; the user typed something else.
      expect(matchEnterTrigger('----')).toBeNull()
    })

    it('does NOT match `--- ` with trailing space (caller pre-trims, so trim removes it; raw with space here would also miss)', () => {
      // Document the strict-equality contract — no fuzzy whitespace.
      // The handler trims before calling, so trailing whitespace is
      // already gone by the time matchEnterTrigger runs.
      expect(matchEnterTrigger('--- ')).toBeNull()
    })
  })

  describe('code-block trigger', () => {
    it('matches bare ``` → code with lang=null', () => {
      expect(matchEnterTrigger('```')).toEqual({ kind: 'code', lang: null })
    })

    it('matches ```ts → code with lang=ts', () => {
      expect(matchEnterTrigger('```ts')).toEqual({ kind: 'code', lang: 'ts' })
    })

    it('matches ```javascript → code with lang=javascript', () => {
      expect(matchEnterTrigger('```javascript')).toEqual({ kind: 'code', lang: 'javascript' })
    })

    it('matches ```python → code with lang=python', () => {
      expect(matchEnterTrigger('```python')).toEqual({ kind: 'code', lang: 'python' })
    })

    it('does NOT match ``` (only two backticks)', () => {
      expect(matchEnterTrigger('``')).toBeNull()
    })

    it('does NOT match ```` (four backticks — raw text past the fence regex)', () => {
      // The regex is `^```(\w*)$`. Four backticks would parse as
      // ``` followed by ` (a non-word char), which `\w*` rejects.
      expect(matchEnterTrigger('````')).toBeNull()
    })

    it('does NOT match ```ts more (text after the language)', () => {
      // Caller pre-trims, but trim only removes leading/trailing
      // whitespace. An interior space-then-word breaks the strict
      // `^```(\w*)$` shape.
      expect(matchEnterTrigger('```ts more')).toBeNull()
    })
  })

  describe('non-trigger inputs return null', () => {
    it('empty string', () => {
      expect(matchEnterTrigger('')).toBeNull()
    })

    it('plain prose', () => {
      expect(matchEnterTrigger('Some normal text the user typed')).toBeNull()
    })

    it('block triggers (those fire on space, not Enter)', () => {
      // Important boundary: `# heading` should NOT fire as an Enter
      // trigger — that's matchBlockTrigger's territory and fires on
      // the trailing space typed BEFORE Enter.
      expect(matchEnterTrigger('# ')).toBeNull()
      expect(matchEnterTrigger('- ')).toBeNull()
      expect(matchEnterTrigger('> ')).toBeNull()
    })
  })
})

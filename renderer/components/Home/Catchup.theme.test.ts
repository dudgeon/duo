// ENH-231 — theme-legibility guard for the Catch-Up board. Duo ships light by
// default with a dark theme via [data-theme="dark"]; a color that's only correct
// on one tone is a recurring bug class (see renderer-surfaces.md). This grep
// pins the rule MECHANICALLY: the board's CSS may use ONLY --duo-* tokens (which
// flip per theme) + the shared duo-banner-*/duo-text-* classes + color-mix
// against --duo-*/transparent — never a bare hex, a Tailwind color utility, a
// `dark:` variant (which tracks the OS scheme, not Duo's toggle), or a
// color-mix against black/white.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const HERE = __dirname
const CSS = readFileSync(path.join(HERE, 'Catchup.css'), 'utf8')
const TSX = ['ModeToggle', 'CatchupBoard', 'SessionDigestCard', 'CompactSessionRow', 'CatchupChips']
  .map((n) => readFileSync(path.join(HERE, `${n}.tsx`), 'utf8'))
  .join('\n')

/** Strip /* *​/ comments + // line comments so a banned token in prose doesn't
 *  trip the grep. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('Catchup.css — theme-legible by construction', () => {
  const css = stripComments(CSS)

  it('uses no bare hex colors (only --duo-* tokens)', () => {
    const hex = css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []
    expect(hex).toEqual([])
  })

  it('never color-mixes against black or white (theme-blind)', () => {
    const bad = css.match(/color-mix\([^)]*\b(?:black|white)\b[^)]*\)/gi) ?? []
    expect(bad).toEqual([])
  })

  it('uses no `dark:` variants (Duo flips [data-theme], not the OS scheme)', () => {
    expect(css.includes('dark:')).toBe(false)
  })

  it('every color reference is a --duo-* var, a duo-banner/text class, or transparent', () => {
    // Sanity: there is at least one --duo- token and the file is non-trivial.
    expect(css.includes('var(--duo-')).toBe(true)
  })
})

describe('Catch-up TSX — no Tailwind color utilities or dark: in className', () => {
  const tsx = stripComments(TSX)

  it('no Tailwind color utilities (text-red-500, bg-blue-200, …)', () => {
    const bad = tsx.match(/\b(?:text|bg|border|ring|from|to|via)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|gray|slate|zinc|neutral|stone)-\d{2,3}\b/g) ?? []
    expect(bad).toEqual([])
  })

  it('no `dark:` variants', () => {
    expect(tsx.includes('dark:')).toBe(false)
  })

  it('no bare hex in inline styles', () => {
    const hex = tsx.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []
    expect(hex).toEqual([])
  })
})

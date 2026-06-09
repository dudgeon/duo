// ENH-207 — pin the drag-to-terminal payload format. These invariants are
// load-bearing for two safety properties from the PRD:
//   - NO trailing newline (so a drop never auto-runs a shell command or
//     submits a half-formed Claude prompt), and
//   - control-char stripping (a newline in a POSIX path must not split the
//     payload across lines).
// A regression here is a security/UX hazard, not cosmetic.

import { describe, it, expect } from 'vitest'
import { DUO_FS_PATH_MIME, formatPathsForTerminal } from './dragPathPayload'

describe('formatPathsForTerminal', () => {
  it('emits a clean absolute path raw, with one trailing space and no newline', () => {
    const out = formatPathsForTerminal(['/Users/geoff/repo/file.ts'])
    expect(out).toBe('/Users/geoff/repo/file.ts ')
    expect(out.endsWith('\n')).toBe(false)
  })

  it('single-quotes a path containing a space', () => {
    expect(formatPathsForTerminal(['/Users/geoff/Application Support/x.json']))
      .toBe("'/Users/geoff/Application Support/x.json' ")
  })

  it('quotes shell metacharacters that would otherwise be interpreted', () => {
    // $ ( ) etc. are unsafe → whole token quoted.
    expect(formatPathsForTerminal(['/tmp/$(rm -rf )/a.txt']))
      .toBe("'/tmp/$(rm -rf )/a.txt' ")
  })

  it('escapes an embedded single-quote with the \'\\\'\' idiom', () => {
    expect(formatPathsForTerminal(["/tmp/it's here.txt"]))
      .toBe("'/tmp/it'\\''s here.txt' ")
  })

  it('space-joins multiple paths in the order given, each quoted as needed', () => {
    expect(formatPathsForTerminal(['/a/b.ts', '/c d/e.ts']))
      .toBe("/a/b.ts '/c d/e.ts' ")
  })

  it('strips embedded newlines / control chars (POSIX paths can contain them)', () => {
    // A newline mid-path must not survive — it would split the payload and
    // could submit a half-formed prompt to a Claude TUI.
    const out = formatPathsForTerminal(['/tmp/ev\nil.txt'])
    expect(out).toBe('/tmp/evil.txt ')
    expect(out.includes('\n')).toBe(false)
  })

  it('strips CR, TAB, and the Unicode line/paragraph separators', () => {
    expect(formatPathsForTerminal(['/a\r\tb  c.ts'])).toBe('/abc.ts ')
  })

  it('returns empty string when nothing usable survives (caller no-ops the drop)', () => {
    expect(formatPathsForTerminal(['\n\n'])).toBe('')
    expect(formatPathsForTerminal([])).toBe('')
  })

  it('drops empty tokens from a multi-selection rather than emitting a bare gap', () => {
    expect(formatPathsForTerminal(['/a.ts', '\n', '/b.ts'])).toBe('/a.ts /b.ts ')
  })

  it('exposes the duo-namespaced dataTransfer MIME', () => {
    expect(DUO_FS_PATH_MIME).toBe('application/x-duo-fs-path')
  })
})

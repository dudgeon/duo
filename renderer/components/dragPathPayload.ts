// ENH-204 — format navigator file/folder paths for insertion into the active
// terminal on drag-drop. The drag SOURCE (FileTree) assembles this payload at
// drag-start; the drop TARGET (App.tsx terminal column) writes it verbatim to
// the active PTY via window.electron.pty.write.
//
// Decisions (PRD docs/prd/enh-204-navigator-drag-path-to-terminal.md):
//   - Sanitize each path first — drop C0 control chars (includes CR/LF/TAB)
//     plus the Unicode line/paragraph separators (U+2028/U+2029). POSIX
//     filenames CAN legally contain newlines; an unstripped one would split
//     the payload across lines and, in a Claude TUI, submit a half-formed
//     prompt. Same threat editor/sendFormat.ts guards (it replaces with
//     spaces for readable provenance; here the token must stay a usable shell
//     argument, so we drop the chars instead).
//   - Quote-if-needed — POSIX single-quote a token only when it contains a
//     space or shell metacharacter (shlex.quote's safe set), so clean absolute
//     paths stay raw and readable. Embedded single-quotes use the '\'' idiom.
//   - Space-join in tree order (caller supplies the order) + ONE trailing
//     space, NO trailing newline — so a drop never auto-runs a shell command
//     or auto-submits to Claude (matches the `duo send` no-Enter default).

/** dataTransfer MIME stamped on a drag that originated in the Duo navigator.
 *  The terminal drop handler keys on this to tell a navigator drag apart from
 *  a foreign OS/text drag — mirroring the `application/x-duo-*` convention the
 *  tab-reorder DnD already uses (WorkingTabStrip / TabBar). */
export const DUO_FS_PATH_MIME = 'application/x-duo-fs-path'

/** Strip control characters that would break a single-line shell token: C0
 *  controls (code point < 0x20, includes CR/LF/TAB) plus the Unicode
 *  line/paragraph separators U+2028/U+2029. Done with a numeric code-point
 *  scan rather than a control-char regex range so no raw control byte ever
 *  appears in this source file. */
function sanitizePathToken(s: string): string {
  let out = ''
  for (const ch of s) {
    const c = ch.codePointAt(0)
    if (c === undefined) continue
    if (c < 0x20 || c === 0x2028 || c === 0x2029) continue
    out += ch
  }
  return out
}

/** POSIX single-quote a token iff it contains a space or shell metacharacter;
 *  otherwise return it raw. Safe set mirrors Python's shlex.quote
 *  (`\w` plus `@%+=:,./-`). Embedded single-quotes are escaped via '\''. */
function shellQuoteIfNeeded(s: string): string {
  if (s.length === 0) return "''"
  if (/^[\w@%+=:,./-]+$/.test(s)) return s
  return "'" + s.replace(/'/g, "'\\''") + "'"
}

/** Assemble the terminal payload for one or more dropped paths. Returns '' if
 *  nothing usable survives sanitization (caller should then no-op the drop). */
export function formatPathsForTerminal(paths: string[]): string {
  const tokens = paths
    .map(sanitizePathToken)
    .filter((p) => p.length > 0)
    .map(shellQuoteIfNeeded)
  if (tokens.length === 0) return ''
  return tokens.join(' ') + ' '
}

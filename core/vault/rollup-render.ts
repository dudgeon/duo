// ENH-250 — a deterministic (no-Claude-required) render+stamp for ONE
// rollup note, factored out of `duo rollup render`'s default path so the
// GUI can trigger the exact same write without shelling out to the CLI.
//
// Two call sites:
//   - the Rollups tab's builder: after every live-save, so a GUI-created/
//     -edited rollup gets a real HTML artifact on disk without the user
//     ever touching a terminal (was gap #1 — the tab could edit the NOTE
//     but never produced anything `duo rollup list`'s "View ↗" could open).
//   - the rendered artifact's own "Refresh" button (was gap #2 — it only
//     posted a bus event that nothing in Duo itself consumed; a re-render
//     is a pure deterministic operation and doesn't need a watching Claude
//     at all — only the OPTIONAL `--summary` narrative does).
//
// Deliberately narrow: no --style / --out / --open / --summary — those
// stay CLI-only escape hatches via `duo rollup render`. Carries the prior
// artifact's change-summary history forward unchanged (no new entry) so a
// GUI-triggered refresh never silently drops "What changed" history.

import fs from 'node:fs'
import path from 'node:path'
import { resolveRollupNote, provenanceStamp, stampRollupProvenance } from './rollup-notes'
import { renderTarget } from './render'
import { extractSummaryLog } from './rollup'
import { probeGitHubLinkBase } from './rollup-markdown'

const ROLLUPS_DIR = 'rollups'

export interface RenderRollupResult {
  ok: boolean
  /** Vault-relative artifact path, or null on failure. */
  outRel: string | null
  absOut: string | null
  /** True when provenance was stamped back into the note (canonical-format
   *  render only — mirrors the CLI's review #1 guard). */
  stamped: boolean
  error: string | null
}

/** Render `target` (a `type: rollup` note) and write its canonical artifact,
 *  stamping provenance. Never throws for a render/eval problem — surfaces
 *  as `{ok:false, error}` so callers (IPC handlers, the builder save path)
 *  can degrade gracefully instead of losing the note write that triggered it.
 *  ENH-248 R8 — async since the `links: github` mode needs the repo probe
 *  (git subprocesses); a 'relative' note never spawns anything. */
export async function renderAndStampRollup(root: string, target: string): Promise<RenderRollupResult> {
  const rollupNote = resolveRollupNote(root, target)
  if (!rollupNote) {
    return { ok: false, outRel: null, absOut: null, stamped: false, error: `not a type: rollup note: ${target}` }
  }
  try {
    const format = rollupNote.format
    const ext = format === 'html' ? '.html' : '.md'
    const outRel = rollupNote.outRel ?? `${ROLLUPS_DIR}/${rollupNote.slug}${ext}`
    const absOut = path.resolve(root, outRel)
    // ENH-228 — never let the artifact clobber the rollup NOTE itself (the
    // MD variant of a note at rollups/<slug>.md would collide).
    if (absOut === rollupNote.noteAbs) {
      return {
        ok: false,
        outRel: null,
        absOut: null,
        stamped: false,
        error: `artifact path ${outRel} collides with the rollup note ${rollupNote.noteRel}`,
      }
    }
    // What actually renders: a `spec:` .base if set, else the note's own
    // embedded ```base blocks (the note path).
    const renderTargetArg = rollupNote.specPath ?? rollupNote.noteRel
    // Carry the prior artifact's change-summary history forward untouched —
    // a deterministic refresh adds no new "What changed" entry.
    const priorContent = fs.existsSync(absOut) ? fs.readFileSync(absOut, 'utf8') : ''
    const summaryLog = extractSummaryLog(priorContent)
    // R8 — `links: github` notes get blob-URL entity links; probe failure
    // (no repo / non-GitHub remote) degrades silently to relative links.
    const github = rollupNote.links === 'github' ? await probeGitHubLinkBase(root) : null
    const result = renderTarget(root, renderTargetArg, {
      outDir: path.dirname(absOut),
      summaryLog,
      embedSnapshot: true,
      github,
    })
    fs.mkdirSync(path.dirname(absOut), { recursive: true })
    fs.writeFileSync(absOut, format === 'html' ? result.html : result.md)

    let stamped = false
    const stamp = provenanceStamp(rollupNote, {
      format,
      outRel,
      generatedAt: result.generatedAt,
      sourceHash: result.sourceHash,
    })
    if (stamp) {
      stampRollupProvenance(rollupNote.noteAbs, stamp)
      stamped = true
    }
    return { ok: true, outRel, absOut, stamped, error: null }
  } catch (e) {
    return { ok: false, outRel: null, absOut: null, stamped: false, error: e instanceof Error ? e.message : String(e) }
  }
}

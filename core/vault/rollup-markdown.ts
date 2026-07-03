// ENH-244 — "Copy as Markdown" for the Rollups tab: render a rollup's live
// view data as a single GFM table whose title links point at the entity's
// GitHub blob (when the vault sits in a GitHub-remote repo) or a vault-root-
// relative link otherwise (portable — pasteable into any markdown reader
// rooted at the vault, an OKF vault included). One probe per copy, not per
// row: git remote + branch are read ONCE for the vault root and every row's
// link is composed from that (pure, no extra subprocess spawns).

import fs from 'node:fs'
import path from 'node:path'
import { execGit } from '../git/exec'
import { getGitStatus } from '../git/status'
import { composeGitHubUrl } from '../git/remote-url'
import { rollupViewData } from './builder'

export interface RollupMarkdownResult {
  markdown: string | null
  error: string | null
}

// ENH-248 R8 — the GitHub-link probe, factored out so the HTML renderer
// (`renderTarget` via `renderAndStampRollup` / `duo rollup render --github`)
// composes blob-URL entity links from the SAME detection Copy-as-Markdown
// uses. One probe per render; blob composition itself is pure.

export interface GitHubLinkBase {
  remote: string
  branch: string
  /** Realpath'd worktree root — `git rev-parse --show-toplevel` resolves
   *  symlinks (macOS /tmp → /private/tmp), so both sides of every
   *  path.relative must use the resolved form. */
  workTreeRootReal: string
}

/** Probe whether `root` sits in a git repo with a GITHUB-family remote.
 *  Returns null for no repo / no origin / a non-GitHub host (gitlab,
 *  self-hosted…) — callers then fall back to relative links. */
export async function probeGitHubLinkBase(root: string): Promise<GitHubLinkBase | null> {
  try {
    const status = await getGitStatus(root)
    if (!status.isRepo || !status.workTreeRoot) return null
    const remoteRes = await execGit('git', ['remote', 'get-url', 'origin'], { cwd: status.workTreeRoot })
    if (!remoteRes.ok || !remoteRes.stdout.trim()) return null
    const base: GitHubLinkBase = {
      remote: remoteRes.stdout.trim(),
      branch: status.branch || status.head,
      workTreeRootReal: (fs.realpathSync.native ?? fs.realpathSync)(status.workTreeRoot),
    }
    // Reject non-GitHub hosts up front (composeGitHubUrl returns no url) so
    // callers never mix blob links with relative fallbacks mid-artifact.
    return gitHubBlobUrl(base, base.workTreeRootReal) === null ? null : base
  } catch {
    return null
  }
}

/** Compose the blob URL for an absolute path under the probed repo, or null
 *  when the remote isn't GitHub-composable. */
export function gitHubBlobUrl(base: GitHubLinkBase, absPath: string): string | null {
  let absPathReal = absPath
  try {
    absPathReal = (fs.realpathSync.native ?? fs.realpathSync)(absPath)
  } catch {
    /* not on disk (edge) — compose from the raw path */
  }
  const relFromRepo = path.relative(base.workTreeRootReal, absPathReal).split(path.sep).join('/')
  const composed = composeGitHubUrl({
    remote: base.remote,
    branch: base.branch,
    relPath: relFromRepo,
    isFolder: absPathReal === base.workTreeRootReal,
  })
  return composed.url ?? null
}

/** Escape the GFM table-breaking characters in a cell value. Pipes end the
 *  cell early; literal newlines break the row — both are neutralized. */
function escapeCell(v: string): string {
  return v.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

function escapeLinkText(v: string): string {
  return escapeCell(v).replace(/\[/g, '\\[').replace(/\]/g, '\\]')
}

/** Render one rollup as a GFM table. Never throws for a spec problem — that
 *  surfaces as `error` (the caller shows the same doctor path as the view). */
export async function rollupMarkdownTable(root: string, target: string): Promise<RollupMarkdownResult> {
  const data = rollupViewData(root, target)
  if (data.error) return { markdown: null, error: data.error }

  // One probe for the whole table: is the VAULT ROOT inside a git repo with
  // a GitHub-family remote? Every row lives under the vault, so this single
  // check decides the link strategy for all of them (probeGitHubLinkBase
  // already rejects non-GitHub hosts, so the table never mixes strategies).
  const github = await probeGitHubLinkBase(root)
  const resolveLink = (absPath: string, vaultRelPath: string): string =>
    (github ? gitHubBlobUrl(github, absPath) : null) ?? './' + vaultRelPath

  const dataColumns = data.columns.filter((c) => c !== 'file.name')
  const colLabels = dataColumns.map((c) => c.replace(/^(note|file)\./, ''))
  const headers = [...data.groupBy, 'Title', ...colLabels]
  const headerRow = '| ' + headers.map(escapeCell).join(' | ') + ' |'
  const sepRow = '| ' + headers.map(() => '---').join(' | ') + ' |'

  const lines = [`## ${data.title}`, '']
  if (data.rows.length === 0) {
    lines.push('_No entities match this rollup\'s filters._')
  } else {
    lines.push(headerRow, sepRow)
    for (const row of data.rows) {
      const link = resolveLink(row.absPath, row.path)
      const titleCell = `[${escapeLinkText(row.title)}](${link})`
      const cells = [
        ...row.groups.map(escapeCell),
        titleCell,
        ...dataColumns.map((c) => escapeCell(row.cells[c] ?? '')),
      ]
      lines.push('| ' + cells.join(' | ') + ' |')
    }
  }

  return { markdown: lines.join('\n') + '\n', error: null }
}

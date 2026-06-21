// ENH-221 — the Open bar's search-vs-target heuristic (extracted pure so it's
// node-testable, no React/DOM). resolveOpenTarget is the classifier; this adds
// the ONE thing the resolver deliberately can't decide: whether a scheme-less
// local-path input is meant as a vault SEARCH query (a bare token → fuzzy-find,
// preserving the old ⌘O) or an open-TARGET (a path-shaped string → open it).

import { resolveOpenTarget } from '../../core/open-resolve'
import type { OpenTarget } from '../../core/open-resolve'

export type BarMode =
  | { mode: 'empty' }
  | { mode: 'search'; query: string }
  | { mode: 'target'; target: OpenTarget; raw: string }

/**
 * Decide whether the input is a vault SEARCH query or an open-TARGET.
 * Anything the resolver classifies as a URL / GitHub link is a target; a
 * scheme-less local-path is a target only when it LOOKS path-shaped (a
 * leading ~ / / / ./ / ../, a drive letter, a `file:` scheme, or any
 * slash). A bare token (`roadmap`) stays a search so ⌘O still fuzzy-finds.
 */
export function classifyInput(raw: string): BarMode {
  const trimmed = raw.trim()
  if (!trimmed) return { mode: 'empty' }
  const target = resolveOpenTarget(trimmed)
  if (target.kind !== 'local-path') {
    return { mode: 'target', target, raw: trimmed }
  }
  const pathy =
    /^(~|\/|\.\/|\.\.\/)/.test(trimmed) ||
    /^[a-zA-Z]:[\\/]/.test(trimmed) ||
    trimmed.startsWith('file:') ||
    trimmed.includes('/')
  if (pathy) return { mode: 'target', target, raw: trimmed }
  return { mode: 'search', query: trimmed }
}

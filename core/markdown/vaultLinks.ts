// ENH-216 OKF Vault Mode — the SINGLE node-free link helper.
//
// ONE graph model, TWO at-rest serializers: Obsidian (wikilinks, the
// existing default) and OKF (standard markdown relative links). This module
// owns ALL rel-path / slug / extract logic; every other unit IMPORTS from
// here and never reimplements it.
//
// It lives under core/markdown/ (in BOTH tsconfigs) on purpose: the renderer
// (Tier-1 click-nav) and the node-only vault core (core/vault/**) both need
// it, so it must be NODE-FREE. All path math is manual POSIX string work —
// never import `node:path`.
//
// Vocabulary:
//   wikilink  — `[[Customer Orders]]` / `[[Customer Orders|Display]]`; the
//               INPUT-ONLY gesture (D3). Never persists in OKF mode.
//   mdlink    — `[Display](./customer-orders.md)`; the standard markdown
//               relative link OKF mode writes at rest (D3).
//   key       — the move-proof identity of a link target: its extension-less
//               basename, anchor-stripped, with -/_/space treated as
//               equivalent so a wikilink and its slugged mdlink share a key.

/** A vault's at-rest link serialization (ENH-216). ONE graph model, TWO
 *  serializers: `obsidian` (wikilinks, the existing default) and `okf`
 *  (standard markdown relative links). Canonical home is THIS node-free
 *  module (it's in both tsconfigs); `core/vault/types.ts` re-exports it so
 *  the node-only vault tree never has to be reached into from the web side. */
export type VaultMode = 'obsidian' | 'okf'

/** The two on-disk link spellings the one graph model serializes to. */
export type LinkSyntax = 'wikilink' | 'mdlink'

/** One extracted link occurrence, carrying its on-disk provenance so a
 *  consumer can tell an input-only wikilink from a persisted mdlink. */
export interface LinkRef {
  /** Move-proof resolution key (see {@link targetKey}). */
  key: string
  /** Display text (the `|alias` of a wikilink, the `[text]` of an mdlink). */
  display: string
  /** The raw on-disk target exactly as written (`Customer Orders#h`,
   *  `./customer-orders.md#h`) — anchors + paths preserved. */
  rawTarget: string
  /** Which spelling this occurrence used. */
  syntax: LinkSyntax
}

// ── slug ──────────────────────────────────────────────────────────────────

const DIACRITIC_RE = /[̀-ͯ]/g

/** Slug an on-disk file stem (D6): `Customer Orders` → `customer-orders`.
 *  Lowercase, strip diacritics + path-unsafe chars, fold spaces/underscores
 *  to a single hyphen, collapse repeats, trim, cap ~80, empty → `note`. */
export function slugStem(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(DIACRITIC_RE, '')
    .toLowerCase()
    // path-unsafe + punctuation → space (so it folds into a hyphen below)
    .replace(/[^a-z0-9\s_-]+/g, ' ')
    // spaces + underscores both become hyphens
    .replace(/[\s_]+/g, '-')
    // collapse runs of hyphens
    .replace(/-+/g, '-')
    // trim leading/trailing hyphens
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    // a slice can re-expose a trailing hyphen
    .replace(/-+$/g, '')
  return slug || 'note'
}

// ── key ───────────────────────────────────────────────────────────────────

/** Lowercase + treat `-`, `_`, and whitespace as equivalent, collapsed —
 *  so a wikilink `Customer Orders` and an mdlink `./customer-orders.md`
 *  resolve to the same key. (Same lenience as the renderer's
 *  `normalizeWikilinkName`, kept in one place.) */
function foldKey(stem: string): string {
  return stem
    .toLowerCase()
    .replace(/[-_\s]+/g, ' ')
    .trim()
    .replace(/ /g, '-')
}

/** The move-proof resolution key for a raw link target. Strips any anchor
 *  (`#…`), reduces a path to its extension-less basename, then folds. A
 *  wikilink `Customer Orders#h` and an mdlink `../x/customer-orders.md#h`
 *  share the key `customer-orders`. */
export function targetKey(rawTarget: string, _syntax: LinkSyntax): string {
  // Drop a trailing anchor (`#heading` / Obsidian `#^block`).
  let t = rawTarget.split('#')[0].trim()
  // Reduce a path to its last segment.
  const slash = t.lastIndexOf('/')
  if (slash >= 0) t = t.slice(slash + 1)
  // Strip a trailing extension (only a known/short one — keeps dotted stems).
  const dot = t.lastIndexOf('.')
  if (dot > 0) t = t.slice(0, dot)
  return foldKey(t)
}

// ── extraction ──────────────────────────────────────────────────────────────

// `[[target]]` / `[[target|display]]` — capture up to the first `|` or `]]`.
const WIKILINK_RE = /\[\[([^\]]+?)\]\]/g
// Markdown inline link `[text](href)`, NOT an image (negative-lookbehind on
// `!`). `href` stops at the first whitespace (title) or closing paren.
const MDLINK_RE = /(?<!!)\[([^\]]*)\]\(\s*([^)\s]+)[^)]*\)/g

/** True for an href we should NOT treat as an in-vault edge: external
 *  (`http:`, `https:`, `mailto:`, any `scheme:`), protocol-relative (`//…`),
 *  or a pure in-page anchor (`#…`). */
function isExternalHref(href: string): boolean {
  if (!href) return true
  if (href.startsWith('#')) return true
  if (href.startsWith('//')) return true
  // any `scheme:` prefix (http:, https:, mailto:, file: is treated external
  // for edge purposes — vault edges are relative)
  return /^[a-z][a-z0-9+.-]*:/i.test(href)
}

/** Scan BOTH the wikilink + markdown-inline-link syntaxes and return every
 *  in-vault link occurrence in document order, each tagged with provenance.
 *  Drops external (http/mailto/scheme), protocol-relative, pure-anchor, and
 *  image (`![..](..)`) targets. Duplicates are kept (one ref per occurrence;
 *  {@link extractLinkKeys} dedupes for VaultFile.links). */
export function extractLinkRefs(text: string): LinkRef[] {
  type Hit = { index: number; ref: LinkRef }
  const hits: Hit[] = []

  for (const m of text.matchAll(WIKILINK_RE)) {
    const inner = m[1]
    const pipe = inner.indexOf('|')
    const rawTarget = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim()
    if (!rawTarget) continue
    const display = (pipe >= 0 ? inner.slice(pipe + 1) : inner).trim()
    hits.push({
      index: m.index ?? 0,
      ref: {
        key: targetKey(rawTarget, 'wikilink'),
        display,
        rawTarget,
        syntax: 'wikilink',
      },
    })
  }

  for (const m of text.matchAll(MDLINK_RE)) {
    const display = m[1].trim()
    const rawTarget = m[2].trim()
    if (isExternalHref(rawTarget)) continue
    hits.push({
      index: m.index ?? 0,
      ref: {
        key: targetKey(rawTarget, 'mdlink'),
        display,
        rawTarget,
        syntax: 'mdlink',
      },
    })
  }

  hits.sort((a, b) => a.index - b.index)
  return hits.map((h) => h.ref)
}

/** Deduped key list across BOTH syntaxes, document order preserved — feeds
 *  {@link import('../vault/types').VaultFile.links}. */
export function extractLinkKeys(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const ref of extractLinkRefs(text)) {
    if (!seen.has(ref.key)) {
      seen.add(ref.key)
      out.push(ref.key)
    }
  }
  return out
}

// ── POSIX path math (manual — no node:path) ─────────────────────────────────

/** Normalize a POSIX path: fold `\\`→`/`, resolve `.`/`..` segments,
 *  collapse `//`. Keeps it relative (no leading-slash assumptions). */
export function normalizePosix(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/')
  const out: string[] = []
  for (const seg of parts) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop()
      else out.push('..')
    } else {
      out.push(seg)
    }
  }
  return out.join('/')
}

/** Everything before the last `/` of a POSIX path (`''` for a bare name). */
function dirOf(p: string): string {
  const norm = p.replace(/\\/g, '/')
  const slash = norm.lastIndexOf('/')
  return slash < 0 ? '' : norm.slice(0, slash)
}

/** Pure POSIX relative link from a SOURCE file's directory to a TARGET file,
 *  always `./`-anchored when it doesn't already climb with `../`. Inputs are
 *  vault-relative POSIX paths (`people/alice.md`). */
export function relLink(sourceRelPath: string, targetRelPath: string): string {
  const fromDir = normalizePosix(dirOf(sourceRelPath))
  const target = normalizePosix(targetRelPath)
  const fromParts = fromDir ? fromDir.split('/') : []
  const toParts = target ? target.split('/') : []

  // Drop the shared prefix.
  let i = 0
  while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) i++

  const ups = fromParts.slice(i).map(() => '..')
  const downs = toParts.slice(i)
  const rel = [...ups, ...downs].join('/')

  if (rel.startsWith('..')) return rel
  return rel ? `./${rel}` : './'
}

// ── serializers ─────────────────────────────────────────────────────────────

/** Slug-aware basename used as a wikilink target / mdlink display fallback. */
function displayFor(tgtAbs: string, display?: string): string {
  if (display && display.trim()) return display.trim()
  // basename without extension
  let t = tgtAbs.replace(/\\/g, '/')
  const slash = t.lastIndexOf('/')
  if (slash >= 0) t = t.slice(slash + 1)
  const dot = t.lastIndexOf('.')
  if (dot > 0) t = t.slice(0, dot)
  return t
}

/** OKF at-rest serializer (D3): `[Display](./rel.md)` — a STANDARD markdown
 *  relative link. `srcAbs`/`tgtAbs` are vault-relative POSIX paths. No
 *  double-square-bracket links ever persist in OKF mode. */
export function serializeOkfLink(srcAbs: string, tgtAbs: string, display?: string): string {
  return `[${displayFor(tgtAbs, display)}](${relLink(srcAbs, tgtAbs)})`
}

/** Obsidian at-rest serializer: `[[basename]]` / `[[basename|Display]]`.
 *  Obsidian resolves by basename, so the path is reduced to its stem. */
export function serializeWikilink(srcAbs: string, tgtAbs: string, display?: string): string {
  let stem = tgtAbs.replace(/\\/g, '/')
  const slash = stem.lastIndexOf('/')
  if (slash >= 0) stem = stem.slice(slash + 1)
  const dot = stem.lastIndexOf('.')
  if (dot > 0) stem = stem.slice(0, dot)
  if (display && display.trim() && display.trim() !== stem) {
    return `[[${stem}|${display.trim()}]]`
  }
  return `[[${stem}]]`
}

/** Pick the at-rest link serializer for a vault mode. Obsidian is the
 *  default; OKF writes standard markdown relative links (D3). */
export function linkSerializerFor(
  mode: VaultMode,
): (srcAbs: string, tgtAbs: string, display?: string) => string {
  return mode === 'okf' ? serializeOkfLink : serializeWikilink
}

// ── Tier-1 click-nav resolution ──────────────────────────────────────────────

/** Resolve a markdown link `href` (relative to the SOURCE file's vault-rel
 *  path) to a vault-relative target path for click-navigation. Returns null
 *  for external / anchor-only hrefs. When `vaultFiles` is supplied, confirms
 *  the resolved path exists (case-/extension-tolerant); otherwise returns the
 *  normalized path optimistically. */
export function resolveMarkdownLinkHref(
  href: string,
  sourceRelPath: string,
  vaultFiles?: string[],
): string | null {
  if (isExternalHref(href)) return null
  // Drop a trailing anchor before resolving.
  const bare = href.split('#')[0]
  if (!bare) return null
  const fromDir = dirOf(sourceRelPath)
  const joined = fromDir ? `${fromDir}/${bare}` : bare
  const resolved = normalizePosix(joined)
  if (!resolved) return null
  if (!vaultFiles) return resolved
  // Confirm against the known file set (exact, then ext-tolerant).
  if (vaultFiles.includes(resolved)) return resolved
  for (const f of vaultFiles) {
    if (normalizePosix(f) === resolved) return f
  }
  // Try with a `.md` extension if the href omitted it.
  if (!/\.[a-z0-9]+$/i.test(resolved)) {
    const withMd = `${resolved}.md`
    for (const f of vaultFiles) {
      if (normalizePosix(f) === withMd) return f
    }
  }
  return null
}

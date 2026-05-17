// BUG-125 v2 — HTML normalization for canvas baseline tracking.
//
// Canvas-mode HTML files are mounted with Duo runtime decoration:
//   - `data-duo-id="..."` attributes injected per-element for comment
//     anchoring (ENH-001 / Stage 17b H12).
//   - `<style data-duo-style="...">` elements injected for runtime CSS
//     (e.g. image-selection-tint plugin from ENH-119).
//   - DOMParser round-trip pretty-printing (lowercase tags, normalized
//     whitespace, attribute ordering).
//
// These modifications produce a baseline that differs byte-by-byte
// from what's on disk — fine for compare-with-self but wrong for
// reconciliation against external writes. BUG-125 v1 (shipped Sprint
// 17) fixed the symlink-watcher-path layer; v2 (this) fixes the
// baseline-tracking layer.
//
// The shape: `normalize(html)` strips Duo-owned injection and
// re-serializes via DOMParser, producing a stable representation that
// equals the user-meaningful content regardless of which side
// (baseline-in-memory or disk-after-external-write) it came from.
//
// Owner decisions locked 2026-05-17 from the BUG-125 v2 playground:
//   Q1 = Option B (normalize before compare).
//   Q2 = Conflict banner when external write strips data-duo-id
//        anchors. NOT this module's responsibility — the diagnostic
//        layer downstream uses normalize() to detect that case and
//        decides between silent-reload vs banner.
//   Q3 = Medium scope: data-duo-* attributes/elements + DOM
//        serialization round-trip. Whitespace inside text nodes is
//        NOT normalized (so a user-meaningful change to a paragraph's
//        spacing still triggers).
//   Q4 = Investigate markdown editor parity in this PR (see
//        renderer/components/editor/markdownNormalize.ts companion
//        if any TipTap extension was found to inject round-trip-
//        surviving content).

const DUO_ATTR_PREFIX = 'data-duo-'

/**
 * Normalize an HTML string for canvas-baseline comparison purposes.
 *
 * Operations (all idempotent — normalize(normalize(html)) === normalize(html)):
 *   1. Parse with DOMParser → strip Duo-owned attributes from every element.
 *   2. Remove Duo-owned injected elements (any element with
 *      `data-duo-style` or `data-duo-injected` attribute).
 *   3. Re-serialize via XMLSerializer for stable tag-case + whitespace.
 *
 * Returns the normalized string. Returns the original input if parsing
 * fails (defensive fallback — never throw from the reconciliation
 * hot path).
 */
export function normalize(html: string): string {
  if (!html) return ''
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(html, 'text/html')
  } catch {
    return html
  }
  if (!doc?.documentElement) return html

  // Remove Duo-owned injected elements first (so children we'd otherwise
  // visit aren't there to slow us down).
  const injected = doc.querySelectorAll('[data-duo-style], [data-duo-injected]')
  for (const el of injected) el.remove()

  // Strip data-duo-* attributes from every remaining element.
  walkAndStripDuoAttrs(doc.documentElement)

  // Re-serialize via outerHTML. For HTML documents, the DOM
  // internally lowercases tag names during parsing, so outerHTML
  // produces lowercase output regardless of the input's casing —
  // satisfying the case-normalization requirement without
  // XMLSerializer's xmlns-attribute side-effect (which broke
  // idempotency on round-trips).
  return doc.documentElement.outerHTML
}

function walkAndStripDuoAttrs(root: Element): void {
  // Process the root, then descendants. Using getElementsByTagName('*')
  // returns a live HTMLCollection; we materialize to an array to avoid
  // walking moved/added elements during iteration.
  const all = [root, ...Array.from(root.getElementsByTagName('*'))]
  for (const el of all) {
    const attrs = el.attributes
    if (!attrs || attrs.length === 0) continue
    // Iterate backwards because removeAttribute mutates the live list.
    for (let i = attrs.length - 1; i >= 0; i--) {
      const attr = attrs[i]
      if (attr.name.startsWith(DUO_ATTR_PREFIX)) {
        el.removeAttribute(attr.name)
      }
    }
  }
}

/**
 * Convenience predicate for the reconciliation layer.
 *
 * Returns `true` iff `a` and `b` are byte-equal after normalization.
 * Useful for the watcher reload branch: clean buffer + external write
 * that normalizes-equal → silent reload (no conflict banner needed).
 */
export function normalizedEqual(a: string, b: string): boolean {
  if (a === b) return true // fast path
  return normalize(a) === normalize(b)
}

/**
 * For BUG-125 v2 Q2 — detect when an external write has stripped
 * Duo-owned anchors (data-duo-id) that were present in the baseline.
 * Reconciliation uses this to choose between silent reload (Q1=A) vs
 * conflict banner (Q1=B / Q2=conflict-banner per owner pick).
 *
 * Returns `true` iff:
 *   - baseline has at least one data-duo-id present,
 *   - disk content does NOT contain those IDs (stripped by external write).
 */
export function externalStrippedDuoIds(baseline: string, disk: string): boolean {
  if (!baseline || !disk) return false
  const baselineIds = extractDuoIds(baseline)
  if (baselineIds.size === 0) return false
  const diskIds = extractDuoIds(disk)
  // If disk has fewer of the baseline's IDs → some were stripped.
  for (const id of baselineIds) {
    if (!diskIds.has(id)) return true
  }
  return false
}

function extractDuoIds(html: string): Set<string> {
  const ids = new Set<string>()
  if (!html) return ids
  const re = /data-duo-id="([^"]+)"/g
  let match: RegExpExecArray | null
  while ((match = re.exec(html)) !== null) {
    ids.add(match[1])
  }
  return ids
}

// BUG-260 / ENH-266e — shared YAML-hazard-safe scalar quoting for any
// hand-composed `.base` filter expression or frontmatter line this module
// writes. An UNQUOTED value containing `: ` parses as a nested YAML MAPPING
// (the engine then silently drops the value — a filter falls to view-only,
// or `splitFrontmatter` swallows the parse error and returns `{}`, blanking
// the ENTIRE frontmatter block, not just the one field); a ` #` starts a
// comment mid-line; a leading `!`/`[`/etc. is a YAML indicator/tag. Quote
// (single, doubling internal quotes) ONLY when a hazard is present, so the
// common hazard-free case stays byte-plain — existing canonical output is
// unchanged. One escaper, two call sites (`builder.ts`'s filter expressions,
// `scaffold.ts`'s `title:`/`aliases:` lines) — same hazard class, same fix.
export function yamlSafeScalar(v: string): string {
  const hazard = /: |\t|\s#/.test(v) || /^[!&*?|>%@`"'[\]{},-]/.test(v) || /^\s|[\s:]$/.test(v)
  return hazard ? `'${v.replace(/'/g, "''")}'` : v
}

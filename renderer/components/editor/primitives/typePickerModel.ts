// ENH-208 Phase 2 (D4) — the TypePickerPopover's list model, kept pure so
// the filter + "+ new type" rules are testable without React/IPC.

/** One pickable row. `existing` rows stub with that template type;
 *  the `new` row creates `templates/<type>.md` first, then stubs. */
export interface TypeChoice {
  kind: 'existing' | 'new'
  type: string
}

/**
 * Live-filter the vault's type names + decide the trailing
 * `+ new type "<filter>"…` row.
 *
 * Rules:
 *   - empty filter → all types, no new row
 *   - non-empty filter → case-insensitive substring filter
 *   - the new row appends (LAST) whenever the filter is non-empty and
 *     no type EQUALS it case-insensitively — mirrors the wikilink
 *     create-row rule, so `per` shows `person` AND offers `per` while
 *     an exact `person` offers nothing new.
 */
export function buildTypeChoices(types: string[], filter: string): TypeChoice[] {
  const trimmed = filter.trim()
  const f = trimmed.toLowerCase()
  const matched = f ? types.filter((t) => t.toLowerCase().includes(f)) : [...types]
  const rows: TypeChoice[] = matched.map((t) => ({ kind: 'existing', type: t }))
  if (trimmed && !types.some((t) => t.toLowerCase() === f)) {
    rows.push({ kind: 'new', type: trimmed })
  }
  return rows
}

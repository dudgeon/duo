// ENH-208 Vault — write verbs (PR3): `vault init` scaffolds a strict
// Obsidian vault; `vault capture` drops a templated inbox note. Both are
// pure fs operations (no socket). Starter file contents are embedded as
// line arrays joined by '\n' — NOT one big template literal — so the
// ```base fences inside the initiative template don't terminate a JS
// backtick string (the no-backticks-in-template-literals trap).

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { isVaultRoot, detectVaultMode } from './detect'
import { loadTemplates } from './corpus'
import { ensureNoteId } from './move'
import type { TypeTemplate, VaultMode } from './types'

const TB = '`'.repeat(3) // ``` — the markdown code fence

// ── starter content ─────────────────────────────────────────────────────────

const APP_JSON = JSON.stringify({ promptDelete: false, alwaysUpdateLinks: true }, null, 2)

// Parentless types file in their registry folder (D19).
const PERSON_TPL = ['---', 'type: person', 'folder: people', 'role:', 'team:', 'aliases: []', '---', ''].join('\n')

const THEME_TPL = ['---', 'type: theme', 'folder: themes', 'summary:', '---', ''].join('\n')

// Parented types designate ONE frontmatter attribute as the filing parent
// (D19) and live under that parent's folder. milestone → loose; meeting →
// in a `notes/` subfolder.
const MILESTONE_TPL = [
  '---',
  'type: milestone',
  'filingParent: initiative',
  'filingLoose: true',
  'initiative:',
  'owner:',
  'status: on-track',
  'due:',
  '---',
  '',
].join('\n')

const MEETING_TPL = [
  '---',
  'type: meeting',
  'filingParent: initiative',
  'filingLoose: false',
  'initiative:',
  'date:',
  'attendees: []',
  'themes: []',
  '---',
  '',
].join('\n')

// Folder-note parent type (D19): owns a folder; carries the one-template
// `initiative == this` milestone rollup (D8) so every initiative inherits it.
const INITIATIVE_TPL = [
  '---',
  'type: initiative',
  'folder: initiatives',
  'folderNote: true',
  'owner:',
  'status: active',
  'due:',
  'themes: []',
  '---',
  '',
  '## Current state',
  '',
  '## Milestones',
  '',
  TB + 'base',
  'filters:',
  '  and:',
  '    - type == "milestone"',
  '    - initiative == this',
  'formulas:',
  `  when: 'if(due, due.format("MMM D") + " · " + due.relative(), "— no due date —")'`,
  `  flag: 'if(status != "done" && due && due < today(), icon("alarm-clock"), "")'`,
  'views:',
  '  - type: table',
  '    name: Milestones',
  '    order:',
  '      - file.name',
  '      - status',
  '      - owner',
  '      - formula.when',
  '      - formula.flag',
  '    summaries:',
  '      due: Earliest',
  '      status: Filled',
  TB,
  '',
].join('\n')

// OKF initiative template — the SAME frontmatter + headings as the Obsidian
// one but MINUS the embedded ```base rollup block (ENH-216: OKF has no
// `.base` machinery; listings are static generated markdown, D8). The
// folder-note filing rule still rides on the frontmatter.
const INITIATIVE_TPL_OKF = [
  '---',
  'type: initiative',
  'folder: initiatives',
  'folderNote: true',
  'owner:',
  'status: active',
  'due:',
  'themes: []',
  '---',
  '',
  '## Current state',
  '',
  '## Milestones',
  '',
].join('\n')

// The processing dashboard — every view is a work-list for the processing
// pass (human or Claude). Templates + README are query-excluded.
const PROCESSING_BASE = [
  '# The processing dashboard — each view is a work-list for the processing',
  '# pass. One base, several lenses.',
  'filters:',
  '  and:',
  '    - file.ext == "md"',
  `    - '!file.inFolder("templates")'`,
  '    - file.name != "README"',
  'views:',
  '  - type: table',
  '    name: Stale inbox',
  '    filters:',
  '      and:',
  '        - file.inFolder("inbox")',
  `        - captured < today() - "1 week"`,
  '    order:',
  '      - file.name',
  '      - captured',
  '  - type: table',
  '    name: Untyped notes',
  '    filters:',
  '      and:',
  '        - not:',
  '            - file.hasProperty("type")',
  '        - not:',
  '            - file.inFolder("inbox")',
  '    order:',
  '      - file.name',
  '      - file.folder',
  '  - type: table',
  '    name: Milestones missing due',
  '    filters:',
  '      and:',
  '        - type == "milestone"',
  '        - not:',
  '            - file.hasProperty("due")',
  '    order:',
  '      - file.name',
  '      - initiative',
  '',
].join('\n')

function readmeText(name: string): string {
  return [
    `# ${name} — a Duo vault`,
    '',
    'A strict [Obsidian](https://obsidian.md) vault of work-notes: plain',
    'markdown + `[[wikilinks]]` + YAML frontmatter + `.base` rollups. It opens',
    'correctly in Obsidian proper at all times; Duo adds capture, search, and',
    'an agent layer (linking, filing, rollups) on top. Managed via the `duo',
    'vault` / `duo graph` / `duo base` CLI verbs and the vault skill.',
    '',
    '## Layout',
    '',
    '- `templates/` — soft schemas (one per type). The template declares the',
    '  `type`, its filing rule, and the `fields` an entity of that type',
    '  expects. **Query-excluded** (not entities).',
    '- `inbox/` — atomic captures land here untyped; the processing pass files',
    '  them.',
    '- `people/`, `themes/` — registry folders for the parentless types.',
    '- `initiatives/<name>/` — each initiative is a folder-note that owns a',
    '  folder; its milestones/meetings file underneath it.',
    '- `notes/` — time-bucketed residue (`notes/YYYY/MM/`) for parented notes',
    '  whose parent is not yet known.',
    '- `bases/` — vault-wide rollups (`processing.base` is the work-list',
    '  dashboard).',
    '- `out/` — rendered rollup artifacts (regenerable; safe to delete).',
    '',
    '## Filing rules (D19)',
    '',
    'Folder layout is ergonomics only — every query is frontmatter-driven, so',
    'links are never lost when a note moves. Parentless types (person, theme)',
    'file in their registry folder. Parented types (milestone, meeting)',
    'designate one frontmatter attribute as the filing parent (e.g. milestone',
    '→ `initiative:`) and live under that parent. Only folder-note types',
    '(initiative) can be parents.',
    '',
  ].join('\n')
}

// The OKF root index.md (ENH-216, D4 + D8). Its frontmatter is the OKF
// in-vault MARKER (`okf_version` — what `detectVaultMode` keys on) plus the
// vault title + `type: index` (D10: every OKF note is type-stamped, root is
// the index). The body starts with the EXACT listing fence `<!-- duo:listing
// -->` — co-owned: scaffold (U2) writes the frontmatter + this fence seed,
// the listings generator (U3) regex-replaces ONLY the body AFTER the
// frontmatter, leaving the frontmatter byte-identical (never re-serialize the
// YAML). Built by hand (not js-yaml dump) so the marker bytes are stable.
function okfRootIndex(title: string): string {
  return [
    '---',
    'okf_version: "0.1"',
    `title: ${title}`,
    'type: index',
    '---',
    '',
    '<!-- duo:listing -->',
    '',
  ].join('\n')
}

// ── vault init ──────────────────────────────────────────────────────────────

export interface InitResult {
  root: string
  created: string[]
  warnings: string[]
  /** ENH-216: the at-rest link mode the vault was scaffolded in. */
  mode: VaultMode
}

/** Scaffold a vault at `folder`. Refuses to clobber an existing vault
 *  unless `force`. Returns created paths, any advisory warnings, and the
 *  at-rest link mode it scaffolded in.
 *
 *  ENH-216 (D2): `format` defaults to `okf` (the dialog default) — note the
 *  deliberate asymmetry with the CLI, where `--format` is REQUIRED (the CLI
 *  layer enforces that, not this fn). `obsidian` reproduces the legacy
 *  scaffold BYTE-FOR-BYTE (a `.obsidian/` marker, `.base` rollups, a README);
 *  `okf` writes a root `index.md` marker + static-listing seed, the same
 *  templates minus the embedded `.base` block, and NO README / NO `bases/`. */
export function initVault(
  folder: string,
  opts: { force?: boolean; format?: VaultMode; name?: string } = {},
): InitResult {
  const mode: VaultMode = opts.format ?? 'okf'
  const root = path.resolve(folder)
  if (isVaultRoot(root) && !opts.force) {
    throw new Error(
      `${root} is already a vault (has an okf_version index.md or .obsidian/). Pass --force to ` +
        `(re)write the starter scaffold files — it overwrites edited starter templates / ` +
        `processing.base / README / index.md, but never touches your own notes.`,
    )
  }
  const created: string[] = []
  const warnings: string[] = []
  const title = opts.name ?? path.basename(root)

  const mkdir = (rel: string) => {
    const abs = path.join(root, rel)
    if (!fs.existsSync(abs)) {
      fs.mkdirSync(abs, { recursive: true })
      created.push(rel + '/')
    }
  }
  const writeFile = (rel: string, content: string) => {
    const abs = path.join(root, rel)
    if (fs.existsSync(abs) && !opts.force) return // never overwrite without --force
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content)
    created.push(rel)
  }

  if (mode === 'obsidian') {
    // Legacy default — kept verbatim (byte-identical regression guard, ENH-216).
    for (const d of ['.obsidian', 'templates', 'inbox', 'people', 'themes', 'initiatives', 'notes', 'bases', 'out'])
      mkdir(d)

    writeFile('.obsidian/app.json', APP_JSON + '\n')
    writeFile('templates/person.md', PERSON_TPL)
    writeFile('templates/theme.md', THEME_TPL)
    writeFile('templates/initiative.md', INITIATIVE_TPL)
    writeFile('templates/milestone.md', MILESTONE_TPL)
    writeFile('templates/meeting.md', MEETING_TPL)
    writeFile('bases/processing.base', PROCESSING_BASE)
    writeFile('README.md', readmeText(path.basename(root)))
  } else {
    // OKF (ENH-216) — same content folders, but NO .obsidian/ and NO bases/
    // (OKF has no `.base` machinery; listings are static generated markdown,
    // D8). The OKF in-vault marker is the root index.md frontmatter (D4).
    for (const d of ['templates', 'inbox', 'people', 'themes', 'initiatives', 'notes', 'out']) mkdir(d)

    // The root index.md is co-owned: this writes the frontmatter marker +
    // the `<!-- duo:listing -->` body seed; the listings generator (U3)
    // regex-replaces ONLY the body after the frontmatter (D8).
    writeFile('index.md', okfRootIndex(title))
    // Same templates as Obsidian, type-stamped, MINUS the embedded `.base`
    // block in the initiative template (no `.base` machinery in OKF).
    writeFile('templates/person.md', PERSON_TPL)
    writeFile('templates/theme.md', THEME_TPL)
    writeFile('templates/initiative.md', INITIATIVE_TPL_OKF)
    writeFile('templates/milestone.md', MILESTONE_TPL)
    writeFile('templates/meeting.md', MEETING_TPL)
    // No README (D10: the root listing is index.md, not a frontmatter-less
    // README); no .obsidian/, no bases/.
  }

  // iCloud-eviction trap (PRD risk): warn if the vault lives under
  // ~/Documents (where macOS Optimize Storage can evict file bytes).
  const docs = path.join(os.homedir(), 'Documents')
  if (root === docs || root.startsWith(docs + path.sep)) {
    warnings.push(
      'This vault is under ~/Documents. If iCloud Drive "Optimize Mac Storage" is ON, ' +
        'macOS can evict note bytes to cloud-only under disk pressure. Consider a non-iCloud location, ' +
        'or disable Optimize Storage for reliable local access.',
    )
  }
  return { root, created, warnings, mode }
}

// ── vault capture ───────────────────────────────────────────────────────────

export interface CaptureResult {
  path: string
  absPath: string
  type: string | null
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
function slugify(s: string): string {
  return s.trim().replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').slice(0, 60)
}

/** Frontmatter lines that stamp a type + seed its expected fields empty
 *  (arrays as `[]`, scalars blank), for a note created from a template.
 *  Shared by `captureNote` and `createEntityStub`. Excludes the `---`
 *  fences and any meta keys (those aren't entity fields).
 *
 *  ENH-216: `type:` is ALWAYS emitted first (D10 — every OKF note is
 *  type-stamped). In `okf` mode, when a human `title` is supplied it's
 *  stamped right after `type:` (D6 — the on-disk stem is slugged, the human
 *  name lives in `title:`). The `id:` is minted separately on the OKF create
 *  path (`ensureNoteId`, D10), not here. New params default to `obsidian` so
 *  existing call sites stay byte-identical. */
export function seedFrontmatterLines(
  template: TypeTemplate,
  opts: { mode?: VaultMode; title?: string } = {},
): string[] {
  const lines = [`type: ${template.type}`]
  if (opts.mode === 'okf' && opts.title) lines.push(`title: ${opts.title}`)
  for (const field of template.fields) {
    lines.push(`${field}:${Array.isArray(template.frontmatter[field]) ? ' []' : ''}`)
  }
  return lines
}

/** Create an atomic inbox note (D6). Untyped by default; `--template <type>`
 *  stamps that type's frontmatter from the template registry. `text`
 *  becomes the body. The filename is timestamped to the SECOND
 *  (`YYYY-MM-DD-HHMMSS` — the date and time joined by a hyphen, no space, so
 *  a no-title capture is a single space-free token; owner ask 2026-06-12),
 *  and a collision guard appends ` 2`, ` 3`, … if a note with the same stamp
 *  + title already exists — so rapid same-second/same-title captures never
 *  silently overwrite each other.
 *
 *  ENH-216: in `okf` mode EVERY note is type-stamped (D10) — an untemplated
 *  capture stamps `type: note` rather than landing untyped — AND carries a
 *  minted stable `id:` (via `ensureNoteId`, the D5 relink key). No `title:`
 *  on a capture (inbox atoms have no human name). `mode` defaults to
 *  `obsidian`, where capture stays untyped-by-default + id-free (unchanged). */
export function captureNote(
  root: string,
  opts: { template?: string; text?: string; title?: string; date?: Date; mode?: VaultMode } = {},
): CaptureResult {
  // Default to the vault's LIVE detected mode (PR#98 F4): the ⇧⌘N capture IPC
  // handler + `duo vault capture` call this without a mode, and an Obsidian
  // capture in an OKF vault lands untyped with no stable id (no D5 relink key).
  const mode: VaultMode = opts.mode ?? detectVaultMode(root) ?? 'obsidian'
  const now = opts.date ?? new Date()
  const stamp =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const titlePart = opts.title ? ' ' + slugify(opts.title) : ''
  const base = `${stamp}${titlePart}`
  // Disambiguate against an existing file rather than clobbering it.
  let rel = path.join('inbox', `${base}.md`)
  for (let n = 2; fs.existsSync(path.join(root, rel)); n++) {
    rel = path.join('inbox', `${base} ${n}.md`)
  }
  const abs = path.join(root, rel)

  const fmLines: string[] = ['---', `captured: ${now.toISOString().slice(0, 10)}`]
  let type: string | null = null
  if (opts.template) {
    const tpl = loadTemplates(root).find((t) => t.type === opts.template)
    if (!tpl) {
      const known = loadTemplates(root).map((t) => t.type).join(', ')
      throw new Error(`unknown template "${opts.template}" (known: ${known || 'none'})`)
    }
    type = tpl.type
    fmLines.push(...seedFrontmatterLines(tpl, { mode }))
  } else if (mode === 'okf') {
    // D10: every OKF note is type-stamped; an untemplated capture is `note`.
    type = 'note'
    fmLines.push('type: note')
  }
  fmLines.push('---', '')
  const body = opts.text ? opts.text + '\n' : ''
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, fmLines.join('\n') + '\n' + body)
  // D10: mint + stamp a stable id on every OKF note at create time (the D5
  // primary relink key). `ensureNoteId` splices it into the just-written
  // frontmatter byte-preservingly. Obsidian captures stay id-free (unchanged).
  if (mode === 'okf') ensureNoteId(abs, root)
  return { path: rel, absPath: abs, type }
}

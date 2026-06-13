// ENH-208 Vault — write verbs (PR3): `vault init` scaffolds a strict
// Obsidian vault; `vault capture` drops a templated inbox note. Both are
// pure fs operations (no socket). Starter file contents are embedded as
// line arrays joined by '\n' — NOT one big template literal — so the
// ```base fences inside the initiative template don't terminate a JS
// backtick string (the no-backticks-in-template-literals trap).

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { isVaultRoot } from './detect'
import { loadTemplates } from './corpus'
import type { TypeTemplate } from './types'

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

// ── vault init ──────────────────────────────────────────────────────────────

export interface InitResult {
  root: string
  created: string[]
  warnings: string[]
}

/** Scaffold a vault at `folder`. Refuses to clobber an existing vault
 *  unless `force`. Returns created paths + any advisory warnings. */
export function initVault(folder: string, opts: { force?: boolean } = {}): InitResult {
  const root = path.resolve(folder)
  if (isVaultRoot(root) && !opts.force) {
    throw new Error(
      `${root} is already a vault (has .obsidian/). Pass --force to (re)write the starter scaffold ` +
        `files — it overwrites edited starter templates / processing.base / README, but never touches ` +
        `your own notes.`,
    )
  }
  const created: string[] = []
  const warnings: string[] = []

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

  for (const d of ['.obsidian', 'templates', 'inbox', 'people', 'themes', 'initiatives', 'notes', 'bases', 'out']) mkdir(d)

  writeFile('.obsidian/app.json', APP_JSON + '\n')
  writeFile('templates/person.md', PERSON_TPL)
  writeFile('templates/theme.md', THEME_TPL)
  writeFile('templates/initiative.md', INITIATIVE_TPL)
  writeFile('templates/milestone.md', MILESTONE_TPL)
  writeFile('templates/meeting.md', MEETING_TPL)
  writeFile('bases/processing.base', PROCESSING_BASE)
  writeFile('README.md', readmeText(path.basename(root)))

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
  return { root, created, warnings }
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
 *  fences and any meta keys (those aren't entity fields). */
export function seedFrontmatterLines(template: TypeTemplate): string[] {
  const lines = [`type: ${template.type}`]
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
 *  silently overwrite each other. */
export function captureNote(
  root: string,
  opts: { template?: string; text?: string; title?: string; date?: Date } = {},
): CaptureResult {
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
    fmLines.push(...seedFrontmatterLines(tpl))
  }
  fmLines.push('---', '')
  const body = opts.text ? opts.text + '\n' : ''
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, fmLines.join('\n') + '\n' + body)
  return { path: rel, absPath: abs, type }
}

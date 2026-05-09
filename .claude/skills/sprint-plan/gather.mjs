#!/usr/bin/env node
// .claude/skills/sprint-plan/gather.mjs
//
// Build a sprint-plan worksheet manifest by harvesting candidates from
// the four agreed sources:
//   1. tasks.md open entries (🆕 / 🟡 / ⏳ / ⬜ DRAFT)
//   2. docs/dev/active-sprint.md FAIL + carry-over rows
//   3. docs/dev/session-log.md most recent dated section (referenced
//      in the intro; not parsed mechanically — too prose-y)
//   4. docs/roadmap.html status lines flagged 🟡
//
// Items are deduped by ID; subtitle aggregates the source provenance
// when an item appears in multiple sources (e.g., "🟡 from
// active-sprint.md FAIL · also in tasks.md as 🟡 Partial").
//
// Usage:
//   node .claude/skills/sprint-plan/gather.mjs <next-version> [out.json]
//
// Example:
//   node .claude/skills/sprint-plan/gather.mjs 0.6.5 \
//     docs/dev/worksheets/sprint-plan-v0.6.5.json

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const [, , nextVersion, outArg] = process.argv
if (!nextVersion) {
  console.error('Usage: gather.mjs <next-version> [out.json]')
  console.error('Example: gather.mjs 0.6.5 docs/dev/worksheets/sprint-plan-v0.6.5.json')
  process.exit(2)
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../../..')
const today = new Date().toISOString().slice(0, 10)
const outPath = outArg ?? `docs/dev/worksheets/sprint-plan-v${nextVersion}.json`

// ---------------------------------------------------------------- tasks.md

function parseTasksMd() {
  const path = resolve(repoRoot, 'tasks.md')
  let text
  try { text = readFileSync(path, 'utf8') } catch { return [] }

  const items = []
  // Walk by `### <ID>: <Title>` headings; within each block, find the
  // first `**Status:**` line and check its emoji.
  const blocks = text.split(/^### /gm).slice(1)
  for (const block of blocks) {
    const headingLine = block.split('\n', 1)[0].trim()
    const m = headingLine.match(/^((?:BUG|ENH|FOLLOWUP)-\d+):\s*(.+)$/)
    if (!m) continue
    const id = m[1]
    const title = m[2].trim()
    const statusMatch = block.match(/\*\*Status:\*\*\s*(.+?)(?=\n)/)
    if (!statusMatch) continue
    const statusLine = statusMatch[1].trim()
    // Filter — only open work. ✅ shipped entries are reference, not
    // candidates.
    let status = null
    if (statusLine.startsWith('🆕')) status = '🆕 Filed'
    else if (statusLine.startsWith('🟡')) status = '🟡 Partial'
    else if (statusLine.startsWith('⏳')) status = '⏳ Open'
    else if (statusLine.startsWith('⬜')) status = '⬜ Draft'
    if (!status) continue

    // Pull a 1-line description from the status line (everything after
    // the emoji + word) or the next non-frontmatter line.
    const statusBlurb = statusLine.replace(/^[🆕🟡⏳⬜]\s*\S+\s*/, '').slice(0, 220)

    items.push({
      id,
      title,
      sources: [`tasks.md (${status})`],
      blurb: statusBlurb || null
    })
  }
  return items
}

// ---------------------------------------------------------- active-sprint.md

function parseActiveSprintMd() {
  const path = resolve(repoRoot, 'docs/dev/active-sprint.md')
  let text
  try { text = readFileSync(path, 'utf8') } catch { return { fails: [], nextSprint: [] } }

  // Find the most recent walk-results section. Anchored on "## Smoke
  // walk vX.Y.Z — results <date>".
  const fails = []
  const nextSprint = []

  // FAIL table — between "### FAIL (...)" and the next "### " header.
  const failSectionMatch = text.match(/### FAIL[^\n]*\n([\s\S]*?)(?=\n### |\n## )/)
  if (failSectionMatch) {
    const tableLines = failSectionMatch[1].split('\n').filter(l => l.startsWith('|'))
    // Skip header row + alignment row.
    for (const line of tableLines.slice(2)) {
      // Format: | # | Item | Failure |
      const cols = line.split('|').map(s => s.trim()).filter(Boolean)
      if (cols.length < 3) continue
      const item = cols[1]
      const failure = cols[2]
      // The "Item" column may be a bare ID (BUG-061), "ENH-X + Phase
      // Y", or freeform ("Phase 3b — ⌘\\ chord"). Try to extract an ID.
      const idMatch = item.match(/((?:BUG|ENH|FOLLOWUP)-\d+)/)
      const idsInFailure = [...failure.matchAll(/\b((?:BUG|ENH|FOLLOWUP)-\d+)\b/g)].map(m => m[1])
      const id = idMatch ? idMatch[1]
        : idsInFailure[0]  // sometimes the new ID lives in the failure cell ("Filed BUG-074")
        ?? `WALK-FAIL-${fails.length + 1}`
      fails.push({
        id,
        title: item,
        sources: ['active-sprint.md FAIL'],
        blurb: failure.slice(0, 280)
      })
    }
  }

  // "Other notes for next sprint" table — same structure.
  const otherMatch = text.match(/### Other notes for next sprint[^\n]*\n([\s\S]*?)(?=\n### |\n## )/)
  if (otherMatch) {
    const tableLines = otherMatch[1].split('\n').filter(l => l.startsWith('|'))
    for (const line of tableLines.slice(2)) {
      const cols = line.split('|').map(s => s.trim()).filter(Boolean)
      if (cols.length < 3) continue
      const noteText = cols[1]
      const trackerCell = cols[2]
      const idMatch = trackerCell.match(/((?:BUG|ENH|FOLLOWUP)-\d+)/)
      if (!idMatch) continue
      const id = idMatch[1]
      // Title is the first sentence/half of the note.
      const title = noteText.split(/\.|—/)[0].slice(0, 100).trim()
      nextSprint.push({
        id,
        title,
        sources: ['active-sprint.md "Other notes for next sprint"'],
        blurb: noteText.slice(0, 280)
      })
    }
  }

  return { fails, nextSprint }
}

// --------------------------------------------------------------- roadmap.html

function parseRoadmapHtml() {
  const path = resolve(repoRoot, 'docs/roadmap.html')
  let text
  try { text = readFileSync(path, 'utf8') } catch { return [] }

  // Pull each `<details id="sN">...</details>` block, then look INSIDE
  // for `<div class="status-line">🟡 ...`. Bounding the scan to the
  // details block (instead of greedy [\s\S]*?) avoids matching the
  // page-snapshot div near the top, which references "🟡 in-progress"
  // for context but isn't itself a stage card.
  const items = []
  const detailsRe = /<details\b[^>]*\bid="(s[\w-]+)"[^>]*>([\s\S]*?)<\/details>/g
  let dm
  while ((dm = detailsRe.exec(text)) !== null) {
    const stageId = dm[1]
    const block = dm[2]
    const summaryMatch = block.match(/<summary>([\s\S]*?)<\/summary>/)
    if (!summaryMatch) continue
    const statusMatch = block.match(/<div class="status-line">🟡([\s\S]*?)<\/div>/)
    if (!statusMatch) continue
    const summary = summaryMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 110)
    const status = statusMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 280)
    items.push({
      id: `STAGE-${stageId.toUpperCase()}`,
      title: summary,
      sources: ['roadmap.html (🟡 in-progress)'],
      blurb: status
    })
  }
  return items
}

// --------------------------------------------------------- merge & dedupe

function mergeItems(...sourceLists) {
  const byId = new Map()
  for (const list of sourceLists) {
    // Dedupe within the source list first — two FAIL rows can both
    // reference the same filed bug (BUG-075 appeared as both ⌘\ and
    // ⌘⇧\ row, same root cause). Collapse them so the merged item's
    // sources list doesn't double-count.
    const seenInList = new Set()
    for (const item of list) {
      if (seenInList.has(item.id)) continue
      seenInList.add(item.id)
      if (byId.has(item.id)) {
        const existing = byId.get(item.id)
        for (const src of item.sources) {
          if (!existing.sources.includes(src)) existing.sources.push(src)
        }
        if (item.blurb && (!existing.blurb || item.blurb.length > existing.blurb.length)) {
          existing.blurb = item.blurb
        }
      } else {
        byId.set(item.id, { ...item, sources: [...item.sources] })
      }
    }
  }
  return [...byId.values()]
}

// -------------------------------------------------------- main composition

const tasksItems = parseTasksMd()
const { fails: failItems, nextSprint: nextSprintItems } = parseActiveSprintMd()
const roadmapItems = parseRoadmapHtml()

// Order matters — FAIL rows are highest signal (regressions blocking
// the cut), then nextSprint (already-triaged candidates), then tasks
// open work, then roadmap (strategic context).
const merged = mergeItems(failItems, nextSprintItems, tasksItems, roadmapItems)

// Build worksheet items. If the title is just the bare ID (e.g., FAIL
// rows where the "Item" column was "BUG-061"), pull a title fallback
// from the first sentence of the blurb so the row is readable.
const items = merged.map(it => {
  let title = it.title
  if (title === it.id || !title) {
    const firstSentence = (it.blurb || '').split(/\.|—|;/)[0].trim()
    if (firstSentence) title = firstSentence.slice(0, 100)
    else title = it.id
  }
  return {
    id: it.id,
    title,
    subtitle: it.sources.join(' · '),
    what_fixes: it.blurb || undefined
  }
})

const manifest = {
  kind: 'sprint-plan',
  name: `sprint-plan-v${nextVersion}`,
  version: nextVersion,
  date: today,
  title: `Sprint plan · v${nextVersion}`,
  intro_html: `
    <strong>How this works.</strong> Each row is a candidate from
    <code>tasks.md</code> open work, <code>docs/dev/active-sprint.md</code>
    (FAIL rows + "Other notes for next sprint"), or
    <code>docs/roadmap.html</code> 🟡 in-progress stages. Mark each as
    <em>P0</em> (must land in the next sprint), <em>P1</em> (would be
    great), <em>P2</em> (nice-to-have if time), or <em>Skip</em>
    (defer further). Add notes if the row needs reframing or has a
    dependency.
    <br><br>
    Worth glancing at while you go: <a class="duo-path-link"
    data-duo-path="docs/dev/session-log.md" href="#"
    tabindex="0">docs/dev/session-log.md</a> (most recent section
    flags owed / deferred items that may not have made it back into
    tasks.md).
    <br><br>
    Use <strong>Other notes</strong> at the bottom for anything not
    on the candidate list — bugs spotted during the walk, ideas that
    surfaced, etc.`,
  controls: {
    primary: {
      kind: 'radio',
      name: 'priority',
      options: [
        { value: 'P0', label: 'P0', color: '#b13e3a' },
        { value: 'P1', label: 'P1', color: '#c46a1c' },
        { value: 'P2', label: 'P2', color: '#4a7d3e' },
        { value: 'SKIP', label: 'Skip', color: '#6f6557' }
      ]
    },
    secondary: {
      kind: 'textarea',
      name: 'notes',
      placeholder: 'Notes (optional — use for context, dependencies, "rolled into X")',
      rows: 2
    },
    mark_all: { label: 'Mark all P2', value: 'P2' }
  },
  result_format: {
    header_template: 'SPRINT PLAN v{version} ({date})',
    summary_label: 'TOTAL'
  },
  items,
  misc_notes: {
    title: 'Other notes',
    help: "Sprint goal, themes, dependencies, items not on the candidate list, anything strategic.",
    placeholder: 'Free-form notes (sprint goal, theme, big rocks)',
    result_block_title: 'OTHER NOTES'
  }
}

// Write.
const outResolved = resolve(repoRoot, outPath)
mkdirSync(dirname(outResolved), { recursive: true })
writeFileSync(outResolved, JSON.stringify(manifest, null, 2), 'utf8')

console.log(`Wrote sprint-plan manifest: ${outPath}`)
console.log(`  ${items.length} candidates · v${nextVersion} · ${today}`)
console.log(`  - ${failItems.length} from active-sprint.md FAIL`)
console.log(`  - ${nextSprintItems.length} from active-sprint.md "Other notes for next sprint"`)
console.log(`  - ${tasksItems.length} from tasks.md open entries`)
console.log(`  - ${roadmapItems.length} from roadmap.html 🟡 status lines`)
console.log(``)
console.log(`Next: node .claude/skills/worksheet/generate.mjs ${outPath} ${outPath.replace(/\.json$/, '.html')}`)

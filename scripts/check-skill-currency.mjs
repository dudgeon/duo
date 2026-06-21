#!/usr/bin/env node
// scripts/check-skill-currency.mjs
//
// Mechanical backstop for the "CLI is the spec" 4-surface rule and the
// bundled-skill (skill/**, agents/duo.md, skill/priming.md) currency
// invariants. The skill teaches a non-SWE user's Claude Code to drive Duo
// fluently and safely; when a `duo` verb is added, renamed, or a skill
// doc is split, the agent-facing prose silently drifts from the CLI it
// describes. This script catches that drift before it ships.
//
// Modeled on scripts/check-materialization.sh ergonomics:
//   node scripts/check-skill-currency.mjs            warn-and-continue (exit 0)
//   node scripts/check-skill-currency.mjs --strict   exit 1 on any failure
//   node scripts/check-skill-currency.mjs --quiet     suppress banner when clean
//
// No network, no Duo socket — pure filesystem + a parse of cli/duo.ts.
// cwd is expected to be the repo root (run via npm script or `node scripts/…`).
//
// Assertions:
//   A1 COVERAGE        every CLI verb appears as a `duo <verb>` code-span in
//                      cli-reference.md, agents/duo.md, AND CLI-COVERAGE.md
//   A2 NO PHANTOMS     every `duo <token>` written in agent-facing docs
//                      resolves to a real verb or known subcommand
//   A3 VERSION         SKILL.md version string == package.json major.minor
//   A4 NO DANGLING     every relative md link / skill path resolves on disk
//                      (+ hard-fail on canvas-authoring / canvas-interaction)
//   A5 BUDGETS         SKILL.md <= 500 lines; frontmatter description <= 1024
//   A6 SYNC            every skill/ subtree is represented in sync:claude
//   A7 VERBS[]         a VERBS array in cli/duo.ts (if present) == case set
//
// See also: .claude/rules/cli-plumbing.md (the 4-surface rule), CLAUDE.md
// § Working style #3 ("The CLI is the spec").

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------
let QUIET = false
let STRICT = false
for (const arg of process.argv.slice(2)) {
  if (arg === '--quiet') QUIET = true
  else if (arg === '--strict') STRICT = true
  else {
    process.stderr.write(`unknown flag: ${arg}\n`)
    process.exit(2)
  }
}

// Repo root = cwd (npm scripts run from package root; manual `node scripts/…`
// likewise). Resolve everything against it so the script is location-stable.
const ROOT = process.cwd()
const R = (...p) => path.join(ROOT, ...p)

// Surface paths (single source of truth for the whole script).
const PATHS = {
  cli: R('cli', 'duo.ts'),
  pkg: R('package.json'),
  skill: R('skill', 'SKILL.md'),
  priming: R('skill', 'priming.md'),
  agents: R('agents', 'duo.md'),
  coverage: R('docs', 'CLI-COVERAGE.md'),
  // After the ENH-203 refactor the full verb table lives HERE, not in SKILL.md.
  cliReference: R('skill', 'references', 'cli-reference.md'),
  skillDir: R('skill'),
}

// ---------------------------------------------------------------------------
// Small IO helpers — never throw on a missing file; return '' / null so a
// single absent surface produces an actionable FAIL, not a stack trace.
// ---------------------------------------------------------------------------
function readOrNull(p) {
  try {
    return fs.readFileSync(p, 'utf8')
  } catch {
    return null
  }
}
function rel(p) {
  return path.relative(ROOT, p) || p
}

// Recursively collect *.md under a dir. Returns [] if the dir is missing.
function walkMarkdown(dir) {
  const out = []
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walkMarkdown(full))
    else if (e.isFile() && e.name.endsWith('.md')) out.push(full)
  }
  return out
}

// ---------------------------------------------------------------------------
// Parse the authoritative verb set out of cli/duo.ts.
//   - case-label set: every top-level `case '<verb>':` (the dispatch).
//   - VERBS array (best-effort): names in a `const VERBS = [...]` literal,
//     if such an array exists (it may not — A7 warns rather than fails then).
// ---------------------------------------------------------------------------
function parseCliVerbs(src) {
  const labels = new Set()
  // Match `      case 'navigate': {` and `case 'url':` alike. Anchored to
  // line start (after indent) so we don't catch `sub === 'write'` strings.
  const reCase = /^[ \t]*case\s+'([a-z][a-z0-9-]*)'\s*:/gm
  let m
  while ((m = reCase.exec(src)) !== null) labels.add(m[1])

  // VERBS array — Duo declares `const VERBS: VerbSpec[] = [ { name: 'x', … }, … ]`
  // (objects, not bare strings), used to render --help and group verbs. Extract
  // each entry's `name:` field. Also tolerate a future bare-string array
  // (`const VERBS = ['a','b']`). Best-effort: if absent, return null so A7
  // degrades to a warning.
  let verbsArray = null
  const reVerbsDecl = /const\s+VERBS\b[^=]*=\s*\[([\s\S]*?)\n\]/m
  const vm = reVerbsDecl.exec(src)
  if (vm) {
    const body = vm[1]
    verbsArray = new Set()
    // Prefer object-form `name: 'verb'` extraction.
    const reName = /\bname:\s*'([a-z][a-z0-9-]*)'/g
    let nm
    while ((nm = reName.exec(body)) !== null) verbsArray.add(nm[1])
    // Fallback: bare-string array literal (no `name:` keys found).
    if (verbsArray.size === 0) {
      const reItem = /'([a-z][a-z0-9-]*)'/g
      let im
      while ((im = reItem.exec(body)) !== null) verbsArray.add(im[1])
    }
    if (verbsArray.size === 0) verbsArray = null
  }

  // Alias entries (e.g. `nav-state` with `aliasOf: 'nav state'`) are back-compat
  // dispatch labels, not separately-documented verbs — the canonical spelling
  // (`duo nav state`) is what the docs carry. Collect their names so A1 can
  // exclude them from the per-surface coverage requirement.
  const aliasNames = new Set()
  if (vm) {
    const reObj = /\{[^{}]*\}/g
    let om
    while ((om = reObj.exec(vm[1])) !== null) {
      if (/\baliasOf\s*:/.test(om[0])) {
        const am = /\bname:\s*'([a-z][a-z0-9-]*)'/.exec(om[0])
        if (am) aliasNames.add(am[1])
      }
    }
  }
  return { labels, verbsArray, aliasNames }
}

// Subcommand allowlist for the multi-verb cases. Derived by reading the
// `case '<verb>':` blocks in cli/duo.ts (the `sub === '<x>'` ladders). Kept
// as a maintained map so A2 can resolve e.g. `duo nav state`, `duo html set`,
// `duo doc write` without re-parsing the dense handlers. If a new subcommand
// is added to the CLI, add it here too (and the docs that mention it pass).
const SUBCOMMANDS = {
  doc: [
    'read', 'write', 'goto', 'find', 'edit', 'conflict-log',
    'insert', 'delete', 'substitute', 'accept', 'reject', 'highlight',
    'comment',
  ],
  html: [
    'new', 'query', 'get', 'set', 'replace', 'append', 'remove', 'attr',
    'click', 'comment', 'comments',
  ],
  nav: ['state', 'pin', 'unpin', 'pins'],
  file: ['rename', 'trash'],
  workspace: ['save', 'open', 'list-recent', 'current', 'new'],
  // ENH-212 (Home) — `duo session open <uuid>` is the Home click contract.
  session: ['list', 'resume', 'open'],
  project: ['list', 'focus', 'pin', 'unpin', 'close'],
  pack: ['list', 'uninstall'],
  packs: ['list'],
  // ENH-191 P5a (S3c) — `duo window new` opens a second window.
  window: ['new'],
  // ENH-212 (Home) — re-entry surface + terminal-tab switching.
  home: ['show', 'state', 'refresh'],
  term: ['tabs', 'tab', 'close'],
  // ENH-223 — scheduled ("cron") Claude sessions.
  cron: ['list', 'add', 'edit', 'run', 'pause', 'resume', 'rm', 'show'],
}

// Tokens that legitimately follow `duo <verb>` in prose but are NOT verbs:
//   - the canonical "duo nav state" spelling renders as two words; the
//     reader resolves `nav` (verb) + `state` (subcommand).
//   - bare flag-y placeholders the docs use illustratively.
// A2 first tries verb resolution; subcommand maps cover the rest. This set
// is a final escape hatch for non-verb words that can directly follow "duo ".
const NON_VERB_FOLLOWERS = new Set([
  // value placeholders / docs meta — appear as `duo <placeholder>` in prose
  '--help', '-h', '<verb>', '<path>', '<n>', '<selector>', '<url>',
])

// Walk a markdown doc LINE BY LINE, yielding the command-context code on each
// line paired with that line's raw text (for negation/removal-cue checks). A
// `duo <verb>` token is a real command reference only inside code (inline
// spans `…` or fenced blocks ``` … ```); bare "duo" in prose ("the `duo` CLI")
// is not an invocation. Keeping line context lets A2:
//   - skip shell-comment lines inside fences (`# … duo command` is a comment),
//   - skip lines that DOCUMENT a verb's non-existence/removal ("there is no
//     `duo html update` verb", "`duo session rename` … removed"),
//   - avoid cross-line boundary bleed (the "duo duo" / "duo references" class),
//     since each line's code is scanned independently.
// Yields { code, raw } for every command-context SEGMENT — each inline span is
// its own segment (NOT concatenated with sibling spans on the same line), so a
// trailing token of one span can never pair with the leading token of the next
// (`` `duo` `` + `` `duo view` `` must not read as "duo duo"). Fenced lines are
// one segment each. `raw` carries the full source line for negation checks.
function* codeLines(text) {
  if (!text) return
  let inFence = false
  let inHtmlComment = false
  const reFenceMarker = /^\s*(```|~~~)/
  const reInline = /(`{1,2})([^`]+?)\1/g
  for (const raw of text.split('\n')) {
    // Track multi-line HTML comments (<!-- … -->). Comment bodies — even ones
    // that quote a verb in backticks ("`duo session rename` … removed") — are
    // never live commands. Skip the whole block. Single-line comments are
    // handled by the open+close both landing on one line.
    if (!inFence) {
      const opens = raw.includes('<!--')
      const closes = raw.includes('-->')
      if (inHtmlComment) {
        if (closes) inHtmlComment = false
        continue
      }
      if (opens && !closes) {
        inHtmlComment = true
        continue
      }
      if (opens && closes) continue // single-line comment
    }
    if (reFenceMarker.test(raw)) {
      inFence = !inFence
      continue // the ``` line itself carries no command
    }
    if (inFence) {
      // Inside a fenced block every line is code — EXCEPT shell-comment lines
      // (first non-space char is '#'), which are English annotations, not
      // commands (e.g. "# 3. … every other duo command").
      if (/^\s*#/.test(raw)) continue
      yield { code: raw, raw }
    } else {
      // Outside a fence, only inline-span content is command-context. Yield
      // EACH span separately so spans don't bleed into one another.
      reInline.lastIndex = 0
      let m
      while ((m = reInline.exec(raw)) !== null) yield { code: m[2], raw }
    }
  }
}

// ---------------------------------------------------------------------------
// Reporting — one header line per assertion, indented offenders beneath.
// ---------------------------------------------------------------------------
let anyFail = false
const lines = []
function emit(s = '') {
  lines.push(s)
}
function pass(tag, msg) {
  emit(`PASS  ${tag}  ${msg}`)
}
function fail(tag, msg, offenders = []) {
  anyFail = true
  emit(`FAIL  ${tag}  ${msg}`)
  for (const o of offenders) emit(`        ${o}`)
}
function warn(tag, msg, offenders = []) {
  emit(`WARN  ${tag}  ${msg}`)
  for (const o of offenders) emit(`        ${o}`)
}

// ===========================================================================
// Load shared inputs
// ===========================================================================
const cliSrc = readOrNull(PATHS.cli)
const pkgRaw = readOrNull(PATHS.pkg)
const skillSrc = readOrNull(PATHS.skill)

if (cliSrc === null) {
  // Without the CLI source there is no authoritative verb set; the whole
  // run is meaningless. Treat as a hard environment error (exit 2) so a
  // wrong-cwd invocation is obvious rather than a wall of false FAILs.
  process.stderr.write(
    `check-skill-currency: cannot read ${rel(PATHS.cli)} — run from the repo root.\n`
  )
  process.exit(2)
}

const { labels: VERB_SET, verbsArray: VERBS_ARRAY, aliasNames: ALIAS_NAMES } = parseCliVerbs(cliSrc)

// Resolver: is `tok` a real top-level verb?
const isVerb = (tok) => VERB_SET.has(tok)

// ===========================================================================
// A1 COVERAGE — every verb appears as a `duo <verb>` code-span in each of the
// three contributor surfaces: cli-reference.md, agents/duo.md, CLI-COVERAGE.md.
// Grouped rows like `duo a / b / c` are normalized by splitting on '/'.
// ===========================================================================
function collectDuoSpans(text) {
  // Returns the SET of verbs mentioned as the first word after `duo `,
  // covering both code-span form (`duo open`) and plain prose. Also expands
  // grouped slash rows: a heading `duo close-tab / close-terminal-tab` yields
  // both. We scan the raw text (code fences included) — coverage just needs
  // the verb named somewhere.
  const found = new Set()
  if (!text) return found
  // `duo <verb>` where verb is the dispatch-token shape. Capture the verb,
  // then look ahead for a `/ <verb>` continuation to expand grouped rows.
  const reDuo = /\bduo\s+([a-z][a-z0-9-]*)((?:\s*\/\s*[a-z][a-z0-9-]*)*)/g
  let m
  while ((m = reDuo.exec(text)) !== null) {
    found.add(m[1])
    if (m[2]) {
      for (const g of m[2].split('/')) {
        const t = g.trim()
        if (t) found.add(t)
      }
    }
  }
  return found
}

;(function a1() {
  const surfaces = [
    ['cli-reference.md', PATHS.cliReference],
    ['agents/duo.md', PATHS.agents],
    ['CLI-COVERAGE.md', PATHS.coverage],
  ]
  const perSurface = surfaces.map(([name, p]) => {
    const text = readOrNull(p)
    return { name, p, missing: text === null, spans: collectDuoSpans(text) }
  })

  // Exclude alias-only labels (e.g. `nav-state`): the canonical form
  // (`duo nav state`) is the one the docs are required to carry.
  const verbList = [...VERB_SET].filter((v) => !ALIAS_NAMES.has(v)).sort()
  const offenders = []
  for (const { name, p, missing } of perSurface) {
    if (missing) {
      offenders.push(
        `${name}: FILE NOT FOUND (${rel(p)}) — all ${verbList.length} verbs unmet here`
      )
    }
  }
  // Per-verb misses, grouped by surface for a compact report.
  for (const { name, missing, spans } of perSurface) {
    if (missing) continue
    const miss = verbList.filter((v) => !spans.has(v))
    if (miss.length) {
      offenders.push(`${name}: missing ${miss.length} → ${miss.join(', ')}`)
    }
  }
  if (offenders.length) {
    fail(
      'A1 COVERAGE',
      `verbs not documented across all 3 surfaces (${verbList.length} CLI verbs)`,
      [...offenders, `fix: add a \`duo <verb>\` mention for each missing verb in the named surface`]
    )
  } else {
    pass('A1 COVERAGE', `all ${verbList.length} CLI verbs present in cli-reference.md, agents/duo.md, CLI-COVERAGE.md`)
  }
})()

// ===========================================================================
// A2 NO PHANTOMS — every `duo <token>` in agent-facing docs must resolve to a
// real verb, a known subcommand under its verb, or a whitelisted follower.
// Catches `duo files`, `duo html update`, `duo about`, `duo whereami`.
// ===========================================================================
;(function a2() {
  // Agent-facing doc set: priming + SKILL + agents/duo.md + every skill/**/*.md.
  const docPaths = new Set([
    PATHS.priming,
    PATHS.skill,
    PATHS.agents,
    ...walkMarkdown(PATHS.skillDir),
  ])

  // Match `duo <verb> [<next>]` so we can validate a verb+subcommand pair. The
  // leading char class rejects `duo` glued to a path/word (`…/duo/`, `duo.ts`);
  // `duo\s+` already excludes hyphenated tokens like `duo-extras`. The "next"
  // token is only validated when the verb owns a subcommand map, so positional
  // args are never mistaken for phantoms.
  const reDuoPair = /(^|[\s('"$>|])duo\s+([a-z][a-z0-9-]*)(?:\s+([a-z][a-z0-9-]*))?/g

  // A line that DOCUMENTS a verb as removed / nonexistent is correct prose, not
  // a phantom invocation. Cues: "no … verb", "there is no", "removed",
  // "deprecated", "doesn't exist", "does not exist", "no longer", "use X
  // instead". Also skip pure HTML-comment lines (`<!-- … removed … -->`).
  const reNegation = /\bno\b|there is no|removed|deprecat|doesn'?t exist|does not exist|no longer|instead of|use\s+`?\w+`?\s+instead/i
  const reHtmlComment = /^\s*<!--|-->\s*$/

  const offenders = []
  const seen = new Set() // de-dupe identical (file, token) offenders
  for (const p of docPaths) {
    for (const { code, raw } of codeLines(readOrNull(p))) {
      // Skip lines whose RAW text documents non-existence / removal, or that
      // are HTML comments. (Checked on raw so the cue outside the code span
      // still counts, e.g. "There is no `duo html update` verb — use …".)
      if (reNegation.test(raw) || reHtmlComment.test(raw)) continue
      reDuoPair.lastIndex = 0
      let m
      while ((m = reDuoPair.exec(code)) !== null) {
        const verb = m[2]
        const next = m[3]
        if (NON_VERB_FOLLOWERS.has(verb)) continue
        if (isVerb(verb)) {
          // Verb is real. If it's a multi-verb case and `next` is a verb-shaped
          // word, validate the subcommand against the maintained map. We only
          // flag the small mapped set; unmapped `next` words are positional
          // args/placeholders, not phantoms. Catches `duo html update`.
          const subs = SUBCOMMANDS[verb]
          if (subs && next && !subs.includes(next)) {
            const key = `${rel(p)}::duo ${verb} ${next}`
            if (!seen.has(key)) {
              seen.add(key)
              offenders.push(
                `${rel(p)}: "duo ${verb} ${next}" — unknown ${verb} subcommand (valid: ${subs.join('|')})`
              )
            }
          }
          continue
        }
        // Verb NOT real → phantom top-level verb (duo files / about / whereami).
        const key = `${rel(p)}::duo ${verb}`
        if (!seen.has(key)) {
          seen.add(key)
          offenders.push(`${rel(p)}: "duo ${verb}" — not a real verb`)
        }
      }
    }
  }

  if (offenders.length) {
    fail(
      'A2 NO PHANTOMS',
      `${offenders.length} phantom verb/subcommand reference(s) in agent-facing docs`,
      [...offenders.sort(), `fix: replace with the canonical verb (e.g. files→ls/status, html update→html set/replace, about/whereami→doctor)`]
    )
  } else {
    pass('A2 NO PHANTOMS', 'all `duo <token>` references resolve to real verbs/subcommands')
  }
})()

// ===========================================================================
// A3 VERSION — the DECLARED current version in SKILL.md must equal package.json
// major.minor. Only a deliberate version DECLARATION counts: a frontmatter
// `version:` key, a `version:` line, a `# … vX.Y` H1 title, or an explicit
// "Skill version: vX.Y" line. SKILL.md changelog entries (e.g. "v0.7.3+ …")
// are history, NOT the skill's declared version, and are ignored. If there is
// no declaration at all, the version is sourced elsewhere (marker-style) → PASS.
// ===========================================================================
;(function a3() {
  let pkgVersion = null
  try {
    pkgVersion = JSON.parse(pkgRaw ?? '').version ?? null
  } catch {
    pkgVersion = null
  }
  if (!pkgVersion) {
    warn('A3 VERSION', 'could not read package.json version — skipped')
    return
  }
  const [maj, min] = pkgVersion.split('.')
  const wantMajorMinor = `${maj}.${min}`

  if (skillSrc === null) {
    fail('A3 VERSION', `SKILL.md not found (${rel(PATHS.skill)})`)
    return
  }

  // Explicit marker/env → version is injected, not literal. PASS.
  if (/\{\{\s*VERSION\s*\}\}|\$\{?DUO_VERSION\}?|<!--\s*version:/i.test(skillSrc)) {
    pass('A3 VERSION', `SKILL.md uses a version marker/env (package.json ${pkgVersion})`)
    return
  }

  // Strip fenced code blocks first — a version declaration lives in
  // frontmatter / a markdown heading / a prose line, never inside a code
  // fence. (SKILL.md's changelog snippets contain shell comments like
  // "# Reply … (v0.7.3+)" that must NOT be read as the skill's version.)
  const prose = skillSrc
    .replace(/```[\s\S]*?```/g, '\n')
    .replace(/~~~[\s\S]*?~~~/g, '\n')

  // Look ONLY for a deliberate declaration. Each pattern captures a vMAJ.MIN.
  const declPatterns = [
    /^version:\s*v?(\d+)\.(\d+)/im, // frontmatter or a `version:` line
    /^#\s+.*?\bv(\d+)\.(\d+)\b/im, // H1 title carrying a version, e.g. "# duo v0.9"
    /\bskill\s+version:?\s*v?(\d+)\.(\d+)/im, // "Skill version: v0.9"
  ]
  let decl = null
  for (const re of declPatterns) {
    const m = re.exec(prose)
    if (m) {
      decl = { raw: m[0].trim(), mm: `${m[1]}.${m[2]}` }
      break
    }
  }

  if (!decl) {
    // No declared version literal — SKILL.md doesn't assert a version (it's
    // derived from package.json at build/cut time). This is the expected
    // post-refactor shape. Treat as pass, with a note.
    pass('A3 VERSION', `no declared version literal in SKILL.md — version sourced externally (package.json ${pkgVersion})`)
    return
  }

  if (decl.mm !== wantMajorMinor) {
    fail('A3 VERSION', `SKILL.md declared version != package.json major.minor (${wantMajorMinor})`, [
      `found "${decl.raw}" → ${decl.mm} — expected ${wantMajorMinor}`,
      `fix: update the SKILL.md version declaration to ${wantMajorMinor} (or switch to a {{VERSION}} marker)`,
    ])
  } else {
    pass('A3 VERSION', `SKILL.md declared version matches package.json major.minor (${wantMajorMinor})`)
  }
})()

// ===========================================================================
// A4 NO DANGLING REFS — every relative .md link / inline skill path mentioned
// in skill/**/*.md must resolve on disk. Hard-fail if canvas-authoring or
// canvas-interaction appear anywhere (they were renamed; references are stale).
// ===========================================================================
;(function a4() {
  const skillMd = walkMarkdown(PATHS.skillDir)
  const offenders = []
  const ghostHits = []

  // Check MARKDOWN LINKS — `[text](target.md[#anchor])` — because those are
  // unambiguously navigational references the reader is meant to follow.
  // Inline backtick filenames (`module-template.html`, `canvases/foo.html`)
  // are content / scaffold examples, NOT cross-references, and are deliberately
  // NOT resolution-checked (doing so floods the report with template-filename
  // noise that buries the real dangling-link signal). The renamed-file class
  // is caught regardless by the ghost-substring scan below.
  const reMdLink = /\]\(([^)\s]+)\)/g

  // A link target is checkable only if it is a verifiable doc path. Skip:
  //   - URLs / anchors / mailto
  //   - install-destination paths (~/.claude/…, /tmp/…, absolute /…) — these
  //     name runtime locations, not repo files
  //   - glob / placeholder targets ("*.md", "<id>.html")
  const skipTarget = (t) =>
    t === '' ||
    /^(?:[a-z]+:)?\/\//i.test(t) || // scheme:// or //
    t.startsWith('mailto:') ||
    t.startsWith('#') ||
    t.startsWith('~') || // ~/.claude/… install path
    t.startsWith('/') || // absolute (incl. /tmp/…)
    /[*<>]/.test(t) || // glob or <placeholder>
    t.includes('TODO') // scaffold placeholder (TODO-pack-name/…)

  for (const file of skillMd) {
    const text = readOrNull(file)
    if (!text) continue
    const dir = path.dirname(file)

    // Ghost-file hard check (substring, anywhere — link OR prose OR code).
    // These two files were renamed; ANY surviving mention is a stale ref.
    for (const ghost of ['canvas-authoring', 'canvas-interaction']) {
      if (text.includes(ghost)) {
        ghostHits.push(`${rel(file)}: references renamed file "${ghost}.md"`)
      }
    }

    let m
    while ((m = reMdLink.exec(text)) !== null) {
      let target = m[1].trim().split('#')[0].split('?')[0].trim()
      if (skipTarget(target)) continue
      if (!/\.(md|html)$/i.test(target)) continue
      // Resolve against (a) the file's own dir, (b) the skill/ root, and
      // (c) the repo root (for links that point at `docs/…` or use `../`).
      // Pass if it resolves ANYWHERE.
      const candidates = [
        path.resolve(dir, target),
        path.resolve(PATHS.skillDir, target),
        path.resolve(ROOT, target),
      ]
      if (!candidates.some((c) => fs.existsSync(c))) {
        offenders.push(`${rel(file)}: link → "${target}" does not resolve`)
      }
    }
  }

  if (ghostHits.length || offenders.length) {
    const hint =
      ghostHits.length
        ? `fix: repoint canvas-authoring → make-page.md; canvas-interaction → make-playground.md / playground-interaction.md`
        : `fix: correct the path or create the target file`
    fail(
      'A4 NO DANGLING',
      `${ghostHits.length + offenders.length} dangling/renamed reference(s) in skill/`,
      [...ghostHits.sort(), ...offenders.sort(), hint]
    )
  } else {
    pass('A4 NO DANGLING', 'all relative md/html references in skill/ resolve on disk')
  }
})()

// ===========================================================================
// A5 BUDGETS — SKILL.md <= 500 lines (warn > 450); frontmatter description
// <= 1024 chars.
// ===========================================================================
;(function a5() {
  if (skillSrc === null) {
    fail('A5 BUDGETS', `SKILL.md not found (${rel(PATHS.skill)})`)
    return
  }
  const lineCount = skillSrc.split('\n').length
  const problems = []

  if (lineCount > 500) {
    problems.push(`SKILL.md is ${lineCount} lines (budget 500)`)
  }

  // Frontmatter description length. Parse the leading --- … --- YAML block and
  // pull `description:` (handles single-line and folded `>`/`|` blocks).
  let descLen = null
  const fm = skillSrc.match(/^---\n([\s\S]*?)\n---/)
  if (fm) {
    const body = fm[1]
    // single-line: description: "...."  OR description: ....
    const single = body.match(/^description:\s*(.+)$/m)
    const folded = body.match(/^description:\s*[|>][-+]?\s*\n([\s\S]*?)(?=^\S|\n---|\Z)/m)
    if (folded) {
      descLen = folded[1].replace(/\n/g, ' ').trim().length
    } else if (single) {
      descLen = single[1].trim().replace(/^["']|["']$/g, '').length
    }
  }
  if (descLen !== null && descLen > 1024) {
    problems.push(`frontmatter description is ${descLen} chars (budget 1024)`)
  }

  if (problems.length) {
    fail('A5 BUDGETS', 'SKILL.md exceeds a budget', [...problems, `fix: trim SKILL.md / move detail into references/`])
  } else if (lineCount > 450) {
    warn('A5 BUDGETS', `SKILL.md is ${lineCount} lines (approaching the 500-line budget)`)
  } else {
    const descNote = descLen !== null ? `, description ${descLen}/1024 chars` : ''
    pass('A5 BUDGETS', `SKILL.md ${lineCount}/500 lines${descNote}`)
  }
})()

// ===========================================================================
// A6 SYNC COMPLETENESS (warn-only) — every top-level subtree of skill/ should
// be represented in the sync:claude cp/mkdir chain so it lands in ~/.claude.
// ===========================================================================
;(function a6() {
  let sync = null
  try {
    sync = JSON.parse(pkgRaw ?? '').scripts?.['sync:claude'] ?? null
  } catch {
    sync = null
  }
  if (!sync) {
    warn('A6 SYNC', 'could not parse sync:claude from package.json — skipped')
    return
  }

  // Top-level entries of skill/: subdirs + root *.md spokes (as a group).
  let entries
  try {
    entries = fs.readdirSync(PATHS.skillDir, { withFileTypes: true })
  } catch {
    warn('A6 SYNC', `skill/ not found (${rel(PATHS.skillDir)}) — skipped`)
    return
  }
  const subdirs = entries.filter((e) => e.isDirectory()).map((e) => e.name)
  const rootMd = entries.filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => e.name)

  const gaps = []
  // Each subdir name should appear somewhere in the sync chain (as a cp/mkdir
  // path segment). pack-builder is synced under ~/.claude/skills/pack-builder,
  // so its source `skill/pack-builder` is represented by the basename token.
  for (const d of subdirs) {
    // Match the dir name as a path segment in the script (e.g. "skill/references"
    // or "references/" or "skill/pack-builder/SKILL.md").
    const seg = new RegExp(`(^|[\\s/])${d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(/|\\b)`)
    if (!seg.test(sync)) gaps.push(`subtree "skill/${d}/" not referenced in sync:claude`)
  }
  // Root *.md spokes: at least SKILL.md + the named spokes should appear.
  // We check that EACH root md basename is cp'd (covers make-page.md etc).
  // BUILD-PROCEDURES.md is repo-dev-only contributor notes, intentionally NOT
  // shipped to ~/.claude — skip it.
  const REPO_ONLY_SPOKES = new Set(['BUILD-PROCEDURES.md'])
  for (const f of rootMd) {
    if (REPO_ONLY_SPOKES.has(f)) continue
    if (!sync.includes(f)) gaps.push(`root spoke "skill/${f}" not cp'd in sync:claude`)
  }

  if (gaps.length) {
    warn('A6 SYNC', `${gaps.length} skill/ subtree(s) may be missing from sync:claude`, [
      ...gaps.sort(),
      `fix: extend the sync:claude cp/mkdir chain in package.json (the enforcement agent owns that edit)`,
    ])
  } else {
    pass('A6 SYNC', `all ${subdirs.length} subdir(s) + ${rootMd.length} root spoke(s) represented in sync:claude`)
  }
})()

// ===========================================================================
// A7 VERBS[] COMPLETENESS (warn if unparseable) — a `const VERBS` array in
// cli/duo.ts (used for help/completion) should equal the case-label set.
// Catches a verb wired into dispatch but omitted from the help/VERBS list.
// ===========================================================================
;(function a7() {
  if (!VERBS_ARRAY) {
    warn('A7 VERBS[]', 'no `const VERBS` array found in cli/duo.ts — skipped (case-label set is authoritative)')
    return
  }
  const onlyInCases = [...VERB_SET].filter((v) => !VERBS_ARRAY.has(v)).sort()
  const onlyInArray = [...VERBS_ARRAY].filter((v) => !VERB_SET.has(v)).sort()
  if (onlyInCases.length || onlyInArray.length) {
    const offenders = []
    if (onlyInCases.length) offenders.push(`dispatched but missing from VERBS[]: ${onlyInCases.join(', ')}`)
    if (onlyInArray.length) offenders.push(`in VERBS[] but no case label: ${onlyInArray.join(', ')}`)
    fail('A7 VERBS[]', 'cli/duo.ts VERBS array != case-label set', [...offenders, `fix: reconcile the VERBS array with the dispatch switch`])
  } else {
    pass('A7 VERBS[]', `VERBS array matches the ${VERB_SET.size} case labels`)
  }
})()

// ===========================================================================
// Render
// ===========================================================================
const failCount = lines.filter((l) => l.startsWith('FAIL')).length
const warnCount = lines.filter((l) => l.startsWith('WARN')).length

// `--quiet` suppresses the banner when there are no FAILURES. Warnings are
// advisory (A6 sync gaps, unparseable VERBS); they must not spam the predev /
// pretest hooks on every launch — matching check-materialization's
// warn-and-continue ergonomic. Failures always print, even under --quiet.
if (QUIET && failCount === 0) {
  process.exit(0)
}

const banner = []
banner.push('')
banner.push('━━━ check-skill-currency ━━━ (CLI-is-the-spec / bundled-skill currency)')
banner.push('')
for (const l of lines) banner.push(l)
banner.push('')
if (failCount === 0) {
  banner.push(`✓ ${VERB_SET.size} CLI verbs · ${failCount} failures · ${warnCount} warnings`)
} else {
  banner.push(`✗ ${failCount} failure(s), ${warnCount} warning(s) across ${VERB_SET.size} CLI verbs`)
  banner.push('')
  banner.push('  These guard the "CLI is the spec" 4-surface rule. Each FAIL above')
  banner.push('  names the surface + the exact fix. Re-run after editing the docs.')
  if (!STRICT) {
    banner.push('  (warn-and-continue; pass --strict to fail the build / CI on these)')
  }
}
banner.push('')

process.stdout.write(banner.join('\n') + '\n')

// Exit 0 unless --strict AND something failed. Warnings never fail the build.
if (STRICT && failCount > 0) process.exit(1)
process.exit(0)

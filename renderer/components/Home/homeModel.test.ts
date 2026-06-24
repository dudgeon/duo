import { describe, it, expect } from 'vitest'
import {
  greetingLine,
  greetingParts,
  freshestSession,
  selectHeroes,
  selectSpine,
  foldSpine,
  ageShort,
  ageWords,
  projectHue,
  subPathLabel,
  fileChipLabel,
  assignCronJobs,
  SPINE_FOLD_AFTER
} from './homeModel'
import type { HomeProject, HomeSession, GreetingData, CronJobView } from '@shared/types'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const WEEK = 7 * DAY

/** Minimal HomeProject factory — only the fields the selectors read. */
function project(name: string, lastActiveAt: number, colorIndex = 0): HomeProject {
  return {
    rootPath: `/Users/x/${name}`,
    displayName: name,
    colorIndex,
    lastActiveAt,
    sessionCount: 1,
    sessions: [],
    recentFiles: []
  }
}

describe('greetingLine (D4 + D12)', () => {
  it('full briefing — name + open count + freshest thread', () => {
    const g: GreetingData = {
      firstName: 'Geoff',
      openCount: 2,
      freshest: { title: 'the terminal-collapse fix', ageMs: 12 * MIN }
    }
    expect(greetingLine(g)).toBe(
      'Welcome back, Geoff — 2 sessions open; freshest is the terminal-collapse fix, 12 minutes ago'
    )
  })

  it('singular session — "1 session open"', () => {
    const g: GreetingData = {
      firstName: 'Geoff',
      openCount: 1,
      freshest: { title: 'a fix', ageMs: 1 * MIN }
    }
    expect(greetingLine(g)).toBe(
      'Welcome back, Geoff — 1 session open; freshest is a fix, 1 minute ago'
    )
  })

  it('D12 degradation — no firstName opens "Welcome back —"', () => {
    const g: GreetingData = {
      openCount: 3,
      freshest: { title: 'thing', ageMs: 2 * HOUR }
    }
    expect(greetingLine(g)).toBe(
      'Welcome back — 3 sessions open; freshest is thing, 2 hours ago'
    )
  })

  it('D4 degradation — 0 open → "all quiet since <age>"', () => {
    const g: GreetingData = {
      firstName: 'Geoff',
      openCount: 0,
      freshest: { title: 'old work', ageMs: 3 * DAY }
    }
    expect(greetingLine(g)).toBe('Welcome back, Geoff — all quiet since 3 days ago')
  })

  it('D4 degradation — 0 open + no freshest → "all quiet" (no since tail)', () => {
    const g: GreetingData = { firstName: 'Geoff', openCount: 0 }
    expect(greetingLine(g)).toBe('Welcome back, Geoff — all quiet')
  })

  it('D4 + D12 — 0 open, no name, no freshest → "Welcome back — all quiet"', () => {
    const g: GreetingData = { openCount: 0 }
    expect(greetingLine(g)).toBe('Welcome back — all quiet')
  })

  it('open count but no freshest known → trims the "; freshest…" tail', () => {
    const g: GreetingData = { firstName: 'Geoff', openCount: 2 }
    expect(greetingLine(g)).toBe('Welcome back, Geoff — 2 sessions open')
  })
})

describe('ageShort', () => {
  it('under a minute → "just now"', () => {
    expect(ageShort(0)).toBe('just now')
    expect(ageShort(59_000)).toBe('just now')
  })
  it('minutes / hours / days / weeks grain', () => {
    expect(ageShort(12 * MIN)).toBe('12m ago')
    expect(ageShort(5 * HOUR)).toBe('5h ago')
    expect(ageShort(3 * DAY)).toBe('3d ago')
    expect(ageShort(2 * WEEK)).toBe('2w ago')
  })
  it('negative / NaN delta clamps to "just now"', () => {
    expect(ageShort(-5000)).toBe('just now')
    expect(ageShort(NaN)).toBe('just now')
  })
})

describe('ageWords', () => {
  it('singular vs plural agreement', () => {
    expect(ageWords(1 * MIN)).toBe('1 minute ago')
    expect(ageWords(2 * MIN)).toBe('2 minutes ago')
    expect(ageWords(1 * HOUR)).toBe('1 hour ago')
    expect(ageWords(1 * DAY)).toBe('1 day ago')
    expect(ageWords(1 * WEEK)).toBe('1 week ago')
  })
  it('under a minute → "moments ago"', () => {
    expect(ageWords(30_000)).toBe('moments ago')
  })
})

describe('hero / spine selection', () => {
  it('first two projects are heroes; the rest are spine', () => {
    const projects = [
      project('a', 100),
      project('b', 90),
      project('c', 80),
      project('d', 70)
    ]
    expect(selectHeroes(projects).map((p) => p.displayName)).toEqual(['a', 'b'])
    expect(selectSpine(projects).map((p) => p.displayName)).toEqual(['c', 'd'])
  })

  it('fewer than two projects — heroes is the whole list, spine empty', () => {
    const one = [project('solo', 100)]
    expect(selectHeroes(one).map((p) => p.displayName)).toEqual(['solo'])
    expect(selectSpine(one)).toEqual([])
    expect(selectHeroes([])).toEqual([])
    expect(selectSpine([])).toEqual([])
  })
})

describe('foldSpine (D5 — fold after 8)', () => {
  const spine = Array.from({ length: 14 }, (_, i) => project(`p${i}`, 100 - i))

  it('collapsed — shows the first 8, hides the rest', () => {
    const { visible, hiddenCount } = foldSpine(spine, false)
    expect(visible).toHaveLength(SPINE_FOLD_AFTER)
    expect(hiddenCount).toBe(14 - SPINE_FOLD_AFTER)
    expect(visible[0].displayName).toBe('p0')
    expect(visible[7].displayName).toBe('p7')
  })

  it('expanded — shows everything, hiddenCount 0', () => {
    const { visible, hiddenCount } = foldSpine(spine, true)
    expect(visible).toHaveLength(14)
    expect(hiddenCount).toBe(0)
  })

  it('exactly 8 spine rows does not fold', () => {
    const eight = Array.from({ length: 8 }, (_, i) => project(`p${i}`, 100 - i))
    const { visible, hiddenCount } = foldSpine(eight, false)
    expect(visible).toHaveLength(8)
    expect(hiddenCount).toBe(0)
  })

  it('fewer than 8 spine rows never folds', () => {
    const three = Array.from({ length: 3 }, (_, i) => project(`p${i}`, 100 - i))
    const { visible, hiddenCount } = foldSpine(three, false)
    expect(visible).toHaveLength(3)
    expect(hiddenCount).toBe(0)
  })
})

describe('projectHue', () => {
  it('maps colorIndex 0..5 to the six --duo-project-* tokens', () => {
    expect(projectHue(0)).toBe('var(--duo-project-pine)')
    expect(projectHue(5)).toBe('var(--duo-project-moss)')
  })
  it('wraps out-of-range indices and falls back on NaN', () => {
    expect(projectHue(6)).toBe('var(--duo-project-pine)')
    expect(projectHue(-1)).toBe('var(--duo-project-moss)')
    expect(projectHue(NaN)).toBe('var(--duo-project-pine)')
  })
})

describe('subPathLabel + fileChipLabel', () => {
  it('subPathLabel trims slashes and nulls out empties', () => {
    expect(subPathLabel('worktrees/foo')).toBe('worktrees/foo')
    expect(subPathLabel('/sub/')).toBe('sub')
    expect(subPathLabel('')).toBeNull()
    expect(subPathLabel(undefined)).toBeNull()
    expect(subPathLabel('/')).toBeNull()
  })
  it('fileChipLabel returns the basename', () => {
    expect(fileChipLabel('/Users/x/proj/README.md')).toBe('README.md')
    expect(fileChipLabel('bare.txt')).toBe('bare.txt')
  })
})

describe('greetingParts (round-2 #3 — clickable freshest title)', () => {
  it('splits N-open greeting around the freshest title', () => {
    const g: GreetingData = { firstName: 'Geoff', openCount: 2, freshest: { title: 'Fix the bug', ageMs: 12 * MIN } }
    const parts = greetingParts(g)
    expect(parts.before).toBe('Welcome back, Geoff — 2 sessions open; freshest is ')
    expect(parts.freshestTitle).toBe('Fix the bug')
    expect(parts.after).toBe(', 12 minutes ago')
    // The reassembled text must match greetingLine() exactly (no drift).
    expect(parts.before + parts.freshestTitle + parts.after).toBe(greetingLine(g))
  })

  it('no freshest → plain line, nothing clickable', () => {
    const g: GreetingData = { firstName: 'Geoff', openCount: 1, freshest: undefined }
    const parts = greetingParts(g)
    expect(parts.freshestTitle).toBeNull()
    expect(parts.before).toBe(greetingLine(g))
  })

  it('0 open with a freshest → title not clickable (the age is the tail, not the thread)', () => {
    const g: GreetingData = { firstName: 'Geoff', openCount: 0, freshest: { title: 'old thread', ageMs: 3 * DAY } }
    const parts = greetingParts(g)
    expect(parts.freshestTitle).toBeNull()
    expect(parts.before + parts.after).toBe(greetingLine(g))
  })
})

describe('freshestSession (round-2 #3)', () => {
  function sess(uuid: string, modifiedAt: number): HomeSession {
    return { uuid, title: uuid, titleSource: 'jsonl-firstmsg', modifiedAt, cwd: `/Users/x/${uuid}` }
  }
  function projWith(name: string, sessions: HomeSession[]): HomeProject {
    return { ...project(name, 0), sessions }
  }

  it('returns the single most-recent session across all projects', () => {
    const projects = [
      projWith('alpha', [sess('a1', 100), sess('a2', 300)]),
      projWith('beta', [sess('b1', 500), sess('b2', 200)]),
    ]
    const f = freshestSession(projects)
    expect(f?.session.uuid).toBe('b1')
    expect(f?.project.displayName).toBe('beta')
  })

  it('null when there are no sessions', () => {
    expect(freshestSession([project('empty', 0)])).toBeNull()
    expect(freshestSession([])).toBeNull()
  })
})

describe('assignCronJobs (D6 — nest under surfaced project cards)', () => {
  /** Minimal CronJobView — assignCronJobs only reads `cwd`. */
  function job(id: string, cwd: string): CronJobView {
    return { id, cwd } as CronJobView
  }

  it('nests a job whose cwd is exactly a surfaced root', () => {
    const { byRoot, unmatched } = assignCronJobs(
      [job('a', '/Users/x/app')],
      ['/Users/x/app', '/Users/x/web'],
      new Set(['/Users/x/app'])
    )
    expect(byRoot.get('/Users/x/app')?.map((j) => j.id)).toEqual(['a'])
    expect(unmatched).toEqual([])
  })

  it('nests a job in a SUBDIR under its deepest enclosing surfaced root', () => {
    const { byRoot, unmatched } = assignCronJobs(
      [job('a', '/Users/x/app/packages/core')],
      ['/Users/x/app'],
      new Set(['/Users/x/app'])
    )
    expect(byRoot.get('/Users/x/app')?.map((j) => j.id)).toEqual(['a'])
    expect(unmatched).toEqual([])
  })

  it('picks the DEEPEST enclosing root when roots nest', () => {
    const { byRoot } = assignCronJobs(
      [job('a', '/Users/x/app/sub/work')],
      ['/Users/x/app', '/Users/x/app/sub'],
      new Set(['/Users/x/app', '/Users/x/app/sub'])
    )
    expect(byRoot.get('/Users/x/app/sub')?.map((j) => j.id)).toEqual(['a'])
    expect(byRoot.has('/Users/x/app')).toBe(false)
  })

  it('aggregates (unmatched) a job whose owning project is NOT surfaced', () => {
    // root exists (folded spine) but isn't in surfacedRoots → aggregated block
    const { byRoot, unmatched } = assignCronJobs(
      [job('a', '/Users/x/folded')],
      ['/Users/x/app', '/Users/x/folded'],
      new Set(['/Users/x/app'])
    )
    expect(byRoot.size).toBe(0)
    expect(unmatched.map((j) => j.id)).toEqual(['a'])
  })

  it('aggregates a job whose cwd matches no known root', () => {
    const { unmatched } = assignCronJobs(
      [job('a', '/tmp/orphan')],
      ['/Users/x/app'],
      new Set(['/Users/x/app'])
    )
    expect(unmatched.map((j) => j.id)).toEqual(['a'])
  })

  it('groups multiple jobs under the same root and preserves order', () => {
    const { byRoot } = assignCronJobs(
      [job('a', '/Users/x/app'), job('b', '/Users/x/app/sub'), job('c', '/Users/x/web')],
      ['/Users/x/app', '/Users/x/web'],
      new Set(['/Users/x/app', '/Users/x/web'])
    )
    expect(byRoot.get('/Users/x/app')?.map((j) => j.id)).toEqual(['a', 'b'])
    expect(byRoot.get('/Users/x/web')?.map((j) => j.id)).toEqual(['c'])
  })
})

// ── ENH-231 — catch-up presentation helpers ────────────────────────────────
import {
  repoLabel,
  attentionChip,
  digestPrimaryAction,
  digestSecondaryAction,
  digestNextLine,
  digestNeedsLine,
  compactDotClass,
} from './homeModel'
import type { CatchupCard } from '@shared/types'

function card(over: Partial<CatchupCard> = {}): CatchupCard {
  return {
    uuid: 'u1',
    cwd: '/Users/x/web-app',
    goal: 'g',
    youAsked: 'ya',
    todos: [],
    files: [],
    artifacts: {},
    attention: null,
    state: 'done',
    gitBranch: null,
    lastActivityAt: 1000,
    tier: 'compact',
    ...over,
  }
}

describe('repoLabel', () => {
  it('is the cwd basename', () => {
    expect(repoLabel('/Users/x/web-app')).toBe('web-app')
    expect(repoLabel('/Users/x/web-app/')).toBe('web-app')
    expect(repoLabel('')).toBe('—')
  })
})

describe('attentionChip', () => {
  it('maps each reason to a label + a both-theme-legible banner class', () => {
    expect(attentionChip('plan-to-approve')).toEqual({ label: '📋 plan to approve', bannerClass: 'duo-banner-warn' })
    expect(attentionChip('question')).toEqual({ label: '💬 question', bannerClass: 'duo-banner-info' })
    expect(attentionChip('blocked')).toEqual({ label: '⛔ blocked', bannerClass: 'duo-banner-error' })
  })
})

describe('digestPrimaryAction / digestSecondaryAction (D7)', () => {
  it('a Done md/html product leads with the artifact; session is secondary', () => {
    const c = card({ state: 'done', artifacts: { createdFiles: ['/Users/x/web-app/q3.md'] } })
    expect(digestPrimaryAction(c)).toEqual({ kind: 'artifact', label: 'Open q3.md →', path: '/Users/x/web-app/q3.md' })
    expect(digestSecondaryAction(c)).toEqual({ kind: 'session', label: 'Open session' })
  })

  it('a PR-bearing card leads with the session; PR is the secondary link', () => {
    const c = card({ state: 'done', artifacts: { pr: { number: 214, url: 'https://github.com/o/r/pull/214' } } })
    expect(digestPrimaryAction(c).kind).toBe('session')
    expect(digestSecondaryAction(c)).toEqual({ kind: 'pr', label: 'Review PR #214', value: 'https://github.com/o/r/pull/214' })
  })

  it('a needs-you card always leads with re-entry, even with a created doc (not done)', () => {
    const c = card({ state: 'needs-you', attention: { reason: 'question' }, artifacts: { createdFiles: ['/x/a.md'] } })
    expect(digestPrimaryAction(c).kind).toBe('session') // not 'done' → no artifact-lead
  })

  it('secondary precedence is PR > doc > diff', () => {
    expect(digestSecondaryAction(card({ artifacts: {}, gitBranch: 'feat/x' }))).toEqual({ kind: 'diff', label: 'View diff' })
    expect(digestSecondaryAction(card({ artifacts: {} }))).toBeNull()
  })
})

describe('digestNextLine / digestNeedsLine', () => {
  it('next prefers the agent recommendation, else the first unfinished todo', () => {
    expect(digestNextLine(card({ narrative: { next: 'do X' } }))).toBe('do X')
    expect(digestNextLine(card({ todos: [{ text: 'a', status: 'completed' }, { text: 'b', status: 'pending' }] }))).toBe('b')
    expect(digestNextLine(card())).toBeNull()
  })
  it('needs line prefers the agent note, else the last assistant block, else youAsked', () => {
    expect(digestNeedsLine(card({ narrative: { note: 'paused on the schema' } }))).toBe('paused on the schema')
    expect(digestNeedsLine(card({ fallbackSnippet: 'Should I use X or Y?' }))).toBe('Should I use X or Y?')
    expect(digestNeedsLine(card({ youAsked: 'the ask' }))).toBe('the ask')
  })
})

describe('compactDotClass', () => {
  it('attention → attn, open → live, else done', () => {
    expect(compactDotClass(card({ attention: { reason: 'blocked' } }))).toBe('duo-cu-dot-attn')
    expect(compactDotClass(card({ open: { kind: 'duo', windowId: 1, tabId: 't' } }))).toBe('duo-cu-dot-live')
    expect(compactDotClass(card())).toBe('duo-cu-dot-done')
  })
})

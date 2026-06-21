// Stage 19e ENH-088 — unit tests for the managed-CLAUDE.md merge logic.
//
// Pure-function tests against the exported helpers in install-service.ts.
// We intentionally do NOT exercise the I/O wrapper (mergeUserClaudeMd) —
// that requires the full Electron runtime (app.getVersion, fs.writeFile
// against a real ~/.claude/CLAUDE.md path) and is verified end-to-end via
// the smoke walk. The four PRD scenarios from
// docs/prd/stage-19e-user-context-onboarding.md § 4 are testable purely
// on planClaudeMdMerge; that's where the decision logic lives.
//
// Note: install-service.ts imports `electron`, which can't load in the
// `node` test environment. We work around this by importing the helpers
// from a path that uses vitest module mocking (vi.mock electron). Easier
// pattern: pull the pure helpers into a mocked import.

import { describe, it, expect, vi } from 'vitest'

// Electron isn't available in node test env. Mock it so the install-
// service module loads — we only touch the pure helpers, which don't
// reach into electron.app.
vi.mock('electron', () => ({
  app: {
    getVersion: () => '0.0.0-test',
    getAppPath: () => '/tmp'
  }
}))

import {
  composeManagedClaudeMdBlock,
  planClaudeMdMerge,
  planCliShim,
  planManagedHooksMerge
} from './install-service'

describe('composeManagedClaudeMdBlock', () => {
  it('renders an opening marker with the version, an h2 heading, prose, and a closing marker', () => {
    const block = composeManagedClaudeMdBlock('1.2.3')
    expect(block).toMatch(/^<!-- duo:managed-v1\.2\.3 — installed by Duo\./m)
    expect(block).toMatch(/## Duo workspace integration/)
    expect(block).toMatch(/<!-- duo:end -->\s*$/)
  })

  it('points at the duo skill, the duo subagent, and the sandbox-troubleshooting reference', () => {
    const block = composeManagedClaudeMdBlock('1.2.3')
    expect(block).toContain('~/.claude/skills/duo/SKILL.md')
    expect(block).toContain('subagent')
    expect(block).toContain('sandbox-troubleshooting.md')
  })

  it('also points at the enterprise-deployments reference for managed installs', () => {
    const block = composeManagedClaudeMdBlock('1.2.3')
    expect(block).toContain('enterprise-deployments.md')
  })

  it('tells the agent to batch approval requests on managed installs (auto-approve off)', () => {
    const block = composeManagedClaudeMdBlock('1.2.3')
    expect(block).toMatch(/auto-approve/i)
    expect(block).toMatch(/whole directory or repository/i)
  })

  it('tells the agent to stay scoped and not request unrelated apps\' data', () => {
    const block = composeManagedClaudeMdBlock('1.2.3')
    expect(block).toMatch(/unrelated applications' data/i)
    expect(block).toMatch(/Music library/i)
  })

  it('surfaces the version in the rendered body so a plain read post-install confirms which Duo wrote it', () => {
    const block = composeManagedClaudeMdBlock('1.2.3')
    // BUG-125 follow-up: the HTML-comment marker is invisible in
    // rendered markdown. Inspecting whether the latest install
    // landed should not require reading the source. The footer
    // line is the user-visible source of truth.
    expect(block).toMatch(/\*Auto-managed by Duo v1\.2\.3\./)
  })
})

describe('planClaudeMdMerge', () => {
  const newBlock = composeManagedClaudeMdBlock('0.6.6')

  describe('Scenario 1 — file does not exist', () => {
    it('creates the file with the block and a trailing newline; sets managed=true', () => {
      const result = planClaudeMdMerge({
        existing: null,
        priorManaged: false,
        newBlock
      })
      expect(result.action).toBe('created')
      expect(result.managed).toBe(true)
      expect(result.contents).toBe(newBlock + '\n')
    })

    it('creates even when priorManaged was previously true (e.g. user deleted the file entirely)', () => {
      const result = planClaudeMdMerge({
        existing: null,
        priorManaged: true,
        newBlock
      })
      expect(result.action).toBe('created')
      expect(result.contents).toBe(newBlock + '\n')
    })
  })

  describe('Scenario 2 — file has a duo:managed-v* marker', () => {
    it('replaces the block in place, preserving surrounding content', () => {
      const oldBlock = composeManagedClaudeMdBlock('0.6.0')
      const existing = `# My CLAUDE.md\n\nMy own notes here.\n\n${oldBlock}\n\n## My other section\n\nMore notes.\n`
      const result = planClaudeMdMerge({
        existing,
        priorManaged: true,
        newBlock
      })
      expect(result.action).toBe('replaced')
      expect(result.managed).toBe(true)
      expect(result.contents).toContain('# My CLAUDE.md')
      expect(result.contents).toContain('My own notes here.')
      expect(result.contents).toContain('## My other section')
      expect(result.contents).toContain('More notes.')
      expect(result.contents).toContain(newBlock)
      expect(result.contents).not.toContain('duo:managed-v0.6.0')
    })

    it('returns no-op-marker-unchanged when the marker block already matches the new block exactly', () => {
      const existing = `# Top\n\n${newBlock}\n\n## Bottom\n`
      const result = planClaudeMdMerge({
        existing,
        priorManaged: true,
        newBlock
      })
      expect(result.action).toBe('no-op-marker-unchanged')
      expect(result.managed).toBe(true)
      expect(result.contents).toBeNull()
    })

    it('replaces the marker block even when priorManaged is false (e.g. installed.json lost)', () => {
      const oldBlock = composeManagedClaudeMdBlock('0.5.0')
      const existing = `${oldBlock}\n\n# user notes\n`
      const result = planClaudeMdMerge({
        existing,
        priorManaged: false,
        newBlock
      })
      expect(result.action).toBe('replaced')
    })
  })

  describe('Scenario 3 — file exists, no marker, no prior managed flag', () => {
    it('appends the block on a new line, preserving the existing content', () => {
      const existing = '# Geoff\'s personal CLAUDE.md\n\nMy preferences and notes here.\n'
      const result = planClaudeMdMerge({
        existing,
        priorManaged: false,
        newBlock
      })
      expect(result.action).toBe('appended')
      expect(result.managed).toBe(true)
      expect(result.contents).toContain('# Geoff\'s personal CLAUDE.md')
      expect(result.contents).toContain('My preferences and notes here.')
      expect(result.contents!.indexOf(newBlock)).toBeGreaterThan(
        result.contents!.indexOf('My preferences')
      )
    })

    it('still appends cleanly when the existing file does not end in a newline', () => {
      const existing = 'no trailing newline'
      const result = planClaudeMdMerge({
        existing,
        priorManaged: false,
        newBlock
      })
      expect(result.action).toBe('appended')
      expect(result.contents!.startsWith('no trailing newline')).toBe(true)
      expect(result.contents).toContain(newBlock)
    })

    it('treats undefined-ish prior flag as not-managed (defensive)', () => {
      const existing = 'existing content\n'
      const result = planClaudeMdMerge({
        existing,
        // Defensive: callers could in principle pass an undefined-ish
        // value; the type system says boolean but runtime `false` works.
        priorManaged: false,
        newBlock
      })
      expect(result.action).toBe('appended')
    })
  })

  describe('Scenario 4 — file exists, no marker, prior managed === true (user removed the block)', () => {
    it('respects the removal — no rewrite, managed stays true', () => {
      const existing = '# My CLAUDE.md\n\nI removed the duo block on purpose.\n'
      const result = planClaudeMdMerge({
        existing,
        priorManaged: true,
        newBlock
      })
      expect(result.action).toBe('respected-removal')
      expect(result.managed).toBe(true)
      expect(result.contents).toBeNull()
    })

    it('does not respect-removal if the file has the marker (covers the user-edited-but-kept-block case)', () => {
      // User keeps the block but edits the prose inside. The marker
      // is still there; we should still version-replace it.
      const tampered = `<!-- duo:managed-v0.6.5 — installed by Duo. Edit freely; remove this block to opt out. -->\n## Custom heading\n\nUser-edited prose here.\n<!-- duo:end -->`
      const result = planClaudeMdMerge({
        existing: tampered,
        priorManaged: true,
        newBlock
      })
      expect(result.action).toBe('replaced')
    })
  })
})

// ENH-156 — pure-function tests for the SHIM_DIR/duo planner. The
// boot-time self-heal (ensureCliShim) wraps planCliShim with I/O; the
// decision matrix is what's worth testing in unit form.

describe('planCliShim', () => {
  const desired = '/Applications/Duo.app/Contents/Resources/cli/duo'

  it('missing shim → create', () => {
    expect(planCliShim({ kind: 'missing' }, desired)).toEqual({ kind: 'create' })
  })

  it('current symlink pointing at desired target → no-op', () => {
    expect(
      planCliShim({ kind: 'symlink', target: desired }, desired)
    ).toEqual({ kind: 'no-op' })
  })

  it('symlink pointing at a stale target → replace', () => {
    expect(
      planCliShim({ kind: 'symlink', target: '/old/path/duo' }, desired)
    ).toEqual({ kind: 'replace' })
  })

  it('broken symlink at any target → replace (even when target string matches)', () => {
    // The broken-symlink case always replaces — recreates so a moved
    // Duo.app gets a working link.
    expect(
      planCliShim({ kind: 'broken-symlink', target: desired }, desired)
    ).toEqual({ kind: 'replace' })
    expect(
      planCliShim({ kind: 'broken-symlink', target: '/old' }, desired)
    ).toEqual({ kind: 'replace' })
  })

  it('non-symlink file/dir at shim path → refuse-non-symlink', () => {
    // User wrote something there manually; we never overwrite.
    expect(planCliShim({ kind: 'non-symlink' }, desired)).toEqual({
      kind: 'refuse-non-symlink'
    })
  })
})

describe('planManagedHooksMerge (ENH-225 attention-hook settings.json merge)', () => {
  const SH = '$HOME/.claude/duo/hooks/duo-attention.sh'
  const SPECS = [
    { event: 'Stop', command: `${SH} set` },
    { event: 'Notification', command: `${SH} set` },
    { event: 'UserPromptSubmit', command: `${SH} clear` },
  ]
  // Read our marked entry out of a hooks[event] array.
  const duoEntries = (settings: any, event: string) =>
    (settings.hooks?.[event] ?? []).filter((e: any) => typeof e?._duo === 'string')
  const commandsFor = (settings: any, event: string) =>
    (settings.hooks?.[event] ?? []).flatMap((e: any) => (e.hooks ?? []).map((h: any) => h.command))

  it('adds a marked entry for each event on empty settings', () => {
    const out = planManagedHooksMerge({}, '1.2.3', SPECS)
    for (const { event, command } of SPECS) {
      const ours = duoEntries(out, event)
      expect(ours).toHaveLength(1)
      expect(ours[0]._duo).toBe('managed-v1.2.3')
      expect(ours[0].hooks[0]).toEqual({ type: 'command', command })
    }
  })

  it('is idempotent — running twice yields one entry per event, not duplicates', () => {
    const once = planManagedHooksMerge({}, '1.2.3', SPECS)
    const twice = planManagedHooksMerge(once, '1.2.3', SPECS)
    expect(twice).toEqual(once)
    for (const { event } of SPECS) expect(duoEntries(twice, event)).toHaveLength(1)
  })

  it('refreshes the version of a prior duo entry (no accumulation)', () => {
    const old = planManagedHooksMerge({}, '1.0.0', SPECS)
    const next = planManagedHooksMerge(old, '2.0.0', SPECS)
    for (const { event } of SPECS) {
      const ours = duoEntries(next, event)
      expect(ours).toHaveLength(1)
      expect(ours[0]._duo).toBe('managed-v2.0.0')
    }
  })

  it('preserves foreign (user-authored) hooks on the same event', () => {
    const userHook = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }
    const out: any = planManagedHooksMerge({ hooks: { Stop: [userHook] } }, '1.2.3', SPECS)
    expect(out.hooks.Stop).toHaveLength(2) // user's + ours
    expect(out.hooks.Stop[0]).toEqual(userHook)
    expect(duoEntries(out, 'Stop')).toHaveLength(1)
  })

  it('drops a pre-marker orphan with our exact command (no duplication)', () => {
    const orphan = { hooks: [{ type: 'command', command: `${SH} set` }] } // unmarked, our command
    const out: any = planManagedHooksMerge({ hooks: { Stop: [orphan] } }, '1.2.3', SPECS)
    expect(out.hooks.Stop).toHaveLength(1)
    expect(typeof out.hooks.Stop[0]._duo).toBe('string') // the fresh marked one
    expect(commandsFor(out, 'Stop')).toEqual([`${SH} set`])
  })

  it('preserves other settings keys and other hook events', () => {
    const input = { model: 'claude', hooks: { PreToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'guard' }] }] } }
    const out: any = planManagedHooksMerge(input, '1.2.3', SPECS)
    expect(out.model).toBe('claude')
    expect(out.hooks.PreToolUse).toEqual(input.hooks.PreToolUse) // untouched
    expect(duoEntries(out, 'Stop')).toHaveLength(1)
  })

  it('does not mutate the input settings', () => {
    const input = { hooks: { Stop: [] as unknown[] } }
    const snapshot = JSON.stringify(input)
    planManagedHooksMerge(input, '1.2.3', SPECS)
    expect(JSON.stringify(input)).toBe(snapshot)
  })

  it('tolerates a non-object / malformed settings input', () => {
    const out = planManagedHooksMerge(null as unknown as Record<string, unknown>, '1.2.3', SPECS)
    expect(duoEntries(out, 'Stop')).toHaveLength(1)
  })
})

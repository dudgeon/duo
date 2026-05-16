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
  planClaudeMdMerge
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

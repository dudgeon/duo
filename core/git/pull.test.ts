// ENH-253 — live git coverage for runPull. Hermetic: a throwaway bare
// "origin" + a real clone in os.tmpdir(), so `git fetch`/`git merge`
// exercise real remote-tracking behavior instead of mocks. This is a
// mutating git path (the reset --hard branch especially), so it gets a
// real shell-out test rather than being deferred to the smoke walk.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'child_process'
import * as os from 'os'
import * as fs from 'fs'
import * as path from 'path'
import { runPull } from './pull'

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString()
}

describe('runPull (live git)', () => {
  let origin = ''
  let clone = ''
  let nonRepo = ''

  beforeAll(() => {
    origin = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-pull-origin-'))
    clone = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-pull-clone-'))
    nonRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-pull-norepo-'))
    // Bare "remote" seeded via a scratch working copy, then cloned for real
    // (so the clone gets proper remote-tracking config, matching what a
    // user's checkout looks like).
    git(origin, 'init', '--bare', '-b', 'main')
    const seed = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-pull-seed-'))
    git(seed, 'init', '-b', 'main')
    git(seed, 'config', 'user.email', 'test@duo.local')
    git(seed, 'config', 'user.name', 'Duo Test')
    fs.writeFileSync(path.join(seed, 'README.md'), '# temp\n')
    git(seed, 'add', '.')
    git(seed, 'commit', '-m', 'init')
    git(seed, 'remote', 'add', 'origin', origin)
    git(seed, 'push', 'origin', 'main')
    fs.rmSync(seed, { recursive: true, force: true })

    execFileSync('git', ['clone', origin, clone], { stdio: 'pipe' })
    git(clone, 'config', 'user.email', 'test@duo.local')
    git(clone, 'config', 'user.name', 'Duo Test')
  })

  afterAll(() => {
    for (const d of [origin, clone, nonRepo]) {
      try {
        if (d) fs.rmSync(d, { recursive: true, force: true })
      } catch {
        /* best-effort */
      }
    }
  })

  it('fails cleanly outside a repo', async () => {
    const r = await runPull(nonRepo)
    expect(r.ok).toBe(false)
    expect(r.errorKind).toBe('not-a-repo')
  })

  it('reports no-upstream on a branch with no tracking configured', async () => {
    git(clone, 'checkout', '-b', 'untracked-branch')
    const r = await runPull(clone)
    expect(r.ok).toBe(false)
    expect(r.errorKind).toBe('no-upstream')
    git(clone, 'checkout', 'main')
    git(clone, 'branch', '-D', 'untracked-branch')
  })

  it('reports up-to-date when the clone already has everything', async () => {
    const r = await runPull(clone)
    expect(r.ok).toBe(true)
    expect(r.result).toBe('up-to-date')
    expect(r.commitsApplied).toBe(0)
  })

  it('fast-forwards a clean, behind-only checkout', async () => {
    // Advance origin's main from a second, independent clone (mirrors a
    // teammate pushing) so the test clone never commits locally here.
    const pusher = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-pull-pusher-'))
    execFileSync('git', ['clone', origin, pusher], { stdio: 'pipe' })
    git(pusher, 'config', 'user.email', 'test@duo.local')
    git(pusher, 'config', 'user.name', 'Duo Test')
    fs.writeFileSync(path.join(pusher, 'NEW.md'), 'new file\n')
    git(pusher, 'add', '.')
    git(pusher, 'commit', '-m', 'add NEW.md')
    git(pusher, 'push', 'origin', 'main')
    fs.rmSync(pusher, { recursive: true, force: true })

    const r = await runPull(clone)
    expect(r.ok).toBe(true)
    expect(r.result).toBe('fast-forwarded')
    expect(r.commitsApplied).toBe(1)
    expect(fs.existsSync(path.join(clone, 'NEW.md'))).toBe(true)
  })

  it('needs confirmation when the tree is dirty, then discards + pulls with force', async () => {
    // Advance origin again.
    const pusher = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-pull-pusher-'))
    execFileSync('git', ['clone', origin, pusher], { stdio: 'pipe' })
    git(pusher, 'config', 'user.email', 'test@duo.local')
    git(pusher, 'config', 'user.name', 'Duo Test')
    fs.writeFileSync(path.join(pusher, 'FROM-REMOTE.md'), 'from remote\n')
    git(pusher, 'add', '.')
    git(pusher, 'commit', '-m', 'add FROM-REMOTE.md')
    git(pusher, 'push', 'origin', 'main')
    fs.rmSync(pusher, { recursive: true, force: true })

    // Dirty the clone's working tree (uncommitted edit).
    fs.writeFileSync(path.join(clone, 'README.md'), 'locally edited, not committed\n')

    const preflight = await runPull(clone)
    expect(preflight.ok).toBe(false)
    expect(preflight.errorKind).toBe('needs-confirmation')
    expect(preflight.changedCount).toBe(1)
    expect(preflight.behindCount).toBe(1)
    // The dirty edit must still be on disk — nothing was touched yet.
    expect(fs.readFileSync(path.join(clone, 'README.md'), 'utf8')).toContain('locally edited')

    const forced = await runPull(clone, { force: true })
    expect(forced.ok).toBe(true)
    expect(forced.result).toBe('discarded-and-pulled')
    expect(fs.existsSync(path.join(clone, 'FROM-REMOTE.md'))).toBe(true)
    // The local edit is gone — replaced by the remote's version of README.md.
    expect(fs.readFileSync(path.join(clone, 'README.md'), 'utf8')).not.toContain('locally edited')
    expect(git(clone, 'status', '--porcelain').trim()).toBe('')
  })

  it('auto-merges a clean, diverged checkout when the changes do not overlap', async () => {
    // Local commit on a new file (ahead of origin).
    fs.writeFileSync(path.join(clone, 'LOCAL.md'), 'local commit\n')
    git(clone, 'add', '.')
    git(clone, 'commit', '-m', 'local commit')

    // Origin also advances, touching a DIFFERENT file — no overlap.
    const pusher = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-pull-pusher-'))
    execFileSync('git', ['clone', origin, pusher], { stdio: 'pipe' })
    git(pusher, 'config', 'user.email', 'test@duo.local')
    git(pusher, 'config', 'user.name', 'Duo Test')
    fs.writeFileSync(path.join(pusher, 'REMOTE2.md'), 'remote commit\n')
    git(pusher, 'add', '.')
    git(pusher, 'commit', '-m', 'remote commit')
    git(pusher, 'push', 'origin', 'main')
    fs.rmSync(pusher, { recursive: true, force: true })

    const r = await runPull(clone)
    expect(r.ok).toBe(true)
    expect(r.result).toBe('merged')
    expect(fs.existsSync(path.join(clone, 'LOCAL.md'))).toBe(true)
    expect(fs.existsSync(path.join(clone, 'REMOTE2.md'))).toBe(true)
    expect(git(clone, 'status', '--porcelain').trim()).toBe('')
  })

  it('aborts cleanly on a genuine merge conflict, leaving no conflict markers', async () => {
    // Local commit editing README.md.
    fs.writeFileSync(path.join(clone, 'README.md'), 'local version\n')
    git(clone, 'add', '.')
    git(clone, 'commit', '-m', 'local README edit')
    const headBefore = git(clone, 'rev-parse', 'HEAD').trim()

    // Origin ALSO edits README.md, on the same line — a real conflict.
    const pusher = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-pull-pusher-'))
    execFileSync('git', ['clone', origin, pusher], { stdio: 'pipe' })
    git(pusher, 'config', 'user.email', 'test@duo.local')
    git(pusher, 'config', 'user.name', 'Duo Test')
    fs.writeFileSync(path.join(pusher, 'README.md'), 'remote version\n')
    git(pusher, 'add', '.')
    git(pusher, 'commit', '-m', 'remote README edit')
    git(pusher, 'push', 'origin', 'main')
    fs.rmSync(pusher, { recursive: true, force: true })

    const r = await runPull(clone)
    expect(r.ok).toBe(false)
    expect(r.errorKind).toBe('merge-conflict')
    // No leftover merge-in-progress state, no conflict markers, HEAD unmoved.
    expect(fs.existsSync(path.join(clone, '.git', 'MERGE_HEAD'))).toBe(false)
    expect(git(clone, 'status', '--porcelain').trim()).toBe('')
    expect(git(clone, 'rev-parse', 'HEAD').trim()).toBe(headBefore)
  })

  // ── ENH-253 review fixes ────────────────────────────────────────────────

  /** Reset the shared clone to exactly origin/main (clean tracked tree,
   *  no untracked files) so review-fix tests don't inherit prior state. */
  function resetCloneToOrigin() {
    git(clone, 'fetch')
    git(clone, 'reset', '--hard', 'origin/main')
    git(clone, 'clean', '-fd')
  }

  /** Push a new file to origin from a scratch clone (a teammate's push). */
  function advanceOrigin(name: string, content = 'from remote\n') {
    const pusher = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-pull-pusher-'))
    execFileSync('git', ['clone', origin, pusher], { stdio: 'pipe' })
    git(pusher, 'config', 'user.email', 'test@duo.local')
    git(pusher, 'config', 'user.name', 'Duo Test')
    fs.writeFileSync(path.join(pusher, name), content)
    git(pusher, 'add', '.')
    git(pusher, 'commit', '-m', `add ${name}`)
    git(pusher, 'push', 'origin', 'main')
    fs.rmSync(pusher, { recursive: true, force: true })
  }

  it('fast-forwards straight through an untracked-only tree (no needs-confirmation)', async () => {
    resetCloneToOrigin()
    advanceOrigin('UNTRACKED-FF.md')
    // Untracked file only — a hard reset wouldn't remove it, so it must NOT
    // count as "changes pulling would discard".
    fs.writeFileSync(path.join(clone, 'scratch-notes.md'), 'untracked scratch\n')

    const r = await runPull(clone)
    expect(r.ok).toBe(true)
    expect(r.result).toBe('fast-forwarded')
    expect(fs.existsSync(path.join(clone, 'UNTRACKED-FF.md'))).toBe(true)
    // The untracked file survived, untouched.
    expect(fs.readFileSync(path.join(clone, 'scratch-notes.md'), 'utf8')).toContain('untracked scratch')
    fs.rmSync(path.join(clone, 'scratch-notes.md'))
  })

  it('fails CLOSED (pull-failed, not clean/up-to-date) when git status itself fails', async () => {
    resetCloneToOrigin()
    advanceOrigin('STATUS-FAIL.md')
    // Corrupt the index so `git status --porcelain` errors out. behind > 0,
    // so the working-tree probe runs — and its failure must be a pull-failed,
    // never silently treated as "clean tree, go ahead and mutate".
    const indexPath = path.join(clone, '.git', 'index')
    const indexBackup = fs.readFileSync(indexPath)
    fs.writeFileSync(indexPath, 'garbage — not a git index')
    try {
      const r = await runPull(clone)
      expect(r.ok).toBe(false)
      expect(r.errorKind).toBe('pull-failed')
      expect(r.result).toBeUndefined()
      expect(r.error).toBeTruthy()
    } finally {
      fs.writeFileSync(indexPath, indexBackup)
    }
  })

  it('reports a non-conflict merge failure as pull-failed with the real stderr', async () => {
    resetCloneToOrigin()
    // Diverge: local commit on LOCAL-DIVERGE.md, remote commit adding
    // COLLIDE.md — and an UNTRACKED local COLLIDE.md in the way. The merge
    // fails with "untracked working tree files would be overwritten", which
    // is NOT a content conflict and must surface git's own words.
    fs.writeFileSync(path.join(clone, 'LOCAL-DIVERGE.md'), 'local\n')
    git(clone, 'add', 'LOCAL-DIVERGE.md')
    git(clone, 'commit', '-m', 'local diverge')
    advanceOrigin('COLLIDE.md')
    fs.writeFileSync(path.join(clone, 'COLLIDE.md'), 'untracked local collision\n')

    const r = await runPull(clone)
    expect(r.ok).toBe(false)
    expect(r.errorKind).toBe('pull-failed')
    expect(r.error).toMatch(/untracked|overwritten/i)
    // The untracked file was not touched.
    expect(fs.readFileSync(path.join(clone, 'COLLIDE.md'), 'utf8')).toContain('untracked local collision')
    fs.rmSync(path.join(clone, 'COLLIDE.md'))
  })

  it('refuses a force with stale expected counts (fresh needs-confirmation)', async () => {
    resetCloneToOrigin()
    advanceOrigin('TOCTOU.md')
    // Two tracked files modified — but the caller consented to only one.
    fs.writeFileSync(path.join(clone, 'README.md'), 'edit one\n')
    fs.writeFileSync(path.join(clone, 'NEW.md'), 'edit two\n')

    const r = await runPull(clone, { force: true, expected: { changedCount: 1, aheadCount: 0 } })
    expect(r.ok).toBe(false)
    expect(r.errorKind).toBe('needs-confirmation')
    expect(r.changedCount).toBe(2)
    // Nothing was discarded.
    expect(fs.readFileSync(path.join(clone, 'README.md'), 'utf8')).toContain('edit one')

    // Consenting to the real counts goes through.
    const forced = await runPull(clone, { force: true, expected: { changedCount: 2, aheadCount: 0 } })
    expect(forced.ok).toBe(true)
    expect(forced.result).toBe('discarded-and-pulled')
    expect(fs.existsSync(path.join(clone, 'TOCTOU.md'))).toBe(true)
  })
})

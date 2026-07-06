// ENH-244 — rollupMarkdownTable: "Copy as Markdown" for the Rollups tab.
// Exercises the real `git` binary (init + remote + commit fixtures) since
// this is exactly the code path the GUI button and `duo rollup markdown`
// hit — a mocked child_process would just re-assert the mock.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { initVault } from './scaffold'
import { createRollupNote } from './builder'
import { rollupMarkdownTable } from './rollup-markdown'

let root: string
let v: string
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-rollup-md-'))
  v = initVault(path.join(root, 'v')).root
})
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

function write(rel: string, content: string): void {
  const abs = path.join(v, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
}

function task(rel: string, fm: string): void {
  write(rel, `---\ntype: task\n${fm}\n---\n\nbody\n`)
}

function git(...args: string[]): void {
  execFileSync('git', args, { cwd: v, stdio: 'pipe' })
}

function initGitRepo(remote?: string): void {
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  if (remote) git('remote', 'add', 'origin', remote)
  git('add', '-A')
  git('commit', '-q', '-m', 'init')
}

describe('rollupMarkdownTable — no git repo (fallback: vault-relative links)', () => {
  it('renders a GFM table with ./<vault-relative-path> links', async () => {
    task('tasks/a.md', 'status: open\norg: platform\nowner: geoff')
    task('tasks/b.md', 'status: done\norg: growth\nowner: sam')
    const { noteRel } = createRollupNote(v, {
      title: 'All tasks',
      types: ['task'],
      groupBy: ['status'],
      buckets: [],
      filters: [],
      columns: ['owner'],
    })
    const { markdown, error } = await rollupMarkdownTable(v, noteRel)
    expect(error).toBeNull()
    expect(markdown).toContain('## All tasks')
    expect(markdown).toContain('| status | Title | owner |')
    expect(markdown).toContain('[a](./tasks/a.md)')
    expect(markdown).toContain('[b](./tasks/b.md)')
    expect(markdown).toContain('| open |')
    expect(markdown).toContain('| geoff |')
  })

  it('empty result set renders a header + no-match note, not an empty table', async () => {
    task('tasks/a.md', 'status: open')
    const { noteRel } = createRollupNote(v, {
      title: 'Nothing',
      types: ['task'],
      groupBy: [],
      buckets: [],
      filters: [{ property: 'status', op: 'eq', value: 'archived' }],
      columns: [],
    })
    const { markdown, error } = await rollupMarkdownTable(v, noteRel)
    expect(error).toBeNull()
    expect(markdown).toContain('## Nothing')
    expect(markdown).toMatch(/No entities match/)
    expect(markdown).not.toContain('| ---')
  })

  it('surfaces the doctor-path error for a broken rollup instead of throwing', async () => {
    write('rollups/broken.md', '---\ntype: rollup\ntitle: Broken\n---\n\n```base\nfilters: [unclosed\n```\n')
    const { markdown, error } = await rollupMarkdownTable(v, 'rollups/broken.md')
    expect(markdown).toBeNull()
    expect(error).toMatch(/YAML/)
  })

  it('escapes pipe characters and brackets in cell values', async () => {
    task('tasks/pipe.md', 'status: open|weird\nowner: "a[b]c"')
    const { noteRel } = createRollupNote(v, {
      title: 'Weird',
      types: ['task'],
      groupBy: ['status'],
      buckets: [],
      filters: [],
      columns: ['owner'],
    })
    const { markdown } = await rollupMarkdownTable(v, noteRel)
    // The raw pipe must not have created a spurious extra column.
    expect(markdown).toContain('open\\|weird')
  })
})

describe('rollupMarkdownTable — GitHub remote (blob links)', () => {
  it('links titles to the GitHub blob URL using the vault-root repo + current branch', async () => {
    task('tasks/a.md', 'status: open\nowner: geoff')
    initGitRepo('git@github.com:dudgeon/duo-fixture.git')
    const { noteRel } = createRollupNote(v, {
      title: 'Open tasks',
      types: ['task'],
      groupBy: [],
      buckets: [],
      filters: [],
      columns: ['owner'],
    })
    const { markdown, error } = await rollupMarkdownTable(v, noteRel)
    expect(error).toBeNull()
    expect(markdown).toContain('https://github.com/dudgeon/duo-fixture/blob/main/tasks/a.md')
    expect(markdown).not.toContain('](./tasks/a.md)')
  })

  it('resolves links relative to the REPO root, not the vault root, when the vault is a subfolder', async () => {
    // Re-root: git lives one level above the vault.
    fs.rmSync(v, { recursive: true, force: true })
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-repo-'))
    const nestedVault = initVault(path.join(repoRoot, 'knowledge')).root
    fs.mkdirSync(path.join(nestedVault, 'tasks'), { recursive: true })
    fs.writeFileSync(
      path.join(nestedVault, 'tasks', 'a.md'),
      '---\ntype: task\nstatus: open\n---\n\nbody\n',
    )
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repoRoot })
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoRoot })
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repoRoot })
    execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/dudgeon/duo-fixture.git'], {
      cwd: repoRoot,
    })
    execFileSync('git', ['add', '-A'], { cwd: repoRoot })
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: repoRoot })

    const { noteRel } = createRollupNote(nestedVault, {
      title: 'Open tasks',
      types: ['task'],
      groupBy: [],
      buckets: [],
      filters: [],
      columns: [],
    })
    const { markdown } = await rollupMarkdownTable(nestedVault, noteRel)
    expect(markdown).toContain('https://github.com/dudgeon/duo-fixture/blob/main/knowledge/tasks/a.md')
    fs.rmSync(repoRoot, { recursive: true, force: true })
  })

  it('falls back to vault-relative links when the remote is not a GitHub host', async () => {
    task('tasks/a.md', 'status: open')
    initGitRepo('https://gitlab.com/dudgeon/duo-fixture.git')
    const { noteRel } = createRollupNote(v, {
      title: 'Open tasks',
      types: ['task'],
      groupBy: [],
      buckets: [],
      filters: [],
      columns: [],
    })
    const { markdown } = await rollupMarkdownTable(v, noteRel)
    expect(markdown).toContain('[a](./tasks/a.md)')
    expect(markdown).not.toContain('gitlab.com')
  })

  it('falls back to vault-relative links when the repo has no remote configured', async () => {
    task('tasks/a.md', 'status: open')
    initGitRepo()
    const { noteRel } = createRollupNote(v, {
      title: 'Open tasks',
      types: ['task'],
      groupBy: [],
      buckets: [],
      filters: [],
      columns: [],
    })
    const { markdown } = await rollupMarkdownTable(v, noteRel)
    expect(markdown).toContain('[a](./tasks/a.md)')
  })
})

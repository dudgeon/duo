// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { findVaultRootWithDefault, normalizeWikilinkName } from './wikilinkResolver'

describe('normalizeWikilinkName', () => {
  it('lowercases', () => {
    expect(normalizeWikilinkName('Other Note')).toBe('other note')
    expect(normalizeWikilinkName('OTHER NOTE')).toBe('other note')
  })

  it('treats hyphen and underscore as space', () => {
    expect(normalizeWikilinkName('other-note')).toBe('other note')
    expect(normalizeWikilinkName('other_note')).toBe('other note')
    expect(normalizeWikilinkName('multi-word-name')).toBe('multi word name')
  })

  it('collapses whitespace runs', () => {
    expect(normalizeWikilinkName('Other  Note')).toBe('other note')
    expect(normalizeWikilinkName('Other\tNote')).toBe('other note')
  })

  it('trims', () => {
    expect(normalizeWikilinkName('  Other Note  ')).toBe('other note')
  })

  it('matches across the smoke-walk scenario', () => {
    // Walk v0.6.8: user typed [[Other Note]], file was other-note.md
    // — must collapse to identical normalized form.
    expect(normalizeWikilinkName('Other Note')).toBe(normalizeWikilinkName('other-note'))
  })

  it('preserves cross-form distinctness when intended', () => {
    // Different words still distinguish.
    expect(normalizeWikilinkName('Other Note')).not.toBe(normalizeWikilinkName('OtherNote'))
    expect(normalizeWikilinkName('foo bar')).not.toBe(normalizeWikilinkName('foobar'))
  })

  it('handles already-normalized input idempotently', () => {
    const norm = normalizeWikilinkName('other note')
    expect(normalizeWikilinkName(norm)).toBe(norm)
  })

  it('handles empty + whitespace-only input', () => {
    expect(normalizeWikilinkName('')).toBe('')
    expect(normalizeWikilinkName('   ')).toBe('')
    expect(normalizeWikilinkName('\t\n')).toBe('')
  })
})

describe('findVaultRootWithDefault — default-vault fallback (BUG-212)', () => {
  // `findVaultRootAndMode` walks up via `window.electron.vault.detect`, and the
  // fallback reads `window.electron.vault.getDefault`. Stub both per test.
  const stubElectron = (opts: {
    detect: (dir: string) => 'okf' | 'obsidian' | null
    defaultVault?: string | null
  }) => {
    ;(globalThis as unknown as { window: { electron: unknown } }).window.electron = {
      vault: {
        detect: vi.fn(({ vaultRoot }: { vaultRoot: string }) =>
          Promise.resolve(opts.detect(vaultRoot)),
        ),
        getDefault: vi.fn(() =>
          Promise.resolve({ defaultVault: opts.defaultVault ?? null, knownVaults: [] }),
        ),
      },
    }
  }

  afterEach(() => {
    delete (globalThis as unknown as { window: { electron?: unknown } }).window.electron
  })

  it('returns the active file’s ENCLOSING vault first (default is not consulted)', async () => {
    const getDefault = vi.fn(() =>
      Promise.resolve({ defaultVault: '/other/default', knownVaults: [] }),
    )
    ;(globalThis as unknown as { window: { electron: unknown } }).window.electron = {
      vault: {
        detect: vi.fn(({ vaultRoot }: { vaultRoot: string }) =>
          Promise.resolve(vaultRoot === '/vaultA' ? 'okf' : null),
        ),
        getDefault,
      },
    }
    const res = await findVaultRootWithDefault('/vaultA/notes/foo.md')
    expect(res).toEqual({ root: '/vaultA', mode: 'okf' })
    expect(getDefault).not.toHaveBeenCalled()
  })

  it('falls back to the DEFAULT vault when the file is in an arbitrary folder', async () => {
    stubElectron({
      // Walk-up finds no vault; only the default path detects as a vault.
      detect: (dir) => (dir === '/home/me/myvault' ? 'obsidian' : null),
      defaultVault: '/home/me/myvault',
    })
    const res = await findVaultRootWithDefault('/home/me/random/scratch.md')
    expect(res).toEqual({ root: '/home/me/myvault', mode: 'obsidian' })
  })

  it('returns null when no enclosing vault AND no default set', async () => {
    stubElectron({ detect: () => null, defaultVault: null })
    expect(await findVaultRootWithDefault('/home/me/random/scratch.md')).toBeNull()
  })

  it('returns null for a null active path with no default', async () => {
    stubElectron({ detect: () => null, defaultVault: null })
    expect(await findVaultRootWithDefault(null)).toBeNull()
  })

  it('uses the default even when the active path is null (no file open)', async () => {
    stubElectron({
      detect: (dir) => (dir === '/home/me/myvault' ? 'okf' : null),
      defaultVault: '/home/me/myvault',
    })
    expect(await findVaultRootWithDefault(null)).toEqual({
      root: '/home/me/myvault',
      mode: 'okf',
    })
  })
})

// @vitest-environment jsdom
// BUG-254 — regression coverage for the silent-stub type-picker race: a
// fast Enter/Tab landing before `window.electron.vault.types()` resolves
// used to be silently dropped, leaving the popover open to capture every
// subsequent keystroke as a type filter (garbage/wrong type, wrong folder —
// live-reproduced via computer-use: `notes/2026/07/X.md` with
// `type: meeting notes for q3` instead of `initiatives/X/X.md` with
// `type: initiative`). These tests pin the fix: an Enter/Tab that lands
// before the registry loads is QUEUED and fires the instant it does,
// against whatever's current at that moment (not a stale pre-load
// snapshot). Also covers the "+ new type" folder-residue hint (H2).

import { describe, it, expect, afterEach, vi } from 'vitest'
import { act, render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { TypePickerPopover } from './TypePickerPopover'

type TypesResult = { ok: true; types: string[] } | { ok: false; error: string }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function stubElectron(typesResult: Promise<TypesResult>) {
  const stub = vi.fn(async () => ({
    ok: true as const,
    path: 'initiatives/Foo/Foo.md',
    absPath: '/vault/initiatives/Foo/Foo.md',
    type: 'initiative',
    created: true,
  }))
  const createType = vi.fn(async (opts: { type: string }) => ({
    ok: true as const,
    path: `templates/${opts.type}.md`,
    type: opts.type,
  }))
  ;(globalThis as unknown as { window: { electron: unknown } }).window.electron = {
    vault: {
      types: vi.fn(() => typesResult),
      stub,
      createType,
    },
  }
  return { stub, createType }
}

afterEach(() => {
  cleanup()
  delete (globalThis as unknown as { window: { electron?: unknown } }).window.electron
})

describe('TypePickerPopover — BUG-254', () => {
  it('queues an Enter pressed before the registry loads and fires it once ready, instead of dropping it', async () => {
    const loading = deferred<TypesResult>()
    const { stub } = stubElectron(loading.promise)
    const onCreated = vi.fn()

    render(
      <TypePickerPopover
        vaultRoot="/vault"
        name="TestInitiative"
        anchorRect={null}
        onCreated={onCreated}
        onCancel={vi.fn()}
      />
    )

    const input = screen.getByLabelText('Filter types')
    // Fires while `types` is still null — must not be silently dropped.
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(stub).not.toHaveBeenCalled()

    await act(async () => {
      loading.resolve({ ok: true, types: ['initiative', 'meeting'] })
      await loading.promise
    })

    await waitFor(() =>
      expect(stub).toHaveBeenCalledWith({ vaultRoot: '/vault', type: 'initiative', name: 'TestInitiative' })
    )
    expect(onCreated).toHaveBeenCalled()
  })

  it('resolves the queued confirm against filter text typed WHILE still loading, not a stale pre-load snapshot', async () => {
    const loading = deferred<TypesResult>()
    const { stub } = stubElectron(loading.promise)

    render(
      <TypePickerPopover
        vaultRoot="/vault"
        name="TestMeeting"
        anchorRect={null}
        onCreated={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    const input = screen.getByLabelText('Filter types')
    fireEvent.keyDown(input, { key: 'Enter' }) // queued — types still null
    fireEvent.change(input, { target: { value: 'meet' } }) // typed before load finished

    await act(async () => {
      loading.resolve({ ok: true, types: ['initiative', 'meeting', 'milestone'] })
      await loading.promise
    })

    // Must land on "meeting" (the filtered choice current when the queued
    // confirm fires), not "initiative" (index 0 with an empty filter) —
    // proves the fix reads fresh state, not a snapshot from keypress time.
    await waitFor(() =>
      expect(stub).toHaveBeenCalledWith({ vaultRoot: '/vault', type: 'meeting', name: 'TestMeeting' })
    )
  })

  it('still picks immediately when the registry is already loaded (happy path unchanged)', async () => {
    const { stub } = stubElectron(Promise.resolve({ ok: true, types: ['initiative', 'meeting'] }))
    render(
      <TypePickerPopover
        vaultRoot="/vault"
        name="Direct"
        anchorRect={null}
        onCreated={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    // Wait for the registry to render before pressing Enter.
    await screen.findByRole('option', { name: 'initiative' })

    fireEvent.keyDown(screen.getByLabelText('Filter types'), { key: 'Enter' })

    await waitFor(() =>
      expect(stub).toHaveBeenCalledWith({ vaultRoot: '/vault', type: 'initiative', name: 'Direct' })
    )
  })

  it('warns that a brand-new type has no folder yet (H2), only while a "+ new type" row is offered', async () => {
    stubElectron(Promise.resolve({ ok: true, types: ['initiative'] }))
    render(
      <TypePickerPopover
        vaultRoot="/vault"
        name="Whatever"
        anchorRect={null}
        onCreated={vi.fn()}
        onCancel={vi.fn()}
      />
    )
    await screen.findByRole('option', { name: 'initiative' })

    const input = screen.getByLabelText('Filter types')
    const hint = /New types start without a folder/

    // An exact existing-type match offers no "+ new type" row — no hint.
    fireEvent.change(input, { target: { value: 'initiative' } })
    expect(screen.queryByText(hint)).toBeNull()

    // A filter matching no known type offers "+ new type" — hint must show.
    fireEvent.change(input, { target: { value: 'brand-new-type' } })
    expect(screen.getByText(hint)).toBeTruthy()
  })
})

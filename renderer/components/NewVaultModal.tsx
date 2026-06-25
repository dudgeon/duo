// ENH-216 (OKF VAULT MODE) — File → New Vault… modal.
//
// Pure-UI complement to the `duo vault init <path> --format=…` CLI surface.
// The IPC layer (`window.electron.vault.{create, pickDir}`) is pre-wired
// (Stage 2/3); this component just composes the inputs + result display
// around it. Structurally cloned from CloneModal.tsx (the canonical
// DOM-overlay modal pattern: window keydown Escape/Enter, busy/result/error
// panels, Atelier tokens, backdrop-click dismiss).
//
// Two on-disk serializers, ONE graph model (§0 of the OKF PRD). The picker
// chooses which serializer the new vault uses at rest:
//   - OKF bundle (D2 default): standard markdown + relative links —
//     [Alice](./people/alice.md) — renders on GitHub, opens in Obsidian.
//   - Obsidian vault: [[wikilinks]] + .obsidian/ — max plugin compat,
//     links survive moves for free.
// The choice is stamped into the vault marker at creation; the active vault
// then sets the editor's link dialect (detected via vault.detect, U7/App).

import { useEffect, useRef, useState } from 'react'
import type { VaultFormat } from '@shared/types'

interface NewVaultModalProps {
  open: boolean
  onClose: () => void
  /** Called on a successful create with the new vault root and the
   *  suggested artifact to open (the OKF index.md / Obsidian entry note).
   *  Parent (App.tsx, U7) decides whether to navigate the tree + open the
   *  file. */
  onCreated: (root: string, openPath?: string) => void
}

/** Type for one Format radio option. */
interface FormatOption {
  value: VaultFormat
  title: string
  /** Short prose under the title. */
  subcopy: string
  /** On-disk preview lines (monospace) — what links + markers look like. */
  preview: string[]
}

// D2 — OKF is PRE-SELECTED. Order matters: the first entry is the default.
const FORMAT_OPTIONS: FormatOption[] = [
  {
    value: 'okf',
    title: 'OKF bundle',
    subcopy:
      'Standard markdown + relative links. Renders on GitHub, opens in any editor and in Obsidian. Best for shareable / published KBs.',
    preview: ['[Alice](./people/alice.md)', 'index.md']
  },
  {
    value: 'obsidian',
    title: 'Obsidian vault',
    subcopy:
      '[[wikilinks]] + .obsidian/. Max Obsidian-plugin compat; links survive moves for free. Best for a private, Obsidian-first vault.',
    preview: ['[[Alice]]', '.obsidian/']
  }
]

type CreateResult =
  | { ok: true; root: string; created?: string[]; warnings?: string[]; openPath?: string }
  | { ok: false; error: string }

export function NewVaultModal({ open, onClose, onCreated }: NewVaultModalProps) {
  const [folder, setFolder] = useState('')
  const [name, setName] = useState('')
  // D2 — OKF pre-selected on every open-transition.
  const [format, setFormat] = useState<VaultFormat>('okf')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<CreateResult | null>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  // Reset state on the open-transition (false → true) ONLY — same scoping
  // discipline as CloneModal (don't nuke the success panel on unrelated
  // re-renders). Focus the Name field once mount completes.
  useEffect(() => {
    if (!open) return
    setFolder('')
    setName('')
    setFormat('okf')
    setResult(null)
    setBusy(false)
    const h = setTimeout(() => nameInputRef.current?.focus(), 0)
    return () => clearTimeout(h)
  }, [open])

  // Close on Escape, submit on Enter (when not busy + a folder is chosen).
  // Window-level listener so the gesture works regardless of focus — and
  // is the global-keystroke escape this modal owns (cleaned up on unmount /
  // close). Enter is guarded against firing while focus is in a textarea-
  // shaped field; there are none here, so a plain Enter submits.
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault()
        onClose()
      } else if (e.key === 'Enter' && !busy && !result?.ok) {
        // Only submit when the form is still actionable (folder chosen).
        if (folder.trim()) {
          e.preventDefault()
          void handleCreate()
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // handleCreate / folder / format read fresh on each keydown via the
    // closure rebuilt by these deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, busy, folder, format, name, result, onClose])

  if (!open) return null

  const canCreate = !busy && !!folder.trim()

  const handlePickDir = async () => {
    if (busy) return
    try {
      const chosen = await window.electron.vault.pickDir()
      if (chosen) setFolder(chosen)
    } catch {
      // Picker cancel / failure is non-fatal — leave the current folder.
    }
  }

  const handleCreate = async () => {
    if (!canCreate) return
    setBusy(true)
    setResult(null)
    try {
      // Expand ~ to the user's home so we ship an absolute path to main
      // (the native picker already returns absolute, but a hand-typed ~
      // path should still resolve). Mirrors CloneModal's HOME getter.
      const home = window.electron.env?.HOME ?? '/tmp'
      const expanded = folder.trim().replace(/^~/, home)
      const res = await window.electron.vault.create({
        folder: expanded,
        name: name.trim() || undefined,
        format
      })
      setResult(res)
      if (res.ok) {
        // ENH-228 — vault.create makes the new vault the default; broadcast so
        // App's present-when-default Vault tab appears immediately (without a
        // restart) and any open VaultView re-points.
        window.dispatchEvent(new CustomEvent('duo-vault-default-changed', { detail: { defaultVault: res.root } }))
        onCreated(res.root, res.openPath)
      }
    } catch (err) {
      setResult({
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => {
        // Click outside the modal body dismisses (when not busy).
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div
        className="bg-surface-0 border border-border rounded-lg shadow-xl w-[480px] max-w-[90vw] p-5 text-ink"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-ink">New Vault</h2>
          <button
            type="button"
            className="text-ink-mute hover:text-ink"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Location — read-only path + Choose… button (native dir picker). */}
        <label className="block text-xs text-ink-mute mb-1" htmlFor="newvault-location">
          Location
        </label>
        <div className="flex gap-2 mb-3">
          <input
            id="newvault-location"
            type="text"
            value={folder}
            readOnly
            placeholder="Choose a folder for the new vault…"
            disabled={busy}
            className="flex-1 min-w-0 px-2 py-1 bg-paper-deep border border-border rounded text-sm font-mono text-ink placeholder-ink-ghost focus:outline-accent"
          />
          <button
            type="button"
            onClick={() => void handlePickDir()}
            disabled={busy}
            className="px-3 py-1 text-sm border border-border rounded text-ink hover:bg-accent/10 disabled:opacity-50 whitespace-nowrap"
          >
            Choose…
          </button>
        </div>

        {/* Name — optional human vault name. */}
        <label className="block text-xs text-ink-mute mb-1" htmlFor="newvault-name">
          Name
        </label>
        <input
          id="newvault-name"
          ref={nameInputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Vault"
          disabled={busy}
          className="w-full px-2 py-1 mb-3 bg-paper-deep border border-border rounded text-sm text-ink placeholder-ink-ghost focus:outline-accent"
        />

        {/* Format — radio with TWO options; OKF pre-selected (D2). */}
        <div className="block text-xs text-ink-mute mb-1">Format</div>
        <div className="grid grid-cols-1 gap-2 mb-3">
          {FORMAT_OPTIONS.map((opt) => {
            const selected = format === opt.value
            return (
              <label
                key={opt.value}
                className={[
                  'block border rounded p-3 cursor-pointer transition-colors',
                  selected
                    ? 'border-accent bg-accent/10'
                    : 'border-border bg-paper-deep hover:border-ink-ghost'
                ].join(' ')}
              >
                <div className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="newvault-format"
                    value={opt.value}
                    checked={selected}
                    onChange={() => setFormat(opt.value)}
                    disabled={busy}
                    className="mt-1 accent-accent"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-ink">{opt.title}</span>
                      {opt.value === 'okf' && (
                        <span className="text-[10px] uppercase font-bold tracking-wide px-1.5 py-0.5 rounded bg-accent/15 text-accent">
                          Default
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-ink-mute mt-1 leading-relaxed">
                      {opt.subcopy}
                    </div>
                    <div className="mt-1.5 px-2 py-1 rounded bg-paper text-[11px] font-mono text-ink-soft leading-relaxed">
                      {opt.preview.map((line, i) => (
                        <div key={i} className="break-all">
                          {line}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </label>
            )
          })}
        </div>

        {busy && (
          // In-progress panel — same surface area the success panel
          // occupies, so the transition reads as "panel updates" rather
          // than "label flicker" (CloneModal walk-rev3 lesson).
          <div className="mb-3 px-4 py-3 rounded bg-paper-deep border border-paper-rule">
            <div className="flex items-center gap-3">
              <span className="text-accent" aria-hidden="true">
                <svg
                  className="animate-spin h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                  <path
                    d="M22 12a10 10 0 0 1-10 10"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-ink font-semibold text-sm">Creating vault…</div>
                <div className="text-ink-mute text-xs mt-0.5 font-mono break-all">{folder}</div>
              </div>
            </div>
          </div>
        )}

        {result && result.ok && (
          <div className="mb-3 px-4 py-3 rounded border duo-banner-ok">
            <div className="flex items-start gap-2">
              <span className="duo-text-ok text-base leading-none" aria-hidden="true">
                ✓
              </span>
              <div className="flex-1 min-w-0">
                <div className="duo-text-ok font-semibold text-sm">
                  Created {format === 'okf' ? 'OKF' : 'Obsidian'} vault
                </div>
                <div className="duo-text-ok text-xs mt-1 font-mono break-all">
                  {result.root}
                </div>
              </div>
            </div>
            {result.warnings && result.warnings.length > 0 && (
              <ul className="mt-2 ml-4 list-disc duo-text-ok text-xs space-y-0.5">
                {result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {result && !result.ok && (
          <div className="mb-3 px-3 py-2 rounded text-xs border duo-banner-error">
            <strong>Couldn't create the vault:</strong> {result.error || 'no detail'}
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1 text-sm border border-border rounded text-ink hover:bg-accent/10 disabled:opacity-50"
          >
            {result?.ok ? 'Done' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={!canCreate}
            className="px-3 py-1 text-sm bg-accent text-white rounded hover:bg-accent/90 disabled:opacity-50"
          >
            {busy ? 'Creating…' : result?.ok ? 'Create another' : 'Create Vault'}
          </button>
        </div>
      </div>
    </div>
  )
}

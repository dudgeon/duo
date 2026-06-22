// @vitest-environment jsdom
//
// Worksheet primitive — behavioral characterization tests.
//
// Locks in the contract that the current `generate.mjs` implementation
// provides today, BEFORE the Sprint 5 refactor onto playground
// primitives (ENH-092/093/094 → ENH-043). When the refactor lands, the
// inline `<script>` block disappears and is replaced by declarative
// `data-duo-action="state:save"` / `data-bind-class` / `compose:json`
// markup. These tests must keep passing — that's the proof the
// observable behavior didn't drift.
//
// What's tested (the contract):
// - Manifest validation (pure, doesn't need DOM)
// - State persistence (radios + textarea + misc → localStorage; round-trip)
// - Live tally + per-card class flip
// - Bulk operations (mark-all)
// - Clear-saved (resets form + wipes localStorage)
// - Composition (text format the user sees in clipboard / send-to-Claude)
// - Clipboard pathway
// - Send-to-Claude with window.duoSendResult fallback to clipboard
// - Per-step copy buttons (trailing-cmd detection)
// - Path-link wrapping
//
// Test harness: each test resets document.body, clears localStorage,
// renders a fresh worksheet, then dispatches DOM events. The inline
// `<script>` from the generated HTML is extracted and executed via
// `new Function()` in the current JSDOM context — JSDOM doesn't run
// inline scripts on innerHTML assignment by spec, so we drive
// execution explicitly. Same global window/document/localStorage.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
// @ts-expect-error — generate.mjs is plain ESM JS, no .d.ts; the typed
// import surface here is small enough that an explicit any is fine.
import { generateWorksheet } from './generate.mjs'

// --------------------------------------------------------------- fixtures

const SAMPLE_MANIFEST = {
  kind: 'smoke-walk',
  name: 'test-walk-v1',
  version: '0.6.6',
  date: '2026-05-04',
  title: 'Test smoke walk',
  controls: {
    primary: {
      kind: 'radio',
      name: 'result',
      options: [
        { value: 'PASS', label: 'Pass', color: '#4a7d3e' },
        { value: 'FAIL', label: 'Fail', color: '#b13e3a' },
        { value: 'SKIP', label: 'Skip', color: '#6f6557' }
      ]
    },
    secondary: {
      kind: 'textarea',
      name: 'notes',
      placeholder: 'Notes',
      rows: 2
    },
    mark_all: { label: 'Mark all Pass', value: 'PASS' }
  },
  result_format: {
    header_template: 'SMOKE WALK v{version} ({date})',
    summary_label: 'SUMMARY'
  },
  items: [
    { id: 'BUG-001', title: 'First item', steps: ['step a', 'step b'] },
    { id: 'BUG-002', title: 'Second item' },
    { id: 'BUG-003', title: 'Third item' }
  ],
  misc_notes: {
    title: 'Other notes',
    help: 'Free-form notes',
    result_block_title: 'OTHER NOTES'
  }
}

const MINIMAL_MANIFEST = {
  name: 'minimal-v1',
  controls: {
    primary: {
      kind: 'radio',
      name: 'result',
      options: [
        { value: 'YES', label: 'Yes' },
        { value: 'NO', label: 'No' }
      ]
    }
  },
  items: [
    { id: 'Q1', title: 'First question' }
  ]
}

// --------------------------------------------------------------- harness

interface RenderedWorksheet {
  scriptText: string
}

function renderWorksheet(manifest: object): RenderedWorksheet {
  const html = generateWorksheet(manifest)

  // Pull out the body's inner HTML (the script tag at the end is part
  // of body content).
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/)
  if (!bodyMatch) throw new Error('Generated HTML missing <body>')
  const bodyHtml = bodyMatch[1]

  // Split the trailing <script> off so we can run it explicitly. There
  // is exactly ONE script tag in the worksheet today; if that ever
  // changes, this regex needs updating.
  const scriptMatch = bodyHtml.match(/<script>([\s\S]*?)<\/script>/)
  if (!scriptMatch) throw new Error('Generated HTML missing inline <script>')
  const scriptText = scriptMatch[1]
  const bodyWithoutScript = bodyHtml.replace(/<script>[\s\S]*?<\/script>/, '')

  document.body.innerHTML = bodyWithoutScript

  // Run the inline script in the current JSDOM scope. The script
  // references document, window, localStorage, navigator, setTimeout —
  // all available on globalThis in a jsdom-environment vitest test.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function(scriptText)()

  return { scriptText }
}

function getRadio(itemId: string, value: string): HTMLInputElement {
  const sel = `section.item[data-id="${itemId}"] input[type=radio][value="${value}"]`
  const el = document.querySelector<HTMLInputElement>(sel)
  if (!el) throw new Error(`Radio not found: ${sel}`)
  return el
}

function getCard(itemId: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`section.item[data-id="${itemId}"]`)
  if (!el) throw new Error(`Card not found: ${itemId}`)
  return el
}

function getNotes(itemId: string): HTMLTextAreaElement {
  const el = document.querySelector<HTMLTextAreaElement>(
    `section.item[data-id="${itemId}"] textarea.notes`
  )
  if (!el) throw new Error(`Notes textarea not found: ${itemId}`)
  return el
}

function setRadio(itemId: string, value: string): void {
  const radio = getRadio(itemId, value)
  radio.checked = true
  radio.dispatchEvent(new Event('change', { bubbles: true }))
}

function setNotes(itemId: string, text: string): void {
  const ta = getNotes(itemId)
  ta.value = text
  ta.dispatchEvent(new Event('input', { bubbles: true }))
}

function flushSaveTimer(): void {
  // The script's `saveSoon` debounces via setTimeout(..., 250). Tests
  // that need state to land in localStorage must advance fake timers.
  vi.advanceTimersByTime(250)
}

// --------------------------------------------------------------- setup

let writeTextMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  document.body.innerHTML = ''
  localStorage.clear()

  // Clipboard mock — JSDOM doesn't ship navigator.clipboard. The
  // worksheet's copy paths await navigator.clipboard.writeText so we
  // need it to resolve.
  writeTextMock = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: writeTextMock },
    configurable: true,
    writable: true
  })

  // confirm() — JSDOM's default returns false. The clear-saved button
  // gates on confirm; tests that exercise it set this to true per-test.
  window.confirm = vi.fn(() => false)

  // Send-to-Claude binding — by default absent (clipboard fallback
  // path); tests that exercise the direct path install it.
  delete (window as unknown as { duoSendResult?: unknown }).duoSendResult
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// --------------------------------------------------------------- tests

describe('manifest validation', () => {
  it('throws when items is missing', () => {
    expect(() => generateWorksheet({ name: 'x', controls: { primary: {} } })).toThrow(/items/)
  })

  it('throws when primary control is missing', () => {
    expect(() => generateWorksheet({ name: 'x', items: [], controls: {} })).toThrow(/primary/)
  })

  it('throws when primary kind is not radio', () => {
    expect(() => generateWorksheet({
      name: 'x',
      items: [],
      controls: { primary: { kind: 'select', options: [{ value: 'a', label: 'A' }] } }
    })).toThrow(/radio/)
  })

  it('throws when options array is empty', () => {
    expect(() => generateWorksheet({
      name: 'x',
      items: [],
      controls: { primary: { kind: 'radio', name: 'r', options: [] } }
    })).toThrow(/non-empty/)
  })

  it('throws when an item is missing id or title', () => {
    expect(() => generateWorksheet({
      ...SAMPLE_MANIFEST,
      items: [{ id: 'OK', title: 'OK' }, { id: '', title: 'Bad' }]
    })).toThrow(/id\/title/)
  })

  it('throws when an option is missing value or label', () => {
    expect(() => generateWorksheet({
      ...SAMPLE_MANIFEST,
      controls: {
        ...SAMPLE_MANIFEST.controls,
        primary: {
          kind: 'radio',
          name: 'r',
          // @ts-expect-error — intentionally malformed
          options: [{ value: 'A' }]
        }
      }
    })).toThrow(/value/)
  })
})

describe('state persistence', () => {
  it('saves a radio selection to localStorage on change (after debounce)', () => {
    renderWorksheet(SAMPLE_MANIFEST)
    setRadio('BUG-001', 'PASS')
    flushSaveTimer()

    const raw = localStorage.getItem('worksheet:test-walk-v1')
    expect(raw).toBeTruthy()
    const state = JSON.parse(raw!)
    expect(state.items['BUG-001'].result).toBe('PASS')
  })

  it('saves textarea typing on input (after debounce)', () => {
    renderWorksheet(SAMPLE_MANIFEST)
    setNotes('BUG-002', 'this failed because…')
    flushSaveTimer()

    const state = JSON.parse(localStorage.getItem('worksheet:test-walk-v1')!)
    expect(state.items['BUG-002'].notes).toBe('this failed because…')
  })

  it('saves misc-notes on input', () => {
    renderWorksheet(SAMPLE_MANIFEST)
    const misc = document.getElementById('misc-notes') as HTMLTextAreaElement
    misc.value = 'extra context'
    misc.dispatchEvent(new Event('input', { bubbles: true }))
    flushSaveTimer()

    const state = JSON.parse(localStorage.getItem('worksheet:test-walk-v1')!)
    expect(state.misc).toBe('extra context')
  })

  it('debounces saves — no localStorage writes during a rapid burst, latest value lands after flush', () => {
    renderWorksheet(SAMPLE_MANIFEST)
    const setSpy = vi.spyOn(Storage.prototype, 'setItem')
    setRadio('BUG-001', 'PASS')
    setRadio('BUG-001', 'FAIL')
    setRadio('BUG-001', 'SKIP')
    // The contract is "writes don't happen on every keystroke" — the
    // exact post-flush write count is implementation detail (depends on
    // how many bubbled events the synthetic `change` dispatch produces).
    // What matters: nothing was persisted DURING the burst.
    expect(setSpy).not.toHaveBeenCalled()

    flushSaveTimer()
    expect(setSpy).toHaveBeenCalled()
    const lastWrite = setSpy.mock.calls[setSpy.mock.calls.length - 1]
    const stored = JSON.parse(lastWrite[1] as string)
    expect(stored.items['BUG-001'].result).toBe('SKIP')  // latest value persisted
    setSpy.mockRestore()
  })

  it('restores state on a fresh render with the same name', () => {
    renderWorksheet(SAMPLE_MANIFEST)
    setRadio('BUG-001', 'PASS')
    setNotes('BUG-001', 'all good')
    setRadio('BUG-002', 'FAIL')
    flushSaveTimer()

    // Render again — same manifest name, so state restores.
    renderWorksheet(SAMPLE_MANIFEST)

    expect(getRadio('BUG-001', 'PASS').checked).toBe(true)
    expect(getNotes('BUG-001').value).toBe('all good')
    expect(getRadio('BUG-002', 'FAIL').checked).toBe(true)
    expect(getRadio('BUG-003', 'PASS').checked).toBe(false)
  })

  it('isolates state per worksheet name', () => {
    renderWorksheet(SAMPLE_MANIFEST)
    setRadio('BUG-001', 'PASS')
    flushSaveTimer()

    // Render a different manifest; should NOT restore the prior worksheet's state.
    const different = { ...SAMPLE_MANIFEST, name: 'other-walk' }
    renderWorksheet(different)
    expect(getRadio('BUG-001', 'PASS').checked).toBe(false)
    expect(localStorage.getItem('worksheet:test-walk-v1')).toBeTruthy()
    expect(localStorage.getItem('worksheet:other-walk')).toBeNull()
  })

  it('survives corrupt localStorage payloads (starts fresh)', () => {
    localStorage.setItem('worksheet:test-walk-v1', '{not valid json')
    expect(() => renderWorksheet(SAMPLE_MANIFEST)).not.toThrow()
    expect(getRadio('BUG-001', 'PASS').checked).toBe(false)
  })
})

describe('live tally', () => {
  it('shows "N to go" with zero answered initially', () => {
    renderWorksheet(SAMPLE_MANIFEST)
    expect(document.getElementById('summary')!.textContent).toMatch(/3 to go.*\(3 total\)/)
  })

  it('counts each option after radio changes', () => {
    renderWorksheet(SAMPLE_MANIFEST)
    setRadio('BUG-001', 'PASS')
    setRadio('BUG-002', 'PASS')
    setRadio('BUG-003', 'FAIL')

    const text = document.getElementById('summary')!.textContent!
    expect(text).toMatch(/2 pass/)
    expect(text).toMatch(/1 fail/)
    expect(text).not.toMatch(/to go/)
  })

  it('applies is-answered + is-opt-<value> class on the answered card', () => {
    renderWorksheet(SAMPLE_MANIFEST)
    setRadio('BUG-001', 'PASS')

    const card = getCard('BUG-001')
    expect(card.classList.contains('is-answered')).toBe(true)
    expect(card.classList.contains('is-opt-pass')).toBe(true)
  })

  it('replaces is-opt-<value> when the radio changes (no stale tints)', () => {
    renderWorksheet(SAMPLE_MANIFEST)
    setRadio('BUG-001', 'PASS')
    setRadio('BUG-001', 'FAIL')

    const card = getCard('BUG-001')
    expect(card.classList.contains('is-opt-pass')).toBe(false)
    expect(card.classList.contains('is-opt-fail')).toBe(true)
  })

  it('applies is-skip class when option value matches SKIP (case-insensitive)', () => {
    renderWorksheet(SAMPLE_MANIFEST)
    setRadio('BUG-001', 'SKIP')

    const card = getCard('BUG-001')
    expect(card.classList.contains('is-skip')).toBe(true)
    expect(card.classList.contains('is-opt-skip')).toBe(true)
  })
})

describe('bulk operations (mark-all)', () => {
  it('renders the mark-all button when manifest declares it', () => {
    renderWorksheet(SAMPLE_MANIFEST)
    expect(document.getElementById('mark-all')).not.toBeNull()
  })

  it('omits the mark-all button when manifest doesn\'t declare it', () => {
    renderWorksheet(MINIMAL_MANIFEST)
    expect(document.getElementById('mark-all')).toBeNull()
  })

  it('sets every UNSET radio to the configured mark-all value', () => {
    renderWorksheet(SAMPLE_MANIFEST)
    setRadio('BUG-002', 'FAIL')  // already set; must be untouched

    document.getElementById('mark-all')!.click()

    expect(getRadio('BUG-001', 'PASS').checked).toBe(true)
    expect(getRadio('BUG-003', 'PASS').checked).toBe(true)
    // Already-set BUG-002 stays FAIL
    expect(getRadio('BUG-002', 'FAIL').checked).toBe(true)
    expect(getRadio('BUG-002', 'PASS').checked).toBe(false)
  })

  it('triggers a re-render of the tally after mark-all', () => {
    renderWorksheet(SAMPLE_MANIFEST)
    document.getElementById('mark-all')!.click()
    expect(document.getElementById('summary')!.textContent).toMatch(/3 pass/)
  })

  it('persists mark-all to localStorage', () => {
    renderWorksheet(SAMPLE_MANIFEST)
    document.getElementById('mark-all')!.click()
    flushSaveTimer()

    const state = JSON.parse(localStorage.getItem('worksheet:test-walk-v1')!)
    expect(state.items['BUG-001'].result).toBe('PASS')
    expect(state.items['BUG-002'].result).toBe('PASS')
    expect(state.items['BUG-003'].result).toBe('PASS')
  })
})

describe('clear-saved', () => {
  it('does NOT clear when confirm() returns false', () => {
    renderWorksheet(SAMPLE_MANIFEST)
    setRadio('BUG-001', 'PASS')
    flushSaveTimer()

    window.confirm = vi.fn(() => false)
    document.getElementById('clear-saved')!.click()

    expect(getRadio('BUG-001', 'PASS').checked).toBe(true)
    expect(localStorage.getItem('worksheet:test-walk-v1')).toBeTruthy()
  })

  it('wipes localStorage AND form state when confirm() returns true', () => {
    renderWorksheet(SAMPLE_MANIFEST)
    setRadio('BUG-001', 'PASS')
    setNotes('BUG-001', 'note text')
    setRadio('BUG-002', 'FAIL')
    flushSaveTimer()

    window.confirm = vi.fn(() => true)
    document.getElementById('clear-saved')!.click()

    expect(getRadio('BUG-001', 'PASS').checked).toBe(false)
    expect(getNotes('BUG-001').value).toBe('')
    expect(getRadio('BUG-002', 'FAIL').checked).toBe(false)
    expect(localStorage.getItem('worksheet:test-walk-v1')).toBeNull()
  })

  it('wipes misc-notes on clear', () => {
    renderWorksheet(SAMPLE_MANIFEST)
    const misc = document.getElementById('misc-notes') as HTMLTextAreaElement
    misc.value = 'something'
    misc.dispatchEvent(new Event('input', { bubbles: true }))
    flushSaveTimer()

    window.confirm = vi.fn(() => true)
    document.getElementById('clear-saved')!.click()

    expect(misc.value).toBe('')
  })

  it('updates the tally after clear', () => {
    renderWorksheet(SAMPLE_MANIFEST)
    setRadio('BUG-001', 'PASS')
    setRadio('BUG-002', 'PASS')
    setRadio('BUG-003', 'PASS')

    window.confirm = vi.fn(() => true)
    document.getElementById('clear-saved')!.click()

    expect(document.getElementById('summary')!.textContent).toMatch(/3 to go/)
  })
})

describe('composition (Copy results text format)', () => {
  it('starts with the templated header line + "=" underline + blank line', () => {
    renderWorksheet(SAMPLE_MANIFEST)
    document.getElementById('copy')!.click()

    const text = writeTextMock.mock.calls[0][0] as string
    const lines = text.split('\n')
    expect(lines[0]).toBe('SMOKE WALK v0.6.6 (2026-05-04)')
    expect(lines[1]).toBe('=============================='.slice(0, lines[0].length))
    expect(lines[2]).toBe('')
  })

  it('formats per-item as "[VALUE] id — title"', () => {
    renderWorksheet(SAMPLE_MANIFEST)
    setRadio('BUG-001', 'PASS')
    setRadio('BUG-002', 'FAIL')
    document.getElementById('copy')!.click()

    const text = writeTextMock.mock.calls[0][0] as string
    expect(text).toContain('[PASS] BUG-001 — First item')
    expect(text).toContain('[FAIL] BUG-002 — Second item')
  })

  it('renders unanswered items as [SKIP]', () => {
    renderWorksheet(SAMPLE_MANIFEST)
    setRadio('BUG-001', 'PASS')
    // BUG-002 + BUG-003 left unanswered
    document.getElementById('copy')!.click()

    const text = writeTextMock.mock.calls[0][0] as string
    expect(text).toContain('[SKIP] BUG-002 — Second item')
    expect(text).toContain('[SKIP] BUG-003 — Third item')
  })

  // Regression guard (recurring "Copy results does nothing" in the split-view
  // aux WebContentsView, where the async clipboard AND execCommand can no-op
  // silently while reporting success). The ONLY reliable path is a pre-selected
  // textarea the user can ⌘C — so the copy handler MUST always surface it.
  it('ALWAYS surfaces a pre-selected fallback textarea with the results (guaranteed paste-back)', async () => {
    renderWorksheet(SAMPLE_MANIFEST)
    setRadio('BUG-001', 'PASS')
    document.getElementById('copy')!.click()
    await Promise.resolve(); await Promise.resolve()
    const ta = document.querySelector('#copy-modal .copy-modal-ta') as HTMLTextAreaElement | null
    expect(ta).toBeTruthy()
    expect(ta!.value).toContain('[PASS] BUG-001 — First item')
  })

  it('still surfaces the fallback textarea when the async clipboard REJECTS (the aux-pane failure mode)', async () => {
    writeTextMock.mockRejectedValueOnce(new Error('Document is not focused'))
    renderWorksheet(SAMPLE_MANIFEST)
    setRadio('BUG-002', 'FAIL')
    document.getElementById('copy')!.click()
    await Promise.resolve(); await Promise.resolve()
    const ta = document.querySelector('#copy-modal .copy-modal-ta') as HTMLTextAreaElement | null
    expect(ta).toBeTruthy()
    expect(ta!.value).toContain('[FAIL] BUG-002 — Second item')
  })

  it('indents notes under the item line as "  Notes: <line>"', () => {
    renderWorksheet(SAMPLE_MANIFEST)
    setRadio('BUG-001', 'PASS')
    setNotes('BUG-001', 'line one\nline two')
    document.getElementById('copy')!.click()

    const text = writeTextMock.mock.calls[0][0] as string
    expect(text).toContain('  Notes: line one')
    expect(text).toContain('  Notes: line two')
  })

  it('omits notes for items without notes', () => {
    renderWorksheet(SAMPLE_MANIFEST)
    setRadio('BUG-001', 'PASS')
    document.getElementById('copy')!.click()

    const text = writeTextMock.mock.calls[0][0] as string
    expect(text).not.toContain('Notes:')
  })

  it('appends summary line "<LABEL>: N PASS, M FAIL (T total)"', () => {
    renderWorksheet(SAMPLE_MANIFEST)
    setRadio('BUG-001', 'PASS')
    setRadio('BUG-002', 'FAIL')
    setRadio('BUG-003', 'PASS')
    document.getElementById('copy')!.click()

    const text = writeTextMock.mock.calls[0][0] as string
    expect(text).toContain('SUMMARY: 2 PASS, 1 FAIL (3 total)')
  })

  it('counts unanswered items toward SKIP in the summary (when SKIP is a valid option)', () => {
    renderWorksheet(SAMPLE_MANIFEST)
    setRadio('BUG-001', 'PASS')
    // BUG-002 + BUG-003 unanswered — both count as SKIP in the summary
    document.getElementById('copy')!.click()

    const text = writeTextMock.mock.calls[0][0] as string
    expect(text).toContain('SUMMARY: 1 PASS, 2 SKIP (3 total)')
  })

  it('appends misc-notes block when filled', () => {
    renderWorksheet(SAMPLE_MANIFEST)
    const misc = document.getElementById('misc-notes') as HTMLTextAreaElement
    misc.value = 'first observation\nsecond observation'
    document.getElementById('copy')!.click()

    const text = writeTextMock.mock.calls[0][0] as string
    expect(text).toContain('OTHER NOTES')
    expect(text).toContain('-----------')
    expect(text).toContain('first observation')
    expect(text).toContain('second observation')
  })

  it('omits the misc-notes block when empty', () => {
    renderWorksheet(SAMPLE_MANIFEST)
    document.getElementById('copy')!.click()

    const text = writeTextMock.mock.calls[0][0] as string
    expect(text).not.toContain('OTHER NOTES')
  })
})

describe('clipboard pathway', () => {
  it('copy-results writes the formatted result text via navigator.clipboard.writeText', () => {
    renderWorksheet(SAMPLE_MANIFEST)
    setRadio('BUG-001', 'PASS')
    document.getElementById('copy')!.click()

    expect(writeTextMock).toHaveBeenCalledTimes(1)
    expect(writeTextMock.mock.calls[0][0]).toContain('[PASS] BUG-001')
  })

  it('updates the copy button label on success', async () => {
    renderWorksheet(SAMPLE_MANIFEST)
    document.getElementById('copy')!.click()

    // The async writeText resolution chain runs on microtasks; flush.
    await Promise.resolve()
    await Promise.resolve()
    expect(document.getElementById('copy')!.textContent).toContain('Copied!')
  })
})

describe('send-to-Claude', () => {
  it('uses window.duoSendResult when available', async () => {
    const sendMock = vi.fn().mockResolvedValue(undefined)
    ;(window as unknown as { duoSendResult: typeof sendMock }).duoSendResult = sendMock

    renderWorksheet(SAMPLE_MANIFEST)
    setRadio('BUG-001', 'PASS')
    document.getElementById('send')!.click()

    await Promise.resolve()
    await Promise.resolve()
    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(sendMock.mock.calls[0][0]).toContain('[PASS] BUG-001')
    expect(sendMock.mock.calls[0][1]).toEqual({ worksheet: 'test-walk-v1' })
    expect(writeTextMock).not.toHaveBeenCalled()
  })

  it('falls back to clipboard when the binding is absent', async () => {
    renderWorksheet(SAMPLE_MANIFEST)
    setRadio('BUG-001', 'PASS')
    document.getElementById('send')!.click()

    await Promise.resolve()
    await Promise.resolve()
    expect(writeTextMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to clipboard when duoSendResult rejects', async () => {
    const sendMock = vi.fn().mockRejectedValue(new Error('no claude session'))
    ;(window as unknown as { duoSendResult: typeof sendMock }).duoSendResult = sendMock

    renderWorksheet(SAMPLE_MANIFEST)
    setRadio('BUG-001', 'PASS')
    document.getElementById('send')!.click()

    // Two awaits for the binding promise; one for the clipboard promise
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(sendMock).toHaveBeenCalled()
    expect(writeTextMock).toHaveBeenCalled()
  })
})

describe('per-step copy buttons', () => {
  it('renders a copy button for trailing commands inside backticks', () => {
    const m = {
      ...MINIMAL_MANIFEST,
      items: [{
        id: 'STEP-01',
        title: 'with command',
        steps: ['Then run `npm run typecheck` to verify']
      }]
    }
    renderWorksheet(m)

    // "npm run typecheck" is mid-sentence (followed by " to verify"),
    // so it should stay INLINE — not become a copy block.
    const cmdBlock = document.querySelector('div.step-cmd')
    expect(cmdBlock).toBeNull()

    // It should appear as inline-code instead.
    const inlineCode = document.querySelector('code.step-inline')
    expect(inlineCode?.textContent).toBe('npm run typecheck')
  })

  it('promotes a trailing command to a copy block', () => {
    const m = {
      ...MINIMAL_MANIFEST,
      items: [{
        id: 'STEP-02',
        title: 'trailing cmd',
        steps: ['Then run: `npm run typecheck`']
      }]
    }
    renderWorksheet(m)

    const cmdBlock = document.querySelector<HTMLElement>('div.step-cmd')
    expect(cmdBlock).not.toBeNull()
    expect(cmdBlock!.querySelector('pre code')!.textContent).toBe('npm run typecheck')
    expect(cmdBlock!.querySelector('button.copy-cmd')).not.toBeNull()
  })

  it('writes the data-cmd value to clipboard on copy-button click', () => {
    const m = {
      ...MINIMAL_MANIFEST,
      items: [{
        id: 'STEP-03',
        title: 'cmd copy',
        steps: ['Run: `duo open foo.html`']
      }]
    }
    renderWorksheet(m)

    const btn = document.querySelector<HTMLButtonElement>('button.copy-cmd')!
    btn.click()
    expect(writeTextMock).toHaveBeenCalledWith('duo open foo.html')
  })
})

describe('path-link wrapping in steps', () => {
  it('wraps absolute /Users/... paths in a duo-path-link anchor', () => {
    const m = {
      ...MINIMAL_MANIFEST,
      items: [{
        id: 'P-01',
        title: 'path link',
        steps: ['Open /Users/test/foo.html in your editor']
      }]
    }
    renderWorksheet(m)

    const link = document.querySelector<HTMLAnchorElement>('a.duo-path-link')
    expect(link).not.toBeNull()
    expect(link!.getAttribute('data-duo-path')).toBe('/Users/test/foo.html')
  })

  it('wraps tilde-prefixed paths', () => {
    const m = {
      ...MINIMAL_MANIFEST,
      items: [{
        id: 'P-02',
        title: 'tilde path',
        steps: ['Edit ~/.claude/duo/priming.md to customize priming']
      }]
    }
    renderWorksheet(m)

    const link = document.querySelector<HTMLAnchorElement>('a.duo-path-link')
    expect(link!.getAttribute('data-duo-path')).toBe('~/.claude/duo/priming.md')
  })

  it('does not wrap relative paths', () => {
    const m = {
      ...MINIMAL_MANIFEST,
      items: [{
        id: 'P-03',
        title: 'relative path',
        steps: ['Look at src/foo.ts and tell me what you see']
      }]
    }
    renderWorksheet(m)

    expect(document.querySelector('a.duo-path-link')).toBeNull()
  })
})

describe('live event emission (ENH-094 + ENH-043)', () => {
  it('does NOT throw when window.duoPlaygroundAction is absent (worksheet outside Duo)', () => {
    // No binding — should silently no-op on every radio change.
    expect(() => {
      renderWorksheet(SAMPLE_MANIFEST)
      setRadio('BUG-001', 'PASS')
    }).not.toThrow()
  })

  it('calls window.duoPlaygroundAction with a duo:event bundle on radio change when binding is present', () => {
    const bindingMock = vi.fn()
    ;(window as unknown as { duoPlaygroundAction: typeof bindingMock }).duoPlaygroundAction = bindingMock

    renderWorksheet(SAMPLE_MANIFEST)
    setRadio('BUG-001', 'PASS')

    expect(bindingMock).toHaveBeenCalledTimes(1)
    const bundle = JSON.parse(bindingMock.mock.calls[0][0] as string)
    expect(bundle.attrs['data-duo-action']).toBe('duo:event')
    expect(bundle.attrs['data-event']).toBe('smoke-walk:item-changed')
    const payload = JSON.parse(bundle.attrs['data-payload'])
    expect(payload).toEqual({
      worksheet: 'test-walk-v1',
      id: 'BUG-001',
      value: 'PASS'
    })

    delete (window as unknown as { duoPlaygroundAction?: unknown }).duoPlaygroundAction
  })

  it('uses the manifest kind as the event-name prefix (different worksheets emit distinguishable events)', () => {
    const bindingMock = vi.fn()
    ;(window as unknown as { duoPlaygroundAction: typeof bindingMock }).duoPlaygroundAction = bindingMock

    const sprintPlanManifest = {
      ...SAMPLE_MANIFEST,
      kind: 'sprint-plan',
      name: 'sprint-test'
    }
    renderWorksheet(sprintPlanManifest)
    setRadio('BUG-001', 'PASS')

    const bundle = JSON.parse(bindingMock.mock.calls[0][0] as string)
    expect(bundle.attrs['data-event']).toBe('sprint-plan:item-changed')

    delete (window as unknown as { duoPlaygroundAction?: unknown }).duoPlaygroundAction
  })

  it('emits one event per radio change in a sequence', () => {
    const bindingMock = vi.fn()
    ;(window as unknown as { duoPlaygroundAction: typeof bindingMock }).duoPlaygroundAction = bindingMock

    renderWorksheet(SAMPLE_MANIFEST)
    setRadio('BUG-001', 'PASS')
    setRadio('BUG-002', 'FAIL')
    setRadio('BUG-001', 'SKIP')  // change of mind on BUG-001

    expect(bindingMock).toHaveBeenCalledTimes(3)
    const events = bindingMock.mock.calls.map(([s]) =>
      JSON.parse(JSON.parse(s as string).attrs['data-payload'])
    )
    expect(events[0]).toMatchObject({ id: 'BUG-001', value: 'PASS' })
    expect(events[1]).toMatchObject({ id: 'BUG-002', value: 'FAIL' })
    expect(events[2]).toMatchObject({ id: 'BUG-001', value: 'SKIP' })

    delete (window as unknown as { duoPlaygroundAction?: unknown }).duoPlaygroundAction
  })
})

describe('rendered shape (smoke checks against generator HTML)', () => {
  it('exposes per-item id + title via data attributes for state lookup', () => {
    renderWorksheet(SAMPLE_MANIFEST)
    const cards = document.querySelectorAll<HTMLElement>('section.item')
    expect(cards.length).toBe(3)
    expect(cards[0].dataset.id).toBe('BUG-001')
    expect(cards[0].dataset.title).toBe('First item')
  })

  it('emits one radio per option, name-spaced per item', () => {
    renderWorksheet(SAMPLE_MANIFEST)
    const radios = document.querySelectorAll<HTMLInputElement>('section.item[data-id="BUG-001"] input[type=radio]')
    expect(radios.length).toBe(3)
    expect(radios[0].name).toBe('result-BUG-001')
    expect(radios[0].value).toBe('PASS')
  })

  it('opts pages into browser-pane routing via meta name=duo-open-in', () => {
    const html = generateWorksheet(SAMPLE_MANIFEST)
    expect(html).toContain('<meta name="duo-open-in" content="browser">')
  })

  it('opts path-link clicks into Split View by default', () => {
    const html = generateWorksheet(SAMPLE_MANIFEST)
    expect(html).toContain('<meta name="duo-path-target" content="split">')
  })
})

// Iframe → parent global-shortcut forwarder.
//
// The HTML canvas is a same-origin sandboxed iframe; its document is
// separate from the parent's, so the parent's capture-phase keydown
// listener doesn't see iframe-internal keystrokes. This module installs
// a capture-phase listener on the iframe's document that:
//
//   1. Asks the SAME `matchGlobalShortcut` matcher whether the keystroke
//      should escape (so the registry stays the single source of truth).
//   2. If yes, preventDefault + stopPropagation inside the iframe and
//      synthesize a KeyboardEvent on the parent's document. The parent's
//      capture listener then runs the dispatch as if the keystroke had
//      originated outside the iframe.
//   3. If no, does nothing — the iframe's bubble-phase handlers
//      (PageTab's local ⌘S/⌘B/⌘I/⌘U/⌘K, contentEditable's text input)
//      run unchanged.
//
// One installer per iframe. Adding new global shortcuts to the registry
// gets every iframe canvas free coverage; new iframe tab types just
// install this once.

import { matchGlobalShortcut, isInEditableSurface } from './globalShortcuts'

/**
 * Install the forwarder on `doc`. Returns a cleanup function.
 *
 * `parentWindow` is the parent's `window` object. We synthesize the
 * dispatched event on `parentWindow.document` so the capture listener
 * in `useKeyboardShortcuts` (registered on the parent doc) catches it.
 */
export function installGlobalShortcutForwarder(
  doc: Document,
  parentWindow: Window
): () => void {
  const handler = (e: KeyboardEvent) => {
    const ctx = { inEditableSurface: isInEditableSurface(doc) }
    const match = matchGlobalShortcut(e, ctx)
    if (!match) return

    // Consume in the iframe so contentEditable / canvas-local handlers
    // don't also fire (e.g. ⌘N would otherwise type 'n' into the body
    // because contentEditable doesn't recognize it as a shortcut).
    e.preventDefault()
    e.stopPropagation()

    // Synthesize a parent-document keydown. The KeyboardEvent
    // constructor is available on the parent's window, and dispatching
    // on the parent's document fires registered capture listeners.
    const synthetic = new (parentWindow as Window & typeof globalThis).KeyboardEvent('keydown', {
      key: e.key,
      code: e.code,
      keyCode: e.keyCode,
      which: e.which,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      repeat: e.repeat,
      bubbles: true,
      cancelable: true
    })
    parentWindow.document.dispatchEvent(synthetic)
  }

  doc.addEventListener('keydown', handler, true)
  return () => doc.removeEventListener('keydown', handler, true)
}

// Stage 17c — Just-added highlight: the HTML canvas binding.
//
// The visual layer is the `duo-just-added` keyframe defined in
// `renderer/styles/globals.css`. The markdown editor binding is
// `editor/extensions/JustAdded.ts` (a TipTap decoration). This file is
// the canvas-side binding: agent writes paint the affected element's
// className with `duo-just-added` for ~6 seconds, then the class is
// stripped.
//
// Same animation as the markdown editor; different addressing model
// (DOM `Element`, not ProseMirror range positions). See
// `primitives/README.md` for the visual-layer / data-layer contract.
//
// Iframe sandbox quirk: the parent renderer's stylesheet does NOT
// apply inside the iframe — they're separate documents. So this file
// injects the keyframe + class into the iframe's <head> via a runtime
// <style> tag (marked `data-duo-canvas-runtime` so the serializer
// strips it from the on-disk output). One installation per canvas open.

/** Total wash + fade duration, kept in lock-step with the keyframe.
 *  Mirrors the markdown editor's HIGHLIGHT_MS in `JustAdded.ts`. */
const HIGHLIGHT_MS = 6000
/** Drop the class shortly after the fade so a long-lived canvas doesn't
 *  carry stale `duo-just-added` classes around forever. */
const CLEANUP_MS = HIGHLIGHT_MS + 500

/** Freshness window for re-painting agent edits at canvas open from the
 *  sidecar's `recentEdits` log. Picks up edits Claude made while the
 *  canvas was closed — but only if they're recent enough that paint is
 *  still useful as "look what just changed." Older entries fall off. */
export const REPAINT_FRESHNESS_MS = HIGHLIGHT_MS

/**
 * Inject the `duo-just-added` keyframe + class into the iframe's <head>
 * so the canvas binding can paint elements with the class and have the
 * animation run. Idempotent — checks for an existing runtime style
 * block carrying the same `data-duo-just-added` sentinel.
 *
 * The style is marked `data-duo-canvas-runtime` so `serialize.ts`
 * strips it from saved HTML (alongside the body-outline runtime style
 * and the contenteditable / spellcheck attributes — same sentinel,
 * same strip rule).
 *
 * Why duplicate the parent stylesheet's rules instead of @importing
 * them: the parent's `globals.css` lives at a Vite-served URL that
 * isn't reachable from the iframe's `srcdoc` document. Inlining is
 * the simplest path; the cost is one ~600-byte <style> tag per
 * canvas open. The keyframe + class shape mirrors the parent
 * declaration in `globals.css` § "Stage 13a — duo-just-added".
 */
export function installJustAddedStyles(doc: Document): void {
  if (doc.head?.querySelector('style[data-duo-just-added]')) return
  const style = doc.createElement('style')
  style.setAttribute('data-duo-canvas-runtime', '1')
  style.setAttribute('data-duo-just-added', '1')
  // Match the parent stylesheet's keyframe + class shape verbatim. The
  // canvas inherits the parent's CSS variables via the body's
  // `color-scheme` indirectly, but iframe documents don't inherit
  // custom properties — so we hard-code Atelier `--duo-mark` (#F0CB6A)
  // here. If the token shifts, update both this file AND globals.css.
  style.textContent = `
@keyframes duo-just-added-fade {
  0%   { background-color: #F0CB6A; box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.04); }
  20%  { background-color: #F0CB6A; box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.04); }
  100% { background-color: transparent;     box-shadow: 0 0 0 0 transparent; }
}
.duo-just-added {
  animation: duo-just-added-fade 6s ease-out forwards;
  padding: 0 2px;
  border-radius: 2px;
}
@media (prefers-reduced-motion: reduce) {
  .duo-just-added {
    animation: none;
    background-color: #F0CB6A;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.04);
    transition: background-color 800ms ease-out 5200ms, box-shadow 800ms ease-out 5200ms;
  }
}
`.trim()
  doc.head?.appendChild(style)
}

/**
 * Paint the `duo-just-added` class on an element. The class triggers
 * the 6s fade animation in the iframe's stylesheet (installed via
 * `installJustAddedStyles`). After the animation completes, a timer
 * strips the class so the decoration set stays small for long-lived
 * canvases.
 *
 * Returns the cleanup function in case a caller wants to cancel the
 * timer (e.g. element is removed before the fade completes — the
 * MutationObserver would catch the removal and the class goes with
 * it, so cancellation is a defensive nicety, not load-bearing).
 *
 * Note: this DOES dirty the buffer because adding a class is an
 * attribute mutation that fires the MutationObserver. The serializer
 * strips `duo-just-added` from `class=""` lists explicitly — see
 * `serialize.ts` § stripJustAddedClass — so the on-disk file is
 * unchanged. Without that strip, agent writes would race the autosave
 * and the class would get persisted in the saved file.
 */
export function markJustAdded(el: Element | null | undefined): () => void {
  if (!el) return () => {}
  el.classList.add('duo-just-added')
  const win = el.ownerDocument?.defaultView
  if (!win) return () => {}
  const timer = win.setTimeout(() => {
    el.classList.remove('duo-just-added')
  }, CLEANUP_MS)
  return () => {
    win.clearTimeout(timer)
    el.classList.remove('duo-just-added')
  }
}

// ENH-224 Phase 2 — the pure visibility/morph predicate behind the
// "Propose changes" footer (ProposeBar.tsx). Extracted so the single
// decision that gates the whole affordance is unit-testable without a
// mounted React tree (ENH-224 review MUST-FIX: zero automated coverage of
// the open→edit→Propose-PR flow).
//
// The bar is INERT for ordinary files (D10 — zero footprint). It surfaces
// only when the open doc lives in a managed checkout AND either has diverged
// from its baseline (→ offer to propose) or already has a PR to view (→ morph
// to the "View PR" state). The three states map 1:1 onto what the component
// renders:
//
//   hidden  — not a checkout, or a checkout with no divergence and no PR
//   propose — diverged: the Propose/Update-PR button is shown (this is the
//             "offer to share back" mode, whether or not a PR already exists)
//   view    — has a PR and is NOT diverged: the success/"View PR" affordance,
//             no Propose button
//
// `propose` takes precedence over `view` when both could apply (a checkout
// that already has a PR AND has been edited again still wants the Update-PR
// button — `effectivePr ? 'Update PR' : 'Propose changes'`).

export interface ProposeBarInput {
  /** True when the open doc lives in a managed checkout (status.context set). */
  inCheckout: boolean
  /** True when the working tree differs from the baseline. */
  diverged: boolean
  /** True when there's a PR to view (a freshly-created one OR a polled one). */
  hasPr: boolean
}

export type ProposeBarMode = 'propose' | 'view' | 'hidden'

export interface ProposeBarState {
  visible: boolean
  mode: ProposeBarMode
}

/**
 * The pure decision behind ProposeBar's `return null` guard + which controls
 * render. See the module comment for the state map.
 */
export function proposeBarState(input: ProposeBarInput): ProposeBarState {
  const { inCheckout, diverged, hasPr } = input
  // Inert for ordinary files (D10): not a checkout, or a checkout with
  // nothing to act on (no divergence, no PR).
  if (!inCheckout || (!diverged && !hasPr)) {
    return { visible: false, mode: 'hidden' }
  }
  // Diverged → offer to propose/update (button visible). Else we're here only
  // because there's a PR and no divergence → the "View PR" view mode.
  return { visible: true, mode: diverged ? 'propose' : 'view' }
}

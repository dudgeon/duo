// ENH-183 C8 — Session hydrator. Duo-driven `/rename` injection when a
// Claude session crosses the "named-worthy" threshold without already
// carrying a customTitle or aiTitle entry.
//
// **D9 invariant** — hydration-already-done tracking is in-memory only.
// No sidecar files. If Duo restarts mid-session, the gate just re-checks
// JSONL state (customTitle still present from the prior /rename → skip;
// no customTitle yet → maybe re-inject, which is harmless because Claude
// would just no-op the rename if the session already had the same name).
//
// **D8 derivation** — title comes from `readBannerTitle`'s 'jsonl-firstmsg'
// rung (the cleaned first user message). We never /rename to a UUID; if
// the derivation falls through to the UUID rung, we abort.
//
// **Trigger conditions** (gates here; trigger wiring lands in C9):
//   - messageCount ≥ HYDRATION_THRESHOLD
//   - no existing `type:"custom-title"` JSONL entry
//   - no existing `type:"ai-title"` JSONL entry
//   - session not already in the in-memory hydrated set
//   - derivation produces a non-empty cleanAndTruncate result
//
// **Why /rename and not direct JSONL writes** — Claude owns its storage.
// Duo's job is to type the slash command into the live PTY exactly as a
// user would; Claude does the actual write. Keeps the data plane single-
// owner (Claude) per the architectural invariant.

import { readBannerTitle, readMessageCount } from './claude-session-tracker'

/** PRD D2 — three messages is "this is a real conversation" enough to
 *  warrant a name. Lower threshold = false positives on test sessions;
 *  higher = too many unnamed conversations linger. 3 is the locked
 *  default; configurable via `duo session auto-hydrate` (C12). */
export const HYDRATION_THRESHOLD = 3

/** Sessions Duo has already issued a /rename for during this Duo run.
 *  Reset on Duo restart (D9 — no persistence). */
const alreadyHydrated = new Set<string>()

export interface MaybeHydrateArgs {
  /** Tab whose PTY we'll write the /rename into. */
  tabId: string
  /** The Claude session UUID (basename of the JSONL file). */
  sessionUuid: string
  /** Tab's cwd — resolves to `~/.claude/projects/<encoded-cwd>/`. */
  cwd: string
  /** PTY-writer callback (injection target). The renderer's
   *  `window.electron.pty.write` for renderer-side trigger paths; the
   *  main-process `ptyManager.write` for main-side trigger paths. */
  ptyWrite: (tabId: string, data: string) => void
}

export interface MaybeHydrateResult {
  hydrated: boolean
  /** Human-readable reason for the decision (no-op or fire). For
   *  logs / `duo session hydrate --explain` (C12) / smoke walks. */
  reason: string
  /** The derived title that was injected, if `hydrated === true`. */
  title?: string
}

/**
 * Decide whether to hydrate the given session and, if so, inject the
 * /rename slash command into the live PTY. Idempotent: a session is
 * hydrated at most once per Duo run.
 */
export async function maybeHydrate(args: MaybeHydrateArgs): Promise<MaybeHydrateResult> {
  const { tabId, sessionUuid, cwd, ptyWrite } = args

  if (alreadyHydrated.has(sessionUuid)) {
    return { hydrated: false, reason: 'already-hydrated-this-run' }
  }

  const count = await readMessageCount(sessionUuid, cwd)
  if (count < HYDRATION_THRESHOLD) {
    return { hydrated: false, reason: `messageCount<${HYDRATION_THRESHOLD} (was ${count})` }
  }

  const titleResult = await readBannerTitle(sessionUuid, cwd)
  if (titleResult.source === 'customTitle') {
    return { hydrated: false, reason: 'already-has-customTitle' }
  }
  if (titleResult.source === 'aiTitle') {
    return { hydrated: false, reason: 'already-has-aiTitle' }
  }
  if (titleResult.source !== 'jsonl-firstmsg') {
    // Source === 'uuid' — no first user message to derive from.
    // We don't /rename to a UUID per D8 ladder rung 4.
    return { hydrated: false, reason: 'no-derivable-title' }
  }

  const derived = titleResult.title.trim()
  if (!derived) {
    return { hydrated: false, reason: 'empty-derivation' }
  }

  // CR \r before the slash + LF after the title puts the command on a
  // fresh line in the user's input and commits it. Matches what a user
  // would type interactively.
  ptyWrite(tabId, `\r/rename ${derived}\n`)
  alreadyHydrated.add(sessionUuid)

  return { hydrated: true, reason: 'injected', title: derived }
}

/** Test/debug-only escape hatch. Production callers should never need
 *  this — the in-memory dedup is per Duo run. */
export function resetHydrationTracking(): void {
  alreadyHydrated.clear()
}

/** Internal getter (tests only). */
export function _hasBeenHydrated(sessionUuid: string): boolean {
  return alreadyHydrated.has(sessionUuid)
}

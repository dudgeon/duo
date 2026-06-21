// ENH-225 (F2/D9) — pure logic for the "waiting on you" tab attention badge.
// Dependency-free + Electron-free so it unit-tests without a DOM or a window.

/**
 * Map a Claude Code hook event (or an explicit CLI state) to the tab's
 * attention flag. The clear-behavior contract (owner: "activity + focus
 * fallback"):
 *   - `Stop` / `Notification`  → true  (Claude went idle / is prompting)
 *   - `UserPromptSubmit`       → false (the user acted — activity clear)
 *   - `clear` / `active`       → false (explicit clear)
 *   - anything unknown         → true  (fail toward "needs attention" so a new
 *                                       Claude hook event can't silently no-op)
 * The OTHER clear leg — focusing the tab — lives in the renderer, not here.
 */
export function attentionForEvent(event: string): boolean {
  const e = (event ?? '').trim()
  return !(e === 'UserPromptSubmit' || e === 'clear' || e === 'active')
}

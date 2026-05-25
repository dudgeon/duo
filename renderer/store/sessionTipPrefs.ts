// ENH-183 C11 — first-time educational banner pref. Once dismissed,
// the tip never re-shows for this Duo install. **Renderer pref only**
// — lives in `localStorage`, NOT in workspace metadata, NOT in
// `~/.claude/`, NOT in any persisted store under Duo's control beyond
// the browser's own preferences (D9 — this isn't shadowing Claude's
// data, so it's allowed).
//
// Tested-by-design escape hatch: open DevTools → Application → Local
// Storage → delete `duo:enh-183:seen-rename-tip`. The tip will re-show.

const KEY = 'duo:enh-183:seen-rename-tip'

const subscribers = new Set<() => void>()

export function getSeenRenameTip(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function setSeenRenameTip(seen: boolean): void {
  try {
    if (seen) localStorage.setItem(KEY, '1')
    else localStorage.removeItem(KEY)
  } catch {
    // localStorage might be unavailable (private mode, etc.) — degrade
    // gracefully. Tip will re-show next session; not a correctness
    // issue, just a UX one.
  }
  subscribers.forEach((fn) => fn())
}

export function subscribeSeenRenameTip(fn: () => void): () => void {
  subscribers.add(fn)
  return () => { subscribers.delete(fn) }
}

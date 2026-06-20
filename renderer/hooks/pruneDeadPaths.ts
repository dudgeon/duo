// BUG-167 (folded into ENH-182) — proactive mount-time pruning of
// persisted navigator state. The reactive ENOENT self-heal in
// useNavigator only fires when the user navigates to or expands a dead
// folder; this util runs once at startup and drops ghosts BEFORE the
// user touches them, so the very first project switch is already quiet.
//
// Lives apart from the hooks so both `useNavigator` and
// `useUserClaudeNavigator` share the same implementation — both replay
// persisted `expanded` sets, both accumulated ghost entries from the
// same pattern (a folder deleted between sessions). The util is also
// unit-testable without mounting React.

/** Probe one path for existence on disk. */
export type DirExistsProbe = (path: string) => Promise<boolean>

/** Probe every entry in `expanded`. Return the subset whose probe
 *  resolved `false`. Entries whose probe THROWS (IPC unreachable,
 *  permission flake) are intentionally NOT included — a probe failure
 *  must never drop nav state speculatively. */
export async function findDeadExpandedPaths(
  expanded: Iterable<string>,
  probe: DirExistsProbe
): Promise<string[]> {
  const paths = [...expanded]
  if (paths.length === 0) return []
  const checks = await Promise.all(
    paths.map(async (p): Promise<readonly [string, boolean | null]> => {
      try {
        return [p, await probe(p)] as const
      } catch {
        return [p, null] as const
      }
    })
  )
  return checks.filter(([, ok]) => ok === false).map(([p]) => p)
}

/** ENH-221 — is `child` the same path as `ancestor`, or nested inside it?
 *  Boundary-safe: `/a/foo-bar` is NOT within `/a/foo`. Used by the
 *  navigator's worktree-removal heal (D5/D6) to tell whether the dead cwd
 *  is the worktree that just vanished (→ revert to its main checkout) vs.
 *  some unrelated dead path (→ nearest-ancestor fallback). */
export function pathIsWithin(child: string, ancestor: string): boolean {
  const a = ancestor.replace(/\/+$/, '')
  const c = child.replace(/\/+$/, '')
  if (!a) return false
  return c === a || c.startsWith(a + '/')
}

/** Walk up from a dead path to the nearest ancestor that still exists.
 *  Returns `fallback` if no ancestor below root qualifies. Used to
 *  recover a missing persisted `cwd` to something the navigator can
 *  actually render. `/` always exists so the loop terminates. */
export async function nearestExistingAncestor(
  deadPath: string,
  probe: DirExistsProbe,
  fallback: string
): Promise<string> {
  let cur = deadPath
  while (cur.length > 1) {
    const slash = cur.lastIndexOf('/')
    const parent = slash > 0 ? cur.slice(0, slash) : '/'
    if (parent === cur) break
    cur = parent
    try {
      if (await probe(cur)) return cur
    } catch {
      /* probe failed — keep walking up */
    }
  }
  return fallback
}

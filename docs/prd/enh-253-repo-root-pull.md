# ENH-253 PRD — Navigator repo-root "Pull latest changes"

> **Status:** Built on branch `claude/file-navigator-git-pull-kt3dv7`, PR
> open. **No live UI verification** — this was built in a cloud/headless
> session with no Electron/computer-use access. Typecheck clean,
> `check:skill-currency` PASS, `core/git/pull.test.ts` (7 live-git cases)
> green, plus a hand-run end-to-end CLI smoke test against real temp
> repos. Owner: Geoff · priority: owner-requested directly. **An owner
> `/smoke-walk` is owed before any cut.**
>
> **References:**
> - `tasks.md` → **ENH-253** (running ledger).
> - **Code touched:** `core/git/pull.ts` (new), `core/git/pull.test.ts`
>   (new), `renderer/components/PullModal.tsx` (new),
>   `renderer/components/FileTree.tsx`, `shared/types.ts`,
>   `shared/host-api.ts`, `electron/preload.ts`, `electron/main.ts`,
>   `cli/duo.ts` (+ `cli/duo` binary). 4-surface CLI docs:
>   `skill/references/cli-reference.md`, `agents/duo.md`,
>   `docs/CLI-COVERAGE.md`. Side cleanup: `core/git/clone.ts`,
>   `core/git/failure-sniff.ts`.
> - Closest sibling precedent: **ENH-222** (worktree lifecycle —
>   `docs/prd/enh-222-worktree-lifecycle.md`), the first Duo feature to
>   write git state from both the navigator and a git-direct CLI verb.

---

## Summary

The navigator's right-click context menu gains **"Pull latest changes"**
on any folder that IS a git repo root (the cwd's own root, or a peer-repo
root row when browsing a parent directory). It fetches the remote and
applies the safest update it can without ever silently discarding
anything: a clean, behind-only checkout fast-forwards automatically; a
clean but diverged checkout auto-merges; a dirty working tree warns and
offers one explicit, clearly-labeled destructive override. The same
capability ships on the CLI (`duo pull`) per the CLI-parity rule, and it
works standalone — no running Duo app, no Claude Code session required
(the owner's explicit ask: *"needs to work without Claude"*).

---

## A. Decisions

| # | Decision | Pick | Rationale |
|---|---|---|---|
| **D1** | Conflict-handling mechanism | **Warn, then a single explicit override button** — fetch always; clean+behind-only pulls silently (no dialog); dirty or diverged shows a warning with counts and a "Discard my changes and pull" button (`git reset --hard` to the remote); a genuine merge conflict during an auto-merge attempt aborts safely and points at a human. | Matches the owner's literal ask ("could warn on overwrite but allow overwrite if I pushed changes") with the fewest moving parts. Considered: stash-and-reapply (rejected — if the reapply itself conflicts, the PM's edits end up parked in a git stash, invisible without CLI comfort); block-with-no-override (rejected — doesn't satisfy the ask). |
| **D2** | Result/progress UI | **A small modal** (`PullModal.tsx`), mirroring the existing `CloneModal.tsx` busy → success/error panel pattern. | Duo has no ephemeral toast system; the `duo-banner-{ok,warn,error}` panel-in-a-modal family is the established "networked git action" surface (Clone uses it). Reusing it keeps this feature visually consistent instead of inventing a new UI primitive. |
| **D3** | "Repo root" gate | Stricter than the existing `inGhRepo` menu gate (which means "inside a repo with a GitHub remote"): `isRepoRoot` requires the right-clicked target to exactly BE a repo root — the cwd's own `workTreeRoot` (reachable via the git ribbon/pill or whitespace-right-click) or a peer-repo root row (`childRepoMap`). | "Pull latest changes" only makes sense on the root itself, not an arbitrary file/subfolder inside a repo — a per-file right-click showing a repo-wide action would be confusing. Reuses the exact peer-repo lookup `childRepoMap` already provides (ENH-152a v2). |
| **D4** | gh CLI involvement | **None** — `runPull` shells out to plain `git fetch`/`git merge`/`git reset --hard` only, never `gh`. | `gh` has no `pull` subcommand; its only value-add (auth) is already provided transparently by whatever credential helper `gh auth login` configured in the user's git config, or SSH keys. This matches the codebase's existing split: `gh` is a hard requirement for PR-create/fork (no git equivalent exists), preferred-with-fallback for clone (`gh repo clone` vs `git clone`), and unused for fetch/push/merge (`core/git/push.ts` is the existing precedent). |
| **D5** | CLI transport | **Git-direct, no socket** (mirrors `duo worktree`), not socket-routed (mirrors `duo clone`/`duo pr`). | The target folder already exists locally (unlike clone) and the operation has no app-surface side effect (unlike `worktree new --window`), so there's nothing only the running app can do. Git-direct means `duo pull` works inside a sandboxed Claude Code session and without Duo running at all — directly satisfies "needs to work without Claude." |
| **D6** | Genuine merge-conflict handling | **Abort immediately, report, change nothing.** No in-app conflict-resolution UI. | Explicitly out of scope per the owner's framing ("simple... even if it leaves many corner cases unaddressed"). Line-level conflict resolution needs to see both versions and pick hunks — building that UI is a different, much larger feature. Safety invariant instead: the repo is never left in a conflicted state a non-technical user could stumble into; `git merge --abort` runs unconditionally on any merge failure. |

---

## B. Implementation

| Layer | What |
|---|---|
| **core** | `core/git/pull.ts` — `runPull(cwd, {force?})`. Decision table: fetch → `behind===0` → up-to-date; `dirty` → `needs-confirmation` (or, with `force`, `git reset --hard @{upstream}` → discarded-and-pulled); `!dirty && ahead===0` → `git merge --ff-only` → fast-forwarded; `!dirty && ahead>0` → `git merge --no-edit` → merged, or abort → merge-conflict. Never throws (mirrors `push.ts`/`worktree.ts`). |
| **shared** | `PullResult`/`PullOptions` in `shared/host-api.ts` (re-exported via `shared/types.ts`); `GIT_PULL` IPC channel. |
| **IPC** | `electron/preload.ts` `git.pull(req)` → `electron/main.ts` `ipcMain.handle(IPC.GIT_PULL, ...)` → `runPull` (same core fn the CLI uses, mirrors `GIT_CREATE_WORKTREE`). |
| **renderer** | `FileTree.tsx`: `isRepoRoot` computed in `popupMenu` (mirrors the existing peer-snap-preferred `inGhRepo` pattern, BUG-132 rev2 precedent) → `buildTreeMenuTemplate` adds "Pull latest changes" → `handleMenuChoice` case `'pull-latest'` opens `PullModal` with the resolved repo root. `PullModal.tsx` (new) — no form (unlike Clone); fires the pull on open, renders busy/success/warning/error. |
| **CLI** | `duo pull [<path>] [--force] [--json]` in `cli/duo.ts`, git-direct import of `runPull` (no socket case needed). Result branching uses if/else, not a nested `switch`/`case` — a second `case '<result>':` ladder in the same file would collide with `check-skill-currency`'s naive whole-file `case '<verb>':` scan (discovered + fixed during this build). |
| **docs** | 4-surface sync: `skill/references/cli-reference.md`, `agents/duo.md`, `docs/CLI-COVERAGE.md`; `check:skill-currency` PASS; `cli/duo` binary rebuilt (`npm run build:cli`). |
| **cleanup** | `core/git/clone.ts`'s private `looksLikeAuthFailure`/`looksLikeBadUrl` → shared `core/git/failure-sniff.ts` (owner-requested scoped cleanup of the gh-auth flow; zero behavior change, verified no test pinned the old private copies). |

CLI verb shape:

```
duo pull [<path>] [--force] [--json]
  → { ok, result?, commitsApplied?, branch?, errorKind?, error?, dirty?, changedCount?, aheadCount?, behindCount? }
  result ∈ { up-to-date, fast-forwarded, merged, discarded-and-pulled }
  errorKind ∈ { not-a-repo, no-upstream, auth-missing, needs-confirmation, merge-conflict, pull-failed }
```

---

## C. Findings & deviations from plan

- **C-1 (FIXED) — `check-skill-currency`'s A7 false-positive.** The CLI verb's success-message branching was originally a `switch (res.result) { case 'up-to-date': ... }`. `scripts/check-skill-currency.mjs`'s A7 check scans the WHOLE file for `case '<token>':` to build the dispatched-verb set, unscoped to the outer verb switch — so `case 'up-to-date':` etc. were misread as 4 phantom CLI verbs, and flagged as undocumented across all doc surfaces. Fixed by rewriting the inner branch as an if/else chain (zero behavior change). Worth remembering for any future verb whose result type has string-literal branches.
- **C-2 (BY DESIGN) — no live UI verification.** This was built in a cloud/headless Claude Code session with no Electron or computer-use access (`.claude/rules/ui-verification.md` rule 7e couldn't be followed — there is no display to request access to). Verified instead via: typecheck, the full existing test suite (no regressions — the 2 failures present both before and after this change are pre-existing and unrelated), 7 new live-git unit tests exercising every branch of `runPull` against real temporary repos, and a hand-run end-to-end CLI smoke test. **An owner `/smoke-walk` of the actual right-click → modal flow is owed before any cut.**
- **C-3 (DEFERRED, by design) — genuine merge-conflict resolution.** Per D6 / the owner's explicit framing, a real content conflict aborts and reports; there is no in-app hunk-picker. Tracked as a known v1 limitation, not a bug.
- **C-4 (DEFERRED) — no remote configured at all.** A repo with zero remotes falls through the `no-upstream` gate (the `@{upstream}` rev-parse fails identically whether there's no tracking branch or no remote at all) with a generic "isn't tracking a remote branch" message. Accurate but not maximally specific; not worth a second git call to distinguish in v1.
- **C-5 (BY DESIGN) — multi-remote repos.** `runPull` always operates on the current branch's configured upstream (`@{upstream}`), never prompts for a remote choice. Matches `git pull`'s own default behavior; out of scope to add a remote picker.

---

## D. Test coverage

- **Unit/integration (core):** `core/git/pull.test.ts` — 7 cases against a hermetic bare "origin" + a real `git clone` (not mocks): not-a-repo, no-upstream, up-to-date, fast-forward (a second clone pushes, mirroring a teammate), dirty→needs-confirmation→force-discard (asserts the dirty edit survives the preflight call untouched, then is correctly replaced after `force: true`), clean-diverged auto-merge (non-overlapping files), and the genuine-conflict abort path (asserts no `.git/MERGE_HEAD`, clean `git status --porcelain`, HEAD unmoved after the abort).
- **Manual (CLI):** hand-run end-to-end against real temp repos outside the test suite — `duo pull` on an up-to-date clone, then again after a second clone pushed a new commit (`fast-forwarded`, `commitsApplied: 1`).
- **Suite:** full `vitest run` — 2159/2160 relevant tests green (pre-existing, unrelated failures: `electron/browser-manager.test.ts` needs the Electron binary, blocked by this sandbox's network policy; `core/vault/rollup-markdown.test.ts` GitHub-link-resolution case, reproduces identically on `main`). `npm run typecheck` clean. `check:skill-currency` PASS (81 verbs, 0 failures).
- **Not yet done:** an owner-driven live smoke-walk of the actual navigator right-click → `PullModal` flow (blocked on Electron/computer-use access in this session).

---

## E. Open follow-ups (not in v1)

1. **C-3** — in-app conflict resolution (currently: abort + point at a human).
2. **C-4** — a more specific "no remote configured" error distinct from "no upstream tracking branch."
3. A live owner smoke-walk covering: the menu item's visibility gate (root-only, not any file), the silent fast-forward happy path, the dirty-tree warning + destructive override, and (if reproducible) the merge-conflict abort message.

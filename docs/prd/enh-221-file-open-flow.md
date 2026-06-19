# ENH-221 PRD — Unified Open & GitHub round-trip ("open a remote doc like it's local; Save → PR")

**Status:** Draft for owner sign-off · 2026-06-19 · **Owner:** Geoff · **Tracker:** `tasks.md` § ENH-221 · **Decisions captured via:** two AskUserQuestion rounds (2026-06-19), folded into § 3. · **Preview:** (renders as source on GitHub — read the markdown.)

---

## 1 · Problem & vision

Duo still *feels like an IDE*. Getting into a document is a verb-and-path
chore (`duo open ~/some/long/path.md`, or hunt through the navigator), and
anything that lives on GitHub is a multi-step manual dance: clone the repo
somewhere, find the file, edit it, then remember the whole `branch → commit →
push → open PR` ritual by hand. None of that feels like Google Docs or Word,
where "open a thing and start working" is a single, friendly motion.

The vision is **one familiar Open affordance that erases the difference between
local and remote.** You hit ⌘O, paste *either* a local path *or* a GitHub
link, and Duo does the right thing:

- **Local file / folder** → focus its folder in the navigator, open the asset
  in its natural viewer. (Modality 1 — "Duo already knows it's here.")
- **GitHub-hosted file** → Duo recognizes it as a Duo-supported format, pulls
  it down into an **opaque managed checkout** the user never has to think about,
  and opens it exactly like a local file. Edits save locally like any doc. The
  moment the working copy **diverges from what was fetched**, a **"Submit PR"**
  affordance appears. One tap (prefilled, editable) ships the change back as a
  pull request — **auto-forking** when the user has no push access, so the
  cross-person / cross-namespace collaboration case "just works."

**Driving use case (owner).** Person A sends Person B a link to a markdown file
in a GitHub repo Person B does *not* own. Person B hits ⌘O, pastes the link,
the doc opens like it's local, B makes edits, and B ships a PR back to A's repo
— without ever consciously cloning, forking, branching, or pushing. **Open →
edit → save ≈ propose changes.** This is the feature that turns Duo from "an
IDE I drive" into "the easiest way to collaborate on a doc."

**Why this is differentiating.** Today `duo open <url>` only ever lands a URL in
the *browser pane* — read-only, no path back upstream. Git plumbing is
read-only (`clone`, `gh-auth`, `git-status`, `worktree`); there is **no
branch / commit / push / PR-create.** So the "Save → PR" half is net-new. The
payoff is large: effortless, low-ceremony collaboration on plain files in git,
intelligible to humans and agents that have no concept of this feature.

---

## 2 · Glossary

| Term | Meaning |
| --- | --- |
| **Open bar** | The unified ⌘O / File ▸ Open… affordance. Accepts a local path **or** a URL; the resolver figures out the modality. CLI twin: the extended `duo open`. |
| **resolver** | The pure brain that classifies an Open input → `local-path` \| `local-clone-of-remote` \| `github-file-url` \| `other-url`. Drives every downstream branch. |
| **managed checkout** | An opaque, Duo-owned working tree under `~/.claude/duo/checkouts/…` that the user never has to locate or manage. Created by a depth-1 clone (D5). |
| **baseline** | The exact upstream blob/ref Duo fetched. Divergence = working file ≠ baseline. The signal that flips the "Submit PR" affordance on (D2). |
| **share-back** | The explicit outward action behind "Submit PR": ensure a push target (write-check → **fork if needed**), branch, commit, push, open/update the PR. |
| **cross-fork PR** | A PR opened from Person B's fork into Person A's repo, used whenever B lacks push access (D3). Opaque to the user. |
| **real clone** | An existing local working copy of the same repo (matched by remote URL) the user already has. Modality-1 reuse target (D6). |

---

## 3 · Locked decisions (D-numbered; source = the two AUQ rounds, 2026-06-19)

| # | Decision | Choice |
| --- | --- | --- |
| **D1** | Entry point | **Unified Open bar** — a Google-Docs-style ⌘O / File ▸ Open… that accepts a **local path OR a URL** and routes by the resolver. Mirrored as the extended `duo open` CLI verb (parity). One affordance, no "which command do I want." (r1 Q4) |
| **D2** | Save / publish model | **Save = local; "Submit PR" is explicit.** Save writes to the managed checkout like any doc. When the working file **diverges from the fetched baseline**, a **"Submit PR" affordance appears** (owner: *"save local, but when local differs from checkout, 'Submit PR' button appears"*). The outward GitHub step is always deliberate and reviewable. (r1 Q1) |
| **D3** | PR origin (no push access) | **Auto-fork, then cross-fork PR.** Duo detects no push access, forks the repo to the user's account (via `gh`), pushes the branch there, opens the PR cross-fork — fully opaque. When the user **does** have push access, branch on origin instead. (r1 Q2) |
| **D4** | Checkout home | **Managed temp, opaque by default** — `~/.claude/duo/checkouts/<owner>-<repo>@<ref>/`. The user never thinks about it. Offer an optional "save a real local copy here…" escape hatch. Never pollutes the user's working tree. (r1 Q3) |
| **D5** | Pull scope | **Shallow-clone the whole repo (depth-1), favoring the target file.** Full-fidelity: relative image/links in the doc resolve, the navigator can show sibling files ("bring focus to the folder"), and the PR diff is real. Heavier on first open is an accepted trade. (r2 Q1) |
| **D6** | Already-local case | **Detect + offer to use the real clone.** Match the pasted URL against known local clones (navigator roots / recents, by remote URL). If found → **offer** to open the file from there (modality 1 — focus the folder). Else → managed checkout. Offer (not silent reuse) so we never surprise-edit the user's real working tree / current branch. (r2 Q2) |
| **D7** | PR submit UX | **Prefill everything, one-tap, editable.** Auto-generate branch name, PR title (from the doc's first `#` heading), and a simple body; show a **compact confirm sheet pre-filled** so it's one tap to ship but still editable. Familiar "Share" feel. (r2 Q3) |
| **D8** | Format scope (v1) | **Markdown first; other text formats next.** Ship the full round-trip for `.md` first (the driving use case); build the machinery so it extends to other editable text (json / yaml / html canvas) without redesign. Binary (images / pdf) stays **view-only** when remote. (r2 Q4) |
| **D9** | Auth | **Lean on the `gh` credential helper** (the existing `gh-auth` probe + `core/git/auth.ts`). Unauthenticated → bounce to "Run `gh auth login`," the same pattern the Clone modal already uses. No in-app OAuth / token handling. (carried from existing clone design) |

**Owner directive (carried from ENH-208 r2 walk).** Every shipped verb lands the
full **4-surface sync** (`cli/duo.ts` · `skill/SKILL.md` · `agents/duo.md` ·
`docs/CLI-COVERAGE.md`) **plus** a `what-duo-does.html` entry. Restated as
acceptance criteria in every phase below.

---

## 4 · The flow, as primitives

Each primitive: what the **user** does, what **Duo/CLI** does, the **files**
touched.

### P1 · The resolver (the Open brain)

- **User:** ⌘O → pastes a local path **or** a URL → Enter.
- **Duo:** classify the input:
  1. **Local path** (`~/…`, absolute, relative, `file://`) → P-local (focus
     folder + open in viewer; this is today's `resolveOpenTarget` + navigator
     focus, lightly extended).
  2. **GitHub file URL** (`github.com/<o>/<r>/blob/…`, `/raw/…`, permalink
     `…/blob/<sha>/…`, `raw.githubusercontent.com/…`) → check D6 (real clone?)
     → else P2/P3 (checkout) → P4 (open).
  3. **Other URL** (non-GitHub http(s)) → today's behavior: open in the browser
     pane (`duo navigate`). Unchanged.
- **Files:** `renderer/` Open-bar component; a new pure resolver module
  (e.g. `core/open/resolve.ts`) shared by UI + CLI; extends
  `cli/duo.ts resolveOpenTarget`.

### P2 · GitHub URL recognition + normalization

- **Duo:** parse `<owner>/<repo>`, `<ref>` (branch | tag | sha), `<path>` from
  the supported GitHub URL shapes; normalize raw ↔ blob ↔ permalink. Pin the
  exact `<ref>` so the baseline (D2) is unambiguous.
- **Files:** extend `core/git/remote-url.ts` (already parses/rewrites remote
  URLs) with a `parseGithubFileUrl()`.

### P3 · Fetch / checkout (opaque)

- **Duo:** depth-1 clone (D5) the repo into the managed home (D4), checked out
  at the pinned ref. Reuse `core/git/clone.ts` (gh-preferred, git fallback).
  Record a **pointer** (no sidecar copy of GitHub state — per CLAUDE.md §12):
  `{ owner, repo, ref, path, checkoutDir, baselineSha }` in Duo session state,
  resolved live thereafter.
- **Files:** `core/git/clone.ts` (reuse), new `core/open/checkout.ts`, session
  state pointer.

### P4 · Open into the viewer

- **Duo:** hand the checked-out file path to the existing classify→open path
  (`fileClassifier.ts` → `.md` = `editor`). Focus the checkout folder in the
  navigator so siblings/assets are visible (D5). From here it is an ordinary
  local doc.
- **Files:** reuse `fileClassifier.ts`, `useNavigator`, WorkingPane.

### P5 · Divergence tracking → "Submit PR" affordance

- **Duo:** track working-file vs baseline (D2). On divergence, surface the
  **"Submit PR"** affordance near the doc (exact treatment = OQ-1). On
  convergence (revert / matches upstream), hide it.
- **Files:** a divergence watcher (cheap content/hash diff against
  `baselineSha`); renderer affordance.

### P6 · Share-back (the net-new git write plumbing)

- **Duo:** on "Submit PR" → (a) write-check the origin; (b) if no push access,
  **auto-fork** to the user's account (D3); (c) create a branch; (d) commit the
  working changes; (e) push to the fork/origin; (f) open the PR (cross-fork when
  forked) via `gh`. Show the **prefilled, editable confirm sheet** first (D7).
- **Files (net-new):** `core/git/{branch,commit,push,fork,pr}.ts`,
  socket handlers in `electron/main.ts`, CLI verb(s) (see § 5).

### P7 · Post-PR state

- **Duo:** show the resulting PR link ("View PR"). **Subsequent saves that
  re-diverge update the same PR** (push to the same branch) — the "Submit PR"
  affordance becomes "Update PR." After upstream merge, a fresh divergence opens
  a new PR/branch.
- **Files:** session-state pointer gains `{ prNumber, prUrl, branch, forkOwner }`
  (live-resolved; still a pointer, not mirrored state).

---

## 5 · CLI surface (parity rule)

The CLI is the spec — the human Open bar + Submit-PR affordance each need a twin.

| Verb | Purpose | Notes |
| --- | --- | --- |
| `duo open <path-or-url>` | **Extend** the existing verb to recognize GitHub file URLs → checkout → open (P1–P4). Local + non-GitHub URL behavior unchanged. | The Open-bar twin. |
| `duo pr create [<path>] [--title …] [--body …] [--draft]` | Share-back (P6): branch/commit/push/PR, auto-fork as needed. Defaults prefilled from the doc (D7); flags override. | The "Submit PR" twin. |
| `duo pr status [<path>]` | Report the doc's checkout + divergence + PR state (JSON). | Visibility-cluster citizen. |
| `duo pr view [<path>]` | Print / open the PR URL (P7). | "View PR" twin. |

Supporting git verbs may also surface (`duo branch`, `duo push`) if the
share-back internals prove useful standalone — decide during build, keep the
4-surface sync. Every new verb → `cli/duo.ts` + `skill/SKILL.md` +
`agents/duo.md` + `docs/CLI-COVERAGE.md` + a `what-duo-does.html` entry.

---

## 6 · Phased build (each phase independently shippable)

**Phase 0 — The Open bar.** ⌘O / File ▸ Open… UI + the unified resolver (P1)
for the **already-working** cases only: local path (focus folder + open) and
non-GitHub URL (browser pane). No GitHub fetch yet. Delivers the "familiar,
friendly Open dialog" feel immediately.
*Acceptance:* ⌘O opens the bar; local path + http(s) URL both resolve correctly;
`duo open` unchanged for these; smoke-walked; `what-duo-does.html` entry.

**Phase 1 — GitHub URL → open-as-local (read/edit, no PR).** P2 + P3 + P4:
recognize a GitHub file URL, shallow-checkout into the managed home, open the
`.md` in the editor, focus the checkout folder. Saving writes locally. No
share-back yet.
*Acceptance:* a `github.com/.../blob/.../*.md` URL opens like a local file;
relative assets resolve; checkout is opaque (under `~/.claude/duo/checkouts/`);
4-surface sync for the extended `duo open`; smoke-walked.

**Phase 2 — Share-back (the core).** P5 + P6 + P7: divergence → "Submit PR"
affordance → prefilled confirm sheet → branch/commit/push/PR with **auto-fork**
(D3) → "View PR" → subsequent-save updates the PR. Net-new
`core/git/{branch,commit,push,fork,pr}.ts` + `duo pr create|status|view`.
*Acceptance:* edit a remote `.md`, click Submit PR, a real PR appears upstream
(cross-fork when no push access); unauthenticated bounces to `gh auth login`;
re-save updates the same PR; full 4-surface sync; smoke-walked.

**Phase 3 — Already-local detection (D6).** Match pasted URL → known local
clones by remote URL; offer to open from the real clone (focus the folder) with
the managed-checkout fallback.
*Acceptance:* pasting a URL for a repo already in a navigator root / recents
offers the real clone; declining falls back to managed checkout; no silent edits
to the user's tree.

**Phase 4 — Format breadth + polish (D8).** Extend the round-trip machinery to
json / yaml / html canvas; "save a real local copy here…" escape hatch (D4);
binary view-only confirmation.
*Acceptance:* a remote `.json`/`.yaml` round-trips via the same path; escape
hatch works; smoke-walked.

---

## 7 · Open questions (build-time / owner)

- **OQ-1 — "Submit PR" affordance treatment (owner wants options).** Owner
  (r1 Q1): *"will need to see UI treatment options."* **Decision playground
  built:** [`docs/research/file-open-submit-pr-ui.html`](../research/file-open-submit-pr-ui.html)
  — visual mockups of four treatments (toolbar button · slide-in banner ·
  status-chip popover · footer "propose" bar), plus decision cards for the
  button label, confirm-sheet depth, and post-PR state. Walk + decide before
  Phase 2.
- **OQ-2 — Baseline staleness / push rejection.** Upstream moves after checkout;
  push is rejected or the PR conflicts. **v1:** attempt the push; on rejection,
  surface the conflict plainly ("upstream changed — pull latest"). Richer
  auto-rebase/sync deferred.
- **OQ-3 — Multi-file edits in one checkout.** One checkout can accumulate edits
  to several files. **v1:** the branch/PR carries whatever diverged in that
  checkout (PR scoped to the checkout). Per-file PRs deferred.
- **OQ-4 — Private repos / SSO orgs.** Relies entirely on `gh` (D9). Document
  the dependency; no special handling in v1.
- **OQ-5 — Fork hygiene.** Reuse an existing fork if the user already has one;
  branch-naming convention (`duo/<doc-slug>-<short>`); fork cleanup is **not**
  Duo's job (leave the fork).
- **OQ-6 — Checkout GC.** Managed checkouts accumulate under
  `~/.claude/duo/checkouts/`. **v1:** leave them; add a prune later (size/age).

---

## 8 · Cross-refs

- **Reuse:** `core/git/clone.ts` (depth-1 clone, gh-preferred), `core/git/auth.ts`
  (`probeGhAuth`), `core/git/status.ts`, `core/git/remote-url.ts` (parse/rewrite),
  `cli/duo.ts` (`resolveOpenTarget`, `open`/`edit`/`view`),
  `renderer/components/fileClassifier.ts`, `renderer/hooks/useNavigator.ts`.
- **Net-new:** `core/open/{resolve,checkout}.ts`,
  `core/git/{branch,commit,push,fork,pr}.ts`, Open-bar component, Submit-PR
  affordance, `duo pr …` verb cluster.
- **Related tickets:** ENH-154 (`gh-link` — link local folder ↔ GitHub repo),
  ENH-155 (FileTree GitHub menu — "Open on GitHub" / "Copy GitHub URL"),
  ENH-152 (navigator git-status overlay), FOLLOWUP-025 (Clone modal),
  `docs/research/github-integration-cluster-v2.html` (prior GitHub-cluster
  research). This ENH is the "round-trip an external doc" complement to that
  cluster's "manage my own repo" focus.
- **Invariant (CLAUDE.md §12 — no sidecar).** The checkout pointer stores only
  IDs/paths that resolve live (`owner/repo/ref/path/checkoutDir/baselineSha`,
  `prNumber/prUrl/branch/forkOwner`). GitHub PR/branch state is read live via
  `gh`, never mirrored.

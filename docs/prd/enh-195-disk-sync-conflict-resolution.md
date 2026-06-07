# PRD — Editor ↔ disk reconciliation & conflict resolution (ENH-195 + ENH-197)

> **Retroactive PRD.** Documents a feature already designed, built, verified, and
> shipped (merged via [#70](https://github.com/dudgeon/duo/pull/70), v0.9.x line).
> Written after the fact to capture expected behaviors, requirements, and the
> rationale for the locked decisions. Scope is **locked** — there are no open
> decisions here (per the rule-11 markdown-vs-playground split). For the running
> engineering ledger see [`tasks.md`](../../tasks.md) § ENH-195 / ENH-197;
> historical detail in [`session-log.md`](../dev/session-log.md) (2026-06-05/06).

| | |
|---|---|
| **Status** | ✅ Shipped (v0.9.x). Retroactive doc. |
| **Owner** | Geoff |
| **Source ENHs** | ENH-195 (reconciliation + CLI edits + responsiveness), ENH-197 (View-diff resolution). Related fix: BUG-195 (split-view ghost). |
| **Follow-ups (out of scope)** | ENH-196 (canvas change-highlight parity), ENH-198 (agent-native CriticMarkup track-changes). |
| **Surfaces touched** | `renderer/hooks/useDiskReconciliation.ts`, `renderer/components/editor/` (MarkdownEditor, trackedDiff, trackedChanges, reloadDiff), `renderer/components/Page/PageTab.tsx` (canvas), `renderer/components/Json/`, `core/socket-server.ts`, `cli/duo.ts`. |

---

## 1. Context & problem

Duo pairs Claude Code terminals with an embedded editor/canvas/browser. The
core promise is that **the agent and the human edit the same artifacts**. That
makes the editor↔disk boundary load-bearing: an agent writes a file from a
terminal while the human has it open in Duo's editor, and vice-versa.

Three symptoms, **one root cause**. The reconciliation layer was *guessing*
whether a disk change was (a) the echo of Duo's own write, or (b) a real
external edit — by comparing disk bytes against the editor's **serialized**
view through a hand-grown `normalizeForEchoCompare`. That guess:

1. **False-positived a conflict banner** whenever the serialized view diverged
   from disk (every TipTap round-trip quirk — soft-breaks, attribute ordering,
   injected `data-duo-id`s). The human got "This file changed on disk" for a
   change they didn't make.
2. **Silently swallowed a real external edit** that happened to normalize-equal
   the buffer — so the editor "didn't notice" agent changes (the human kept
   stale content on screen).
3. Was only necessary because **agents write *behind* the editor** — there was
   no surgical markdown verb, no JSON verb, and no way to even ask "is this
   file open in Duo?", so agents used raw `Write`/`Edit` and the editor fought
   the change.

A later finding (the v0.9.0 pre-walk) added a fourth: when a clean buffer is
**destructively overwritten** on disk (autosave having already flushed the
human's edits), the byte-faithful reload **silently replaced the document** —
the human lost work with only an informational strip, no recourse.

## 2. Goals / non-goals

**Goals**
- **G1** — Make agent markdown/JSON editing flow through `duo` verbs that are
  *echo-safe* against the open editor (no false conflict from a sanctioned write).
- **G2** — Make every viewer/editor **notice and reflect** external (agent or
  third-party) on-disk changes promptly.
- **G3** — **Eliminate false-positive** conflict banners while **preserving** a
  real conflict prompt when the human has genuinely unsaved edits.
- **G4** — When an external change would **destroy** the human's document, give
  them a **choice** (keep mine / take theirs / review the diff) rather than a
  silent overwrite.

**Non-goals**
- Real-time collaborative (OT/CRDT) co-editing. This is single-writer-at-a-time
  reconciliation, not concurrent merge.
- A general 3-way merge UI. "View diff" reuses the existing tracked-changes rail
  (2-way old↔new), not a conflict-marker merge editor.
- Canvas change-highlight on reload (markdown only for v1 → ENH-196).
- Teaching agents the CriticMarkup track-changes format (→ ENH-198).

## 3. Expected behaviors

### 3.1 The reconciliation state machine (per open file)

On a watched file's disk-change event, the shared hook decides one outcome:

| Buffer state | Disk change vs. baseline | Outcome |
|---|---|---|
| (any) | byte-identical to last-seen disk | **No-op** (spurious event / unchanged) |
| (any) | matches a recent Duo write | **No-op** (own echo; consumed once) |
| **Clean** | small real change | **Silent reload** + inline change-highlight |
| **Clean** | destructive (>50% changed) | **Reload + "destructive overwrite" banner** (§3.3) |
| **Clean** | strips persisted Duo anchors (canvas) | **Conflict banner** (would orphan comment anchors) |
| **Dirty** | cosmetic / round-trip-equal | **Ignore** (no banner, no edit loss) |
| **Dirty** | real divergence | **Conflict banner** (§3.2) |

The decision compares **disk bytes against the byte-exact last-seen-disk
baseline** (not the serialized view). The serialized view feeds only the
dirty-check and the dirty-path cosmetic-equality test.

### 3.2 Conflict banner — dirty buffer (BUG-085 lock, D4)

The human has unsaved edits AND the file changed on disk with a real
divergence → an amber banner: **"This file changed on disk while you were
editing"**. **ENH-202** (owner request, 2026-06-06) unified this with the
destructive banner (§3.3) to three actions: **Keep mine** (next save overwrites
disk), **Reload from disk** (adopt disk, drop edits), and **View diff** (adopt
the disk content as accept/rejectable tracked changes *against your unsaved
doc* — Accept-all = disk, Reject-all = yours). This is the only path that can
lose unsaved edits, and it never fires without an explicit human choice.
*(Markdown only — the HTML canvas has no CriticMarkup tracked-changes rail, so
its dirty banner stays the two-action Reload / Keep-mine.)*

### 3.3 Destructive-overwrite resolution — clean buffer (ENH-197)

A clean buffer whose document is mostly replaced by an external write
(`changedFraction > 0.5`) reloads to the disk version **and** surfaces a banner
with three actions:

- **Keep mine** — restore the pre-reload document (captured at reload time) and
  re-save it, reverting the external change on disk.
- **Load new** — keep the disk version; dismiss.
- **View diff** — rebuild the document as **accept/rejectable tracked changes**
  representing old → new (the human's text struck via `deletionMark`, the new
  text inserted via `insertionMark`), surfaced through the **existing
  suggesting-mode rail** ("N suggestions · Accept all · Reject all" + inline
  marks). **Accept all → the disk version; Reject all → the human's version.**

### 3.4 CLI editing verbs (D1)

- **`duo status`** → JSON list of open working tabs with `{kind, path, title,
  dirty, active, pinned}`. Lets an agent ask "is this file open / dirty in Duo?"
- **`duo doc edit <path> --find "X" --replace "Y" [--occurrence N|--all] [--at-line N]`**
  → surgical plain-markdown find/replace (`--occurrence`/`--all` scope the
  match(es), `--at-line` confines to a line). Routed **through the open buffer**
  (echo-registered, no false conflict) when the file is open; a direct disk
  write when closed. Returns `{ok, changed, replacements, path}`.
- **`duo json set <path> <dotpath> <value>` / `duo json merge <path> <patch.json>`**
  → JSON/YAML edits; echo-safe when open; format inferred from extension.

### 3.5 Responsiveness (G2)

The markdown editor, HTML canvas, **and** the JSON/YAML, image, and PDF viewers
watch their open file and refresh on external change. A post-attach catch-up
read closes the load↔watch race; rename/delete is surfaced, not a crash. The
"removed on disk — save to recreate it" strip is shown on the three **editing**
surfaces only (markdown shipped v0.9.0; canvas + JSON/YAML under ENH-113 via the
shared `onFileRemoved` callback). The read-only image and PDF viewers meet the
weaker contract — they keep the last-loaded frame on delete rather than crashing.

## 4. Functional requirements

- **FR-1** — A disk change byte-identical to the last value Duo read or wrote is
  a no-op (no reload, no banner).
- **FR-2** — A disk change that is the echo of one of Duo's own recent writes is
  a no-op; the echo entry is **consumed once** so a later genuine external write
  of the same bytes is not masked.
- **FR-3** — A real external change to a **clean** buffer reloads the editor to
  the disk content (byte-faithful: *any* remaining byte difference reloads).
- **FR-4** — A small clean-buffer reload paints an inline change-highlight
  (washed insertions + deletion ticks, persist-until-next-edit) in markdown.
- **FR-5** — A destructive (`>50%`) clean-buffer reload surfaces the
  Keep-mine / Load-new / View-diff banner (§3.3); the banner persists until the
  human acts (no auto-dismiss).
- **FR-6** — "Keep mine" restores the exact pre-reload document and re-saves it.
- **FR-7** — "View diff" produces tracked changes such that **Accept-all
  reproduces the disk document exactly and Reject-all reproduces the pre-reload
  document exactly** (the round-trip invariant).
- **FR-8** — A real external change to a **dirty** buffer surfaces the conflict
  banner (Reload / Keep mine); a cosmetic/round-trip-equal change to a dirty
  buffer is ignored.
- **FR-9** — `duo status` reports every open working tab with its dirty/active/
  pinned flags.
- **FR-10** — `duo doc edit` / `duo json set|merge` applied to a file that is
  **open** route through the buffer and do **not** raise a conflict banner
  (echo-safe); applied to a **closed** file, they write disk directly.
- **FR-11** — Closing a file editing surface tears down its watcher; a renamed/
  deleted open file shows a recoverable affordance rather than erroring.
- **FR-12** — The reconciliation pipeline is a **single shared implementation**
  consumed by markdown, canvas, and JSON; per-surface behavior is injected as
  callbacks (no copy-paste divergence).

## 5. Non-functional requirements

**Correctness**
- **NFR-1** — The View-diff round-trip (FR-7) holds for inline, block-level, and
  whole-document changes (verified by `Node.eq` over the resolved doc).
- **NFR-2** — Frontmatter and EOL style survive a reconcile intact (the disk-read
  helper used at save time is **pure** — no side effects that could clobber
  in-progress frontmatter).
- **NFR-3** — The genuine canvas anchor-loss banner (BUG-125-v2) still fires when
  a write strips `data-duo-id`s that were **persisted on disk**, while a clean
  external content edit of a no-persisted-id canvas reloads silently.

**Performance**
- **NFR-4** — Reconcile is O(n) over document tokens; the watcher uses chokidar
  with debounce; the echo set is **count-bounded** (cap 32) and consumed on the
  matching event — no wall-clock timer that could expire before a large file's
  event arrives (the 1.2 MB-file failure mode).
- **NFR-5** — Reconcile must not block typing; highlight/diff painting is
  best-effort chrome that never blocks a reload (wrapped so a diff failure still
  reloads the content).

**Security**
- **NFR-6** — `duo json set|merge` rejects `__proto__` / `constructor` /
  `prototype` keys (prototype-pollution guard), including via the Electron main
  process path.
- **NFR-7** — Open/closed routing resolves symlink + case-fold path aliases
  (canonical path) so a write via an aliased path is still recognized as the
  open file.
- **NFR-8** — The PreToolUse warn-hook is **fail-open and `$DUO_SESSION`-gated**
  — it never blocks an edit, and is inert outside a Duo PTY.

**Compatibility & parity**
- **NFR-9** — CLI/UI parity: anything the human can do to a buffer, the agent can
  do from `duo` verbs (the CLI is the spec).
- **NFR-10** — Editor/canvas remain parallel *editing* surfaces, but share **one
  reconciliation layer** (DECISIONS.md:620 amended to scope the lock to the
  editing primitive, not reconciliation).
- **NFR-11** — No new runtime dependency: the diff uses `@tiptap/pm/changeset`
  (transitive), not a new package.

**Reliability & durability**
- **NFR-12** — No sidecar disk-hash cache; all baselines are in-memory refs read
  live (state lives where it belongs — DECISIONS.md § sidecar litmus).
- **NFR-13** — The reconciliation state machine carries durable test coverage
  (the ~11-bug BUG-085→BUG-166 arc had zero integration tests before this).

## 6. Architecture & key decisions

- **D1 — Full CLI edit surface.** `duo status` + `duo doc edit` + `duo json
  set|merge` (vs. status-only or markdown-only).
- **D2 — Guidance + warn-only hook.** A fail-open, `$DUO_SESSION`-gated
  PreToolUse nudge on `Edit`/`Write` to a Duo-open file, plus priming/CLAUDE/skill
  guidance (vs. guidance-only or a blocking hook).
- **D3 — Byte-faithful clean reload + markdown change-highlight.** Any byte
  difference on a clean buffer reloads; the normalize gauntlet is reserved for
  echo-suppression + the dirty-path cosmetic test only. Canvas highlight deferred
  (ENH-196).
- **D4 — Keep the dirty-buffer conflict banner** (the BUG-085 lock).
- **D5 — One shared `useDiskReconciliation` hook** across the three surfaces.
- **ENH-197 — Destructive-overwrite resolution via tracked changes.** "View
  diff" reuses the CriticMarkup suggesting rail; the old↔new diff is built by a
  **block-level LCS** (`trackedDiff.ts`) — whole-block strike+insert for
  dissimilar blocks, inline char-diff (gated at ≤50% block change) for small
  edits — so a wholesale rewrite reads cleanly rather than as char-interleaved
  noise.

**Key implementation invariants**
- The **byte-exact `lastSeenDiskRef`** is the primary echo/conflict comparator;
  the serialized baseline only feeds the dirty + cosmetic checks.
- The pre-reload document is captured before `setContent` so "Keep mine" /
  "View diff" can recover or diff it.
- Tracked-change accept/reject deletes the **whole block node** when a marked
  range spans a block end-to-end (else strands empty block shells) — a latent
  bug fixed as part of ENH-197.

## 7. Edge cases (handled)

- Autosave (800 ms debounce, default on) flushing the human's edits before an
  external write lands — so the "dirty buffer" window is small and a destructive
  overwrite hits a *clean* buffer. Addressed by §3.3 (the human still gets a
  choice).
- A markdown soft-break / round-trip artifact reloading a clean buffer (D3
  byte-faithful: disk bytes win) without a banner.
- Rapid double-save echoes (a stale chokidar event for an earlier body) — no
  banner, no reload (the bounded echo set).
- The load↔watch race (a write landing in the gap between the initial load read
  and the watcher subscription) — closed by a post-attach catch-up read.

## 8. Acceptance / verification

- **923 automated tests** pass, both typecheckers clean. New coverage:
  `useDiskReconciliation.test.ts` (the reconciliation state machine, incl. the
  canvas divergent-seed regression), `trackedDiff.test.ts` (the View-diff
  round-trip + granularity lock), `jsonOps.test.ts` (the prototype-pollution
  guard).
- **Adversarial review** (15-agent) on the original cut found + fixed 9
  confirmed bugs (3 high-sev) before ship.
- **Live smoke walk** (v0.9.1-rev2, run in the split-view aux): **VIEW-DIFF and
  WARN-HOOK both PASS**; markdown / JSON / canvas reconciliation + all three
  verbs verified on the running build.

## 9. Out of scope / tracked follow-ups

- **ENH-196** — mirror the markdown reload change-highlight onto the canvas.
- **ENH-198** — make agents emit Duo-native CriticMarkup for tracked changes
  (they default to writing `<ins>` HTML tags, which don't render as Duo tracked
  changes) — via `duo doc` guidance/verb and/or editor reformatting.
- **BUG-195** (fixed alongside, not a disk-sync requirement) — `split-view
  close` orphaned an aux **browser** tab's WebContentsView (ghost); the renderer
  close/promote handlers now call `releaseAuxTab()` unconditionally.

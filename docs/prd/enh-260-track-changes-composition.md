# ENH-260 — Track-changes composition (suggesting-mode rewrite)

**Status:** decisions locked 2026-07-08 (owner paste-back from
`docs/research/track-changes-composition.html`); implementation in flight on
PR #129. This PRD is the locked-scope record AND the work contract for the
implementation agents.

**Problem (one line).** Suggesting mode composes edits wrong: deleting your own
pending insertion double-marks instead of netting out (phantom `{--…--}` on
save, corrupted reject-baseline), type-over/cut/paste-over hard-delete original
text untracked, Backspace at a deletion edge hard-deletes struck text, and
typing inside a deletion is swallowed. Full evidence: the ENH-260 playground
(§ 3 probes) and `tasks.md § ENH-260`.

---

## 1 · Locked decisions

### Owner-locked (playground paste-back, 2026-07-08)

| # | Decision | Choice |
|---|---|---|
| D1 | What counts as "own" insertion for net-zero delete | **SAME-AUTHOR-OR-UNATTRIBUTED** — a pending InsertionMark is "own" when its `author` attr is `null` OR equals the current author. Only a *different, non-null* author is foreign. |
| D2 | Delete-route coverage architecture | **TRANSACTION-REWRITE** — reconcile every content-removing transaction at the plugin level (appendTransaction), not per-input-route intercepts. Covers keys, type-over, cut, paste-over, drag, IME, programmatic. |
| D3 | Typing inside a tracked deletion | **RELOCATE-TO-END** — the typed text moves to just after the end of the contiguous deletion run, InsertionMark'd, caret after it. Deletion runs stay contiguous; del+ins adjacency folds to `{~~old~>new~~}` on save. |
| D4 | Backspace/Delete at the edge of an existing deletion | **SKIP-CARET** — the caret jumps across the struck run (backspace → to its start; forward-delete → to its end); struck text is never re-deleted. Continued backspacing marks the text *before* the run. |
| D5 | CLI compose semantics (`duo doc delete/substitute`) | **COMPOSE** — ranges overlapping `{++…++}` tokens decompose: insertion-token sub-ranges shrink/split/remove the token; plain sub-ranges get `{--…--}` / substitution treatment. Refusal remains for overlaps with `{--…--}` / `{~~…~~}` / `{==…==}` / comment tokens. |
| D6 | Attribution on disk | **CM-PURE** — standard CriticMarkup tokens, no author metadata on ins/del/sub/highlight (Stage 14b Q3 lock stands). Attribution is a live-session property. |

### Derived decisions (state-and-proceed, this PRD)

- **D7 — cross-author nested state (in-memory only).** When the current author
  deletes a *foreign* pending insertion (D1: non-null, different author), the
  text keeps its InsertionMark and *additionally* gets a DeletionMark — the
  only sanctioned ins+del coexistence, meaning "pending insertion, deletion
  suggested by another author." Semantics: **accept** (that deletion) →
  delete the text (resolves both suggestions); **reject** → remove the
  DeletionMark (restores the pending insertion). **Serializer degradation:**
  CM-pure cannot represent the nested state, so double-marked text serializes
  as the *insertion token only* (`{++text++}`) — the counter-suggestion is the
  newer, less-destructive thing to drop, and the reject-baseline stays correct.
  Never serialize double-marked text as `{--…--}`.
- **D8 — structural deletions pass untracked.** A deletion whose removed slice
  contains **no text characters** (e.g. Backspace at a paragraph start joining
  two blocks) is not reinstated — CriticMarkup marks are text-only and cannot
  carry a paragraph-boundary deletion. Known, documented limitation (Word
  tracks paragraph marks; CM cannot). Mixed slices (text + structure, e.g. a
  selection across paragraphs) ARE reinstated in full, preserving structure.
- **D9 — programmatic transactions opt out via shared meta.** Any dispatch that
  mutates content but is *not a user edit* must carry
  `META_SUGGEST_AUTO` (see `suggestMeta.ts`) or one of the existing guards
  (`addToHistory: false`, `preventUpdate`). This now *matters for deletes*:
  accept/reject helpers delete content, and without the meta the reconciler
  would resurrect it. Sites that MUST stamp: all four accept/reject helpers in
  `trackedChanges.ts`, `DeletionMark.acceptDeletion`, `applyTrackedDiff`
  (already `addToHistory`-guarded — verify), history-restore, and any other
  programmatic `tr.delete`/`replaceWith` dispatch found by grep.
- **D10 — code contexts unchanged.** Fenced code blocks and inline-`code`
  spans keep today's disposition: edits there are untracked native edits (the
  reconciler skips ranges the marks can't legally apply to, both for insertion
  stamping and deletion reinstatement).

## 2 · Architecture

Two intercepts become one engine + one thin plugin:

```
renderer/components/editor/suggestMeta.ts      (new, tiny)  meta constants
renderer/components/editor/suggestEngine.ts    (new, pure)  the kernel
renderer/components/editor/extensions/SuggestingMode.ts     (rewritten, thin)
```

### suggestEngine.ts — pure functions, no Editor dependency

- `isOwnSuggestionMark(mark, currentAuthor)` — D1 policy.
- `segmentDeletedSlice(doc, from, to, currentAuthor)` — classify the range
  into ordered segments: `own-insertion` (really delete) · `already-deleted`
  (reinstate as-is, D4 caret handling) · `foreign-insertion` (reinstate with
  ins+del per D7) · `plain` (reinstate with DeletionMark) · `code`
  (reinstate bare — untracked, D10).
- `buildSuggestionTr(oldState, transactions, newState, currentAuthor,
  deleteDirection)` → `Transaction | null` — the reconciler. For each
  qualifying user transaction, walk its steps (each step's before-doc is
  `tr.docs[i]`); for every `ReplaceStep`/`ReplaceAroundStep`:
  1. **Deletions** (`oldEnd > oldStart`): slice the before-doc; if the slice
     has no text → D8 skip. Otherwise re-insert at the mapped position (before
     any content the same step inserted — struck-old-then-new reading order) a
     transformed copy: own-insertion text dropped (net-zero), plain text
     DeletionMark'd (current author), already-deleted text kept as-is,
     foreign-insertion text kept + DeletionMark added (D7), code text kept
     bare. Reuse `markFragmentText` (export it from `trackedDiff.ts`).
  2. **Insertions** (`newEnd > newStart`): stamp InsertionMark (current
     author) with the existing code-block/inline-code skip rules (port them
     verbatim from the old appendTransaction), AND strip any DeletionMark the
     inserted text inherited; if the insertion landed strictly inside a
     deletion run, relocate it to just after the run's end (D3) and put the
     caret after it.
  3. **Caret:** after a pure deletion that was fully reinstated, place the
     caret per `deleteDirection`: `backspace` → start of the reinstated range;
     `forward` → end; unknown → end. (Direction is recorded by the plugin's
     keydown listener — records only, never consumes.)
- Skip guards for the whole transaction batch: `META_SUGGEST_AUTO`,
  `getMeta('addToHistory') === false`, `getMeta('preventUpdate')`,
  history-plugin metas (`'history$'`), `!docChanged`.
- **Invariant** (exported check used by tests + a dev-only console.warn):
  ins+del may coexist on a text node ONLY when the InsertionMark author is
  non-null and ≠ the DeletionMark author (D7 state). Any other coexistence is
  a bug.

### SuggestingMode.ts — the thin plugin

- `appendTransaction` → delegate to `buildSuggestionTr` when enabled.
- `handleKeyDown` → records Backspace/Delete direction for caret placement;
  implements D4's caret-skip **as a pure selection move** when the caret is
  collapsed against a deletion-run edge in the delete direction AND the run is
  not preceded by anything deletable in that direction… simpler contract: when
  the char that would be deleted is already deletion-marked, move the caret
  across the *entire contiguous run* instead of letting the delete run
  (consume the event, no doc change). Everything else falls through — the
  reconciler handles it.
- Keep `storage: { enabled, getAuthor }` API unchanged (MarkdownEditor wiring
  untouched). Keep `priority: 1000`.
- `wrapAsDeletionWithView` is deleted; tests that imported it are reworked to
  drive the same scenarios through dispatched transactions (same assertions).

### Consumers of the (now well-defined) mark states

- `markdownCriticMarkup.ts § extractCmInfo` — explicit precedence: ins+del →
  **insert** (D7 degradation), never last-wins.
- `trackedChanges.ts` — `collectTrackedChanges` emits double-marked runs as
  `kind: 'deletion'` with a new `overInsertion: true` flag; per-range accept →
  delete text; per-range reject → remove DeletionMark only; `acceptAll` /
  `rejectAll` → delete the text either way (accept: del accepted; reject: the
  underlying insertion is rejected too). All four helpers +
  `acceptTrackedChange`/`rejectTrackedChange` stamp `META_SUGGEST_AUTO`.
- `core/markdown/docEdit.ts` — D5 compose (see § 4, package S2).

## 3 · Acceptance criteria

1. The four playground probes, as permanent regression tests, now observe:
   - P1: type `XY`, backspace → doc/serialize `Hello {++X++}world`; rail: one
     insertion `X`.
   - P2: select `world`, type `planet` → `Hello {--world--}{++planet++}`
     (folds to `{~~world~>planet~~}` on save); cut and paste-over behave
     identically.
   - P3: wrap `world` as deletion, Backspace at its right edge → caret jumps
     to before `world`; doc unchanged; next Backspace marks the char before.
   - P4: type `Z` mid-`{--world--}` → `Hello {--world--}{++Z++}` with caret
     after `Z`.
2. Property tests (battery of scenario scripts): with suggesting ON from
   baseline B producing doc D — `acceptAll(D)` equals the same script applied
   with suggesting OFF, and `rejectAll(D)` equals B. (Same invariant
   `trackedDiff.test.ts` proves for reload diffs.)
3. Foreign-author scenario (D7): author A inserts, author B deletes it →
   in-memory ins(A)+del(B); accept → gone; reject → back to pending ins(A);
   serialize → `{++text++}`.
4. `duo doc delete --text` targeting text inside a `{++…++}` shrinks the token
   (removing it entirely when emptied); a range spanning insertion + plain
   decomposes into shrink + `{--…--}`; overlaps with del/sub/highlight/comment
   still refuse with the existing message. `substitute` analogous.
5. Existing suites stay green: `suggestInlineCode` (reworked, same coverage),
   `undoHistory` (undoDepth contracts hold — one Cmd+Z reverts a whole
   suggested op), `markdownCriticMarkup`, `trackedDiff`, `docEdit`,
   `reloadDiff`. `npm run typecheck` and `npm run check:skill-currency` pass.
6. Docs current: this PRD; `tasks.md` ENH-260 status; playground gets a
   "decisions locked → shipped in PR #129" note; CLI help + `skill/SKILL.md` +
   `agents/duo.md` + `docs/CLI-COVERAGE.md` reflect D5 composition;
   `cli/duo` binary rebuilt iff `cli/duo.ts` changed.

## 4 · Work packages

- **S1 — suggestEngine** (new `suggestEngine.ts` + `suggestEngine.test.ts`;
  export `markFragmentText` from `trackedDiff.ts`). Pure-function kernel per
  § 2 + unit/property tests. No changes to SuggestingMode.ts.
- **S2 — docEdit compose** (`core/markdown/docEdit.ts` + `docEdit.test.ts`).
  D5 semantics; `buildStrippedView`/occurrence behavior unchanged; existing
  tests must keep passing unmodified unless they pin the old refusal for
  insertion overlaps (update those to the compose expectation).
- **S3 — consumers** (`markdownCriticMarkup.ts`, `trackedChanges.ts`, new
  `trackedChanges.test.ts`). D7 precedence + double-marked semantics +
  META_SUGGEST_AUTO stamping (import from `suggestMeta.ts`).
- **S4 — plugin rewrite** (`extensions/SuggestingMode.ts`, rework
  `suggestInlineCode.test.ts`, new integration test with the four probes +
  the property battery at the editor level). Depends on S1.
- **S5 — docs + CLI surfaces** (`cli/duo.ts` help text, `skill/SKILL.md`,
  `agents/duo.md`, `docs/CLI-COVERAGE.md`, `tasks.md`, playground note,
  `docs/dev/active-sprint.md`). Depends on S2 landing.

## 5 · Out of scope

- Canvas-surface track changes (parity disposition (b) — surface-specific).
- Persisting attribution (D6 locked CM-pure; revisit only on multi-author
  demand).
- Standalone-comment atoms, ENH-198's agent-guidance work.
- Tracking paragraph-boundary-only deletions (D8 limitation).
- **Inner-content markdown escaping in CM tokens** (pre-existing, surfaced
  during implementation): special characters *inside* token text — e.g.
  `{++a > b ~ c++}` — are serialized by tiptap-markdown as `&gt;` / `\~`.
  This round-trips correctly through the editor (markdown-it unescapes on
  load) but is unfriendly to external CM tooling reading the raw source.
  The token *delimiters* are protected (the ENH-260 fold fix sentinels
  `{~~ ~> ~~}` through serialization); inner-content escaping is a
  follow-up if external-tooling interop demands it.

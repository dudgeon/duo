# ENH-198 PRD — Agent-native markdown track-changes: teach the agent CriticMarkup (and an optional `duo doc suggest` alias)

> **Status:** spec drafted 2026-06-06 (not yet implemented). **Priority:**
> Medium. **Effort:** S (docs/guidance-dominant; the suggestion *machinery*
> already ships — see § 3). One genuine owner decision: **D1** (ship the thin
> `suggest` alias, or guidance-only). Authored in a Linux remote sandbox; the
> verification in § 8 is doc-driven plus one optional live CLI check.
>
> **References:**
> - Filed in [`tasks.md`](../../tasks.md) → **ENH-198** (owner, on the
>   v0.9.1-rev2 walk OTHER NOTES).
> - Existing machinery this rides on (BUG-138 Phase 3):
>   - `core/markdown/docEdit.ts` — the pure body→CriticMarkup helpers
>     (`insertAfter` L180, `deleteText` L266, `substituteText` L337,
>     `highlightText` L309, `addAnchoredComment` L377, `acceptOp` L537,
>     `rejectOp` L569).
>   - `core/markdown/criticmarkup.ts` — parser/serializer + Duo's
>     pipe-metadata comment extension (`serializeOp` L236).
>   - `renderer/components/editor/markdownCriticMarkup.ts` —
>     `applyCriticMarkupFromText` (L71) converts CM tokens → TipTap marks on
>     load; `serializeWithCriticMarkup` (L190) round-trips marks → tokens.
>   - `core/socket-server.ts` → `handleDocEdit` (L498) — the `doc-edit`
>     command that backs every CriticMarkup verb (**disk-only**, see § 5).
>   - CLI verbs: `cli/duo.ts` → `case 'doc'` insert/delete/substitute/
>     highlight/comment/accept/reject (L1062–1168); per-verb help
>     `printDocHelp` (L2047).
> - Discovery surfaces that must stay in lockstep (CLI-parity rule):
>   `skill/SKILL.md` (the "Leave a comment or track-change" recipe, L331–404),
>   `skill/references/comments.md`, `agents/duo.md` (verb cheat-sheet L197+),
>   `docs/CLI-COVERAGE.md` (L107+).
> - Cross-ref: **ENH-197** (View-diff tracked-changes machinery) — the
>   read/preview side of the same CriticMarkup system.

---

## 1. What we're building

When an agent is asked to "**use track changes**" / "suggest edits" / "leave
tracked changes" on a markdown file, the change should render as Duo's native
**accept/rejectable suggestions** (CriticMarkup marks in the right-side rail) —
**not** as literal `<ins>…</ins>` / `<del>…</del>` HTML, which Duo's editor
treats as plain prose and which the user cannot accept or reject.

This is **not** a new feature build. Duo *already* ships the complete
agent-facing suggestion pipeline (BUG-138 Phase 3). ENH-198 closes a pure
**discoverability gap**: the verbs that produce tracked changes are named
`insert` / `delete` / `substitute`, and **no surface tells the agent "write
CriticMarkup, never `<ins>`/`<del>` HTML."** So an agent reaching for its naive
prior (HTML edit tags) is never corrected.

The fix is two parts, the first mandatory and the second the owner's call (D1):

1. **Guidance (mandatory).** Add an explicit "**use the CriticMarkup verbs;
   never write `<ins>`/`<del>`/`<s>` HTML — Duo renders those as literal text,
   not tracked changes**" steer to the four discovery surfaces *and* the
   `duo doc` help index, keyed off the phrase the owner actually used ("track
   changes" / "suggest").
2. **A thin `duo doc suggest` alias (optional — D1).** A convenience verb that
   maps the natural phrase to the existing op set, so an agent that types the
   obvious thing lands on the right path without first reading the skill.

**Out of scope (deferred / separate items):**
- **Editor reformatting (approach (b) in `tasks.md`)** — auto-detecting
  `<ins>`/`<del>` on load and converting to CM marks. A fuzzier safety net
  (what to detect, round-trip fidelity); **deferred**, see § 10. The guidance
  fix removes the need in the common case.
- The `duo doc track-changes [on|off]` *suggesting-mode* toggle — a separate
  P1 gap already tracked in `docs/CLI-COVERAGE.md` L238 (PRD D18). Unrelated to
  authoring a suggestion; not part of ENH-198.

---

## 2. Persona + job to be done

**Primary persona:** the PM/owner pairing with an agent in a Duo terminal,
editing a `.md` (a PRD, a spec, a note) the owner has open in Duo's editor.

**Job:** *"I told the agent to mark up this doc with track changes — I want
each edit to show up as a suggestion I can accept or reject, the same as if a
human reviewer used Suggesting mode."* The agent's job-to-be-done is to **map
the owner's plain-language request to the duo-native format on the first try**,
without the owner having to know — or say — the word "CriticMarkup."

**The failure that triggered this (from `tasks.md`):** the owner told an agent
to "use track changes to modify an .md"; the agent wrote literal
`<ins>…</ins>` HTML into the file. That does not render as a Duo tracked change
— the editor's format is CriticMarkup, which it already parses. The agent
simply didn't know the duo-native format, and nothing in its context told it.

---

## 3. What already exists (do NOT rebuild)

Grounding, because the first-triage assessment understated this. The full
authoring → render → accept/reject loop ships today:

| Capability | Verb (ships now) | Emits | Backed by |
|---|---|---|---|
| Suggest an insertion | `duo doc insert <f> --text "X" (--after\|--before\|--at-line)` | `{++X++}` | `docEdit.insertAfter/Before/AtLine` |
| Suggest a deletion | `duo doc delete <f> --text "X"` | `{--X--}` | `docEdit.deleteText` |
| Suggest a substitution | `duo doc substitute <f> --text "X" --with "Y"` | `{~~X~>Y~~}` | `docEdit.substituteText` |
| Highlight | `duo doc highlight <f> --text "X"` | `{==X==}` | `docEdit.highlightText` |
| Comment / reply | `duo doc comment <f> --anchor "X" --body "B"` | `{==X==}{>>…<<}` | `docEdit.addAnchoredComment` |
| Accept / reject | `duo doc accept\|reject <f> (--id\|--match)` | resolves the token | `docEdit.acceptOp/rejectOp` |

All seven route through one socket command (`doc-edit`, `handleDocEdit` at
`core/socket-server.ts:498`). On load the editor converts these tokens to
TipTap marks (`applyCriticMarkupFromText`), renders them in the suggestion
rail, and the user accepts/rejects per-op. SKILL.md L331–404 even carries a
runnable "Leave a comment or track-change" recipe with `DUO_AUTHOR` attribution.

**So the only thing missing is the agent knowing to reach for these instead of
`<ins>`/`<del>`.** Two confirmed absences in the current tree:

- **No negative guidance anywhere.** `grep -niE "<ins>|<del>|<s>|do not write"`
  across `skill/SKILL.md`, `agents/duo.md`, `docs/CLI-COVERAGE.md`, `cli/duo.ts`
  returns nothing. The agent's wrong prior is never contradicted.
- **No phrase-bridge.** The verbs are `insert`/`delete`/`substitute`; an agent
  scanning for "track changes" / "suggest" finds no matching verb name and no
  index entry, so it doesn't connect the request to the verb cluster.

---

## 4. The model (D1)

**D1 — How far to go: guidance-only, or guidance + a `suggest` alias?**

The guidance half (§ 6) is **mandatory either way**. D1 is only about whether to
*also* ship a thin convenience verb. Owner picks; recommendation is **(a)**.

- **(a) Guidance + a thin `duo doc suggest` alias (recommended).** Add
  `duo doc suggest <file>` that forwards to the existing op set by flag shape —
  a pure CLI-layer router in `cli/duo.ts`, **no new `socket-server` / renderer
  code** (it emits the same `doc-edit` payloads the named verbs do):
  - `--replace "<old>" --with "<new>"` → `substitute` op
  - `--replace "<old>"` (no `--with`) → `delete` op
  - `--insert "<text>" (--after "Y" | --before "Y" | --at-line N)` → `insert` op
  - bare `--help` prints the "this is track-changes; here's the CriticMarkup it
    writes; never `<ins>`/`<del>`" steer.

  Rationale: the agent that types the obvious thing (`duo doc suggest`) lands on
  the right path *before* reading the skill — guidance helps the careful agent,
  the alias catches the hasty one. Cost is one `case`-arm in `cli/duo.ts` +
  binary rebuild; it reuses `flagValue` and the existing `doc-edit` send.

- **(b) Guidance-only — no new verb.** Update the four surfaces + `duo doc`
  help so a skill-aware agent maps "track changes" → `insert`/`delete`/
  `substitute`, and add the negative `<ins>`/`<del>` steer. Zero new surface
  area, zero binary rebuild, but relies entirely on the agent having loaded the
  skill before it acts.

> **Owner-recommended in `tasks.md` (approach (a)) is the alias.** Stated
> inline here so the implementer doesn't re-litigate: build **(a)** unless the
> owner says otherwise.

---

## 5. Behaviors

### 5a — The negative steer (mandatory, both D1 branches)

Every place that documents the CriticMarkup verbs gains one explicit line, in
the agent's voice, paraphrasable as:

> **For tracked-change suggestions in markdown, write CriticMarkup tokens
> (`{++ins++}`, `{--del--}`, `{~~old~>new~~}`) via `duo doc insert/delete/
> substitute` — NEVER `<ins>`/`<del>`/`<s>` HTML. Duo's editor renders HTML
> edit tags as literal prose, not accept/rejectable suggestions.**

Placed at: SKILL.md L331+ recipe header; `agents/duo.md` near the `duo doc`
cheat-sheet rows; `docs/CLI-COVERAGE.md` `duo doc` cluster; and the `duo doc`
help index (`printDocHelp`, so it surfaces at the CLI too, since an agent that
runs `duo doc --help` should be corrected there).

### 5b — Phrase-bridge in the help index

In `printDocHelp`'s grouped listing (`cli/duo.ts:2096`), add a one-line lead
that names the natural phrases so a scanning agent connects them to the verbs:
e.g. *"To suggest / track-change edits, use insert / delete / substitute (they
write CriticMarkup, which renders as accept/rejectable suggestions)."*

### 5c — `duo doc suggest` (only if D1 = (a))

- `duo doc suggest <file> --replace "<old>" --with "<new>"` → emits
  `{~~old~>new~~}` (forwards to the `substitute` op).
- `duo doc suggest <file> --replace "<old>"` → emits `{--old--}` (forwards to
  `delete`).
- `duo doc suggest <file> --insert "<text>" (--after "Y" | --before "Y" |
  --at-line N)` → emits `{++text++}` (forwards to `insert`).
- `--occurrence N` passes through (same disambiguation as the named verbs).
- `DUO_AUTHOR` attribution behaves identically (it already flows through the
  `doc-edit` payload for the named verbs).
- Idempotency / overlap / not-found semantics are **inherited unchanged** from
  `docEdit.ts` — `suggest` adds no new matching logic, it only renames flags.

---

## 6. Implementation notes

- **`suggest` is a CLI-only router (if built).** It does **not** follow the full
  8-step new-verb plumbing checklist, because it adds no new `socket-server`
  command — it reuses `doc-edit`. The touched surfaces are: `cli/duo.ts`
  (`case 'doc'` → `sub === 'suggest'` arm + a `printDocHelp` section), then the
  three doc surfaces (SKILL.md, `agents/duo.md`, `docs/CLI-COVERAGE.md`), then
  `npm run build:cli` + `git add cli/duo`, then `npm run sync:claude`. (Per
  CLAUDE.md rules 8 + 9 and `.claude/rules/cli-plumbing.md` — but *not* steps
  1–4 of the new-verb checklist, since there's no IPC/main/socket change.)
- **No renderer change at all.** The render path (token → mark) already exists;
  `suggest` and the guidance change nothing the editor sees.
- **No editor/canvas parity obligation.** Tracked-change *suggestions* are a
  markdown-source concept; the HTML canvas uses sidecar-JSON annotations
  (`duo html comment`), a separate system already documented in SKILL.md's
  BUG-146 disambiguation table (L344–358). This is a **(b) Skipped —
  surface-specific** disposition under the renderer-surfaces parity rule, and
  the guidance should reaffirm "look at `main.kind` first" so the agent doesn't
  fire markdown verbs at an HTML canvas.

### Correcting two errors in the first-triage assessment

So the implementer isn't misled by the intake notes:

1. **These verbs are disk-only, NOT "echo-safe through the buffer."**
   `handleDocEdit` (`core/socket-server.ts:494`) reads the file via FilesService
   and writes **disk**; when the file is open in the editor, the chokidar
   watcher reconciles the external change (silent on a clean buffer,
   banner-prompted on a dirty one). The **echo-safe buffer route** belongs to
   the *plain* `duo doc edit` path (`doc-edit-plain` → `plainEdit.ts`), which is
   a different, non-CriticMarkup verb. Do **not** model `suggest` on the
   `plainEdit` buffer path; model it on `handleDocEdit`'s disk path.
2. **The suggestion machinery is NOT missing.** The assessment's "the
   recommended convenience verb `duo doc suggest` does not exist" is true only
   of the *alias name* — the underlying `insert`/`delete`/`substitute`
   suggestion verbs (and `docEdit.ts`) already ship. ENH-198 is a
   discoverability fix, not a build.

---

## 7. CLI / UI parity

- **The agent-facing CLI is the leading surface here**, not a follower. The
  human's equivalent is TipTap's Suggesting mode (selecting text and applying
  insert/delete marks in the editor UI); the CriticMarkup verbs already give the
  agent the matching capability. ENH-198 doesn't change UI behavior at all — it
  makes the *already-at-parity* CLI capability **discoverable** under the words
  the owner uses.
- **Deliberate asymmetry — the human has no `<ins>`-to-CM auto-convert either.**
  Approach (b) (editor reformatting) would add a convenience the UI doesn't have
  and the CLI doesn't need once the guidance lands; it stays deferred (§ 10), so
  there is no parity debt created by shipping guidance-only or guidance+alias.

---

## 8. Verification — checklist

Doc-driven; one optional live check. (Authored without Electron — a live run
needs a macOS dev session, but nothing here is render-state-dependent.)

1. **Negative steer present on every surface.** `grep -niE "<ins>|<del>"`
   across `skill/SKILL.md`, `agents/duo.md`, `docs/CLI-COVERAGE.md`,
   `cli/duo.ts` now returns the new guidance lines (and only as *prohibited*
   examples). `duo doc --help` output includes the steer.
2. **Phrase-bridge present.** `duo doc --help` (and the SKILL recipe) name
   "suggest" / "track change" and point to insert/delete/substitute.
3. **Sync ran.** After editing `skill/` + `agents/`, `npm run sync:claude`
   copied them to `~/.claude/`; after editing `cli/duo.ts`,
   `npm run build:cli` regenerated the tracked `cli/duo` binary and it's staged.
4. **`npm run typecheck`** clean.
5. **(If D1 = (a)) `duo doc suggest` round-trips to CriticMarkup** — on a live
   dev session, against a scratch file (use a unique path, do **not** rewrite a
   file the editor has open — `.claude/rules/ui-verification.md` § 7d):
   - `duo doc suggest /tmp/enh198-{rev}.md --insert " (draft)" --after "Title"`
     → file gains `{++ (draft)++}`; if open in the editor, it renders as a
     green-underline insertion pill in the rail (not literal text).
   - `duo doc suggest … --replace "TBD" --with "Geoff D."` → `{~~TBD~>Geoff
     D.~~}` renders as red-strike + green-inline.
   - `duo doc suggest … --replace "scratch"` → `{--scratch--}` renders as a
     deletion suggestion.
   - Each is accept/rejectable via `duo doc accept|reject` (or the rail).
6. **Regression — the named verbs are unchanged.** `duo doc insert/delete/
   substitute` behave exactly as before (the alias forwards, it doesn't
   replace).
7. **(If D1 = (b)) Skip 3's binary rebuild and 5 entirely** — guidance-only is a
   doc-and-help change; verify via 1, 2, 4 and re-reading the rendered SKILL /
   coverage tables.

---

## 9. Future / open

- **Editor reformatting safety net (approach (b)) — deferred.** If, after the
  guidance lands, agents still occasionally emit `<ins>`/`<del>` (or a user
  pastes HTML-marked-up text), revisit auto-converting common track-changes HTML
  (`<ins>`, `<del>`, `<s>`) to CM marks on load/reconcile in
  `renderer/components/editor/markdownCriticMarkup.ts`. File as a follow-up ENH
  cross-referencing this PRD; decide round-trip fidelity (does an accepted
  `<ins>` re-serialize as CM or as nothing?) at that point.
- **`suggest` symmetry with `comment`.** If the alias proves popular, consider
  folding `--comment "<text>" --anchor "Y"` into `duo doc suggest` too, so the
  whole suggestion surface is reachable under one verb. Out of scope for v1.

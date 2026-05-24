# ENH-183 Step 0 empirics

> Output of build-plan C1. Verifies the unverified assumptions behind ENH-183's
> read ladder (D5), write ladder (D8), and JSONL-fallback derivation (D13).
> **Date:** 2026-05-24. **Claude Code version:** 2.1.148.
>
> All findings are from inspecting the installed Claude binary's strings table
> and existing on-disk session storage. No new live `/rename` injections were
> needed — there are already 5+ real `customTitle` JSONL entries on this
> machine from past sessions that empirically demonstrate the write protocol.

## Headline correction

The PRD's D5 read ladder and D8 write ladder named the user-editable title
field `customName`. **The actual field is `customTitle`.** All references in
the PRD, build plan, and CLAUDE.md need a mechanical rename. The field appears
in the Claude binary as both a regex pattern (`"customTitle":"([^"]+)"`) and
literal JSON prefix (`"customTitle":"`), and in real session data as JSONL
entries of the form:

```json
{"type":"custom-title","customTitle":"sunday night","sessionId":"0c3e499a-..."}
```

This is not a casing nit — the rename affects what fields the read ladder
parses, what shape the write payload takes, and how the smoke walk's D9
invariant check is worded.

## Storage layout (more JSONL-centric than the PRD assumed)

The PRD treats `sessions-index.json` as the primary canonical store and
JSONL as a fallback for projects where the index is absent (D13). Empirics
say it's flipped: **JSONL is the primary store; `sessions-index.json` is
optional and absent from most projects on this machine.**

| Storage file | Status on this machine |
|---|---|
| `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl` | Present for every active session. Append-only event log. |
| `~/.claude/projects/<encoded-cwd>/sessions-index.json` | Present in only 2 of ~30 projects (`markdown-feedback`, `git-brain` — both pre-2026-02). The Duo project, where this work is anchored, has NONE. |

Implications:

1. The read ladder cannot assume `sessions-index.json` exists. JSONL-only
   reading must be the primary path, not the fallback.
2. There is no concrete benefit to consulting `sessions-index.json` if it
   exists — we'd have to read the JSONL anyway to get the *latest*
   `custom-title` entry (which `sessions-index.json` may not even reflect;
   see below).
3. D13 (JSONL line count for `messageCount`) was correctly identified as
   necessary; promoting it from "fallback" to "primary" is a small
   adjustment.

## How `/rename` writes (binary-strings evidence)

The Claude binary (a packed JS bundle, `node-pty`-driven CLI at
`~/.local/bin/claude`) contains these telltale strings clustered near the
session-metadata schema:

```
Display title for the session: custom title, auto-generated summary, or first prompt.
File size in bytes. Only populated for local JSONL storage.
User-set session title via /rename.
First meaningful user prompt in the session.
Git branch at the end of the session.
Working directory for the session.
User-set session tag.
Creation time in milliseconds since epoch, extracted from the first entry's timestamp.
Session metadata returned by listSessions and getSessionInfo.
```

And, separately, the entry-type strings:

```
"type":"custom-title"
"customTitle":"
"type":"ai-title"
"aiTitle":"
"type":"tag"
"tag":"
```

**Reading**: `customTitle` (set by `/rename`), `aiTitle` (set by Haiku), and
`tag` are three independent entry types appended to JSONL. The "display
title" described at the top is a **derived** computation (the read ladder)
— not a stored field.

**Function names**: `renameSession`, `onRenameSession`. Wired through the
slash-command dispatcher.

## Real on-disk evidence

Five existing sessions on this machine already carry `customTitle` JSONL
entries from past owner usage:

```
projects/-Users-geoffreydudgeon-Documents-GitHub-duo--claude-worktrees-focused-nobel-7dd6fa/7fd48dde-...jsonl
  → customTitle: "weds"
projects/-Users-geoffreydudgeon-Documents-GitHub-duo-docs/17d05c98-...jsonl
  → customTitle: "Renamed via Duo"          ← was a prior ENH-177 attempt
projects/-Users-geoffreydudgeon-Documents-GitHub-duo/0c3e499a-...jsonl
  → customTitle: "sunday night"
projects/-Users-geoffreydudgeon-Documents-GitHub-duo/19bcc636-...jsonl
  → customTitle: "0.5.1 bug squashing"
projects/-Users-geoffreydudgeon-Documents-GitHub-duo/20ee2573-...jsonl
  → customTitle: "tues night"
```

The "Renamed via Duo" entry is meaningful — it's residue from
[`f351719`](https://github.com/dudgeon/duo/commit/f351719) (the original
ENH-177 implementation that got reverted at `49f4644`). That code wrote
`customTitle` correctly. So **the cherry-pick base in C2 already uses the
right field name** — C3+ are where the PRD's `customName` references need
the correction, not C2.

## Schema field summary (sessions-index.json, when present)

For the two legacy projects that still have `sessions-index.json`, the
schema is:

```json
{
  "version": 1,
  "originalPath": "/Users/.../path/to/cwd",
  "entries": [
    {
      "sessionId": "<uuid>",
      "fullPath": "<absolute path to jsonl>",
      "fileMtime": <ms>,
      "firstPrompt": "<first user message, truncated>",
      "summary": "<derived display title, comes from aiTitle entry>",
      "messageCount": <int>,
      "created": "<ISO>",
      "modified": "<ISO>",
      "gitBranch": "<branch name>",
      "projectPath": "<absolute cwd>",
      "isSidechain": false
    }
  ]
}
```

**Critically: no `customTitle` field even in projects that have it set in
JSONL.** The `summary` field appears to be the Haiku-generated `aiTitle`
projection. `sessions-index.json` is a partial cache, not the source of
truth. The read ladder cannot rely on it for the user-rename field at all.

## messageCount derivation (D13)

Could not cross-check directly: every session in the legacy projects with
both `sessions-index.json` and the JSONL had its JSONL deleted (cleanup?
tombstone removal?). The strings dump mentions:

```
Skipping tombstone removal: session file too large (
```

So Claude does tombstone old JSONLs. The cross-check is unverifiable on
this machine without spawning a fresh session and waiting for both files
to settle.

**Decision:** treat the JSONL line count (filtered to `type:"user"`
entries) as the canonical `messageCount` derivation. Per D9 invariant, we
never cache this value — recompute on each read.

## Read ladder (D5) — revised

Corrected priority order, JSONL-primary:

1. **Latest `{"type":"custom-title","customTitle":"..."}` entry in JSONL**
   (scan JSONL in reverse for performance, return the last one matched).
2. **Latest `{"type":"ai-title","aiTitle":"..."}` entry in JSONL** (same
   reverse-scan strategy).
3. **First `type:"user"` JSONL entry**, cleaned via the D12-spec helper
   (strip `<ide_opened_file>…</ide_opened_file>`, drop conversational
   prefixes, truncate to 60 chars on word boundary).
4. **Bare UUID** as last-resort fallback.

`sessions-index.json` is not consulted by the read ladder. If it exists,
it provides nothing the JSONL doesn't have more authoritatively, and on
the Duo project it doesn't exist at all.

## Write ladder (D8) — revised

`/rename <derived>` PTY-injection causes Claude itself to append a
`{"type":"custom-title","customTitle":"<derived>","sessionId":"..."}` entry
to the JSONL. Duo never writes the JSONL directly. The Haiku auto-summary
flow appends an `aiTitle` entry separately; the two coexist (priority is
resolved by D5).

Open question for the Haiku-vs-customTitle race: since both write
independently, the question is timing. The read ladder picks customTitle
when present regardless of order, so even if Haiku writes its `aiTitle`
AFTER our `/rename`, the user-set title still wins. **D8 is safe.** The
race is not a real issue under the read-ladder's priority.

## Empirics-derived edits required before C2

| Target | Edit |
|---|---|
| PRD § various (22 occurrences) | `customName` → `customTitle` |
| PRD § D5 read ladder | Reword: read from JSONL entries, not `sessions-index.json` field |
| PRD § D8 write ladder | Reword: /rename appends JSONL entry (Claude does the write; Duo invokes via PTY) |
| PRD § D13 | Promote from "fallback derivation" to "primary derivation"; explain sessions-index.json may be absent |
| Build plan C4 | Update field names in source-type union |
| Build plan C8 | Update hydrator "skip already hydrated" check to test JSONL for type:"custom-title"/"ai-title" |
| CLAUDE.md § 12 | Update one stray `customName` reference in active-sprint notes |

## C1 status

- [x] Notes doc written.
- [x] PRD empirics-table NEEDS VERIFY rows resolved (see below).
- [x] All blocking unknowns resolved.

PRD § 11 empirics rows to flip:

- `Schema is UUID-keyed map {uuid: {summary, customName, ...}}` — already
  flagged WRONG; addendum: even the right schema (`{version, entries[]}`)
  is **optional** and absent on the Duo project.
- `/rename X via PTY injection writes to customName` — flipping NEEDS
  VERIFY → **VERIFIED CORRECTED**: writes a JSONL entry
  `{"type":"custom-title","customTitle":"X","sessionId":"<uuid>"}`. Field
  name is `customTitle`, not `customName`. No PTY test needed — 5 real
  examples already on disk.

## Out of scope (deferred to future work, not blocking C2)

- The `aiTitle` write path (Haiku's own injection mechanism) is opaque
  from outside. We don't need to understand it for D8 to work.
- The exact JSONL-event protocol (line-buffered? atomic-per-line? safe to
  read concurrently?) is also opaque; the cherry-pick base of C2 already
  handles whatever pattern works.
- The `tag` JSONL entry type is unrelated to the title fields and out of
  ENH-183's scope.

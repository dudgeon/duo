# Intent conversations

Archived plan-mode conversations where Geoff paused dev to talk through
multiple ideas at once before any one of them was specced or shipped.
Each file is the verbatim plan-mode working artifact from a single
session — preserved for "how we got here" context after the
resolutions were feathered into the canonical roadmap surfaces.

## When to add to this directory

Only when:
1. Geoff explicitly pauses dev for an intent conversation (i.e. "let's
   talk through some ideas"), AND
2. The conversation produces three or more substantive design
   decisions that warrant durable record beyond a session-log entry.

Otherwise, lighter-weight conversations land in `docs/dev/session-log.md`
and that's enough.

## Where the canonical "where we landed" lives

These archive files are NOT specs. The spec lives in the roadmap stage
cards (`docs/roadmap.html`, mirrored in `roadmap.html`). When picking up
a stage for implementation, read the stage card first. The intent-
conversation archive answers "why was this chosen?", not "what should
I build?"

## Lifecycle

These files are append-only. Don't edit a past conversation's resolutions
to reflect later decisions — instead, file a new conversation or update
the relevant stage card. The archive is the historical record; drift is
the failure mode to avoid.

## Index

| Date | File | Topic |
|---|---|---|
| 2026-04-26 night | [`2026-04-26-six-ideas.md`](2026-04-26-six-ideas.md) | Six ideas after Stage 17d-A → Stages 22, 23, 24, 25, 18b, 19d |
| 2026-04-27 dawn | [`2026-04-27-stage-21-signing.md`](2026-04-27-stage-21-signing.md) | Stage 21 signed-cut toolchain — root-caused to iCloud File Provider on `~/Documents/`; not provenance |

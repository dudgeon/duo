# Open intent items for the conversation

> **Why this file exists.** Owner paused dev after Stage 17d-A landed
> (2026-04-26 night) to talk through intent before pulling in the
> next ship. These are the threads I noticed while shipping recent
> stages — surfaced explicitly so the conversation has them at hand,
> not so I push agendas. Triage by the user; not pushing agendas.
>
> **Lifecycle.** Single-shot. Once the conversation lands and
> decisions get baked into ROADMAP / DECISIONS / individual stage
> cards, this file gets deleted (or its content moved into
> session-log.md as a date-stamped resolution).
>
> Star (★) marks items the user explicitly flagged earlier that I
> haven't yet closed out.

---

## Sequencing / what to ship next

- **Stage 14 vs. Stage 17d-B/C vs. Stage 21 vs. defer-and-talk.** All
  three are reasonable next ships per the breadcrumb. Stage 14 has
  the most leverage now that the rail primitive is in place; 17d-B
  + 17d-C are small but their value lights up only when the snippet
  bundle (17d-C) lands first; Stage 21 is mechanical but ships
  distribution. The intent question: which of these maps to a
  Trailblazer milestone the user is aiming at? If 17d-A was "the
  collab loop closes for canvas," then Stage 14 is "same loop for
  markdown" — does that shape the user's calendar?
- **★ Stage 11 tail items.** Frontmatter properties panel, drag-drop
  images, slash menu, floating selection bubble — all defer cleanly,
  none have been pulled in. The original Stage 11 PRD assumed they'd
  ship with 11a; they didn't. Are any worth pulling forward, or is
  this a "ship 14 + 17 first, polish 11 once the editor sees real
  use" call?
- **★ Stage 17a.5 directions A and E** (curated starter templates +
  user-defined template registry). Owner committed direction F
  (markdown shortcuts on typing) and direction D (smart-blank
  overlay). A and E are still open design questions blocking code
  work on a template gallery / registry. The Backlog template-
  loader card is already filed at
  `docs/roadmap.html#backlog-templates` with v1 location +
  agent-CLI shape proposed.

## Ergonomic / process loose ends

- **Visual verification owed on V1–V27.** That's a lot of unwalked
  smoke. Most of it requires the Duo app running, which it usually
  isn't during my sessions. Worth scheduling a dedicated
  "verification afternoon" against the V1–V27 list before the next
  major ship?
- **★ The 19c UI walk on the merged build.** Split-button, ⌘T from
  terminal focus → claude, install banner when claude missing,
  `duo new-tab` round-trip — never been eyes-on-verified post-merge.
  Folds into the verification afternoon.
- **★ FOLLOWUP-002** (`tasks.md`): the C5 outside-Duo guard for the
  duo subagent has a corner case where a narrow Bash allowlist
  permission-denies the guard check, which causes the agent to
  proceed instead of refusing. Hardening idea: refuse-on-check-denied
  in the agent prompt.
- **★ FOLLOWUP-003** (`tasks.md`): the Stage 5 v2 PRD's "~85% token
  reduction" hypothesis didn't survive synthetic measurement. The
  agent's value is real but different (bounded context per task,
  specialized prompt, clear contract) — worth re-framing in the PRD
  so future readers don't expect cold-cache cost wins.
- **★ FOLLOWUP-004**: visual pill rendering verification (Stage
  15.2 + 17c) is gated on computer-use access which has been
  deferred all session.

## Architecture / direction

- **The "common componentry" insight from 17d-A.** Having the
  `<CommentRail>` primitive shipped with both the canvas binding
  AND a documented MD reuse story makes Stage 14 meaningfully
  shorter. Are there other places this pattern ("ship the visual
  primitive with one binding; future bindings cost much less")
  deserves an explicit pass? Stage 14's track-changes primitives
  (`<TrackedRangeMark>`, `<AcceptAllBanner>`) are the obvious next
  ones; the comment-anchor logic in markdown will be very similar
  to canvas's `commentAnchors.ts` — consider refactoring the
  doc-order anchor sort + reconciliation pattern into a tiny
  shared util when 14a lands.
- **Sidecar schema versioning.** 17d-A added the additive
  `resolvedThreads` field; the schema is `version: 1` and we're
  silently extending. The current `isValidSidecar` only checks
  `version === 1`, not field shape. Worth a v2 bump + migration
  pass when the next breaking change arrives — the open question
  is which change crosses that line. Track changes in the sidecar
  (Stage 17 v2)? Comment threading semantics? Per-comment resolved
  state vs. per-thread? Worth a brief design pass.
- **The `data-duo-component` recognition layer is unimplemented.**
  17b shipped the attribute injection but no UI / agent flow
  reads it back. PRD H18 + 17d-C rely on this to teach Claude its
  own snippets; until the recognition flow exists, snippets are
  one-way. Is this the right time to design the read path, or
  defer to when the agent-snippet pattern is in real use?

## Distribution shape

- **Trailblazers cohort timing.** Owner pre-work for Stage 21 is
  done. The mechanical sign + notarize is a half-day. The
  consent-sheet + installer (Stage 18) is independent. Which lands
  first for the cohort?
- **Auth on the Unix socket.** Stage 21 has the launch-time-token
  bullet; the Trailblazer ergonomics shift in interesting ways
  once the socket is auth'd (the agent has to learn about the
  token; today's "just send to the path" simplicity goes away).
  Worth thinking about before 21d ships.

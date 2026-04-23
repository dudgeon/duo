# Duo — Vision

> The product north star. For engineering state see [ROADMAP.md](../ROADMAP.md),
> for locked architectural choices see [DECISIONS.md](DECISIONS.md), for the
> original engineering brief (historical) see [duo-brief.md](../duo-brief.md).

---

## What Duo is

Duo is a macOS workspace for working **alongside an agent**. It bundles the
pieces you need — a terminal, an embedded browser, a file browser, a prose
editor, and a skill/connector surface — into one signed app, and it treats the
presence of an agent as a first-class design assumption rather than an
afterthought.

Duo is **not** an agent. It is a harness for someone else's agent. Today that
means [Claude Code](https://www.anthropic.com/claude-code); the architecture
leaves room for others over time. When this document says "the agent" it means
"whatever agent the user has brought."

The goal is simple: make working with an agent feel as natural and as beautiful
as working in the cloud-docs editors people already know — without closing the
door on the terminal underneath, which is still where the agent actually lives.

---

## Who this is for

### Primary — the product manager without a SWE background

Knows the agent is useful. Does not write code. Lives in Google Docs, Figma,
Notion, Jira, Slack. Is comfortable in a browser tab; is *not* comfortable in a
terminal, does not think in file paths, does not edit markdown by typing `##`.
Has probably installed Claude Code once, been impressed, been overwhelmed, and
gone back to ChatGPT in a browser tab.

The jobs-to-be-done we care about for this persona:

- Draft, revise, and review PRDs, briefs, and strategy docs with an agent in
  the loop — without copy-pasting between windows.
- Pull local assets (a screenshot, a research transcript, a CSV) into the
  conversation without knowing or typing where they live on disk.
- Discover what the agent *can* do in this context — which skills, which
  connectors, which shortcuts — without reading the docs.
- Use the browser as a shared surface: the agent navigates, renders, and the
  PM clicks through.
- Trust that pressing the wrong key won't break anything or leak anything.

### Secondary — other non-SWE knowledge workers

Designers, UX researchers, program managers, marketers, and executives all
share the same shape of problem. Duo should not over-fit to PM-specific
jargon, but when a tradeoff splits the two, the PM use case wins. Where a
feature helps one of these secondary personas noticeably more than the
primary (e.g. a researcher's transcript-synthesis workflow), it lives in the
starter skill pack rather than in core UI.

### Explicitly not the primary audience

Engineers using Claude Code for production software work are already well-served
by a terminal + IDE + browser. Duo should not be hostile to them — the escape
hatches stay — but it is not designed around their workflow and will not
compromise PM-facing ergonomics to suit them.

---

## The problem

The people most excited about agentic AI in a large company are rarely
engineers. They are PMs, designers, researchers, and operators who see the
promise and want in. When they try, they run into the same wall:

- The terminal looks and feels like 1980s infrastructure. They are afraid of
  it and, reasonably, they should be — one wrong command can delete their
  work.
- Markdown is the agent's native format. Cloud-docs people have spent a
  decade unlearning markup.
- Skills, subagents, MCP connectors, and `~/.claude/` live on the file system.
  The file system is invisible to someone whose entire working life is in
  a browser.
- The agent produces beautiful reasoning and the harness renders it as green
  text on a black background at 80 columns.

The result is that the people whose work would benefit most from an agent are
also the people least equipped to access one. Duo is the answer to "what if
the surface looked like the tools these people already love?"

---

## North star

> **Working with an agent should feel like working in a beautiful cloud
> document — not like SSH-ing into a server.**

A PM should be able to open Duo, start talking to the agent, drop in a file,
approve a suggestion, tweak a paragraph in the editor, watch the agent render
an interactive draft in the browser pane, and never once encounter a raw file
path, a `cd`, a backslash-escape, or a YAML block — unless they want to.

The terminal is still there, because the agent lives in it. But the terminal
in Duo reads long, prose-heavy human-agent conversations the way a good book
reads, not the way a log file reads.

---

## The flagship bet — the reading and writing pair

Two surfaces, designed as one:

### 1. A prose-first terminal

Keeps full Claude Code TUI compatibility (the inner program must render
correctly — that is non-negotiable), but the chrome, typography, and behavior
around it are tuned for long, wrapped, human-readable conversation rather
than for tail-f-ing a build log.

Expect: proportional-ish fonts where safe, generous line-height, a reader-width
soft limit with graceful overflow, markdown-aware highlighting for the
agent's output, and no surprise truncation of a long answer. Claude Code's
TUI keeps its columnar rendering where it needs to; the surrounding frame
does not.

### 2. A markdown editor that feels like your favorite docs editor

Duo's editing surface for local markdown files renders and edits like Google
Docs or Notion — live formatting, no visible asterisks or pound signs, clean
heading typography, commentable, undoable, drag-and-drop for images, paste
from the web that just works. Saves as plain markdown so the agent reads
and writes the same file.

This is the editor where the PM sees what the agent drafted, makes edits, and
hands revisions back. It is also where the PM starts their own draft and
asks the agent to iterate.

### Why this pair is the flagship

The reading surface (terminal) and the writing surface (editor) together turn
the human-agent loop into something that feels like collaborative editing
rather than a command-line session. Every other feature in this document is
supporting cast — but without this pair, the supporting cast cannot save the
experience.

---

## Supporting capabilities

Ordered by how directly each one serves the primary persona. Some are shipped
(Stages 1–5); some are aspirational. See [ROADMAP.md](../ROADMAP.md) for
status.

### Agent ↔ browser pair

The agent and the user share a browser pane. The agent can navigate, read,
and drive it (shipped: `duo navigate`, `duo ax`, `duo click`, `duo type`,
etc.). Aspirationally, the agent can also **render its own interactive
surfaces** into that pane — approval lists, diff views, tables, checklists,
walk-throughs — that the user clicks through directly rather than replying
in chat. The pane is a shared workspace, not just an agent-controlled tab.

### Visual file browser / context drawer

A sidebar that shows the files around the current working directory (and a
pinned "home" scope), lets the user drag any file into the conversation to
add it to context, and understands what the agent can do with each type
(preview a PDF, summarize a CSV, diff two drafts). PMs should never have to
know or type a file path.

### Skill discovery, install, and editing

Skills live in multiple places today — `~/.claude/skills/`, project
`.claude/`, repo-bundled `skill/` directories. Duo presents one unified view:
here are the skills available to this session, here is what they do, here
is how to toggle one on or off, here is how to create a new one from a
template. No opening of dotfiles, no sync scripts.

### Connector / MCP setup wizard

Installing an MCP connector (Slack, Jira, Notion, Google, GitHub) today means
editing JSON. Duo wraps the common ones in a guided setup: click, OAuth,
done. The JSON still exists; the PM never sees it.

### Starter skill pack for PM-shaped work

The first-run experience ships with a curated pack of skills tuned to PM
scenarios — PRD drafting, competitive scan, interview synthesis, roadmap
updates, stakeholder-summary generation. Not everyone keeps them all; they
establish the "this tool knows what I do" feeling on day one.

### The terminal escape hatch

Everything above has a terminal-native equivalent. Nothing Duo does locks
a power user out of the underlying shell, the raw markdown, or the dotfiles.
When the PM grows into a power user, or hands the session to an engineer,
the terminal is still the terminal. This is the BYO-harness promise: the
smoothing is additive, never a cage.

---

## Principles

1. **Agent-native by default.** Every surface assumes there is an agent in
   the loop and designs for that fact. A file browser isn't a Finder clone;
   it's a context drawer. An editor isn't Sublime; it's a collaboration
   surface.

2. **Bring your own harness.** Duo is not an agent. Today the only supported
   harness is Claude Code. The architecture (skill + CLI + socket) is
   harness-shaped, not agent-shaped, so future agents that speak the same
   shell-command idiom can plug in without re-platforming.

3. **Smooth over, don't replace.** When Claude Code exposes a sharp edge —
   an unreadable log dump, a dotfile to edit, a permission prompt in the
   wrong register — Duo smooths it. It does not hide or reimplement Claude
   Code itself. The escape hatches stay open.

4. **Don't break the TUI.** Claude Code's TUI is a living interface that
   the primary agent vendor ships updates to. Duo's prose terminal must
   render Claude Code exactly as Claude Code expects. Every typography
   and layout choice is subordinate to that.

5. **Beautiful by default.** The cloud-docs worker's baseline aesthetic is
   very high. Duo matches it without trying to be minimalist-performative.
   Dark-mode-first, proportional typography where it helps, restrained
   color.

6. **Ask before deciding.** A PM has opinions and deserves to be consulted
   on meaningful choices. Silent defaults are fine for mechanics (paths,
   ports); substantive UX (layout, behavior) is asked.

7. **Shippable quality, prototype speed.** The MVP doesn't need every
   capability in this document; it does need to *feel* like a finished
   product for the capabilities it does ship. A half-polished surface
   confirms the PM's suspicion that agent tooling isn't for them.

---

## What this vision supersedes

- [`duo-brief.md`](../duo-brief.md) captured the engineering brief for Stages
  1–5 (terminal + browser + bridge + skill). It remains the authoritative
  reference for the technical architecture and the Google Docs first-class
  read/write path. The product framing in that brief — "a tool for PMs using
  Claude Code at Capital One" — is narrower than this vision and is
  superseded here. The engineering content is not.

- The README has been reframed to lead with the workspace framing (and
  persona) rather than with the terminal-plus-browser technical pitch.
  Install/quickstart/CLI reference remain.

- [`ROADMAP.md`](../ROADMAP.md) and [`DECISIONS.md`](DECISIONS.md) continue
  to be the source of truth for what is built and why. Aspirational items
  named in this document are tracked there (or belong in the backlog if not
  yet) — this document does not commit to dates.

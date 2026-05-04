# Duo vocabulary — page, playground, lesson, canvas

> **What this is.** The user-facing terminology lock for Duo's
> page / playground / lesson / canvas hierarchy. Both `make-page.md`
> and `make-playground.md` cite this file as canonical. Authored
> 2026-05-02 (v0.6.1 terminology lock); shipped 2026-05-04 (Stage 19e
> ENH-089) as part of the Duo skill so end users following pointers
> from `make-page.md` / `make-playground.md` arrive at a doc they can
> actually read.
>
> **For Duo project contributors:** the internal-names column for
> each user-facing term lives in the project's [CLAUDE.md § Glossary](../../../../Documents/GitHub/duo/CLAUDE.md)
> alongside the path-and-component mapping (`WorkingTab.kind === 'page'`,
> `renderer/components/Page/`, etc.). That belongs with the codebase;
> this file is what an agent or end user authoring playgrounds reads.

---

## The hierarchy in one read-through

- **canvas** = the slot on the right side of Duo's window, type-agnostic. Whatever tab is open there occupies the canvas.
- **page** = a basic HTML tab inside the canvas. Static or lightly-styled. Read-only by default; no actions, no events. Just rendered content.
- **playground** = a page with interactivity. Fires playground-action verbs (`claude:spawn` / `terminal:send` / `browser:open` / `editor:open` / `nav:reveal` / `selection:set` / `theme:set` / `terminal:focus` / `duo:event`), reads form inputs via `data-payload-from`, emits events Claude can stream via `duo events --follow`. **The interactive tier of a page.**
- **lesson** = a playground paired with an accompanying guide skill (a `.md` Claude reads to drive the user through step-by-step). The most common consumer of playground primitives. Distributed via Stage 18b packs.
- **start tab** = a playground that ships with Duo (or with a fork's distro) auto-opening on first launch. `intro-to-duo` is one; future "configure your Duo" / "tour the FAQ" / "import your settings" playgrounds belong here too.

## Vocabulary table (user-facing)

| User says | What they mean |
|---|---|
| **the canvas** | The right pane — the slot that hosts whatever tab is active. Type-agnostic. |
| **a tab** (no qualifier) | A single tab inside the right pane. Any kind: markdown editor, page, browser tab, image viewer, PDF viewer, future modalities. |
| **a page** | A basic HTML tab inside the canvas. Static or lightly-styled. Read-only by default; no actions, no events. |
| **a playground** | A page with interactivity — fires playground-action verbs, reads form inputs via `data-payload-from`, emits events that an agent can stream via `duo events --follow`. The interactive tier of a page. |
| **a lesson** | A playground paired with an accompanying guide skill (a `.md` Claude reads to drive the user through). The most common consumer of playground primitives. |
| **the navigator** / **the tree** / **the file pane** | The left column with the dual-pane file tree. |
| **the terminal** | The middle column with the Claude terminal sessions. |
| **a terminal tab** | One of the Claude / shell sessions in the middle column. |

## The page / playground distinction is content-level, not kind-level

Both pages and playgrounds are the same internal kind. What makes a page a playground is whether it has interactivity baked in. A user asking "build me a playground" is asking for an HTML page with action verbs and events; "build me a lesson" adds a paired `lesson-skill/SKILL.md` that Claude reads as the runtime conversation partner.

## When to reach for which

- **Page** — when the artifact is mostly read-only content (a doc, a snippet of inline data, a static reference card the user will glance at).
- **Playground** — when the user will click buttons, fill forms, expect things to happen in Duo (open a file, focus the terminal, send selected text to Claude). Default for "agent-emitted dashboards" and "interactive references."
- **Lesson** — when there's a teaching arc with steps, progress, and a Claude session that knows the user is mid-lesson. The lesson skill encodes the arc; the playground encodes the surface.
- **Start tab** — a playground that ships with Duo (or with a fork's distro), auto-opening on first launch.

## Cross-references

- **Build a page:** `~/.claude/skills/duo/make-page.md`
- **Build a playground:** `~/.claude/skills/duo/make-playground.md`
- **Build a lesson (canonical template):** `~/.claude/skills/duo/examples/lesson-template/`
- **Drive an existing playground (author → driver):** `~/.claude/skills/duo/playground-interaction.md`
- **Lesson runtime contract:** `~/.claude/skills/duo/lesson-runtime.md`

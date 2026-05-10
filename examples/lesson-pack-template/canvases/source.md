# Claude Code 101 for PMs: Curriculum Design & Birdhouse Catalog

A research-backed scaffold for a GA "AI in Product" track. Designed for a ~30-minute self-paced experience that picks up after onboarding/GitHub basics and lands the *principles* before the procedures — then sends PMs into a graduated set of "birdhouse" projects that compound into a personal Claude Code working environment.

---

## Part 0 — Framing assumptions that shape every design choice

Before the curriculum itself, six framing assumptions worth making explicit because each one constrains a downstream decision:

1. **"Claude Code is an agent harness, not a chatbot."** Anthropic itself reframed the SDK as the "Claude Agent SDK" because the harness — terminal access, file I/O, shell, tool use, permission gating, memory — is the durable abstraction; the coding use case is just one application. PMs need this mental model on minute one. Treating Claude Code as "ChatGPT in a black window" is the single biggest predictor of failure.
2. **The general-population PM is *not* afraid of complexity; they're afraid of opacity.** A non-technical PM can absorb file paths, YAML frontmatter, and a permissions hierarchy if you tell them *what each artifact is for and where it lives*. They cannot absorb hand-wavy phrases like "just point Claude at it."
3. **Enterprise constraints (managed `managed-settings.json`, network restrictions, sensitive data) shrink the design space.** Plug-ins, MCP servers, web fetch, and arbitrary `npm install` may be locked or governed. The curriculum should bias toward primitives that work *inside the sandbox the platform team has already approved*: CLAUDE.md, local skills, file-based artifacts, and slash commands. Treat plugins/MCP as preview material, not core.
4. **The 30-minute budget is for *concepts plus a lit-fuse first project.*** Reaching mastery in 30 minutes is impossible; provoking the right *next session* is achievable. The course's success metric is "did the PM open Claude Code again in the next 48 hours and feel oriented?"
5. **Birdhouses must compound.** Each project should leave behind durable assets in `~/.claude/` or a notes folder, so session N+1 starts smarter than session N. This is the signature of the curriculum and what differentiates it from generic "10 PM prompts" content.
6. **PM-shaped, not engineer-shaped, exemplars.** Most public Claude Code education is engineer-coded (PR review, refactors, test gen). PMs need analogues drawn from PRDs, customer feedback, exec readouts, Jira hygiene, stakeholder maps, and OKR check-ins. Reusing engineering examples by analogy fails — the cognitive load is too high in 30 minutes.

---

# OBJECTIVE 1 — The "next-level" 101 curriculum: principles before procedures

Below is a full inventory of the conceptual building blocks, ranked by leverage. Each block has: **Why it matters for a PM**, **Minimum viable explanation**, **Working analogy**, and **Misconception to preempt**. The expected delivery is a written micro-module with a one-screen explainer and a 1-minute video, not a deep dive — depth lives in the birdhouses.

I have grouped them into seven *concept families* so a course author can choose a 6-to-8-module shape inside the 30-minute envelope. A reasonable cut: pick one block from each family for the core path, link the rest as "Going deeper" appendices.

## Family A — Mental model (the thing that breaks if you skip it)

### A1. Agent harness vs. chatbot
- **Why for a PM:** A chatbot answers; an agent reads, writes, and acts on your machine on your behalf. Every other concept (permissions, CWD, CLAUDE.md, skills) only makes sense once a PM stops treating Claude Code as "Claude.ai in a terminal." Anthropic's own framing has shifted from "Claude Code SDK" to "Claude Agent SDK" precisely because the harness is the product.
- **MVE (60 seconds):** "When you type into Claude.ai, you're talking to a model. When you type into Claude Code, you're directing an agent that has hands — it can read files, run commands, and edit your filesystem. The trade is: it's vastly more useful, and you're now responsible for telling it where to stand and what it's allowed to touch."
- **Analogy:** A *contractor with keys to your house* vs. a *consultant on a Zoom call*. The consultant gives you advice. The contractor needs an address, a key, a scope of work, and a "don't touch the wine cellar" rule.
- **Misconception:** "It's just a smarter chatbot." No — the value comes from durable artifacts on your filesystem, not from the conversation transcript.

### A2. The agentic loop (read → think → act → observe → repeat)
- **Why for a PM:** Explains why Claude sometimes "spins" reading files, why it asks before editing, and why the same prompt can land differently depending on what's on disk.
- **MVE:** "Claude Code runs a loop: it picks a tool (read, write, search, run), executes it, looks at the result, and decides what to do next, until it thinks the task is done or hits a permission gate."
- **Analogy:** A new analyst on day one with a Confluence login and a corporate laptop — they read a doc, decide what to do next, run a query, react to the output.
- **Misconception:** "The model knows things." It doesn't, until it reads them. Almost every "Claude got it wrong" complaint is really a "Claude wasn't given the right files to read" problem.

## Family B — Context (the resource you spend in every session)

### B1. The context window as a budget
- **Why for a PM:** The single most actionable concept. PMs who don't understand context budgeting will fight Claude Code for weeks; PMs who do will outperform engineers.
- **MVE:** "The context window is everything Claude can 'see' at once: your prompt, files it has read, prior conversation, system prompt, CLAUDE.md, loaded skill descriptions. It's finite. As it fills, the model's attention rots — older content distracts from the current task. You manage that budget with `/clear`, `/compact`, subagents, and good file hygiene." (Anthropic's own session-management blog frames this as "context rot" — performance degrades as the window grows even though the model technically has 1M tokens available.)
- **Analogy:** A whiteboard in a tiny meeting room. You can keep adding bullets, but past a point the older bullets get smudged and the team starts ignoring them. Sometimes you erase and write a clean summary.
- **Misconception:** "Bigger context = better answers." False; long sessions degrade. Anthropic's published guidance is "when you start a new task, start a new session."

### B2. `/clear`, `/compact`, and `/context` — the three context controls
- **Why for a PM:** These are the levers PMs will actually pull during a session. Without them, the only escape from a confused session is closing the terminal.
- **MVE:**
  - `/context` — show what's currently loaded (great for "wait, why is Claude confused?")
  - `/compact` — model summarizes the conversation so far and replaces history with the summary; lossy but cheap. Steerable with `/compact focus on the customer-feedback synthesis, drop the formatting debate`.
  - `/clear` — wipe the slate; you write the brief of what survives. More work, but the resulting context is exactly what you decided was relevant.
- **Analogy:** `/compact` is "give me the meeting recap from the AI notetaker." `/clear` is "let's reconvene tomorrow with a fresh agenda you write."
- **Misconception:** "`/compact` is always good." Compaction happens when the model is at its dumbest (most context-saturated). For high-stakes work, `/clear` plus a hand-written brief is more reliable.

### B3. The "give Claude the materials" principle
- **Why for a PM:** Dovetails with the user's own framing — "the difference between asking Claude to do something and giving Claude the materials to do something well." This is the single highest-leverage habit shift.
- **MVE:** "Before you ask, gather. A PM who pastes 3 customer interview transcripts, the PRD draft, and last week's OKRs into a folder, then asks Claude to synthesize, will outperform a PM who writes the cleverest prompt in the world against an empty folder."
- **Analogy:** Briefing a contract analyst. The first 5 minutes of context-gathering produces 80% of the quality.
- **Misconception:** "Better prompts = better output." Better *materials* + adequate prompt > clever prompt + thin materials.

## Family C — Place (where to invoke, and why CWD matters)

### C1. Current Working Directory (CWD) as the "where am I standing" question
- **Why for a PM:** This is the user's own example, and it deserves its own module. Where you launch Claude shapes what it sees by default. Launch from a repo root and Claude can read code; launch from `~/Documents/notes/` and Claude can read your meeting notes; launch from `~/` and Claude has the broadest view but loses focus.
- **MVE:** "When you type `claude` in your terminal, the folder you're in becomes Claude's home base. It auto-loads any `CLAUDE.md` in that folder, can read files relative to it, and bounds what it considers 'this project.' Choose the folder deliberately, the same way you'd choose which conference room to hold a meeting in."
- **Analogy:** *Where you enter the building.* If you walk in via the lobby on the east side, you see the people who work near that lobby. Walk in via the loading dock and you see warehouse staff. Same building, different field of view.
- **Misconception:** "I can just point Claude at a file later." You can with `--add-dir`, but that doesn't auto-load the CLAUDE.md in that directory. Where you start matters most.

### C2. Project boundaries and the three-folder pattern
- **Why for a PM:** Most PMs don't have "repos" in the way engineers do. They need an explicit recommendation for *where* to keep things.
- **MVE:** Recommend three default invocation points:
  1. **`~/`** (your home directory) — for general "thinking partner" sessions; loads your *user-level* CLAUDE.md and skills.
  2. **`~/notes/`** (or an Obsidian vault) — for personal knowledge work, customer synthesis, weekly reviews.
  3. **A specific repo** (e.g., a specific product repo) — for code-aware work, where the team's project-level CLAUDE.md guides Claude.
- **Analogy:** Three desks. Personal desk for journaling, library desk for research, team conference room for project work. You choose the desk, and the desk shapes the work.
- **Misconception:** "There's one right place." Different work, different CWD. The skill is *deciding*, not memorizing.

## Family D — Memory (what survives between sessions)

### D1. CLAUDE.md — project-level vs. user-level (`~/.claude/CLAUDE.md`)
- **Why for a PM:** This is the single highest-leverage authoring activity. A good CLAUDE.md is the difference between re-explaining your job every session and Claude already knowing.
- **MVE:** "CLAUDE.md is a markdown file Claude auto-loads at the start of every session. Two scopes that matter to you:
  - `~/.claude/CLAUDE.md` (user-level): loaded into *every* session on your laptop. Put your role, your team, your terminology, your writing style, your "always do / never do" rules.
  - `./CLAUDE.md` in any project folder (project-level): loaded only when you launch Claude in that folder. Put project-specific terminology, repo conventions, stakeholder lists for *that* effort.
  Higher specificity wins on conflict. your organization may also deploy a *managed* organization-level CLAUDE.md that takes precedence over both — that's expected."
- **Analogy:** Your standing instructions to a contract analyst (user level) plus a project-specific brief (project level) plus your manager's policy memo (managed/enterprise level).
- **Misconception:** "Longer is better." Wrong — Anthropic's own guidance and the HumanLayer research show LLMs follow fewer instructions more reliably than many. Aim for 50–200 lines, prefer pointers to other files over inline copies, and use *progressive disclosure* (CLAUDE.md as a "map" pointing to detail files).

### D2. Auto-memory and the difference between explicit memory and learned memory
- **Why for a PM:** Claude Code v2.1.59+ now writes its own notes about what worked. PMs need to know this exists, that it's editable via `/memory`, and that it's stored in `~/.claude/projects/` per-project.
- **MVE:** "CLAUDE.md is what *you* told Claude. Auto-memory is what *Claude* learned. Both are loaded next session. You can review and edit both with `/memory`."
- **Analogy:** Your standing instructions vs. an analyst's running notebook. Both inform tomorrow's work.
- **Misconception:** "It remembers everything from last time." It doesn't — only what was either written to a file or captured in auto-memory. Anything ephemeral in the chat is gone after `/clear`.

### D3. Files on disk as the *real* memory
- **Why for a PM:** The deepest unlock. The chat is ephemeral; markdown files in your folders are forever (and portable across tools — no vendor lock-in, an underrated point at a regulated enterprise).
- **MVE:** "If you want Claude to remember it next session, ask Claude to *write a file*. Markdown files in your notes folder are the real memory. Conversations are scratch paper."
- **Analogy:** Whiteboard vs. wiki page. The whiteboard is great for thinking; only the wiki page is there next month.
- **Misconception:** "Saving the chat transcript is enough." Transcripts are unstructured and unsearchable; Claude won't reliably re-read them. *Synthesized* artifacts (a glossary, a stakeholder map, a decision log) are what compound.

## Family E — Capability (skills, subagents, MCP, plugins)

### E1. Skills and progressive disclosure
- **Why for a PM:** Skills are how a PM turns "the thing I keep asking Claude to do" into "the thing Claude does the same way every time" — without re-typing the instructions. They're the path from user to author.
- **MVE:** "A skill is a folder with a `SKILL.md` file. The top of the file is metadata (name + description) — Claude reads this at startup so it *knows the skill exists* but doesn't load the instructions yet. When your task matches the description, Claude loads the body. If the body references additional files, Claude only loads those when needed. This three-layer progressive disclosure is what lets you have dozens of skills without bloating context."
- **Where they live:** `~/.claude/skills/<skill-name>/SKILL.md` (personal, all projects) or `.claude/skills/<skill-name>/SKILL.md` (committed to a repo, shared with team).
- **Analogy:** A binder of SOPs in the drawer. The drawer label tells you what's inside; you pull the binder only when the situation calls for it; inside the binder, sections are tabbed and you flip to the one you need.
- **Misconception:** "Skills are like prompts." They're more durable: same trigger, same instructions, every time, with bundled reference docs. If you find yourself pasting the same instruction more than twice, it should be a skill.

### E2. Local skills vs. global skills vs. plugins
- **Why for a PM:** PMs get confused by overlap. A precise model prevents wasted effort.
- **MVE:**
  - **User/global skills** (`~/.claude/skills/`) — your personal toolkit; available in every session.
  - **Project/local skills** (`.claude/skills/` in a repo) — team-shared; committed to git.
  - **Managed/enterprise skills** — deployed by your organization platform team; can't be overridden.
  - **Plugins** — bundles that include skills + commands + subagents + MCP server config, installable from a marketplace. *Note: enterprise policy may restrict marketplaces; treat plugins as advanced.*
- **Analogy:** Your personal cookbook (user) vs. the team recipe binder in the office (project) vs. the corporate-issued recipe binder you can't write in (managed) vs. ordering a recipe pack from a publisher (plugin).
- **Misconception:** "Plugins are required." They're not — most of the value for a PM comes from a handful of well-authored local skills.

### E3. Subagents (and forks)
- **Why for a PM:** Subagents are the single best tool for keeping the main session clean during research-heavy work — exactly the kind of work PMs do (reading 12 customer transcripts, scanning a backlog of 80 Jira tickets).
- **MVE:** "A subagent is a Claude that runs a side task in its own fresh context window and returns only the summary. Use one when you'd otherwise pollute your main conversation with logs or file dumps. Anthropic's own mental test: 'Will I need this tool output again, or just the conclusion?' If just the conclusion, use a subagent."
- **Analogy:** Sending an intern to read 40 emails and come back with a one-page brief. The intern's drafts don't end up on your desk.
- **Misconception:** "More subagents = better." Subagents add coordination cost. Reach for them when output volume would otherwise drown the main session.

### E4. MCP servers (conceptually only, given enterprise context)
- **Why for a PM:** Worth knowing the *category* exists even if your organization restricts which MCP servers are approved. PMs hear about Jira MCPs, Figma MCPs, etc., from outside content.
- **MVE:** "MCP (Model Context Protocol) is how Claude Code can talk to outside systems — Jira, GitHub, a database — beyond your local files. Each connection is an 'MCP server.' At your organization, the platform team controls which servers are approved; you'll get a list, not a free-for-all. Until then, paste-driven workflows (copy a Jira ticket into a file, point Claude at the file) get you 80% of the value."
- **Analogy:** A network of phones that let your contractor call other vendors. Useful but governed; you don't get to wire arbitrary phones in.
- **Misconception:** "I need MCP servers to be productive." False — file-based workflows are the dominant pattern, and several Anthropic case studies (legal, marketing) ran entirely on local files.

## Family F — Trust (permissions, modes, safety)

### F1. The five permission modes
- **Why for a PM:** This is the single most-asked question in any Claude Code rollout, and the place enterprise governance bites hardest. PMs need a 60-second internal model.
- **MVE:**
  - **default** — asks before every write or shell command. Safe, slow.
  - **acceptEdits** — auto-approves file edits in your workspace, still asks for shell. Good for productive sessions.
  - **plan** — read-only; Claude analyzes and proposes a plan, can't modify anything. Best for exploration.
  - **auto** — Claude executes without prompts, with a safety classifier blocking risky actions. Available on Team/Enterprise; admins can disable. (Note: this is a research preview as of early 2026.)
  - **bypassPermissions** (`--dangerously-skip-permissions`) — no checks, no prompts. *Don't use it on a your organization laptop.* Anthropic chose the word "dangerously" deliberately. your organization almost certainly has this disabled via managed settings.
  - Cycle modes mid-session with **Shift+Tab**.
- **Analogy:** Five postures for a contractor: "ask me before every nail" / "you can hammer, but ask before plumbing" / "look, don't touch" / "work autonomously, with a safety inspector watching" / "no oversight at all." You choose based on the day.
- **Misconception:** "Plan mode means Claude is doing the work safely." Plan mode means Claude is *not* doing the work — it's planning. Many PMs confuse "planning" with "executing carefully."

### F2. Trust boundaries — what's never auto-approved
- **Why for a PM:** Reduces the "what could go wrong" anxiety that often paralyzes first-time use.
- **MVE:** "Even in auto-mode, certain things are never silently approved: writing to your `.claude/` configuration, your shell config, your SSH keys, force-pushes to git main. your organization's managed settings add to this list."
- **Misconception:** "Claude can wreck my machine if I'm not watching." It's possible but unlikely under default settings; the harness has multiple layers.

### F3. Plan-then-execute as the default rhythm
- **Why for a PM:** This is the single biggest behavior change for PMs coming from chat tools. PMs are used to "ask, get answer." Claude Code rewards "ask Claude to plan, review, then ask Claude to execute the plan."
- **MVE:** "Default workflow: enter plan mode (Shift+Tab), describe what you want, let Claude propose a plan as a markdown file, edit it, then say 'execute.' This is faster than it sounds and prevents 90% of off-track sessions."
- **Analogy:** Outline before draft. Spec before sprint.
- **Misconception:** "Planning is overhead." On non-trivial work, the alternative is rework.

## Family G — Authoring (the move from user to author)

### G1. The "promote it to a skill" reflex
- **Why for a PM:** The arc of Claude Code mastery is: (1) ask things in chat, (2) put context in CLAUDE.md, (3) extract repeated patterns into skills, (4) bundle skills into a personal workflow. PMs need the reflex named so they recognize it when it shows up.
- **MVE:** "If you've prompted Claude to do the same thing twice, write the third invocation as a skill. The cost is 10 minutes; the payoff is every future session."
- **Analogy:** The first time you write a status update, you draft. The third time, you make a template. The tenth time, you make a generator.

### G2. Slash commands as the lighter-weight alternative
- **Why for a PM:** Many PM workflows aren't "let Claude decide when to use this" — they're "I want to type one thing and trigger a known recipe." That's a slash command, not a skill.
- **MVE:** "A markdown file in `~/.claude/commands/` becomes a `/your-command-name` shortcut. Use slash commands when you always invoke explicitly (e.g., `/standup-prep`); use skills when you want Claude to recognize the situation and reach for the right tool itself."
- **Analogy:** Slash commands are macros (you press the button). Skills are policies (the system applies them when relevant).

### G3. Reading vs. writing — knowing which mode you're in
- **Why for a PM:** PMs habitually conflate "Claude told me X" with "Claude did X." Distinguishing read-only synthesis from write actions sharpens both safety and effectiveness.
- **MVE:** "Every session is some mix of read (Claude scanning your materials and synthesizing) and write (Claude generating files, editing existing ones, running commands). Be explicit about which you want. 'Read these 5 transcripts and tell me the top 3 themes' is a read task. 'Write a 1-page synthesis to ~/notes/research/q2-themes.md' is a write task. The second compounds."

---

## Suggested 30-minute core path (one cut, not the only cut)

A defensible spine for the GA course, prioritizing leverage per minute:

| Min | Module | Core concept | Hands-on? |
|-----|--------|--------------|-----------|
| 0–3 | **Reset your model** | A1 Agent harness vs. chatbot + B3 "give Claude the materials" | Watch a 90-sec demo of file-aware vs. file-blind Claude. |
| 3–7 | **Where you stand** | C1 CWD + C2 three-folder pattern | Open a terminal, `cd` into three places, run `claude` once in each, observe what loads. |
| 7–13 | **What persists** | D1 CLAUDE.md (user vs. project) + D3 files-on-disk | Run `/init` in a notes folder; inspect the generated CLAUDE.md. |
| 13–18 | **Manage the budget** | B1 context + B2 `/clear`/`/compact`/`/context` | Run `/context` in a fresh session and a session with 10 file reads; compare. |
| 18–22 | **Posture** | F1 permission modes + F3 plan-then-execute | Cycle Shift+Tab; do one task in plan mode, one in acceptEdits. |
| 22–27 | **Make it yours** | E1 skills + G1 promote-to-skill reflex | Watch the instructor turn a 3-message recipe into a skill. |
| 27–30 | **Your first birdhouse** | Launch the *Personal Context Bootstrap* (Birdhouse #1 below) | Self-paced from here. |

Anything not in the spine becomes a "Going Deeper" appendix card linked from the relevant module.

---

# OBJECTIVE 2 — The Birdhouse Catalog

Each birdhouse is a small, tractable project that solves a real PM problem and *deliberately* leaves behind durable assets so the next session is smarter. The progression is designed so a PM can stop after Birdhouse #1 and still get value, but a PM who completes the first five has a meaningful personal Claude Code environment.

**Naming convention used below:**
- **Effort** — wall-clock time including a 30% "first time, fumbling" tax.
- **Skill level** — `Foundation` (do first), `Core` (do soon), `Branch` (role-dependent), `Advanced` (after the first five).
- **Compounds via** — the specific durable asset that makes session N+1 better.

## The Foundation tier (do these in order; ~2 hours total)

### Birdhouse #1 — Personal Context Bootstrap (the user's example, formalized)
- **Functional purpose:** A guided interview where Claude learns who the PM is, their team, products, repos, Jira projects, stakeholders, recurring deliverables, and writing preferences.
- **Why a PM wants it:** Every subsequent session benefits. The first time you can ask "draft my weekly update for Anita" and Claude knows who Anita is, the value clicks.
- **Principles reinforced:** A1, A2, B3, C2, D1, D3, G3.
- **Local assets created:**
  - `~/.claude/CLAUDE.md` — top-level identity, role, team, products, terminology, "always/never" rules.
  - `~/.claude/context/role.md`, `team.md`, `products.md`, `stakeholders.md`, `tools.md`, `recurring-deliverables.md` (progressive disclosure — pointed to from CLAUDE.md, not inlined).
  - `~/.claude/context/voice-samples/` — folder seeded with 2–3 of the PM's actual writing samples for tone calibration.
- **Shareable artifact:** A rendered HTML synthesis (`~/me-snapshot.html`) — single-page "About me" the PM can sanity-check, share with their manager, or paste into a new-team intro.
- **Effort:** 30 min.
- **Skill level:** Foundation, project #1.
- **Compounds via:** Every future session loads the user-level CLAUDE.md, which references these files. Claude can pull stakeholder names, product names, and tone right.
- **Pedagogical role:** Demonstrates plan-then-execute, file writing, progressive disclosure, and the concept of "Claude knowing me" all in one project.

### Birdhouse #2 — Internal Acronym & Glossary File
- **Functional purpose:** your organization has a *deep* internal vocabulary (servicing flows, regulatory acronyms, product nicknames). Claude doesn't know any of it.
- **Why a PM wants it:** Eliminates the "what does CLR mean again?" tax in every output Claude produces, and prevents Claude from inventing wrong expansions.
- **Principles reinforced:** B3 materials, D1 user-level CLAUDE.md, E1 progressive disclosure (referenced, not inlined).
- **Local assets created:** `~/.claude/context/glossary.md` — a markdown table of acronyms and their expansions, plus a "preferred terminology" section ("call it 'cardholder', not 'customer', in all written outputs").
- **Shareable artifact:** A rendered HTML cheat sheet for new hires on the team.
- **Effort:** 15 min (paste-driven from existing internal glossary).
- **Skill level:** Foundation, project #2.
- **Compounds via:** All subsequent writing tasks use the right terms.
- **Pedagogical note:** Emphasize **paste-driven** capture — no API access required. This is also a low-stakes way to teach "files-as-memory."

### Birdhouse #3 — The "How I Write" Voice Calibration Pack
- **Functional purpose:** Claude writes blandly out of the box. Calibrate it against 3–5 samples of the PM's actual writing.
- **Why a PM wants it:** Status updates, exec summaries, and Slack messages start sounding like *them*, not like generic AI prose.
- **Principles reinforced:** B3, D1, G3 (writing mode), E1 skill authoring.
- **Local assets created:**
  - `~/.claude/context/voice-samples/` — 3–5 actual samples (status update, PRD intro, Slack post, exec email).
  - `~/.claude/skills/match-my-voice/SKILL.md` — a skill that, when triggered ("write this in my voice"), pulls the samples and applies extracted style rules.
  - `~/.claude/context/voice-rules.md` — Claude-extracted observations ("uses Oxford commas, prefers 2-sentence paragraphs, opens with the bottom line").
- **Shareable artifact:** A side-by-side HTML comparison showing the same paragraph rewritten in default Claude voice vs. the PM's voice.
- **Effort:** 30 min.
- **Skill level:** Foundation, project #3 (also a great "wow" moment).
- **Compounds via:** Every future write request can append "in my voice" and trigger the skill.

### Birdhouse #4 — Recurring Deliverable Templates (PRD, status update, exec brief)
- **Functional purpose:** A folder of starter templates the PM uses, with annotations on what good looks like.
- **Why a PM wants it:** Next time the PM says "draft a PRD for X," Claude uses the template the team actually accepts, with the right sections, tone, and length.
- **Principles reinforced:** D1, E1, G2 slash commands (one slash command per template), B3.
- **Local assets created:**
  - `~/.claude/templates/prd.md`, `status-update.md`, `exec-brief.md`, `okr-checkin.md`, `decision-memo.md`.
  - `~/.claude/commands/draft-prd.md`, `draft-status.md`, etc. — slash commands that load the right template and prompt for the input.
- **Shareable artifact:** A rendered HTML "deliverable kit" the PM can share with a new hire.
- **Effort:** 45 min (front-loaded; pays back forever).
- **Skill level:** Foundation, project #4.
- **Compounds via:** `/draft-prd` becomes muscle memory. Templates evolve in place over time.

### Birdhouse #5 — Stakeholder Map
- **Functional purpose:** A structured file capturing key stakeholders — name, role, team, what they care about, communication preferences, recent interactions.
- **Why a PM wants it:** Claude can now tailor outputs. "Draft an update for Carl" produces something pitched at Carl's altitude and concerns.
- **Principles reinforced:** D3 files-as-memory, B3, C2.
- **Local assets created:** `~/.claude/context/stakeholders.md` (referenced from user-level CLAUDE.md). Optionally `~/.claude/context/stakeholders/<name>.md` per person for deeper notes (progressive disclosure pattern).
- **Shareable artifact:** A rendered HTML stakeholder map (visual, with relationships).
- **Effort:** 30 min.
- **Skill level:** Foundation, project #5.
- **Compounds via:** Stakeholder-tailored writing becomes the default. Updating "what Carl cares about now" once propagates to every future output.

## The Core tier (project-pattern coverage; do across the next 2–4 weeks)

### Birdhouse #6 — Customer Feedback Synthesis Loop
- **Functional purpose:** Drop raw transcripts, NPS verbatims, or support tickets into a folder; Claude extracts themes, codes them, and updates a running synthesis file.
- **Principles reinforced:** B1 context budget, E3 subagents (one per transcript to keep main context clean), D3.
- **Local assets:** `~/notes/research/raw/` (inputs), `~/notes/research/synthesis.md` (running output), `~/.claude/skills/synthesize-research/SKILL.md`.
- **Shareable artifact:** A monthly HTML themes report with quote pull-outs.
- **Effort:** 45 min first time, 5 min after.
- **Skill level:** Core. **Branch trigger:** essential for discovery-heavy PMs.
- **Compounds via:** The synthesis file is a *living* document; each new transcript merges into existing themes rather than starting over.
- **Note:** Excellent demonstrator of the subagent pattern — each transcript handled by a forked subagent that returns only the themes, not the raw text.

### Birdhouse #7 — Jira Triage Companion (paste-driven)
- **Functional purpose:** PM pastes a backlog dump (CSV export or copy-paste); Claude classifies, deduplicates, suggests priorities based on the team's stated OKRs, and drafts grooming notes.
- **Principles reinforced:** B3 materials, F3 plan-then-execute, F1 permission posture (read-only first).
- **Local assets:** `~/notes/jira/<project>/dump-YYYY-MM-DD.md` (raw), `~/notes/jira/<project>/triage-YYYY-MM-DD.md` (output), `~/.claude/skills/jira-triage/SKILL.md`.
- **Shareable artifact:** A rendered HTML grooming brief for the next refinement meeting.
- **Effort:** 30 min.
- **Skill level:** Core.
- **Compounds via:** Each triage builds context — the skill learns the team's themes and Claude gets sharper at classifying. Also serves as a stand-in until enterprise approves a Jira MCP.

### Birdhouse #8 — Decision Log / Lightweight ADR for Product Decisions
- **Functional purpose:** A markdown-based decision log. Each decision: context, options considered, choice, rationale, reversibility, owner.
- **Principles reinforced:** D3, E1, G2 slash command (`/log-decision`).
- **Local assets:** `~/notes/decisions/YYYY-MM-DD-<slug>.md`, `~/.claude/commands/log-decision.md` (slash command that prompts the PM through the structure), `~/notes/decisions/INDEX.md` (auto-updated by Claude).
- **Shareable artifact:** A rendered HTML decision register, filterable by quarter or product area.
- **Effort:** 30 min setup, 5 min per decision after.
- **Skill level:** Core.
- **Compounds via:** Three months in, the PM can ask "why did we pick X over Y last spring?" and get a real answer instead of a guess. Also a leadership-visible artifact.

### Birdhouse #9 — Meeting Prep + Debrief Workflow
- **Functional purpose:** Before a meeting: Claude pulls relevant context (last meeting notes, related decisions, the stakeholder file for attendees) and drafts an agenda + briefing. After: Claude consolidates raw notes into action items, decisions, and follow-ups.
- **Principles reinforced:** B3, D3, E1, G2 (`/prep-meeting`, `/debrief-meeting`), E3 subagents.
- **Local assets:** `~/notes/meetings/YYYY-MM-DD-<topic>.md` per meeting, `~/.claude/commands/prep-meeting.md`, `~/.claude/commands/debrief-meeting.md`, optional `~/.claude/skills/meeting-debrief/SKILL.md`.
- **Shareable artifact:** A rendered HTML one-pager per meeting (decisions, owners, dates, follow-ups).
- **Effort:** 45 min setup, 5 min per meeting.
- **Skill level:** Core.
- **Compounds via:** The PM accumulates a chronological record of the team's meetings, queryable via Claude.

### Birdhouse #10 — Weekly Personal Retro / Review
- **Functional purpose:** Friday afternoon: PM runs `/weekly-review`. Claude reads this week's meetings, decisions, and Jira triage notes; produces a personal retro with what shipped, what slipped, and what needs attention next week.
- **Principles reinforced:** B3, E1 skills, D3, plus the *compounding* lesson — past weeks' retros are themselves inputs to future ones.
- **Local assets:** `~/notes/weekly/YYYY-WW.md`, `~/.claude/skills/weekly-review/SKILL.md`, `~/.claude/commands/weekly-review.md`.
- **Shareable artifact:** A rendered HTML weekly digest the PM can share with their manager (optional).
- **Effort:** 20 min setup, 10 min per week.
- **Skill level:** Core.
- **Compounds via:** Pattern detection over months — "you keep slipping on X" — only possible because the artifacts are durable, structured files.

## The Branch tier (role-dependent; pick what matches the PM)

### Birdhouse #11 — Competitive Intelligence File
- **Functional purpose:** A living dossier on key competitors. PM pastes in articles, screenshots descriptions, or analyst notes; Claude updates structured profiles.
- **Local assets:** `~/notes/competitive/<competitor>/profile.md`, `~/notes/competitive/<competitor>/timeline.md`, `~/.claude/skills/competitive-intel/SKILL.md`.
- **Shareable artifact:** Rendered HTML competitor teardown.
- **Effort:** 30 min setup.
- **Branch:** Strategy-leaning PMs.
- **Compounds via:** Each new input updates the profile; quarterly Claude can compare profiles to draft a competitive update.

### Birdhouse #12 — Domain Glossary for any technical domain
- **Functional purpose:** Beyond acronyms — capture domain *concepts* (intents, slot types, IVR flows, regulatory requirements) with definitions and examples.
- **Local assets:** `~/notes/domain/<domain>/glossary.md`, `~/notes/domain/<domain>/concepts/<concept>.md` per major concept.
- **Shareable artifact:** Rendered HTML domain primer.
- **Effort:** 60 min.
- **Branch:** PMs in technically dense domains.
- **Compounds via:** Claude can now explain domain mechanics correctly and use them in PRDs.

### Birdhouse #13 — Reading List & Knowledge Digestion
- **Functional purpose:** Drop a long article, white paper, or transcript into an `inbox/` folder. Claude reads, summarizes against your existing notes, identifies what's new vs. confirmatory, and files it.
- **Local assets:** `~/notes/reading/inbox/`, `~/notes/reading/processed/`, `~/notes/reading/INDEX.md`, `~/.claude/skills/digest-reading/SKILL.md`.
- **Shareable artifact:** Monthly HTML "what I've read and what I'm taking from it" digest.
- **Effort:** 30 min.
- **Branch:** Continuous-learning PMs.
- **Compounds via:** Claude gets a stronger sense of *what the PM already knows*, which improves all subsequent reasoning.

### Birdhouse #14 — Voice Notes → PRD-Ready Notes
- **Functional purpose:** PM dictates a voice memo (existing transcript via phone or Otter); paste transcript into a folder. Claude extracts the half-formed thoughts and shapes them into structured notes ready for a PRD section.
- **Local assets:** `~/notes/voice-memos/raw/`, `~/notes/voice-memos/structured/`, `~/.claude/skills/voice-to-structure/SKILL.md`.
- **Shareable artifact:** Optional — usually internal.
- **Effort:** 20 min.
- **Branch:** PMs who think out loud / on commutes.
- **Compounds via:** Lowers the activation energy for capturing thinking.

### Birdhouse #15 — Onboarding Doc Generator for New Team Members
- **Functional purpose:** Given the existing context files (Birdhouses #1, #2, #5, #12), generate an "everything a new PM joining my team needs to know" onboarding pack.
- **Local assets:** `~/notes/onboarding/<new-hire-or-template>.md`, `~/.claude/skills/generate-onboarding/SKILL.md`.
- **Shareable artifact:** Rendered HTML onboarding pack — high-leverage shareable.
- **Effort:** 30 min.
- **Branch:** Lead PMs / those onboarding others.
- **Compounds via:** Demonstrates the *aggregate* value of all prior context files; great showcase moment.

### Birdhouse #16 — Customer Quote Library
- **Functional purpose:** Tagged, searchable repository of memorable customer quotes from research and support.
- **Local assets:** `~/notes/quotes/quotes.md` (one-line entries with tags), `~/notes/quotes/source/` (full transcripts).
- **Shareable artifact:** Rendered HTML quote wall for an exec readout.
- **Effort:** 20 min.
- **Branch:** Discovery-heavy PMs.
- **Compounds via:** Future PRDs and exec presentations have ready-to-cite voice-of-customer.

## The Universal Knowledge-Worker tier (not PM-specific; broaden the appeal)

### Birdhouse #17 — Personal Kanban / Task State File
- **Functional purpose:** Simple `tasks.md` with `Now / Next / Waiting / Done` sections; Claude maintains it via `/task` slash commands.
- **Local assets:** `~/notes/tasks.md`, `~/.claude/commands/task.md`.
- **Shareable artifact:** None (private).
- **Effort:** 15 min.
- **Skill level:** Foundation-adjacent (PMs who already use Notion/Trello can skip).
- **Compounds via:** Replaces ephemeral chat-based to-do lists with a durable file Claude can reason over.

### Birdhouse #18 — File-Naming and Folder-Structure Convention File
- **Functional purpose:** A meta-skill — a file documenting your own conventions (where meeting notes go, how to name PRDs, what tags to use). Claude reads it before creating any new file.
- **Local assets:** `~/.claude/context/conventions.md`.
- **Shareable artifact:** None.
- **Effort:** 15 min.
- **Skill level:** Foundation; do this *with* Birdhouse #1.
- **Compounds via:** Prevents the "where did Claude put that?" tax. Every future write task asks Claude to consult conventions first.

### Birdhouse #19 — Slack/Email Triage Practice (paste-driven)
- **Functional purpose:** Paste a chunk of unread Slack threads or emails; Claude classifies (action / FYI / can-be-ignored), drafts replies for the action items, and produces a 3-line summary.
- **Local assets:** `~/.claude/skills/triage-inbound/SKILL.md`, ephemeral input files.
- **Shareable artifact:** None (private).
- **Effort:** 20 min.
- **Skill level:** Branch (Universal).
- **Compounds via:** The skill learns the PM's preferred reply length and tone over time.

### Birdhouse #20 — "Promote-to-Skill" Workshop (the meta-birdhouse)
- **Functional purpose:** A guided session where Claude reviews the PM's last week of conversations and identifies the top 3 candidates to extract as new skills, then writes them.
- **Local assets:** Adds to `~/.claude/skills/` over time.
- **Shareable artifact:** None.
- **Effort:** 30 min.
- **Skill level:** Advanced (do this after a few weeks of usage).
- **Compounds via:** Closes the authoring loop — turns the user into an author, the most valuable transition in the curriculum.

---

## Recommended progression

**Track A — Linear (default for general-population PM):**
1, 2, 18, 3, 4, 5 → (the PM now has a working personal environment) → 8, 9, 10 → choose two of {6, 7, 11, 13, 15} → 20.

**Track B — Discovery-heavy PM:** 1, 2, 3, 5, 6, 16, 9, 10, 13, 20.

**Track C — Delivery-heavy PM:** 1, 2, 4, 5, 7, 8, 9, 10, 17, 20.

**Track D — Strategy-heavy PM:** 1, 2, 4, 5, 11, 12, 13, 8, 10, 20.

In all tracks, the foundation tier (Birdhouses 1–5) is non-negotiable. Everything else can branch.

---

## Cross-cutting recommendations

### On pedagogy

1. **Two delivery modes per concept.** A 60-second video (mental model) + a 1-screen explainer with a concrete example. PMs who learn by watching and PMs who learn by reading both get served.
2. **Show the failure mode.** For every concept, show what it looks like when the PM doesn't understand it. The "oh, *that's* what was happening" moment is the durable learning. E.g., for CWD: show two side-by-side terminals running the same prompt from different directories, producing dramatically different results.
3. **Defer plugins and MCP.** They're fascinating but enterprise-restricted. Mention as preview material; teach the file-and-skill-based primitives that *will* work in the your organization environment from day one.
4. **Anchor every concept to the persistent artifact.** "Where does this live? When does it load? When does it stop loading?" — make those three questions the spine of every module.
5. **Lean on Anthropic's own framing where possible.** "Onboarding Claude Code like a new developer" and "Effective context engineering" are framings the PMs will hear from their engineer counterparts. Using the same vocabulary builds shared language.
6. **Course-internal CLAUDE.md.** The course itself should ship with a `CLAUDE.md` that PMs `cd` into during the lesson — they should *experience* a well-authored CLAUDE.md before they author one.

### Common pitfalls to preempt explicitly

| Pitfall | Symptom | Curriculum fix |
|---------|---------|----------------|
| Treating Claude Code as Claude.ai | "Why does it want my permission to read files?" | Module A1 + the contractor/consultant analogy. |
| Working from `~/Desktop` always | Stakes accumulate in random places, no CLAUDE.md ever loads | Module C1/C2 + the three-folder pattern. |
| Bloated CLAUDE.md | Instruction following decays | "50–200 lines, prefer pointers to files" rule + an example of progressive disclosure. |
| Long-running session decay | "It used to work, now it's confused" | Module B1/B2 + the "new task = new session" rule. |
| Re-explaining the team every session | Friction; PM gives up | Birdhouse #1, prioritized as project-zero. |
| Not knowing about plan mode | Either over-cautious (one prompt at a time) or over-aggressive (skipping permissions) | Module F1/F3 + an explicit "if it's research, plan mode; if it's iteration, acceptEdits" rule. |
| `--dangerously-skip-permissions` curiosity | A PM Googles it and tries it | Address head-on; reinforce that your organization managed settings likely block it; explain *why* the word "dangerously" is in the flag name (Anthropic chose it deliberately as a safety signal). |
| Conflating chat memory with file memory | "Why doesn't Claude remember what we talked about yesterday?" | Module D2/D3 + Birdhouse #1's user-level CLAUDE.md as the corrective. |
| "It hallucinated" complaints | Almost always a context problem, not a model problem | The "give Claude the materials" mantra + show before/after with a stakeholders.md file. |

### Validation / assessment approach

A 30-minute self-paced course can't have a real exam, but you can build in three lightweight validation moments:

1. **Inline knowledge checks (3–5 questions, ungated).** "Where does `~/.claude/CLAUDE.md` load? (a) only when you're in your home directory (b) at the start of every Claude Code session on this laptop (c) only when you reference it explicitly." Correct answer: (b).
2. **Artifact validation in Birdhouse #1.** Have the PM run a final command (e.g., `cat ~/.claude/CLAUDE.md | wc -l` or a provided `validate.sh`) that confirms the artifacts exist and meet a minimum-bar structure. Output is a green "you're set up" message + a copy-paste shareable confirmation token.
3. **The 7-day re-engagement signal.** Telemetry-permitting, the strongest validation isn't a quiz — it's whether the PM ran `claude` again within 7 days. Build the course funnel to make day-2 trivially easy: a 3-line email or Slack DM that says "today, try `/draft-status` from yesterday's templates birdhouse" with the exact command.

### Suggested telemetry for the GA rollout

- % of starters who complete Birdhouse #1.
- Median number of Birdhouses per PM at 30 days.
- Distribution of CLAUDE.md sizes after Birdhouse #1 (to detect the "wrote 1000 lines" anti-pattern).
- Re-engagement rate at day 2 / day 7 / day 30.
- Skills-authored-per-PM at day 30 (the leading indicator of "user → author" conversion).
- Most common slash command invocations (signals which templates are real-work-fits).

### Enterprise-specific guardrails to call out in the course

- **Authentication:** Your organization almost certainly routes Claude Code through a managed LLM gateway with SSO (OIDC federation). PMs should expect a one-time SSO flow, not API key management.
- **Data sensitivity:** *Tell PMs explicitly* what's safe to put in CLAUDE.md and notes (general team context, public product names, role descriptions) and what isn't (PII, NPI, customer data, internal financials, model parameters). Better one explicit list than a vague warning.
- **Managed settings precedence:** Tell PMs about it so they're not confused when their `disableBypassPermissionsMode` setting won't override; explain that this is *expected* and protective.
- **Approved MCP servers:** Maintain a Capital-One-specific page listing the currently approved MCP servers. Don't let PMs go fishing.
- **Network restrictions:** If `npm install` and arbitrary marketplace plugin installs are blocked, say so explicitly and route PMs to the internal mirror or skill-bundle distribution mechanism.
- **Auto mode availability:** As of early 2026, auto mode is a research preview, not GA on all plans. Be honest about its preview status and admin-controlled availability.

### What to *not* teach in the 30-minute core (defer to follow-on tracks)

These are real and valuable but will swamp the budget and increase early-stage failure:
- Hooks (PreToolUse, PostToolUse) — defer to a "Power User" track.
- Worktree isolation — engineering-shaped, not PM-shaped.
- Headless / `claude -p` scripting — useful but a different audience.
- Custom output styles, statuslines, TUI customization — cosmetic.
- Building MCP servers — way out of scope.
- Cowork / parallel agent teams — exciting but bleeding-edge.
- The Agent SDK — for the engineers building agents, not for PMs using one.

### Pacing recommendation across the six "AI in Product" tracks

If your six-track training program are sequenced, this Claude Code 101 should land *after* a generic "AI literacy for PMs" track (covering chatbots, hallucinations, prompt basics) and *before* tracks on "AI feature design," "Evals for PM-owned AI features," and "AI roadmap & risk." Claude Code is the *tool track*; it's the one that gives PMs a daily-driver craft tool, which then makes the strategic tracks more concrete.

The "early-adopter cohort → GA" handoff should explicitly leverage early-adopter alumni as in-channel office-hours hosts and as the source of canonical CLAUDE.md and skill examples. The single biggest predictor of GA success is whether a general-population PM can see a early adopter's `~/.claude/` structure and steal from it on day one.

---

## Closing note on raw materials

The richest source documents to draw from when authoring the actual modules:

- **Anthropic — *Best Practices for Claude Code*** (`code.claude.com/docs/en/best-practices`). The canonical operational doc.
- **Anthropic — *How Claude remembers your project*** (`code.claude.com/docs/en/memory`). Definitive on CLAUDE.md and auto-memory.
- **Anthropic — *Choose a permission mode*** (`code.claude.com/docs/en/permission-modes`). Definitive on the five modes.
- **Anthropic — *Explore the .claude directory*** (`code.claude.com/docs/en/claude-directory`). Definitive on file layout and precedence.
- **Anthropic — *Extend Claude with skills*** (`code.claude.com/docs/en/skills`) and the *Skill authoring best practices*. Definitive on skill structure.
- **Anthropic — *Create custom subagents*** (`code.claude.com/docs/en/sub-agents`). Definitive on subagents and forks.
- **Anthropic blog — *Using Claude Code: session management and 1M context***. The clearest articulation of `/clear` vs `/compact` vs subagents.
- **Anthropic engineering — *Claude Code auto mode: a safer way to skip permissions***. The current authoritative source on auto mode and its limits.
- **Anthropic engineering — *Building agents with the Claude Agent SDK***. The harness-as-product framing.
- **Anthropic — *How Anthropic teams use Claude Code*** (PDF and blog). Cross-functional case studies including non-engineering teams (legal, marketing).
- **HumanLayer blog — *Writing a good CLAUDE.md***. The best-argued external piece on the *brevity* and *progressive disclosure* discipline. Particularly useful for a PM audience because it quantifies why long CLAUDE.md files degrade behavior.
- **Anthropic resources — *The Complete Guide to Building Skills for Claude*** (PDF). Long-form companion for the skills module.
- **Carl Vellotti — *Claude Code for Product Managers* (`ccforpms.com`)** and **Sachin Rekhi — *Claude Code for Product Managers***. Two of the better-quality PM-shaped public courses; useful for borrowing examples and *not* for borrowing curriculum structure (both are aimed at curious-and-forward-leaning audiences, not your organization's general-population PM).
- **Teresa Torres on Lenny's podcast — *Claude Code for product managers: research, writing, context libraries***. The single best demonstration of file-based PM workflows by a non-engineer; useful as a "this is what mature use looks like" reference.
- **Andrej Karpathy / MindStudio — *LLM Wiki* pattern**. The intellectual foundation for the "files-as-memory, folder-as-knowledge-base" approach that underpins most of the birdhouses.

These sources, plus internal organization context (the actual `managed-settings.json`, the actual approved MCP server list, the actual SSO flow), are the input pile. the course author's job at this stage is to pick the *one* sentence per concept that lands for a general-population PM, and the *one* concrete artifact per birdhouse that they can show their manager on Friday.
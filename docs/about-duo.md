# About Duo

Modern knowledge agents, like Claude Code, is a powerful but sometimes cumbersome experience.

## The problem I was trying to solve

Working with Claude Code outside of an IDE often means juggling multiple windows from multiple applications.

![A typical knowledge-worker workflow — multiple terminal windows, editor windows, browser windows, and Finder windows juggled across the screen](image-20260518-102703-44ef.png)

In my average workflow, I am:

- Running multiple terminal windows
- Editing multiple markdown files
- Manually looking things up in Finder and setting CWD in the terminal
- Reviewing multiple html artifacts in browsers
- Typing out descriptions to Claude to try me best to reference these various pieces and orchestrate workflows

There are a lot of ways to improve aspects of this workflow, but I didn't find any that addressed all of them:

- IDEs like VSC offer a flexible three-column view and can be enhanced with extensions – but the markdown editing experience isn't great and the terminal is extremely unreliable for long sessions.
- Claude Desktop is getting better with every release – but it is not available for all enterprise customers and does not yet have a great co-writing experience for artifacts.
- Obsidian offers a great markdown editing experience and can be extended with a terminal – but does not work as well with non-markdown assets

I have tried many alternative terminals (e.g. CMUX, which is great), IDEs, versions of Claude Desktop, but each left me thinking I could build something that fit my needs better.

## Introducing Duo

I built Duo, an agent-friendly IDE for product managers and knowledge workers.

Duo is free, open source, does not capture or send any of your data anywhere, and lets you work with whatever agent you want.

![Duo's main window — file navigator on the left, terminal in the middle, working pane (markdown editor / browser / canvas) on the right](image-20260518-105715-661d.png)

At its core, Duo is an IDE for knowledge work, with four main features:

1. **File Navigator that sets and responds to context** – you can use it to find your files, set the CWD for your Claude session, check Github status for linked repos, etc.
2. **Tabbed, connected Terminal** – more work is happening in the terminal, so Duo's terminal is front and center. If you spawn a new terminal session, it sets CWD from the navigator. When you switch tabs, the file navigator responds by opening the current CWD.
3. **Markdown editor that feels like home** – it's all markdown-native under the hood, but unless you view source you don't need to think about Markdown. Use markdown notation (styles rendered real-time) or just use familiar keyboard shortcuts from Google Docs, Word, or Notion.
4. **CLI that ties it all together** – \~anything you can do in the app, your Agent can do via CLI.
   - "Open my the roadmap and scroll to the 'open questions' section"
   - "Navigate to the 'tasks' folder, expand it, and tell me what's in there"
   - "Create a new file, 'product-vision.md', open it, and collapse the terminal and navigator so I can focus"

<!-- Feature deep dives — Navigator, Terminal, Canvas (Main vs Split View, Actions,
     Markdown Editor, HTML Editor, JSON Editor, Browser), CLI — coming soon. -->

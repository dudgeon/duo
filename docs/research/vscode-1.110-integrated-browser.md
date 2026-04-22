# Research — VS Code 1.110 Integrated Browser

> **Source:** External research report delivered 2026-04-22, reviewed in the `claude/browser-document-editing-OdneV` branch.
> **Why it's here:** Duo's architecture is a direct response to the walls this report documents. VS Code 1.110 ships a capable agent-driven browser but locks Claude Code out; Duo is being designed so Claude Code is the first-class client of the browser. Preserving the report helps future Claude instances understand which patterns we are borrowing, which we are improving on, and why.
> **Companion doc:** See `../../duo-brief.md` §17 ("Google Docs First-Class Support") for the implications mapped onto our roadmap.

-----

# VSCode 1.110's integrated browser: powerful for Copilot, walled off from Claude Code

**The VSCode 1.110 integrated browser is a genuinely capable agent-driven browser — but Claude Code cannot use it.** The browser tools are hardwired into VS Code's internal chat/agent system with no exposed CDP port, no MCP wrapper, no extension API, and no CLI access. They are built-in workbench primitives, not extension-contributed tools, which means they exist below the extensibility layer where third-party agents operate. Claude Code users who need browser automation should use the Playwright MCP server or Claude Code's own Chrome integration instead.

The integrated browser itself — introduced in VS Code 1.109 (January 2026) with agent tools added in 1.110 (stable March 4, 2026) — is a real Chromium browser running inside Electron, capable of loading any URL including Google Docs with full authentication. The agent tooling on top of it is genuinely impressive: screenshot capture, DOM reading via accessibility tree, console log monitoring, click/type/hover simulation, and arbitrary Playwright code execution. The gap is purely one of access control architecture.

-----

## The browser is real Chromium with full web capabilities

The integrated browser is **not** an iframe or webview hack. It runs in Electron's embedded Chromium engine (Chromium 142.x as of 1.110) as a separate process with full isolation from VS Code's main process. Source code lives in `src/vs/workbench/contrib/chat/electron-browser/tools/` — the `electron-browser` layer of the workbench, meaning it's a core platform feature, not a bundled extension.

This architecture means the browser can do everything a real browser does: load `http://`, `https://`, and `file://` URLs; handle JavaScript-heavy SPAs; run authentication flows for Google, GitHub, and other OAuth providers; maintain cookies and localStorage across sessions. The old Simple Browser (an iframe-in-a-webview) couldn't authenticate to Google or load sites with `X-Frame-Options` restrictions. The integrated browser overcomes all of these limitations.

Session storage is controlled by `workbench.browser.dataStorage` with three modes: **`global`** (persists across workspaces), **`workspace`** (isolated per workspace), and **`ephemeral`** (incognito-like, no persistence). In untrusted workspaces, ephemeral mode is forced regardless of the setting. Multiple browser instances can run simultaneously in separate editor tabs.

-----

## Ten agent tools — and what each actually does

When `workbench.browser.enableChatTools` is set to `true`, agents gain access to **10 built-in tools** grouped under "Built-in > Browser" in the chat tools picker:

| Category          | Tools                                                                       | What they do                                                                        |
|-------------------|-----------------------------------------------------------------------------|-------------------------------------------------------------------------------------|
| Page navigation   | `openBrowserPage`, `navigatePage`                                           | Open URLs and navigate within pages                                                 |
| Content reading   | `readPage`, `screenshotPage`                                                | Extract page content (accessibility tree → Markdown) and capture visual screenshots |
| User interaction  | `clickElement`, `hoverElement`, `dragElement`, `typeInPage`, `handleDialog` | Simulate clicks, hovers, drag operations, keyboard input, and dialog responses      |
| Custom automation | `runPlaywrightCode`                                                         | Execute arbitrary Playwright scripts in the browser context                         |

The `readPage` tool almost certainly returns the page's **accessibility tree converted to Markdown**, based on PR #245571 ("Convert Accessibility Tree to Markdown") found in VS Code's commit history. This approach mirrors the Playwright MCP server's strategy of using structured accessibility snapshots rather than raw HTML, making output LLM-friendly without requiring vision models.

The `runPlaywrightCode` tool is the most powerful entry point. It accepts arbitrary Playwright automation code, meaning agents can call `page.evaluate()` for JavaScript execution, `page.accessibility.snapshot()` for raw accessibility tree data, and any other Playwright API. Console errors and warnings are **automatically streamed** to the agent during all interactions — this isn't a poll-based system but a real-time feed.

-----

## Shared pages vs. agent-opened pages: the authentication model

The browser tools implement a **dual-session architecture** that is central to understanding what agents can and cannot access:

**Agent-opened pages** (via `openBrowserPage`) run in **private, in-memory sessions** with no shared cookies or storage. The agent gets a clean, isolated browser context. This means an agent cannot access your authenticated Google Docs session unless you explicitly grant it.

**Shared pages** use a fundamentally different model. When you manually open a page in the integrated browser, log into Google, and then click the **"Share with Agent"** button in the browser toolbar, a confirmation dialog appears. Upon approval, a visual indicator marks the tab as shared, and the agent gains temporary access to that page **including your full session state** — cookies, localStorage, and login credentials. Clicking "Share with Agent" again immediately revokes access.

This is a thoughtful security design: **the agent never inherits your authenticated sessions by default**. Google Docs access requires explicit, revocable, per-page user consent. Agents that need to test authentication flows against their own apps use the ephemeral agent-opened pages instead.

-----

## Evaluation against the ten criteria

Here is a direct assessment of each capability the user asked about:

**1. Embedding a real browser that loads arbitrary URLs including authenticated Google Docs:** Yes. Full Chromium browser, loads any URL. Google authentication works. Shared pages preserve login state.

**2. CLI-based access from the VSCode terminal (e.g., Claude Code programmatically inspecting DOM, evaluating JS, taking screenshots):** No. The tools are internal workbench primitives with no CLI interface, no command-line API, and no way for a terminal process to invoke them. There is no `vscode` CLI flag, no Unix socket, no REST endpoint, and no IPC mechanism exposed to terminal processes.

**3. Chrome DevTools Protocol (CDP) access:** No externally accessible CDP. The integrated browser uses CDP internally through Electron's `webContents.debugger` APIs, and VS Code maintains the `@vscode/cdp` library (now archived, likely absorbed into core). But **no CDP port or WebSocket endpoint is exposed** for external tools to connect to. The protocol layer is fully encapsulated.

**4. Google authentication with persistent sessions:** Yes. Users can log into Google and maintain sessions. The `global` storage mode persists cookies across workspaces. Shared pages give agents access to these authenticated sessions.

**5. Accessibility tree access:** Yes, through two paths. `readPage` returns the accessibility tree converted to Markdown format. For raw accessibility tree data, `runPlaywrightCode` provides access to Playwright's `page.accessibility.snapshot()` API.

**6. Screenshot capture:** Yes. The `screenshotPage` tool captures page screenshots, likely using Electron's `webContents.capturePage()` or CDP's `Page.captureScreenshot`. The browser testing guide specifically describes capturing screenshots at different viewport sizes for responsive testing.

**7. Console log reading:** Yes. Console errors and warnings are automatically streamed to the agent in real time as it interacts with pages. This uses CDP's `Runtime.consoleAPICalled` event or Electron's console event handlers internally.

**8. JavaScript evaluation:** Yes, via `runPlaywrightCode`. Agents can call `page.evaluate()` to run arbitrary JavaScript in the page context. The simpler tools (`clickElement`, `typeInPage`) handle common interactions without requiring custom JS.

**9. "Share with Agent" feature:** This is a manual, user-initiated sharing mechanism. Click the toolbar button → confirm in dialog → visual indicator appears on tab → agent gets temporary access including your session → click again to revoke. It is part of VS Code's built-in chat system and **not extensible** to agents outside that system.

**10. Does it work with Claude Code specifically?** **No.** This is the critical finding, detailed in the next section.

-----

## Why Claude Code is locked out — and the three walls blocking it

There are three distinct architectural barriers preventing Claude Code from accessing the integrated browser tools:

**Wall 1: The tools are not exposed through any extension API.** The browser tools are registered as internal workbench contributions, not through the Language Model Tools API (`vscode.lm.registerTool` / `vscode.lm.tools`). Third-party extensions cannot discover, invoke, or interact with these tools programmatically. There is no `vscode.commands` entry point, no event to subscribe to, and no API surface whatsoever.

**Wall 2: The tools are bound to VS Code's chat/agent system.** They appear exclusively in the chat tools picker under "Built-in > Browser" and are invoked through the agent mode conversation flow. GitHub issue #298949 reveals that `workbench.browser.enableChatTools` is **governed by GitHub Copilot organizational policies** — when a user's org disabled MCP servers in Copilot settings, this setting showed "Managed by organization." The issue was closed as "not planned," confirming the tight coupling to Copilot infrastructure.

**Wall 3: Claude operates with its own tool definitions.** Whether running as the standalone Claude Code extension (Anthropic's VS Code extension with its own UI and terminal) or as a third-party agent within Copilot Chat (via `github.copilot.chat.claudeAgent.enabled`), Claude uses **Anthropic's Claude Agent SDK with its own set of tools and capabilities**. The official docs state this explicitly. Cloud Claude agent sessions "can't directly access VS Code built-in tools." Local Claude agent sessions use the Claude Agent harness rather than the Copilot agent harness. No documentation confirms local Claude sessions can access the built-in browser tools.

-----

## Practical alternatives for Claude Code browser automation

Since the integrated browser tools are inaccessible, Claude Code users have three viable alternatives:

- **Playwright MCP server** (`@microsoft/mcp-server-playwright` or `@playwright/mcp@latest`): The most mature option. Launches a separate Chromium instance, supports CDP endpoint connection to existing browsers, works with any MCP-compatible client including Claude Code. Configured via `.vscode/mcp.json` or Claude Code's MCP settings. Provides accessibility tree snapshots, screenshots, click/type actions, and JavaScript evaluation — functionally similar to the built-in tools but running externally.
- **Claude Code's native Chrome integration**: Anthropic's own solution, released in 2026. Uses the "Claude in Chrome" browser extension (v1.0.36+) connected via native messaging to Claude Code (v2.0.73+). This is completely independent of VS Code's integrated browser — it controls your actual Chrome or Edge browser. Requires a paid Anthropic plan.
- **Community extensions**: Projects like "Damocles" (claude-unbound) build their own browser integrations as in-process MCP servers, demonstrating that the community is routing around VS Code's walled garden rather than waiting for official extensibility.

The Playwright MCP server is the closest equivalent to the built-in tools. The key tradeoff: the built-in tools offer tighter integration (real-time console streaming, visual tab indicators, Share with Agent UI) and zero setup, while the Playwright MCP requires configuration but works with any agent.

-----

## Conclusion

VS Code 1.110's integrated browser is architecturally impressive — a real Chromium browser with a thoughtful dual-session security model, ten capable agent tools, and Playwright as an escape hatch for arbitrary automation. The `readPage` accessibility-tree-to-Markdown approach and real-time console streaming represent genuine advances over external browser automation.

But the architecture is a **closed system**. No CDP port, no extension API, no MCP wrapper, no CLI access. The tools exist as internal workbench primitives below the extensibility layer, tightly coupled to Copilot's organizational policy framework. There are no GitHub issues requesting broader access, no documented plans to open the API, and the one related issue (#298949) was closed as "not planned."

For Claude Code users, the practical answer is the **Playwright MCP server** for headless automation or **Claude Code's Chrome integration** for interactive browsing. These provide ~90% of the same capabilities with different tradeoffs. The missing 10% — real-time console streaming, the Share with Agent UX, and zero-config setup — remains a Copilot exclusive for now. Whether Microsoft opens this architecture to third-party agents will likely depend on competitive pressure from Cursor and Windsurf, both of which have shipped their own deep browser integrations.

-----

## Implications for Duo (added during integration)

The architectural walls that block Claude Code from VS Code's browser do **not** exist in Duo, because Duo owns its own Electron main process and exposes CDP to the terminal via a Unix-socket CLI bridge by design. Direct mapping of the ten criteria onto Duo's planned architecture:

| # | Capability                        | In Duo                                                                                 |
|---|-----------------------------------|----------------------------------------------------------------------------------------|
| 1 | Real Chromium with authenticated URLs | WebContentsView is real Chromium with persistent session (Stage 2)                 |
| 2 | CLI access from terminal          | Core design — `orbit <cmd>` over Unix socket (Stage 3)                                 |
| 3 | CDP access                        | Free via `webContents.debugger.sendCommand(...)` in the main process                   |
| 4 | Google auth with persistent sessions | Electron `session` + partition persists cookies (Stage 2)                           |
| 5 | Accessibility tree                | `Accessibility.getFullAXTree` via CDP — the read path for canvas-rendered apps         |
| 6 | Screenshots                       | `Page.captureScreenshot` (CDP) or `webContents.capturePage()`                          |
| 7 | Console logs                      | `Runtime.consoleAPICalled` CDP event or `webContents` `console-message`                |
| 8 | JS evaluation                     | `Runtime.evaluate` / `webContents.executeJavaScript`                                   |
| 9 | Share-with-agent gating           | Optional — Duo's threat model is single-user-owned; may adopt the UX for clarity       |
| 10| Works with Claude Code            | Yes by construction                                                                    |

**Key gotcha surfaced by this report for Duo planning:** Google Docs (Kix editor) renders to `<canvas>`, not DOM. Naive `document.querySelector('.kix-appview-canvas')` returns almost no text, so the original skill example in `duo-brief.md` §10 was wrong. The accessibility-tree path described here (what VS Code's `readPage` does) is the correct primitive. See `duo-brief.md` §17 for Duo's adopted strategy.

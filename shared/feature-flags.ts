// Shared feature flags — small constants module for opt-in / kill-switch
// gating of features across main + renderer + CLI.
//
// Today: simple module-level constants. Set them here, recompile, ship.
// No runtime flipping — that's deliberate; if a flag needs runtime
// flipping, promote it to a localStorage-backed setting (see e.g. the
// theme system in App.tsx) or a CLI verb.
//
// Adding a flag:
//   1. Add the constant below with a comment explaining what it gates
//      and why it's currently on or off.
//   2. Reference it where the feature would normally fire (e.g.
//      `if (FEATURE_AUTO_INJECT_IDS) { ... }`).
//   3. Cross-link the deciding bug/ENH ID in the comment so the next
//      person knows which conversation to dig up.
//
// Removing a flag:
//   - Remove the constant + the guard in the consumer once the feature
//     is settled.

/** Stage 17b — auto-inject `data-duo-id` attributes when opening an
 *  HTML canvas that has none. The original design was: prompt the user
 *  on first open via IdInjectionBanner; if accepted, walk the body
 *  and stamp `data-duo-id="<ULID>"` on every element so agent edits
 *  via `duo html *` and comment threads have stable anchors.
 *
 *  Off by default as of v0.5.5 (owner request, post-walk-2). The
 *  feature isn't broken — it does what it claims — but the banner
 *  surfaces on every fresh canvas open and many local HTML files
 *  don't need or benefit from the IDs (smoke walk pages, agent-
 *  generated dashboards, prototype HTML). Re-enable when the auto-
 *  surfacing is gated more tightly (e.g. only when an agent op needs
 *  an anchor) or when the canvas/browser routing convention from
 *  ENH-034 lands so canvas-mode is opt-in per file.
 *
 *  When false: no banner, no auto-inject. Files that already have
 *  IDs continue to work — only the first-open prompt is suppressed.
 *  Agents can still call `duo html stamp-ids` manually if a session
 *  needs anchors. */
export const FEATURE_AUTO_INJECT_IDS = false

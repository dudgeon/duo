// Stage 21e-ii — fork-config compile-time constants.
//
// Vite's `define:` block (in electron.vite.config.ts) substitutes
// these identifiers with literal values from fork.config.json at
// compile time. The substitution happens at parse time on bare
// identifier references — `__DUO_PUBLISH_OWNER__` in source code
// becomes the string literal `"dudgeon"` (or whatever the forker
// configured) in the bundled output. No runtime cost.
//
// These are NOT real variables — they exist only at type-check
// time. Don't try to import them; use them as bare identifiers.
//
// To fork: copy fork.config.default.json → fork.config.json and
// edit. Rebuild — your values flow through. See
// `docs/HOW-TO-FORK.md` for the full forker walkthrough.

/** macOS bundle identifier (`com.X.Y` reverse-DNS form). */
declare const __DUO_APP_ID__: string

/** Display name shown in macOS menus + dock. */
declare const __DUO_PRODUCT_NAME__: string

/** Update channel provider. Today only `'github'` is wired. */
declare const __DUO_PUBLISH_PROVIDER__: string

/** GitHub org / user that hosts the upstream releases. */
declare const __DUO_PUBLISH_OWNER__: string

/** GitHub repo name under that org. */
declare const __DUO_PUBLISH_REPO__: string

/** Default host patterns for ~/.claude/duo/external-domains.json on
 *  first install. URLs matching these patterns route through
 *  shell.openExternal instead of the embedded browser. */
declare const __DUO_BOOTSTRAP_EXTERNAL_DOMAINS__: string[]

/** Default pinned help files for ~/.claude/duo/pins.json on first
 *  install. Each entry is a basename like `'faq.html'`. */
declare const __DUO_BOOTSTRAP_HELP_PINNED__: string[]

/** ENH-051 — pack directory names this fork has opted out of.
 *  Stage 18b's PackLoader filters these before classification;
 *  install-service skips them when copying upstream packs/* into
 *  ~/.claude/duo/packs/. Empty array (default) = ship all upstream
 *  packs. Forks edit fork.config.json's `packs.disabled` to opt out
 *  of upstream FTUX content (e.g. an enterprise distro that has
 *  its own onboarding suppresses `intro-to-duo`). */
declare const __DUO_PACKS_DISABLED__: string[]

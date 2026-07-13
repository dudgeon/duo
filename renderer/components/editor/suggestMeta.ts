// ENH-260 — shared transaction-meta constants for suggesting mode.
//
// META_SUGGEST_AUTO marks a transaction as NOT a user edit, so the
// suggesting-mode reconciler (suggestEngine.buildSuggestionTr) must skip
// it. Two producer classes:
//   1. The reconciler's own appended transactions (loop guard).
//   2. Programmatic mutations that must never be re-tracked as
//      suggestions — accept/reject helpers (which DELETE content the
//      reconciler would otherwise resurrect), tracked-diff application,
//      history restore, CriticMarkup materialization passes.
//
// Historically this constant lived module-private in SuggestingMode.ts
// as 'duo-suggesting-auto'; the string value is kept for continuity.

export const META_SUGGEST_AUTO = 'duo-suggesting-auto'

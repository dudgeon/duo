#!/usr/bin/env node
// .claude/skills/worksheet/generate.mjs
//
// Schema-driven worksheet generator. Takes a manifest JSON and writes a
// self-contained interactive HTML page: per-item controls (radio
// primary + textarea secondary), localStorage persistence keyed by
// manifest name, sticky footer with summary + Copy results button that
// produces parseable text output. Built by extracting the smoke-walk
// generator (.claude/skills/smoke-walk/generate.mjs) so other use cases
// (sprint planning, retros, triage forms) get the same chrome for free.
//
// Usage (direct):
//   node .claude/skills/worksheet/generate.mjs <manifest.json> <output.html>
//
// Usage (programmatic):
//   import { generateWorksheet } from '.claude/skills/worksheet/generate.mjs'
//   const html = generateWorksheet(manifest)
//
// Manifest schema (see .claude/skills/worksheet/SKILL.md for the full
// authoring guide):
//
// {
//   "kind": "smoke-walk" | "sprint-plan" | "<arbitrary>",
//   "name": "v0.6.4-walk-1",        // unique; used as localStorage key
//   "version": "0.6.4",             // displayed in header; optional
//   "date": "2026-05-03",           // displayed in header; optional
//   "title": "Smoke walk · v0.6.4", // <h1>
//   "intro_html": "<p>...</p>",     // optional intro blurb
//   "controls": {
//     "primary": {
//       "kind": "radio",
//       "name": "result",
//       "options": [
//         { "value": "PASS", "label": "Pass", "color": "#4a7d3e" },
//         ...
//       ]
//     },
//     "secondary": {
//       "kind": "textarea",
//       "name": "notes",
//       "placeholder": "Notes (optional)",
//       "rows": 2
//     },
//     "mark_all": { "label": "Mark all Pass", "value": "PASS" }
//   },
//   "result_format": {
//     "header_template": "SMOKE WALK v{version} ({date})",
//     "summary_label": "SUMMARY"
//   },
//   "items": [
//     {
//       "id": "BUG-070",
//       "title": "Cursor lands in fresh HTML canvas on first click",
//       "subtitle": "🟡 from active-sprint.md FAIL",  // optional
//       "what_fixes": "...",                          // optional description
//       "steps": ["...", "..."],                      // optional steps list
//       "body_html": "..."                            // optional escape hatch
//     }
//   ],
//   "misc_notes": {                                   // optional misc block
//     "title": "Other notes",
//     "help": "Anything you noticed that didn't belong to a specific item.",
//     "result_block_title": "OTHER NOTES"
//   }
// }

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'

// ---------------------------------------------------------------- helpers

// HTML escape — covers the <span> / <p> / <textarea-placeholder> cases.
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ENH-046 (smoke-walk lineage) — split a step's prose into prose and
// `code` chunks. Anything that "looks like a command" (whitespace, > 25
// chars, or starts with a recognized shell verb) becomes a copyable
// <pre> block; short tokens stay inline as <code>. Mid-sentence
// commands get demoted back to inline so they don't leave a prose gap.
const COMMAND_VERB_RE = /^(?:duo|node|ls|pkill|bash|sh|zsh|npm|cd|mkdir|rmdir|rm|mv|cp|cat|git|grep|find|which|chmod|export|source|sudo|brew|open|killall|head|tail|wc|awk|sed|jq|defaults)\b/

function looksLikeCommand(s) {
  if (s.length > 25) return true
  if (/\s/.test(s)) return true
  if (COMMAND_VERB_RE.test(s)) return true
  return false
}

// ENH-039 (smoke-walk lineage) — wrap absolute-ish paths so the CDP
// page-side click forwarder can route them through duoOpenPath /
// duoOpenPathSplit. Trailing punctuation (period, comma, etc.) is
// excluded by the regex's `[\w-]` tail.
const PATH_RE = /(?:~\/[\w./~-]*[\w-]|\/(?:Users|tmp)\/[\w./-]*[\w-])/g

function wrapPaths(escapedHtml) {
  return escapedHtml.replace(PATH_RE, (match) =>
    `<a class="duo-path-link" data-duo-path="${match}" href="#" tabindex="0">${match}</a>`
  )
}

function renderStepHtml(step) {
  const parts = []
  let buf = ''
  let inCode = false
  for (let i = 0; i < step.length; i++) {
    const ch = step[i]
    if (ch === '`') {
      if (inCode) {
        if (looksLikeCommand(buf)) {
          parts.push({ kind: 'cmd', text: buf })
        } else {
          parts.push({ kind: 'inline-code', text: buf })
        }
        buf = ''
        inCode = false
      } else {
        if (buf) parts.push({ kind: 'prose', text: buf })
        buf = ''
        inCode = true
      }
      continue
    }
    buf += ch
  }
  if (buf) parts.push({ kind: inCode ? 'prose' : 'prose', text: (inCode ? '`' : '') + buf })

  // BUG-063 (smoke-walk lineage) — only pull cmds into a copy block
  // when they're truly trailing. Mid-sentence cmds stay inline.
  function isTrivialTrailingProse(text) {
    return /^[\s.,;:!?)\]"]*$/.test(text)
  }
  function isTrailingCmd(idx) {
    for (let j = idx + 1; j < parts.length; j++) {
      const p = parts[j]
      if (p.kind === 'prose' && isTrivialTrailingProse(p.text)) continue
      return false
    }
    return true
  }
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].kind === 'cmd' && !isTrailingCmd(i)) {
      parts[i] = { kind: 'inline-code', text: parts[i].text }
    }
  }

  const inlineHtml = parts
    .filter(p => p.kind !== 'cmd')
    .map(p => p.kind === 'inline-code'
      ? `<code class="step-inline">${wrapPaths(esc(p.text))}</code>`
      : wrapPaths(esc(p.text)))
    .join('')
  const cmdBlocks = parts
    .filter(p => p.kind === 'cmd')
    .map(p => `<div class="step-cmd"><pre><code>${esc(p.text)}</code></pre><button class="copy-cmd btn-copy" data-cmd="${esc(p.text)}" type="button">Copy</button></div>`)
    .join('')
  return `${inlineHtml}${cmdBlocks}`
}

// ---------------------------------------------------------- manifest validation

function validateManifest(m) {
  if (!m || typeof m !== 'object') throw new Error('Manifest must be an object')
  if (typeof m.name !== 'string') throw new Error('Manifest needs a string `name` (used as localStorage key)')
  if (!Array.isArray(m.items)) throw new Error('Manifest needs an `items` array')
  if (!m.controls?.primary) throw new Error('Manifest needs `controls.primary` (the radio group)')
  const p = m.controls.primary
  if (p.kind !== 'radio') throw new Error('controls.primary.kind must be "radio" (only kind supported today)')
  if (!Array.isArray(p.options) || p.options.length === 0) {
    throw new Error('controls.primary.options must be a non-empty array')
  }
  for (const opt of p.options) {
    if (typeof opt.value !== 'string' || typeof opt.label !== 'string') {
      throw new Error('Each control option needs string `value` and `label`')
    }
  }
}

// ---------------------------------------------------------- HTML generation

export function generateWorksheet(manifest) {
  validateManifest(manifest)

  const {
    kind = 'worksheet',
    name,
    version = '',
    date = '',
    title = name,
    intro_html = '',
    controls,
    result_format = {},
    items,
    misc_notes
  } = manifest

  const primary = controls.primary
  const secondary = controls.secondary  // optional textarea
  const markAll = controls.mark_all     // optional default-button {label, value}

  const headerTemplate = result_format.header_template
    ?? `${kind.toUpperCase().replace(/-/g, ' ')}${version ? ' v' + version : ''}${date ? ' (' + date + ')' : ''}`
  const headerLine = headerTemplate
    .replaceAll('{version}', version)
    .replaceAll('{date}', date)
    .replaceAll('{name}', name)
  const summaryLabel = result_format.summary_label ?? 'SUMMARY'

  // Per-item HTML
  const itemsHtml = items.map((item, i) => {
    if (!item.id || !item.title) {
      throw new Error(`Item ${i} missing required id/title`)
    }
    const subtitleHtml = item.subtitle
      ? `<div class="subtitle">${esc(item.subtitle)}</div>`
      : ''
    const whatFixesHtml = item.what_fixes
      ? `<p class="what-fixes">${esc(item.what_fixes)}</p>`
      : ''
    const stepsHtml = (item.steps && item.steps.length)
      ? `<ol class="steps">\n        ${item.steps.map(s => `<li>${renderStepHtml(s)}</li>`).join('\n        ')}\n      </ol>`
      : ''
    const bodyHtml = item.body_html ?? ''

    // Radio buttons for the primary control. Per-option colors are
    // applied via the generated CSS rules (see optionColorRules below);
    // each option's `.opt-<value>:has(input:checked)` rule sets the
    // background. Don't inline a CSS variable here — nothing reads it.
    const radiosHtml = primary.options.map(opt => `
          <label class="opt opt-${esc(opt.value.toLowerCase())}">
            <input type="radio" name="${esc(primary.name)}-${esc(item.id)}" value="${esc(opt.value)}">
            <span>${esc(opt.label)}</span>
          </label>`).join('')

    const secondaryHtml = secondary?.kind === 'textarea' ? `
        <textarea
          class="notes"
          rows="${secondary.rows ?? 2}"
          placeholder="${esc(secondary.placeholder ?? '')}"
          data-name="${esc(secondary.name)}"
        ></textarea>` : ''

    return `
    <section class="item" data-id="${esc(item.id)}" data-title="${esc(item.title)}">
      <header class="item-head">
        <span class="id">${esc(item.id)}</span>
        <h2 class="title">${esc(item.title)}</h2>
      </header>
      ${subtitleHtml}
      ${whatFixesHtml}
      ${stepsHtml}
      ${bodyHtml}
      <div class="controls">
        <fieldset class="result-toggle">
          <legend class="sr-only">${esc(primary.name)} for ${esc(item.id)}</legend>${radiosHtml}
        </fieldset>${secondaryHtml}
      </div>
    </section>`
  }).join('\n')

  // Misc notes block (optional)
  const miscHtml = misc_notes ? `
<section class="misc">
  <h2 class="misc-title">${esc(misc_notes.title ?? 'Other notes')}</h2>
  ${misc_notes.help ? `<p class="misc-help">${esc(misc_notes.help)}</p>` : ''}
  <textarea
    id="misc-notes"
    class="misc-textarea"
    rows="4"
    placeholder="${esc(misc_notes.placeholder ?? 'Free-form notes (optional)')}"
  ></textarea>
</section>` : ''

  // Per-option color CSS — emit a rule per option value so the checked
  // state can use the option's declared color.
  const optionColorRules = primary.options
    .filter(o => o.color)
    .map(o => `  fieldset.result-toggle .opt-${o.value.toLowerCase()}:has(input:checked) { background: ${o.color}; }`)
    .join('\n')

  const markAllBtnHtml = markAll
    ? `<button class="btn" id="mark-all" type="button" data-mark-value="${esc(markAll.value)}">${esc(markAll.label)}</button>`
    : ''

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<!-- duo-open-in: force the browser pane (canvas would put body in
     contenteditable, trapping the Copy results click as a cursor
     placement). -->
<meta name="duo-open-in" content="browser">
<!-- duo-editable: lock to read-only IF the page does end up in the
     canvas (e.g. user moves it to Split View, which currently
     promotes browser-pane content to a canvas). The form controls
     (radio inputs, textarea) still work — they bypass contentEditable
     — but the document text doesn't accept stray cursor placement,
     so Copy results / Send to Claude clicks land cleanly. Without
     this, BUG-091 + the user's split-view test became a procedural
     blocker for the smoke walk. -->
<meta name="duo-editable" content="false">
<!-- Path links default to opening in Split View so the worksheet
     stays visible while linked files open in aux. Per-link override:
     <a data-duo-path="..." data-duo-target="main">. -->
<meta name="duo-path-target" content="split">
<title>${esc(title)}</title>
<style>
  /* Atelier-adjacent palette — paper bg, ink text, soft accent.
     Self-contained so the page works without Duo's stylesheet. */
  :root {
    --paper: #fbf8f1;
    --paper-deep: #f3ede0;
    --paper-edge: #e8e0cb;
    --paper-rule: #d9cea8;
    --ink: #2b2620;
    --ink-soft: #4a4238;
    --ink-mute: #6f6557;
    --ink-ghost: #9a9080;
    --accent: #c46a1c;
    --accent-soft: #f4d9b6;
    --pass: #4a7d3e;
    --fail: #b13e3a;
    --skip: #6f6557;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: var(--paper);
    color: var(--ink);
    font-family: -apple-system, "SF Pro Text", "Segoe UI", system-ui, sans-serif;
    font-size: 14px;
    line-height: 1.5;
  }
  body { padding: 32px 40px 96px; max-width: 820px; margin: 0 auto; }
  .sr-only {
    position: absolute; width: 1px; height: 1px; overflow: hidden;
    clip: rect(0,0,0,0); white-space: nowrap;
  }

  header.page-head { border-bottom: 1px solid var(--paper-rule); padding-bottom: 16px; margin-bottom: 24px; }
  header.page-head h1 {
    font-family: "New York", "Iowan Old Style", Georgia, serif;
    font-style: italic;
    font-weight: 500;
    margin: 0 0 4px;
    font-size: 22px;
  }
  header.page-head .meta { color: var(--ink-mute); font-size: 13px; }

  .intro {
    background: var(--paper-deep);
    border: 1px solid var(--paper-rule);
    border-radius: 6px;
    padding: 12px 16px;
    margin-bottom: 24px;
    font-size: 13px;
    color: var(--ink-soft);
  }
  .intro strong { color: var(--ink); font-weight: 600; }

  section.item {
    background: white;
    border: 1px solid var(--paper-rule);
    border-radius: 6px;
    padding: 16px 18px;
    margin-bottom: 16px;
    transition: border-color 0.15s, background 0.15s;
  }
  section.item.is-answered { border-color: var(--accent); }
  section.item.is-skip { opacity: 0.7; }

  /* Per-option card tint — when an item is answered, the whole card
     adopts a soft tint of the chosen option color. Restored at owner
     request after the smoke-walk to worksheet primitive extraction
     dropped it. The is-opt-VALUE class is set in tally() based on the
     checked radio. Scoped to known PASS/FAIL/SKIP and P0/P1/P2
     conventions; consumers using custom values inherit only the
     border-color treatment. */
  section.item.is-opt-pass { background: color-mix(in srgb, var(--pass) 8%, white); border-color: color-mix(in srgb, var(--pass) 50%, var(--paper-rule)); }
  section.item.is-opt-fail { background: color-mix(in srgb, var(--fail) 10%, white); border-color: color-mix(in srgb, var(--fail) 55%, var(--paper-rule)); }
  section.item.is-opt-skip { background: color-mix(in srgb, var(--skip) 6%, white); border-color: var(--paper-rule); }
  section.item.is-opt-p0 { background: color-mix(in srgb, var(--fail) 10%, white); border-color: color-mix(in srgb, var(--fail) 55%, var(--paper-rule)); }
  section.item.is-opt-p1 { background: color-mix(in srgb, var(--accent) 10%, white); border-color: color-mix(in srgb, var(--accent) 55%, var(--paper-rule)); }
  section.item.is-opt-p2 { background: color-mix(in srgb, var(--pass) 8%, white); border-color: color-mix(in srgb, var(--pass) 50%, var(--paper-rule)); }

  .item-head {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin-bottom: 6px;
  }
  .item-head .id {
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 11.5px;
    color: var(--ink-mute);
    background: var(--paper-deep);
    padding: 2px 6px;
    border-radius: 3px;
    flex-shrink: 0;
  }
  .item-head h2.title {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: var(--ink);
  }
  .subtitle {
    font-size: 12px;
    color: var(--ink-mute);
    margin: 2px 0 8px;
    font-style: italic;
  }

  .what-fixes { margin: 6px 0 10px; color: var(--ink-soft); font-size: 13px; }
  ol.steps { margin: 6px 0 14px 18px; padding: 0; color: var(--ink-soft); font-size: 13px; }
  ol.steps li { margin-bottom: 3px; }

  .controls {
    display: flex;
    flex-direction: column;
    gap: 10px;
    border-top: 1px dashed var(--paper-rule);
    padding-top: 12px;
  }

  fieldset.result-toggle {
    display: flex;
    gap: 0;
    border: 1px solid var(--paper-rule);
    border-radius: 5px;
    padding: 0;
    margin: 0;
    overflow: hidden;
    width: fit-content;
  }
  fieldset.result-toggle .opt {
    cursor: pointer;
    padding: 6px 14px;
    font-size: 12.5px;
    color: var(--ink-mute);
    border-right: 1px solid var(--paper-rule);
    background: white;
    transition: background 0.1s, color 0.1s;
    user-select: none;
  }
  fieldset.result-toggle .opt:last-child { border-right: none; }
  fieldset.result-toggle .opt:hover { background: var(--paper-deep); }
  fieldset.result-toggle .opt input { display: none; }
  fieldset.result-toggle .opt:has(input:checked) {
    color: white;
    font-weight: 600;
  }
${optionColorRules}

  textarea.notes {
    width: 100%;
    border: 1px solid var(--paper-rule);
    border-radius: 4px;
    padding: 6px 8px;
    font-family: inherit;
    font-size: 13px;
    resize: vertical;
    background: var(--paper);
    color: var(--ink);
    outline: none;
  }
  textarea.notes:focus { border-color: var(--accent); background: white; }

  section.misc {
    margin-top: 24px;
    padding: 14px 18px;
    border: 1px dashed var(--paper-rule);
    border-radius: 6px;
    background: var(--paper-deep);
  }
  .misc-title {
    font-family: "New York", "Iowan Old Style", Georgia, serif;
    font-style: italic;
    font-weight: 500;
    font-size: 15px;
    margin: 0 0 4px;
    color: var(--ink);
  }
  .misc-help { margin: 0 0 10px; color: var(--ink-mute); font-size: 12.5px; }
  textarea.misc-textarea {
    width: 100%;
    border: 1px solid var(--paper-rule);
    border-radius: 4px;
    padding: 8px 10px;
    font-family: inherit;
    font-size: 13px;
    resize: vertical;
    background: white;
    color: var(--ink);
    outline: none;
  }
  textarea.misc-textarea:focus { border-color: var(--accent); }

  footer.actions {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    background: var(--paper);
    border-top: 1px solid var(--paper-rule);
    padding: 12px 40px;
    display: flex;
    align-items: center;
    gap: 16px;
    box-shadow: 0 -4px 16px rgba(0,0,0,0.04);
  }
  footer.actions .summary {
    flex: 1;
    color: var(--ink-soft);
    font-size: 13px;
  }
  footer.actions .summary .count-tally { font-weight: 600; color: var(--ink); }
  footer.actions .summary .count-todo { color: var(--accent); font-weight: 600; }

  button.btn {
    appearance: none;
    border: 1px solid var(--paper-rule);
    background: white;
    padding: 8px 14px;
    border-radius: 5px;
    font-family: inherit;
    font-size: 13px;
    color: var(--ink);
    cursor: pointer;
    transition: background 0.1s, border-color 0.1s, color 0.1s;
  }
  button.btn:hover { background: var(--paper-deep); }
  button.btn-primary {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }
  button.btn-primary:hover { background: #a85916; border-color: #a85916; }
  button.btn-primary.is-copied {
    background: var(--pass);
    border-color: var(--pass);
  }
  button.btn[disabled] { opacity: 0.5; cursor: not-allowed; }
  button.btn-ghost {
    background: transparent;
    border-color: transparent;
    color: var(--ink-mute);
  }
  button.btn-ghost:hover { background: var(--paper-deep); color: var(--ink-soft); }

  /* Backtick-derived inline code + Copy-button command blocks. */
  code.step-inline {
    font-family: "SF Mono", ui-monospace, Menlo, Consolas, monospace;
    font-size: 12px;
    background: var(--paper-deep);
    border: 1px solid var(--paper-rule);
    border-radius: 3px;
    padding: 1px 5px;
    color: var(--ink);
  }
  a.duo-path-link {
    color: var(--accent);
    text-decoration: none;
    border-bottom: 1px dotted var(--accent);
    cursor: pointer;
  }
  a.duo-path-link:hover, a.duo-path-link:focus { border-bottom-style: solid; outline: none; }
  code.step-inline a.duo-path-link {
    color: inherit;
    border-bottom: none;
    text-decoration: underline dotted;
    text-decoration-color: var(--accent);
    text-underline-offset: 2px;
  }
  code.step-inline a.duo-path-link:hover,
  code.step-inline a.duo-path-link:focus { text-decoration-style: solid; }
  div.step-cmd {
    display: flex;
    align-items: stretch;
    gap: 6px;
    margin: 6px 0 2px;
    max-width: 720px;
  }
  div.step-cmd pre {
    flex: 1;
    margin: 0;
    padding: 7px 10px;
    background: var(--ink-soft);
    color: #fff8e8;
    border-radius: 4px;
    font-family: "SF Mono", ui-monospace, Menlo, Consolas, monospace;
    font-size: 12px;
    line-height: 1.45;
    overflow-x: auto;
    white-space: pre;
  }
  div.step-cmd pre code { font-family: inherit; color: inherit; }
  button.copy-cmd {
    appearance: none;
    border: 1px solid var(--paper-rule);
    background: white;
    color: var(--ink);
    padding: 0 12px;
    border-radius: 4px;
    font-family: inherit;
    font-size: 12px;
    cursor: pointer;
    align-self: stretch;
    transition: background 0.1s, color 0.1s, border-color 0.1s;
    flex-shrink: 0;
  }
  button.copy-cmd:hover { background: var(--paper-deep); }
  button.copy-cmd.is-copied {
    background: var(--pass);
    border-color: var(--pass);
    color: white;
  }
  /* Guaranteed-paste-back modal (the programmatic clipboard no-ops silently in
     the aux WebContentsView — this textarea is the reliable ⌘C path). */
  .copy-modal-overlay {
    position: fixed; inset: 0; z-index: 10000;
    background: rgba(0, 0, 0, 0.45);
    display: flex; align-items: center; justify-content: center; padding: 24px;
  }
  .copy-modal-panel {
    background: var(--paper, #fff); color: var(--ink, #111);
    border: 1px solid var(--paper-deep, #ccc); border-radius: 10px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
    width: min(680px, 92vw); max-height: 80vh;
    display: flex; flex-direction: column; gap: 10px; padding: 16px;
  }
  .copy-modal-head { font-size: 13px; font-weight: 600; line-height: 1.4; }
  .copy-modal-ta {
    flex: 1; min-height: 220px; width: 100%; box-sizing: border-box;
    font-family: ui-monospace, Menlo, monospace; font-size: 12px;
    background: var(--paper-deep, #f3f3f3); color: var(--ink, #111);
    border: 1px solid var(--paper-deep, #ccc); border-radius: 6px;
    padding: 10px; resize: vertical;
  }
  .copy-modal-foot { display: flex; justify-content: flex-end; }
</style>
</head>
<body>

<header class="page-head">
  <h1>${esc(title)}</h1>
  <div class="meta">${esc(date)}${date ? ' · ' : ''}${items.length} items</div>
</header>

${intro_html ? `<div class="intro">${intro_html}</div>` : ''}

<main id="items">
${itemsHtml}
</main>
${miscHtml}

<footer class="actions">
  <div class="summary" id="summary"></div>
  ${markAllBtnHtml}
  <button class="btn" id="copy" type="button" title="Copy results to clipboard for paste-back into Claude">Copy results</button>
  <button class="btn btn-primary" id="send" type="button" title="Send results directly to the active Claude terminal in Duo (falls back to clipboard if the binding isn't wired)">Send to Claude</button>
  <button class="btn btn-ghost" id="clear-saved" type="button" title="Wipe localStorage state for this worksheet (use after sending / pasting back to Claude)">Clear saved</button>
</footer>

<script>
  const NAME = ${JSON.stringify(name)};
  const HEADER_LINE = ${JSON.stringify(headerLine)};
  const SUMMARY_LABEL = ${JSON.stringify(summaryLabel)};
  const TOTAL = ${items.length};
  const PRIMARY_NAME = ${JSON.stringify(primary.name)};
  const PRIMARY_OPTIONS = ${JSON.stringify(primary.options.map(o => o.value))};
  const SECONDARY_NAME = ${JSON.stringify(secondary?.name ?? null)};
  const MISC_RESULT_TITLE = ${JSON.stringify(misc_notes?.result_block_title ?? 'OTHER NOTES')};
  // ENH-043 — event-name prefix for live duo:event emission. Defaults
  // to the manifest 'kind' (e.g. 'smoke-walk', 'sprint-plan') so
  // multiple open worksheets don't collide on the event bus.
  const WALK_EVENT_PREFIX = ${JSON.stringify(kind)};

  const itemEls = Array.from(document.querySelectorAll('section.item'));
  const summaryEl = document.getElementById('summary');
  const copyBtn = document.getElementById('copy');
  const markAllBtn = document.getElementById('mark-all');

  function tally() {
    const counts = Object.fromEntries(PRIMARY_OPTIONS.map(v => [v, 0]));
    for (const it of itemEls) {
      const v = (it.querySelector('input[type=radio]:checked') || {}).value;
      // Strip every is-opt-* class before re-applying the active one
      // so toggling between options doesn't accumulate stale tints.
      const stale = Array.from(it.classList).filter(c => c.startsWith('is-opt-'));
      stale.forEach(c => it.classList.remove(c));
      it.classList.remove('is-answered', 'is-skip');
      if (v) {
        counts[v] = (counts[v] || 0) + 1;
        it.classList.add('is-answered');
        it.classList.add('is-opt-' + v.toLowerCase());
        if (v === 'SKIP' || v === 'Skip' || v === 'skip') it.classList.add('is-skip');
      }
    }
    const totalAnswered = Object.values(counts).reduce((a, b) => a + b, 0);
    const todo = TOTAL - totalAnswered;
    const parts = PRIMARY_OPTIONS
      .map(v => counts[v] > 0 ? \`<span class="count-tally">\${counts[v]} \${v.toLowerCase()}</span>\` : null)
      .filter(Boolean);
    if (todo) parts.push(\`<span class="count-todo">\${todo} to go</span>\`);
    summaryEl.innerHTML = parts.join(' · ') + \` (\${TOTAL} total)\`;
  }

  document.getElementById('items').addEventListener('change', tally);
  document.getElementById('items').addEventListener('input', tally);
  tally();

  // ENH-094 + ENH-043 (Sprint 5) — when running inside Duo, fire a
  // live duo:event each time a radio changes, so Claude subscribed
  // via 'duo events --follow' sees walk progress as it happens. Falls
  // back to a no-op when window.duoPlaygroundAction isn't present
  // (worksheet opened outside Duo, or older Duo build pre-ENH-094).
  // Per-item events use the manifest's 'kind' as the event prefix
  // so smoke walks fire 'smoke-walk:item-changed', sprint plans fire
  // 'sprint-plan:item-changed', etc. — keeps the event channel
  // disambiguated when multiple worksheets are open.
  function emitItemChanged(id, value) {
    if (typeof window.duoPlaygroundAction !== 'function') return;
    try {
      window.duoPlaygroundAction(JSON.stringify({
        attrs: {
          'data-duo-action': 'duo:event',
          'data-event': WALK_EVENT_PREFIX + ':item-changed',
          'data-payload': JSON.stringify({ worksheet: NAME, id: id, value: value })
        }
      }));
    } catch (err) { /* binding refused — silent fallback */ }
  }
  document.getElementById('items').addEventListener('change', function (e) {
    if (!e.target || !e.target.matches || !e.target.matches('input[type=radio]')) return;
    const item = e.target.closest('section.item');
    if (!item) return;
    emitItemChanged(item.dataset.id, e.target.value);
  });

  // localStorage persistence — keyed by manifest name so different
  // worksheets don't restore each other's state.
  const STORAGE_KEY = 'worksheet:' + NAME;

  function captureState() {
    const state = { items: {}, misc: '' };
    for (const it of itemEls) {
      const id = it.dataset.id;
      const radio = it.querySelector('input[type=radio]:checked');
      const ta = it.querySelector('textarea.notes');
      state.items[id] = {
        result: radio ? radio.value : null,
        notes: ta ? ta.value : ''
      };
    }
    const miscEl = document.getElementById('misc-notes');
    state.misc = miscEl ? miscEl.value : '';
    return state;
  }

  function applyState(state) {
    if (!state || typeof state !== 'object') return;
    for (const it of itemEls) {
      const id = it.dataset.id;
      const slot = (state.items || {})[id];
      if (!slot) continue;
      if (slot.result) {
        const radio = it.querySelector(\`input[type=radio][value="\${slot.result}"]\`);
        if (radio) radio.checked = true;
      }
      if (slot.notes) {
        const ta = it.querySelector('textarea.notes');
        if (ta) ta.value = slot.notes;
      }
    }
    if (state.misc) {
      const miscEl = document.getElementById('misc-notes');
      if (miscEl) miscEl.value = state.misc;
    }
  }

  let saveTimer = null;
  function saveSoon() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(captureState()));
      } catch { /* best-effort */ }
    }, 250);
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) { applyState(JSON.parse(raw)); tally(); }
  } catch { /* corrupt or missing — start fresh */ }

  document.body.addEventListener('input', saveSoon);
  document.body.addEventListener('change', saveSoon);

  document.getElementById('clear-saved').addEventListener('click', () => {
    if (!confirm('Clear saved state and reset the form? This cannot be undone.')) return;
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    for (const it of itemEls) {
      const checked = it.querySelector('input[type=radio]:checked');
      if (checked) checked.checked = false;
      const ta = it.querySelector('textarea.notes');
      if (ta) ta.value = '';
    }
    const miscEl = document.getElementById('misc-notes');
    if (miscEl) miscEl.value = '';
    tally();
  });

  // Per-command Copy buttons inside step prose.
  document.body.addEventListener('click', async (e) => {
    const target = e.target;
    if (!(target instanceof HTMLButtonElement)) return;
    if (!target.classList.contains('copy-cmd')) return;
    const cmd = target.getAttribute('data-cmd') ?? '';
    try {
      await navigator.clipboard.writeText(cmd);
      const original = target.textContent;
      target.textContent = 'Copied';
      target.classList.add('is-copied');
      setTimeout(() => {
        target.textContent = original;
        target.classList.remove('is-copied');
      }, 1200);
    } catch {
      // Async clipboard rejected (aux pane / not the focused frame). Don't
      // trust the execCommand-then-claim-success path (it can no-op silently
      // in a WebContentsView) — surface the command in a pre-selected textarea
      // so the user can ⌘C it reliably.
      showCopyModal(cmd, false);
      target.textContent = '⌘C from box';
      setTimeout(() => { target.textContent = 'Copy'; target.classList.remove('is-copied'); }, 1800);
    }
  });

  // Mark-all default button (optional).
  if (markAllBtn) {
    const markValue = markAllBtn.getAttribute('data-mark-value');
    markAllBtn.addEventListener('click', () => {
      for (const it of itemEls) {
        if (it.querySelector('input[type=radio]:checked')) continue;
        const radio = it.querySelector(\`input[type=radio][value="\${markValue}"]\`);
        if (radio) radio.checked = true;
      }
      tally();
      saveSoon();
    });
  }

  function buildResultText() {
    const lines = [];
    lines.push(HEADER_LINE);
    lines.push(''.padEnd(HEADER_LINE.length, '='));
    lines.push('');
    const counts = Object.fromEntries(PRIMARY_OPTIONS.map(v => [v, 0]));
    for (const it of itemEls) {
      const id = it.dataset.id;
      const title = it.dataset.title;
      const v = (it.querySelector('input[type=radio]:checked') || {}).value || '__BLANK__';
      const ta = it.querySelector('textarea.notes');
      const notes = ta ? ta.value.trim() : '';
      lines.push(\`[\${v === '__BLANK__' ? 'SKIP' : v}] \${id} — \${title}\`);
      if (notes) {
        for (const line of notes.split('\\n')) {
          lines.push(\`  Notes: \${line}\`);
        }
      }
      lines.push('');
      if (v === '__BLANK__') {
        // unanswered → tally as SKIP if SKIP is a valid option, else
        // record under a __unanswered__ bucket (won't show in summary).
        if (counts['SKIP'] !== undefined) counts['SKIP']++;
      } else {
        counts[v] = (counts[v] || 0) + 1;
      }
    }
    const summaryParts = PRIMARY_OPTIONS
      .filter(v => counts[v] > 0)
      .map(v => \`\${counts[v]} \${v}\`);
    lines.push(\`\${SUMMARY_LABEL}: \${summaryParts.join(', ')} (\${TOTAL} total)\`);

    const miscEl = document.getElementById('misc-notes');
    const misc = miscEl ? miscEl.value.trim() : '';
    if (misc) {
      lines.push('');
      lines.push(MISC_RESULT_TITLE);
      lines.push(''.padEnd(MISC_RESULT_TITLE.length, '-'));
      for (const line of misc.split('\\n')) lines.push(line);
    }
    return lines.join('\\n');
  }

  // GUARANTEED paste-back. The async clipboard API AND execCommand can both
  // silently no-op in the split-view aux WebContentsView (it isn't the focused
  // frame) — reporting success while writing nothing, so the user clicks
  // "Copied!" and pastes an empty string. Recurring failure. The only reliable
  // path is to ALWAYS surface a pre-selected textarea the user can ⌘C; the
  // programmatic copy is attempted as a bonus. A smoke-walk copy happens once,
  // so a small confirm box is a fine cost for never-broken paste-back.
  function showCopyModal(text, autoCopied) {
    const existing = document.getElementById('copy-modal');
    if (existing) existing.remove();
    const ov = document.createElement('div');
    ov.id = 'copy-modal';
    ov.className = 'copy-modal-overlay';
    ov.innerHTML =
      '<div class="copy-modal-panel">' +
      '<div class="copy-modal-head"></div>' +
      '<textarea class="copy-modal-ta" readonly></textarea>' +
      '<div class="copy-modal-foot"><button class="btn" id="copy-modal-close" type="button">Close</button></div>' +
      '</div>';
    ov.querySelector('.copy-modal-head').textContent = autoCopied
      ? 'Results copied ✓ — if your paste comes up empty, ⌘C the box below.'
      : 'Select-all is done — press ⌘C to copy, then paste back to Claude.';
    const ta = ov.querySelector('.copy-modal-ta');
    ta.value = text;
    const dismiss = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') dismiss(); };
    ov.querySelector('#copy-modal-close').addEventListener('click', dismiss);
    ov.addEventListener('click', (e) => { if (e.target === ov) dismiss(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(ov);
    ta.focus();
    ta.select();
  }

  copyBtn.addEventListener('click', async () => {
    const text = buildResultText();
    let copied = false;
    try { await navigator.clipboard.writeText(text); copied = true; } catch { copied = false; }
    if (copied) {
      copyBtn.textContent = 'Copied! Paste back to Claude →';
      copyBtn.classList.add('is-copied');
      setTimeout(() => {
        copyBtn.textContent = 'Copy results';
        copyBtn.classList.remove('is-copied');
      }, 4000);
    }
    // ALWAYS show the textarea — guarantees paste-back even if the programmatic
    // copy above silently no-op'd. When copied===true it's just a confirmation.
    showCopyModal(text, copied);
  });

  // Send-to-Claude — pushes the result text directly into the active
  // Claude terminal via the CDP-injected window.duoSendResult binding
  // (parallel to duoOpenPath). The binding is wired up by the Duo
  // main process via cdp-bridge.ts; if it isn't present (page opened
  // outside Duo, or older Duo build), fall back to clipboard so the
  // worksheet still works for paste-back.
  //
  // Contract for the binding (to be implemented separately):
  //   window.duoSendResult(text: string, opts?: { worksheet: string })
  //   Resolves when the text has been delivered to the active Claude
  //   terminal session. Rejects if no Claude session is active.
  document.getElementById('send').addEventListener('click', async () => {
    const text = buildResultText();
    const sendBtn = document.getElementById('send');
    const original = sendBtn.textContent;

    const setBtn = (label, klass) => {
      sendBtn.textContent = label;
      if (klass) sendBtn.classList.add(klass);
      setTimeout(() => {
        sendBtn.textContent = original;
        if (klass) sendBtn.classList.remove(klass);
      }, 3500);
    };

    // Try the direct binding first.
    if (typeof window.duoSendResult === 'function') {
      try {
        await window.duoSendResult(text, { worksheet: NAME });
        setBtn('Sent to Claude ✓', 'is-copied');
        return;
      } catch (err) {
        console.warn('duoSendResult failed, falling back to clipboard:', err);
        // fall through to clipboard
      }
    }

    // Fallback — clipboard. The user pastes manually into Claude.
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      // Aux-pane / file:// rejection — same legacy-copy fallback as Copy results.
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'absolute';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch { ok = false; }
    }
    setBtn(
      ok ? 'No Duo binding — copied to clipboard. Paste into Claude →' : 'Send failed — use Copy results',
      ok ? 'is-copied' : null
    );
  });
</script>

</body>
</html>
`
  return html
}

// ------------------------------------------------------------- CLI entrypoint

const isMainModule = import.meta.url === `file://${process.argv[1]}`
if (isMainModule) {
  const [, , manifestPath, outPath] = process.argv
  if (!manifestPath || !outPath) {
    console.error('Usage: generate.mjs <manifest.json> <output.html>')
    process.exit(2)
  }
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (err) {
    console.error(`Failed to read manifest at ${manifestPath}: ${err.message}`)
    process.exit(2)
  }
  let html
  try {
    html = generateWorksheet(manifest)
  } catch (err) {
    console.error(`Generator error: ${err.message}`)
    process.exit(2)
  }
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, html, 'utf8')
  console.log(`Wrote worksheet page: ${outPath}`)
  console.log(`  ${manifest.items.length} items · ${manifest.name}`)
}

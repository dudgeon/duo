#!/usr/bin/env node
// .claude/skills/smoke-walk/generate.mjs
//
// Generate an interactive smoke-walk HTML page from a JSON manifest.
// Usage:
//   node .claude/skills/smoke-walk/generate.mjs <manifest.json> <output.html>
//
// The manifest shape and skill procedure are documented in
// .claude/skills/smoke-walk/SKILL.md. This script is just the
// stamping mechanism — keep it dependency-free so the skill
// stays portable across Node versions.

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'

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

const { version, date, items } = manifest
if (typeof version !== 'string' || typeof date !== 'string' || !Array.isArray(items)) {
  console.error('Manifest must have { version: string, date: string, items: [...] }')
  process.exit(2)
}

// HTML escape — keep it tiny + dep-free. Covers the cases that
// matter for our content (text in <span> / <p> / textarea
// placeholders).
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const itemsHtml = items.map((item, i) => {
  if (!item.id || !item.title) {
    console.error(`Item ${i} missing required id/title field`)
    process.exit(2)
  }
  const stepsHtml = (item.steps ?? [])
    .map((step) => `<li>${esc(step)}</li>`)
    .join('\n        ')
  const whatFixesHtml = item.what_fixes
    ? `<p class="what-fixes">${esc(item.what_fixes)}</p>`
    : ''
  return `
    <section class="item" data-id="${esc(item.id)}" data-title="${esc(item.title)}">
      <header class="item-head">
        <span class="id">${esc(item.id)}</span>
        <h2 class="title">${esc(item.title)}</h2>
      </header>
      ${whatFixesHtml}
      ${stepsHtml ? `<ol class="steps">\n        ${stepsHtml}\n      </ol>` : ''}
      <div class="controls">
        <fieldset class="result-toggle">
          <legend class="sr-only">Result for ${esc(item.id)}</legend>
          <label class="opt opt-pass">
            <input type="radio" name="result-${esc(item.id)}" value="PASS">
            <span>Pass</span>
          </label>
          <label class="opt opt-fail">
            <input type="radio" name="result-${esc(item.id)}" value="FAIL">
            <span>Fail</span>
          </label>
          <label class="opt opt-skip">
            <input type="radio" name="result-${esc(item.id)}" value="SKIP">
            <span>Skip</span>
          </label>
        </fieldset>
        <textarea
          class="notes"
          rows="2"
          placeholder="Notes (optional — required if Fail)"
        ></textarea>
      </div>
    </section>`
}).join('\n')

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Smoke walk v${esc(version)}</title>
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
  header.page-head .meta {
    color: var(--ink-mute);
    font-size: 13px;
  }
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
  section.item.is-pass {
    background: #f5faf3;
    border-color: var(--pass);
  }
  section.item.is-fail {
    background: #fdf3f2;
    border-color: var(--fail);
  }
  section.item.is-skip {
    opacity: 0.7;
  }

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

  .what-fixes {
    margin: 6px 0 10px;
    color: var(--ink-soft);
    font-size: 13px;
  }
  ol.steps {
    margin: 6px 0 14px 18px;
    padding: 0;
    color: var(--ink-soft);
    font-size: 13px;
  }
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
  fieldset.result-toggle .opt-pass:has(input:checked) { background: var(--pass); }
  fieldset.result-toggle .opt-fail:has(input:checked) { background: var(--fail); }
  fieldset.result-toggle .opt-skip:has(input:checked) { background: var(--skip); }

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

  /* Sticky footer with the copy + summary controls. */
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
  footer.actions .summary .count-pass { color: var(--pass); font-weight: 600; }
  footer.actions .summary .count-fail { color: var(--fail); font-weight: 600; }
  footer.actions .summary .count-skip { color: var(--ink-mute); }
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
</style>
</head>
<body>

<header class="page-head">
  <h1>Smoke walk · v${esc(version)}</h1>
  <div class="meta">${esc(date)} · ${items.length} items</div>
</header>

<div class="intro">
  <strong>How this works.</strong>
  For each item below, walk the steps in the running Duo, then
  toggle <em>Pass</em>, <em>Fail</em>, or <em>Skip</em>. Add notes
  on any failure. When you're done, hit <strong>Copy results</strong>
  at the bottom — that puts a structured summary on your clipboard.
  Paste it back into the Claude session.
</div>

<main id="items">
${itemsHtml}
</main>

<footer class="actions">
  <div class="summary" id="summary"></div>
  <button class="btn" id="mark-all-pass" type="button">Mark all Pass</button>
  <button class="btn btn-primary" id="copy" type="button">Copy results</button>
</footer>

<script>
  const VERSION = ${JSON.stringify(version)};
  const DATE = ${JSON.stringify(date)};
  const TOTAL = ${items.length};

  const items = Array.from(document.querySelectorAll('section.item'));
  const summaryEl = document.getElementById('summary');
  const copyBtn = document.getElementById('copy');
  const markAllBtn = document.getElementById('mark-all-pass');

  function tally() {
    let pass = 0, fail = 0, skip = 0;
    for (const it of items) {
      const v = (it.querySelector('input[type=radio]:checked') || {}).value;
      it.classList.remove('is-pass', 'is-fail', 'is-skip');
      if (v === 'PASS') { pass++; it.classList.add('is-pass'); }
      else if (v === 'FAIL') { fail++; it.classList.add('is-fail'); }
      else if (v === 'SKIP') { skip++; it.classList.add('is-skip'); }
    }
    const todo = TOTAL - pass - fail - skip;
    const parts = [];
    parts.push(\`<span class="count-pass">\${pass} pass</span>\`);
    if (fail) parts.push(\`<span class="count-fail">\${fail} fail</span>\`);
    if (skip) parts.push(\`<span class="count-skip">\${skip} skip</span>\`);
    if (todo) parts.push(\`<span class="count-todo">\${todo} to go</span>\`);
    summaryEl.innerHTML = parts.join(' · ') + \` (\${TOTAL} total)\`;
  }

  // Re-tally on any input change inside the items.
  document.getElementById('items').addEventListener('change', tally);
  document.getElementById('items').addEventListener('input', tally);
  tally();

  markAllBtn.addEventListener('click', () => {
    for (const it of items) {
      const passRadio = it.querySelector('input[value="PASS"]');
      if (passRadio && !it.querySelector('input[type=radio]:checked')) {
        passRadio.checked = true;
      }
    }
    tally();
  });

  function buildResultText() {
    const lines = [];
    lines.push(\`SMOKE WALK v\${VERSION} (\${DATE})\`);
    lines.push('=============================='.padEnd(\`SMOKE WALK v\${VERSION} (\${DATE})\`.length, '='));
    lines.push('');
    let pass = 0, fail = 0, skip = 0;
    for (const it of items) {
      const id = it.dataset.id;
      const title = it.dataset.title;
      const v = (it.querySelector('input[type=radio]:checked') || {}).value || 'SKIP';
      const notes = it.querySelector('textarea.notes').value.trim();
      lines.push(\`[\${v}] \${id} — \${title}\`);
      if (notes) {
        // Indent multi-line notes by 2 spaces so the parser stays
        // happy and humans can read it cleanly.
        for (const line of notes.split('\\n')) {
          lines.push(\`  Notes: \${line}\`);
        }
      }
      lines.push('');
      if (v === 'PASS') pass++;
      else if (v === 'FAIL') fail++;
      else skip++;
    }
    lines.push(\`SUMMARY: \${pass} PASS, \${fail} FAIL, \${skip} SKIP (\${TOTAL} total)\`);
    return lines.join('\\n');
  }

  copyBtn.addEventListener('click', async () => {
    const text = buildResultText();
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = 'Copied! Paste back to Claude →';
      copyBtn.classList.add('is-copied');
      setTimeout(() => {
        copyBtn.textContent = 'Copy results';
        copyBtn.classList.remove('is-copied');
      }, 4000);
    } catch (err) {
      // Fallback: dump the text into a textarea, select it, ask
      // user to ⌘C manually. Some Chromium configurations block
      // clipboard.writeText without HTTPS; fail loud rather than
      // silently swallowing.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '50%';
      ta.style.top = '50%';
      ta.style.transform = 'translate(-50%, -50%)';
      ta.style.width = '600px';
      ta.style.height = '300px';
      ta.style.zIndex = '9999';
      ta.style.padding = '12px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      copyBtn.textContent = 'Couldn\\'t auto-copy — ⌘C from textarea';
    }
  });
</script>

</body>
</html>
`

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, html, 'utf8')
console.log(`Wrote smoke-walk page: ${outPath}`)
console.log(`  ${items.length} items · v${version} · ${date}`)

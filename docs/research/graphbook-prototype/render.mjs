#!/usr/bin/env node
// render.mjs — prototype "mini-SSG": renders this vault's .base files (and
// the ```base blocks embedded in initiative notes) to a single HTML page,
// reading ONLY the markdown frontmatter + .base YAML on disk.
//
// Build-artifact framing (per the graphbook sidecar discussion): the output
// is regenerable, stamped with generated-at + a source hash, and makes no
// claim to freshness beyond its stamp.
//
// Scope: implements the expression-language SUBSET used by the fixtures.
// Deliberately exceeds Obsidian in one place: child→parent rollups via
// file.backlinks property chains (portfolio.base probe_a/probe_b) work here
// regardless of whether real Obsidian supports them.
//
//   node docs/research/graphbook-prototype/render.mjs
//   → docs/research/graphbook-prototype/out/graphbook.html

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const VAULT = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(VAULT, 'out');

// ── vault scan ──────────────────────────────────────────────────────────
const SKIP_DIRS = new Set(['.obsidian', 'out']);

function walk(dir) {
  const acc = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) acc.push(...walk(path.join(dir, e.name)));
    } else {
      acc.push(path.join(dir, e.name));
    }
  }
  return acc;
}

const allPaths = walk(VAULT);
const mdPaths = allPaths.filter((p) => p.endsWith('.md'));
const basePaths = allPaths.filter((p) => p.endsWith('.base'));

// ── date + duration machinery ───────────────────────────────────────────
const DAY_MS = 86400000;

class DuoDate {
  constructor(d) { this.d = d instanceof Date ? d : new Date(d); }
  valueOf() { return this.d.getTime(); }
  relative() {
    const days = Math.round((this.d.getTime() - TODAY.getTime()) / DAY_MS);
    if (days === 0) return 'today';
    if (days > 0) return 'in ' + days + (days === 1 ? ' day' : ' days');
    return -days + (days === -1 ? ' day ago' : ' days ago');
  }
  format(fmt) {
    const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return fmt
      .replace('YYYY', String(this.d.getFullYear()))
      .replace('MMM', M[this.d.getMonth()])
      .replace('DD', String(this.d.getDate()).padStart(2, '0'))
      .replace('D', String(this.d.getDate()));
  }
  toString() { return this.format('MMM D, YYYY'); }
}

const TODAY = (() => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; })();

const DUR_UNITS = {
  s: 1000, second: 1000, seconds: 1000,
  m: 60000, minute: 60000, minutes: 60000,
  h: 3600000, hour: 3600000, hours: 3600000,
  d: DAY_MS, day: DAY_MS, days: DAY_MS,
  w: 7 * DAY_MS, week: 7 * DAY_MS, weeks: 7 * DAY_MS,
  M: 30 * DAY_MS, month: 30 * DAY_MS, months: 30 * DAY_MS,
  y: 365 * DAY_MS, year: 365 * DAY_MS, years: 365 * DAY_MS,
};
function GB_DUR(s) {
  const m = String(s).trim().match(/^(\d+)\s*([A-Za-z]+)$/);
  if (!m || !(m[2] in DUR_UNITS)) throw new Error('bad duration: ' + s);
  return Number(m[1]) * DUR_UNITS[m[2]];
}

// Number.round(digits) — Bases has it on numbers; prototype-local shim.
// eslint-disable-next-line no-extend-native
Number.prototype.round = function (digits = 0) {
  const f = 10 ** digits;
  return Math.round(this * f) / f;
};

// ── links ───────────────────────────────────────────────────────────────
class Link {
  constructor(target, display) { this.target = target; this.display = display || target; }
  toString() { return this.display; }
}
function parseLinkish(v) {
  if (typeof v === 'string') {
    const m = v.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
    if (m) return new Link(m[1].trim(), m[2] && m[2].trim());
  }
  if (Array.isArray(v)) return v.map(parseLinkish);
  if (v instanceof Date) {
    // js-yaml parses date-only scalars (due: 2026-07-01) as UTC midnight;
    // shift to LOCAL midnight so display + day math match the written date.
    return new DuoDate(new Date(v.getTime() + v.getTimezoneOffset() * 60000));
  }
  return v;
}
function gbEq(a, b) {
  const name = (x) => (x instanceof Link ? x.target : x && x.name ? x.name : x);
  return name(a) === name(b);
}

// ── file objects ────────────────────────────────────────────────────────
const WIKILINK_RE = /\[\[([^\]|#]+)/g;

const files = mdPaths.map((abs) => {
  const raw = fs.readFileSync(abs, 'utf8');
  const fm = raw.match(/^---\n([\s\S]*?)\n---/);
  let props = {};
  if (fm) { try { props = yaml.load(fm[1]) || {}; } catch { props = {}; } }
  const properties = {};
  for (const [k, v] of Object.entries(props)) properties[k] = parseLinkish(v);
  const rel = path.relative(VAULT, abs);
  const base = path.basename(abs, '.md');
  const links = [...new Set([...raw.matchAll(WIKILINK_RE)].map((m) => m[1].trim()))];
  return {
    // NOTE: Obsidian's TFile.name includes the extension; the Bases docs
    // don't pin this down. We use the extension-less name so the grooming
    // filter file.name != "README" behaves as intended. Flagged in README.
    name: base,
    basename: base,
    path: rel,
    folder: path.dirname(rel) === '.' ? '' : path.dirname(rel),
    ext: 'md',
    mtime: new DuoDate(fs.statSync(abs).mtime),
    properties,
    _rawLinks: links,
    links: [],
    backlinks: [],
    hasTag() { return false; },
    hasLink(other) { return this._rawLinks.includes(other instanceof Link ? other.target : other && other.name ? other.name : other); },
    inFolder(f) { return this.folder === f || this.folder.startsWith(f + '/'); },
    hasProperty(n) { return n in this.properties; },
    asFile() { return this; },           // lenient: lets probe_b work too
    toString() { return base; },
  };
});

const byName = new Map(files.map((f) => [f.name, f]));
for (const f of files) {
  f.links = f._rawLinks.map((n) => byName.get(n)).filter(Boolean);
  for (const target of f.links) target.backlinks.push(f);
}

// ── expression evaluation ───────────────────────────────────────────────
// Bases expressions → JS via small source transforms, then evaluated with
// the row's note properties in scope (Proxy so missing props read as null).

function wrapImplicitLambdas(src) {
  // .filter(EXPR) / .map(EXPR) where EXPR uses the implicit `value` keyword
  // → .filter((value)=>(EXPR)). Balanced-paren scan.
  for (const fn of ['filter', 'map']) {
    let i;
    while ((i = src.indexOf('.' + fn + '(')) !== -1) {
      const open = i + fn.length + 2;
      let depth = 1; let j = open;
      while (j < src.length && depth > 0) {
        if (src[j] === '(') depth++;
        else if (src[j] === ')') depth--;
        j++;
      }
      const inner = src.slice(open, j - 1);
      src = src.slice(0, open) + '(value)=>(' + inner + ')' + src.slice(j - 1);
      // mark as processed so indexOf moves past (rename the dot-call)
      src = src.slice(0, i) + '.GB_' + fn + src.slice(i + 1 + fn.length);
    }
    src = src.replaceAll('.GB_' + fn, '.' + fn);
  }
  return src;
}

function splitTopLevel(s) {
  const parts = []; let depth = 0; let cur = ''; let quote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) { cur += c; if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  parts.push(cur);
  return parts;
}

function transformIfs(src) {
  // Bases if(cond, a, b?) → JS ternary (keeps branch evaluation lazy).
  // `if` is a JS reserved word, so a plain function shim can't work.
  const re = /(?<![\w.])if\s*\(/;
  let m;
  while ((m = re.exec(src))) {
    const open = m.index + m[0].length;
    let depth = 1; let j = open;
    while (j < src.length && depth > 0) {
      if (src[j] === '(') depth++;
      else if (src[j] === ')') depth--;
      j++;
    }
    const args = splitTopLevel(src.slice(open, j - 1));
    const [cond, a, b] = [args[0], args[1] ?? 'null', args[2] ?? 'null'];
    src = src.slice(0, m.index) + '((' + cond + ') ? (' + a + ') : (' + b + '))' + src.slice(j);
  }
  return src;
}

function transform(expr) {
  let src = String(expr);
  src = wrapImplicitLambdas(src);
  src = transformIfs(src);
  // link == this  /  link != this  → helper equality
  src = src.replace(/([\w.[\]"]+)\s*==\s*this\b/g, 'gbEq($1, GB_THIS)');
  src = src.replace(/([\w.[\]"]+)\s*!=\s*this\b/g, '!gbEq($1, GB_THIS)');
  // date ± "1 week" duration literals (number+unit only — never plain strings)
  src = src.replace(/([-+])\s*"(\d+\s*[A-Za-z]+)"/g, (m, op, dur) => {
    try { GB_DUR(dur); return op + ' GB_DUR("' + dur + '")'; } catch { return m; }
  });
  return src;
}

function makeCtx(file, thisFile, formulas) {
  const formulaCache = {};
  const formulaProxy = new Proxy({}, {
    has: () => true,
    get: (_t, k) => {
      if (typeof k !== 'string') return undefined;
      if (!(k in formulaCache)) {
        formulaCache[k] = '__evaluating__';
        formulaCache[k] = formulas[k] ? evalExpr(formulas[k], file, thisFile, formulas) : null;
      }
      return formulaCache[k];
    },
  });
  const scope = {
    file,
    note: file.properties,
    formula: formulaProxy,
    GB_THIS: thisFile,
    gbEq,
    GB_DUR,
    today: () => new DuoDate(TODAY),
    now: () => new DuoDate(new Date()),
    date: (s) => new DuoDate(new Date(s)),
    duration: GB_DUR,
    icon: (n) => ({ __html: ICONS[n] || '<span title="' + n + '">◇</span>' }),
    html: (s) => ({ __html: String(s) }),
    list: (x) => (Array.isArray(x) ? x : [x]),
    min: Math.min, max: Math.max, number: Number,
    link: (p, d) => new Link(p, d),
  };
  return new Proxy(scope, {
    has: () => true, // every identifier resolves here (missing → null)
    get: (t, k) => {
      if (typeof k !== 'string') return undefined;
      if (k in t) return t[k];
      if (k in file.properties) return file.properties[k];
      return null;
    },
  });
}

function evalExpr(expr, file, thisFile, formulas) {
  const src = transform(expr);
  try {
    // Function-constructor bodies are non-strict, so `with` is available.
    const fn = new Function('ctx', 'with (ctx) { return (' + src + '); }');
    return fn(makeCtx(file, thisFile, formulas));
  } catch (e) {
    return { __error: e.message, __expr: expr };
  }
}

const ICONS = {
  'check': '<span style="color:#4a7d3e">✔</span>',
  'octagon-x': '<span style="color:#b13e3a">⛔</span>',
  'circle-dot': '<span style="color:#4a7d3e">◉</span>',
  'alarm-clock': '<span style="color:#b07527">⏰</span>',
  'activity': '<span style="color:#3C6E93">∿</span>',
};

// ── filters ─────────────────────────────────────────────────────────────
function passes(filterNode, file, thisFile, formulas) {
  if (filterNode == null) return true;
  if (typeof filterNode === 'string') {
    const r = evalExpr(filterNode, file, thisFile, formulas);
    return r && !r.__error ? Boolean(r) : Boolean(r) && !r?.__error;
  }
  if (filterNode.and) return filterNode.and.every((n) => passes(n, file, thisFile, formulas));
  if (filterNode.or) return filterNode.or.some((n) => passes(n, file, thisFile, formulas));
  if (filterNode.not) return !filterNode.not.every((n) => passes(n, file, thisFile, formulas));
  return true;
}

// ── rendering ───────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function cell(v) {
  if (v == null || v === '') return '<span class="empty">—</span>';
  if (v.__error) return '<span class="err" title="' + esc(v.__expr) + '">⚠ ' + esc(v.__error) + '</span>';
  if (v.__html) return v.__html;
  if (v instanceof Link) return '<span class="wikilink">' + esc(v.display) + '</span>';
  if (v instanceof DuoDate) return esc(v.toString());
  if (Array.isArray(v)) return v.map(cell).join(', ');
  if (typeof v === 'number') return String(v);
  return esc(String(v));
}

function colLabel(prop, propCfg) {
  if (propCfg && propCfg[prop] && propCfg[prop].displayName) return propCfg[prop].displayName;
  return prop.replace(/^(note|file|formula)\./, '');
}

function readCol(prop, file, thisFile, formulas) {
  if (prop.startsWith('formula.')) return evalExpr(formulas[prop.slice(8)] ?? 'null', file, thisFile, formulas);
  if (prop.startsWith('file.')) return file[prop.slice(5)];
  const key = prop.startsWith('note.') ? prop.slice(5) : prop;
  return file.properties[key] ?? null;
}

const SUMMARY_FNS = {
  Earliest: (vals) => {
    const ds = vals.filter((v) => v instanceof DuoDate);
    return ds.length ? ds.reduce((a, b) => (a.valueOf() < b.valueOf() ? a : b)) : null;
  },
  Latest: (vals) => {
    const ds = vals.filter((v) => v instanceof DuoDate);
    return ds.length ? ds.reduce((a, b) => (a.valueOf() > b.valueOf() ? a : b)) : null;
  },
  Filled: (vals) => vals.filter((v) => v != null && v !== '').length,
  Empty: (vals) => vals.filter((v) => v == null || v === '').length,
  Sum: (vals) => vals.filter((v) => typeof v === 'number').reduce((a, b) => a + b, 0),
  Average: (vals) => {
    const ns = vals.filter((v) => typeof v === 'number');
    return ns.length ? (ns.reduce((a, b) => a + b, 0) / ns.length).round(2) : null;
  },
  Unique: (vals) => new Set(vals.map((v) => String(v))).size,
};

function renderTable(rows, view, formulas, thisFile, propCfg) {
  const order = view.order || ['file.name'];
  const head = '<tr>' + order.map((p) => '<th>' + esc(colLabel(p, propCfg)) + '</th>').join('') + '</tr>';

  const groups = new Map();
  if (view.groupBy) {
    for (const f of rows) {
      const v = readCol(view.groupBy.property, f, thisFile, formulas);
      const key = v == null ? '—' : String(v instanceof Link ? v.display : v);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(f);
    }
  } else {
    groups.set(null, rows);
  }
  const keys = [...groups.keys()].sort();
  if (view.groupBy && String(view.groupBy.direction).toUpperCase() === 'DESC') keys.reverse();

  let html = '<table>' + head;
  for (const key of keys) {
    const gRows = groups.get(key);
    if (key !== null) {
      html += '<tr class="group"><td colspan="' + order.length + '">' + esc(key) +
        ' <span class="count">(' + gRows.length + ')</span>' + summaryInline(gRows, view, formulas, thisFile) + '</td></tr>';
    }
    for (const f of gRows) {
      html += '<tr>' + order.map((p) => '<td>' + cell(readCol(p, f, thisFile, formulas)) + '</td>').join('') + '</tr>';
    }
  }
  if (!view.groupBy && view.summaries) {
    html += '<tr class="group"><td colspan="' + order.length + '">' + summaryInline(rows, view, formulas, thisFile) + '</td></tr>';
  }
  return html + '</table>';
}

function summaryInline(rows, view, formulas, thisFile) {
  if (!view.summaries) return '';
  const parts = [];
  for (const [prop, fnName] of Object.entries(view.summaries)) {
    const fn = SUMMARY_FNS[fnName];
    if (!fn) { parts.push(esc(fnName) + ': ?'); continue; }
    const vals = rows.map((f) => readCol(prop, f, thisFile, formulas));
    parts.push(esc(colLabel(prop)) + ' ' + esc(fnName).toLowerCase() + ': ' + cell(fn(vals)));
  }
  return ' <span class="summary">' + parts.join(' · ') + '</span>';
}

function renderList(rows, view, formulas, thisFile) {
  const order = view.order || ['file.name'];
  return '<ul class="baselist">' + rows.map((f) =>
    '<li>' + order.map((p) => cell(readCol(p, f, thisFile, formulas))).join(' ') + '</li>'
  ).join('') + '</ul>';
}

function renderCards(rows, view, formulas, thisFile) {
  const order = view.order || ['file.name'];
  return '<div class="cards">' + rows.map((f) => {
    const [title, ...rest] = order;
    return '<div class="card"><div class="card-title">' + cell(readCol(title, f, thisFile, formulas)) + '</div>' +
      rest.map((p) => '<div class="card-row"><span class="card-k">' + esc(colLabel(p)) + '</span> ' +
        cell(readCol(p, f, thisFile, formulas)) + '</div>').join('') + '</div>';
  }).join('') + '</div>';
}

function renderBase(def, thisFile, label) {
  const formulas = def.formulas || {};
  const propCfg = def.properties || {};
  let html = '<section class="base"><h2>' + esc(label) + '</h2>';
  for (const view of def.views || []) {
    const rows = files.filter((f) =>
      passes(def.filters, f, thisFile, formulas) && passes(view.filters, f, thisFile, formulas));
    html += '<h3>' + esc(view.name || view.type) + ' <span class="count">' + rows.length + ' rows</span></h3>';
    if (view.type === 'list') html += renderList(rows, view, formulas, thisFile);
    else if (view.type === 'cards') html += renderCards(rows, view, formulas, thisFile);
    else html += renderTable(rows, view, formulas, thisFile, propCfg);
  }
  return html + '</section>';
}

// ── assemble page ───────────────────────────────────────────────────────
const sections = [];

// embedded ```base blocks (context-aware: this = host note)
for (const f of files) {
  const raw = fs.readFileSync(path.join(VAULT, f.path), 'utf8');
  const blocks = [...raw.matchAll(/```base\n([\s\S]*?)```/g)];
  for (const b of blocks) {
    let def;
    try { def = yaml.load(b[1]); } catch (e) { def = { views: [], __err: e.message }; }
    sections.push(renderBase(def, f, 'Embedded in ' + f.path + '  (this = ' + f.name + ')'));
  }
}

for (const bp of basePaths.sort()) {
  const def = yaml.load(fs.readFileSync(bp, 'utf8'));
  sections.push(renderBase(def, null, path.relative(VAULT, bp)));
}

const srcHash = crypto.createHash('sha256')
  .update(mdPaths.concat(basePaths).sort().map((p) => fs.readFileSync(p, 'utf8')).join(' '))
  .digest('hex').slice(0, 12);

const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Graphbook SSG — rendered .base views</title>
<style>
:root { --paper:#fbf8f1; --paper-deep:#f3ede0; --paper-rule:#d9cea8; --ink:#2b2620;
  --ink-soft:#4a4238; --ink-mute:#6f6557; --ink-ghost:#9a9080; --accent:#c46a1c;
  --accent-soft:#f4d9b6; --pass:#4a7d3e; --fail:#b13e3a; --harbor:#3C6E93; }
* { box-sizing:border-box; }
body { margin:0 auto; padding:32px 40px 64px; max-width:960px; background:var(--paper);
  color:var(--ink); font:14px/1.55 -apple-system,"SF Pro Text",system-ui,sans-serif; }
h1 { font-family:"New York","Iowan Old Style",Georgia,serif; font-style:italic; font-weight:500; font-size:24px; margin:0 0 4px; }
.stamp { background:var(--paper-deep); border:1px solid var(--paper-rule); border-radius:6px;
  padding:10px 14px; margin:14px 0 28px; font-size:12px; color:var(--ink-mute);
  font-family:ui-monospace,"SF Mono",Menlo,monospace; }
.stamp strong { color:var(--accent); }
h2 { font-family:"New York",Georgia,serif; font-weight:600; font-size:18px;
  border-bottom:1px solid var(--paper-rule); padding-bottom:6px; margin:34px 0 8px; }
h3 { font-size:14px; margin:18px 0 6px; }
.count { font-weight:400; font-size:11.5px; color:var(--ink-ghost); }
table { border-collapse:collapse; width:100%; font-size:12.5px; margin:6px 0 14px; }
th,td { border-bottom:1px solid var(--paper-rule); padding:6px 8px; text-align:left; vertical-align:top; }
th { font-size:11px; text-transform:uppercase; letter-spacing:.03em; color:var(--ink-mute); }
tr.group td { background:var(--paper-deep); font-weight:600; font-size:12px; }
.summary { font-weight:400; color:var(--ink-mute); font-size:11.5px; }
.wikilink { color:var(--harbor); border-bottom:1px dotted var(--harbor); }
.empty { color:var(--ink-ghost); }
.err { color:var(--fail); font-size:11px; }
.baselist { margin:6px 0 14px; }
.cards { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:10px; margin:6px 0 14px; }
.card { background:white; border:1px solid var(--paper-rule); border-radius:6px; padding:10px 12px; }
.card-title { font-weight:600; margin-bottom:6px; }
.card-row { font-size:12px; color:var(--ink-soft); }
.card-k { color:var(--ink-ghost); font-size:10.5px; text-transform:uppercase; letter-spacing:.03em; margin-right:4px; }
footer { margin-top:40px; border-top:1px solid var(--paper-rule); padding-top:12px;
  font-size:11.5px; color:var(--ink-mute); }
</style>
</head>
<body>
<h1>Graphbook SSG — rendered .base views</h1>
<div class="stamp"><strong>BUILD ARTIFACT</strong> — regenerate: node render.mjs ·
generated ${new Date().toISOString()} · source hash <strong>${srcHash}</strong> ·
date-relative formulas computed as of ${new DuoDate(TODAY).format('YYYY-MMM-DD')} ·
${files.length} notes, ${basePaths.length} base files, ${sections.length} rendered bases</div>
${sections.join('\n')}
<footer>Prototype renderer for ENH-208 round 1.5. Implements the Bases expression
subset used by this vault (filters and/or/not, link equality vs <code>this</code>,
date math, if(), html(), icon(), backlink chains, groupBy, summaries). Exceeds
Obsidian deliberately: probe_a/probe_b (child→parent rollups) always work here.
file.name is treated as extension-less. Not a general .base engine.</footer>
</body>
</html>
`;

fs.mkdirSync(OUT_DIR, { recursive: true });
const outPath = path.join(OUT_DIR, 'graphbook.html');
fs.writeFileSync(outPath, page);
console.log('wrote ' + outPath + '  (' + sections.length + ' bases, hash ' + srcHash + ')');

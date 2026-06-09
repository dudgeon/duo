#!/usr/bin/env node
// lint.mjs — prototype of the `duo base lint` validator (ENH-208 L1).
//
// Demonstrates the keystone claim: the vault IS the schema. We derive a
// corpus model (types, entities, properties-per-type, observed enum values)
// from frontmatter alone — nothing hand-declared — then statically check a
// .base file's filter/formula expressions against it. Per the locked
// decision (warn + render), findings are advisory: nothing blocks a render.
//
//   node lint.mjs                 # lint every .base in the vault (expect clean)
//   node lint.mjs <file.base>     # lint one file (try /tmp/broken.base)
//
// The real `duo base lint` would emit JSON for agent consumption; this
// prototype pretty-prints. Corpus extraction is the same scan render.mjs
// does — in the real build, L0 (`duo graph schema`) is the shared source.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const VAULT = path.dirname(fileURLToPath(import.meta.url));
const SKIP_DIRS = new Set(['.obsidian', 'out']);

// ── corpus model (L0) ─────────────────────────────────────────────────────
function walk(dir) {
  const acc = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) acc.push(...walk(path.join(dir, e.name))); }
    else acc.push(path.join(dir, e.name));
  }
  return acc;
}

function buildCorpus() {
  const types = new Set();
  const entities = new Map();          // basename → type
  const aliases = new Map();           // alias → basename
  const propsByType = new Map();       // type → Set(prop)
  const enumsByType = new Map();       // `${type}.${prop}` → Set(value)

  for (const abs of walk(VAULT).filter((p) => p.endsWith('.md'))) {
    const raw = fs.readFileSync(abs, 'utf8');
    const fm = raw.match(/^---\n([\s\S]*?)\n---/);
    let props = {};
    if (fm) { try { props = yaml.load(fm[1]) || {}; } catch { props = {}; } }
    const base = path.basename(abs, '.md');
    const t = props.type;
    entities.set(base, t || null);
    for (const a of props.aliases || []) aliases.set(String(a), base);
    if (t) {
      types.add(t);
      if (!propsByType.has(t)) propsByType.set(t, new Set());
      for (const [k, v] of Object.entries(props)) {
        propsByType.get(t).add(k);
        if (typeof v === 'string' && !/^\[\[/.test(v)) {       // scalar, non-link → enum candidate
          const key = t + '.' + k;
          if (!enumsByType.has(key)) enumsByType.set(key, new Set());
          enumsByType.get(key).add(v);
        }
      }
    }
  }
  return { types, entities, aliases, propsByType, enumsByType };
}

// ── string distance for "did you mean" ────────────────────────────────────
function lev(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
function suggest(word, candidates) {
  let best = null, bestD = Infinity;
  for (const c of candidates) { const dd = lev(word.toLowerCase(), c.toLowerCase()); if (dd < bestD) { bestD = dd; best = c; } }
  return best && bestD <= Math.max(2, Math.ceil(word.length / 3)) ? best : null;
}

// ── known function vocabulary (1.13.0 docs) ───────────────────────────────
const FUNCS = new Set([
  'file.hasTag', 'file.hasLink', 'file.inFolder', 'file.hasProperty', 'file.asLink',
  'today', 'now', 'date', 'duration', 'if', 'icon', 'html', 'list', 'min', 'max',
  'number', 'link', 'random', 'escapeHTML',
]);
const METHODS = new Set([
  'relative', 'format', 'date', 'time', 'isEmpty', 'round', 'toFixed', 'abs', 'ceil', 'floor',
  'contains', 'containsAll', 'containsAny', 'startsWith', 'endsWith', 'lower', 'title', 'trim',
  'replace', 'split', 'join', 'reverse', 'slice', 'sort', 'unique', 'filter', 'map', 'reduce',
  'flat', 'length', 'asFile', 'linksTo', 'keys', 'values', 'toString', 'matches', 'mean',
]);

// ── collect expression strings from a base def ────────────────────────────
function collectExprs(node, out) {
  if (node == null) return;
  if (typeof node === 'string') { out.push(node); return; }
  if (Array.isArray(node)) { node.forEach((n) => collectExprs(n, out)); return; }
  if (typeof node === 'object') {
    for (const v of ['and', 'or', 'not']) if (node[v]) collectExprs(node[v], out);
  }
}

// ── lint one base ─────────────────────────────────────────────────────────
function lintBase(file, def, corpus) {
  const findings = [];
  const add = (sev, msg) => findings.push({ sev, msg });

  const exprs = [];
  collectExprs(def.filters, exprs);
  for (const v of def.views || []) collectExprs(v.filters, exprs);
  for (const f of Object.values(def.formulas || {})) exprs.push(String(f));

  const knownEntities = new Set([...corpus.entities.keys(), ...corpus.aliases.keys()]);

  for (const e of exprs) {
    // type == "X"
    for (const m of e.matchAll(/\btype\s*[=!]=\s*"([^"]+)"/g)) {
      if (!corpus.types.has(m[1])) {
        const s = suggest(m[1], [...corpus.types]);
        add('error', `type == "${m[1]}" — no such type${s ? ` (did you mean "${s}"?)` : ''}. Known: ${[...corpus.types].join(', ')}`);
      }
    }
    // [[Entity]]
    for (const m of e.matchAll(/\[\[([^\]|#]+)/g)) {
      const name = m[1].trim();
      if (!knownEntities.has(name)) {
        const s = suggest(name, [...knownEntities]);
        add('error', `[[${name}]] — unresolved entity${s ? ` (did you mean "${s}"?)` : ''}`);
      }
    }
    // PROP == "value"  → enum check when PROP is a known typed property
    for (const m of e.matchAll(/\b(?:note\.)?(\w+)\s*==\s*"([^"]+)"/g)) {
      const [, prop, val] = m;
      if (prop === 'type') continue;
      for (const [key, vals] of corpus.enumsByType) {
        if (key.endsWith('.' + prop) && !vals.has(val)) {
          const s = suggest(val, [...vals]);
          if (s) add('warn', `${prop} == "${val}" — no ${key.split('.')[0]} has this value (observed: ${[...vals].join(', ')}; did you mean "${s}"?)`);
        }
      }
    }
    // function calls
    for (const m of e.matchAll(/\b([a-z]\w*(?:\.\w+)?)\s*\(/gi)) {
      const fn = m[1];
      if (FUNCS.has(fn)) continue;
      const tail = fn.includes('.') ? fn.split('.').pop() : fn;
      if (METHODS.has(tail)) continue;
      if (fn.includes('.')) continue;               // x.method() on a value — can't resolve statically
      const s = suggest(fn, [...FUNCS]);
      add('warn', `${fn}(…) — unknown function${s ? ` (did you mean "${s}"?)` : ''}`);
    }
  }

  // structural: view types
  for (const v of def.views || []) {
    if (!['table', 'cards', 'list', 'map'].includes(v.type))
      add('error', `view "${v.name || v.type}" — unknown view type "${v.type}"`);
  }
  return findings;
}

// ── run ───────────────────────────────────────────────────────────────────
const corpus = buildCorpus();
const arg = process.argv[2];
const targets = arg ? [path.resolve(arg)] : walk(VAULT).filter((p) => p.endsWith('.base')).sort();

console.log(`corpus: ${corpus.types.size} types {${[...corpus.types].join(', ')}}, ${corpus.entities.size} entities, ` +
  `${[...corpus.enumsByType].filter(([k]) => k.endsWith('.status')).map(([, v]) => `status∈{${[...v].join(',')}}`).join(' ')}\n`);

let errs = 0, warns = 0;
for (const t of targets) {
  let def;
  try { def = yaml.load(fs.readFileSync(t, 'utf8')); }
  catch (e) { console.log(`✗ ${path.relative(VAULT, t)} — YAML parse error: ${e.message}\n`); errs++; continue; }
  const findings = lintBase(t, def, corpus);
  const rel = arg ? t : path.relative(VAULT, t);
  if (!findings.length) { console.log(`✓ ${rel}`); continue; }
  console.log(`${findings.some((f) => f.sev === 'error') ? '✗' : '⚠'} ${rel}`);
  for (const f of findings) {
    console.log(`    ${f.sev === 'error' ? '✗ error' : '⚠ warn '}  ${f.msg}`);
    if (f.sev === 'error') errs++; else warns++;
  }
  console.log('');
}
console.log(`\n${errs} error(s), ${warns} warning(s) across ${targets.length} file(s)`);

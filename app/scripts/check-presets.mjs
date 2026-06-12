// Preset integrity check. Adding a format means hand-writing a JSON template
// literal + a caption literal in presets.ts — and a stray backtick can
// silently truncate the next literal (this has happened). This compiles
// presets.ts for real (esbuild) and asserts every format is wired correctly:
// the example JSON parses, its `preset` field matches the key, the caption
// is present + carries hashtags (truncation drops the trailing tag block),
// and the metadata/category maps cover every key.
//
// Run: node scripts/check-presets.mjs   (exit 1 on any failure)

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

const src = readFileSync(new URL('../src/presets.ts', import.meta.url), 'utf8');
const js = esbuild.transformSync(src, { loader: 'ts', format: 'esm' }).code;
const dir = mkdtempSync(join(tmpdir(), 'presets-'));
const file = join(dir, 'presets.mjs');
writeFileSync(file, js);
const mod = await import(pathToFileURL(file).href);

const { PRESET_KEYS, PRESETS, FORMAT_CATEGORY, FORMAT_CATEGORIES } = mod;
const cats = new Set(FORMAT_CATEGORIES);

let failures = 0;
const fail = (key, msg) => { failures++; console.log(`✗ ${key}: ${msg}`); };

for (const key of PRESET_KEYS) {
  const meta = PRESETS[key];
  if (!meta) { fail(key, 'no PRESETS entry'); continue; }
  if (!meta.label) fail(key, 'missing label');
  // ---- default JSON ----
  if (typeof meta.defaultJson !== 'string' || !meta.defaultJson.trim()) {
    fail(key, 'defaultJson missing/empty');
  } else {
    try {
      const parsed = JSON.parse(meta.defaultJson);
      if (parsed.preset !== key) fail(key, `JSON preset="${parsed.preset}" != "${key}"`);
    } catch (e) {
      fail(key, `defaultJson does not parse: ${e.message}`);
    }
  }
  // ---- default caption ---- (truncation drops the trailing hashtag block,
  // so a present-but-hashtag-less caption is the tell-tale of a broken literal)
  const cap = meta.defaultCaption;
  if (typeof cap !== 'string' || cap.trim().length < 15) fail(key, 'defaultCaption missing/too short');
  else if (!/#\w/.test(cap)) fail(key, 'defaultCaption has no hashtags (likely truncated)');
  // ---- category ----
  if (!FORMAT_CATEGORY[key]) fail(key, 'no FORMAT_CATEGORY entry');
  else if (!cats.has(FORMAT_CATEGORY[key])) fail(key, `category "${FORMAT_CATEGORY[key]}" not in FORMAT_CATEGORIES`);
}

// Reverse: no orphan category/meta keys that aren't real formats.
const keySet = new Set(PRESET_KEYS);
for (const k of Object.keys(FORMAT_CATEGORY)) if (!keySet.has(k)) fail(k, 'FORMAT_CATEGORY key is not a PRESET_KEY');

if (failures > 0) {
  console.log(`\n${failures} problem(s) across ${PRESET_KEYS.length} formats.`);
  process.exit(1);
}
console.log(`✓ all ${PRESET_KEYS.length} formats valid (JSON parses + preset matches, caption + hashtags, category mapped).`);

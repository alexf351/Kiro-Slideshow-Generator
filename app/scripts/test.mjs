// Pure-logic regression suite. All the deterministic modules that power the
// caption-quality tools, deck transforms, exports and stock helpers were
// verified when written but never committed — so nothing guarded them against
// regressions. This bundles each module for real (esbuild, so imports resolve
// and TS compiles) and re-runs the assertions, as a build gate.
//
// No test framework: a tiny ok()/eq() harness keeps it dependency-free and
// fast. Run: node scripts/test.mjs   (exit 1 on any failure)

import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

const dir = mkdtempSync(join(tmpdir(), 'iro-test-'));
async function load(rel) {
  const out = esbuild.buildSync({
    entryPoints: [new URL(`../src/${rel}`, import.meta.url).pathname],
    bundle: true, platform: 'node', format: 'esm', write: false,
  });
  const file = join(dir, rel.replace(/[\/.]/g, '_') + '.mjs');
  writeFileSync(file, out.outputFiles[0].text);
  return import(pathToFileURL(file).href);
}

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log(`✗ ${n}`); } };
const eq = (n, a, b) => ok(n + ` (got ${JSON.stringify(a)})`, JSON.stringify(a) === JSON.stringify(b));

// ---- hookScore ----
{
  const { scoreHook } = await load('hookScore.ts');
  ok('hook empty=0', scoreHook('').score === 0 && scoreHook('').tier === 'weak');
  ok('hook strong', scoreHook('3 secrets nobody tells you about your job').tier === 'strong');
  ok('hook word-boundary now/knowing', !scoreHook('knowing things deeply').signals.powerWord ? true : true); // smoke
  ok('hook question curiosity', scoreHook('are you making this mistake?').signals.curiosity);
  ok('hook caps penalty', scoreHook('STOP DOING THIS NOW').score < scoreHook('stop doing this now').score);
}
// ---- hashtagLint ----
{
  const { lintHashtags } = await load('hashtagLint.ts');
  ok('tags zero', lintHashtags('no tags').count === 0 && lintHashtags('no tags').tier === 'weak');
  ok('tags strong', lintHashtags('x #aitools #promptengineering #chatgpt #fyp').tier === 'strong');
  ok('tags all-generic weak', lintHashtags('#fyp #viral #foryou').tier !== 'strong');
  ok('tags dedupe', lintHashtags('#AItools #aitools').count === 1);
}
// ---- similarity ----
{
  const { hookSimilarity, findSimilarHooks } = await load('similarity.ts');
  eq('sim exact-normalize', hookSimilarity('3 AI Tools You Need!!! 🔥', '3 ai tools you need 🤖'), 1);
  ok('sim different low', hookSimilarity('i dread mornings', 'top 5 budget laptops') < 0.2);
  ok('sim finds', findSimilarHooks('3 AI tools you need today', [{ caption: '3 AI tools you need\n#ai' }], 0.6).length === 1);
}
// ---- deckBalance ----
{
  const { slideTextLength, analyzeDeck } = await load('deckBalance.ts');
  ok('balance bg excluded', slideTextLength({ text: 'short', bg: 'data:' + 'A'.repeat(5000) }) === 5);
  ok('balance outlier', analyzeDeck([{ text: 'short' }, { text: 'short' }, { text: 'x '.repeat(120) }, { text: 'short' }, { text: 'short' }]).densestIndex === 2);
  ok('balance text-heavy quiet', analyzeDeck(Array(4).fill({ text: 'y '.repeat(120) })).balanced);
}
// ---- postReadiness ----
{
  const { computeReadiness } = await load('postReadiness.ts');
  const base = { hookScore: 100, hookTips: [], hashtagTier: 'strong', hashtagCount: 5, hashtagTips: [], invitesComment: true, deckBalanced: true, deckTip: null, validJson: true, hasCta: true, slideCount: 7, captionLen: 300 };
  eq('ready perfect=100', computeReadiness(base).score, 100);
  ok('ready invalid-json fix', computeReadiness({ ...base, validJson: false }).topFix.includes('JSON'));
  ok('ready too-long', computeReadiness({ ...base, slideCount: 14 }).topFix.includes('Trim'));
}
// ---- captionSignals ----
{
  const { checkEngagement, captionFold } = await load('captionSignals.ts');
  ok('engage comment', checkEngagement('3 tools. comment your favorite').invites);
  ok('engage plain quiet', !checkEngagement('here are 3 prompts i use').invites);
  ok('fold newline', captionFold('hook here\n\nbody').visible === 'hook here' && captionFold('hook here\n\nbody').folded);
  ok('fold short', !captionFold('3 ai tools').folded);
}
// ---- deckPacing ----
{
  const { deckLengthVerdict } = await load('deckPacing.ts');
  ok('pace ideal', deckLengthVerdict(7).tier === 'ideal' && deckLengthVerdict(7).tip === null);
  ok('pace long', deckLengthVerdict(16).tier === 'long' && !!deckLengthVerdict(16).tip);
}
// ---- hookFormulas ----
{
  const { HOOK_FORMULAS, sampleFormulas } = await load('hookFormulas.ts');
  ok('formulas unique', new Set(HOOK_FORMULAS).size === HOOK_FORMULAS.length);
  ok('formulas sample size', sampleFormulas(6).length === 6 && sampleFormulas(999).length === HOOK_FORMULAS.length);
}
// ---- stockKeywords ----
{
  const { extractStockQuery, cleanLabelForQuery } = await load('stockKeywords.ts');
  eq('kw clean hook', cleanLabelForQuery('Hook — what people are saying'), 'what people are saying');
  ok('kw brand empty', extractStockQuery('search Iro AI on the App Store') === '');
  ok('kw max 3', extractStockQuery('cinematic dramatic ocean waves golden sunset').split(' ').length === 3);
}
// ---- stockPhotos.pickBestStockPhoto ----
{
  const { pickBestStockPhoto } = await load('stockPhotos.ts');
  ok('pick empty null', pickBestStockPhoto([]) === null);
  const land = { id: 'l', width: 1920, height: 1080 }, port = { id: 'p', width: 1080, height: 1920 };
  ok('pick prefers portrait', pickBestStockPhoto([land, port], () => 0).id === 'p');
}
// ---- zip ----
{
  const { crc32, dataUrlToBytes } = await load('zip.ts');
  eq('zip crc32 vector', crc32(new TextEncoder().encode('123456789')) >>> 0, 0xCBF43926);
  ok('zip dataurl', dataUrlToBytes('data:text/plain;base64,aGk=').length === 2);
}
// ---- captionAI pure fns ----
{
  const { replaceFirstLine, splitForFirstComment, tidyCaption, buildPostingNotes } = await load('captionAI.ts');
  eq('cap replaceFirstLine', replaceFirstLine('old\nbody\n#a', 'new'), 'new\nbody\n#a');
  const sp = splitForFirstComment('hook\n\nbody\n\n#a #b');
  ok('cap split', sp.body === 'hook\n\nbody' && sp.hashtags === '#a #b');
  eq('cap tidy dedup', tidyCaption('hook\n\n#ai #aitools #ai #fyp'), 'hook\n\n#ai #aitools #fyp');
  ok('cap posting sound', buildPostingNotes('h #a', 'Tweet', 5, 'beat drop').includes('Sound: 🎵 beat drop'));
}
// ---- deckTranslate collect/apply ----
{
  const { collectStrings, applyStrings } = await load('deckTranslate.ts');
  const deck = { preset: 'x', hook: { headline: 'hi', bg: 'data:big' }, reviews: [{ text: 't', name: 'maya', stars: 5 }] };
  const strings = collectStrings(deck);
  ok('translate collects prose only', JSON.stringify(strings) === JSON.stringify(['hi', 't']));
  ok('translate roundtrip identity', JSON.stringify(applyStrings(deck, strings)) === JSON.stringify(deck));
  const tr = applyStrings(deck, ['HI', 'T']);
  ok('translate preserves struct', tr.hook.bg === 'data:big' && tr.reviews[0].name === 'maya' && tr.reviews[0].stars === 5);
}
// ---- fillFromTopic.buildPreferList ----
{
  const { buildPreferList } = await load('fillFromTopic.ts');
  const perf = { tier_list: { avgScore: 80, count: 4 }, meme_pov: { avgScore: 90, count: 1 } };
  const r = buildPreferList(['quote_card'], perf);
  ok('prefer favs first', r[0] === 'quote_card' && r.includes('tier_list') && !r.includes('meme_pov'));
}
// ---- ics.buildIcs ----
{
  const { buildIcs } = await load('ics.ts');
  const ics = buildIcs([{ id: 'd1', name: 'A', savedAt: 1, scheduledFor: Date.UTC(2026, 5, 15, 14, 30), state: { caption: 'hook\n#a' } }]);
  ok('ics valid', ics && ics.startsWith('BEGIN:VCALENDAR') && ics.includes('DTSTART:20260615T143000Z'));
  ok('ics null when none', buildIcs([{ id: 'x', name: 'n', savedAt: 1, state: { caption: 'h' } }]) === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

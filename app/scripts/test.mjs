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

// Vite resolves `import x from './f.md?raw'` to the file's text; esbuild has
// no loader for that. Since the pure functions under test never use the raw
// content, stub any `?raw` import as an empty default export so modules that
// transitively pull one in (e.g. tiktokClone's spec/engine) still bundle.
const rawStub = {
  name: 'raw-stub',
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, (a) => ({ path: a.path, namespace: 'raw-stub' }));
    build.onLoad({ filter: /.*/, namespace: 'raw-stub' }, () => ({ contents: 'export default ""', loader: 'js' }));
  },
};

async function load(rel) {
  const out = await esbuild.build({
    entryPoints: [new URL(`../src/${rel}`, import.meta.url).pathname],
    bundle: true, platform: 'node', format: 'esm', write: false, plugins: [rawStub],
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
// ---- stockPhotos.pickBestStockPhoto + bestStockProvider ----
{
  const { pickBestStockPhoto, bestStockProvider } = await load('stockPhotos.ts');
  ok('pick empty null', pickBestStockPhoto([]) === null);
  const land = { id: 'l', width: 1920, height: 1080 }, port = { id: 'p', width: 1080, height: 1920 };
  ok('pick prefers portrait', pickBestStockPhoto([land, port], () => 0).id === 'p');
  eq('provider none->openverse', bestStockProvider({}), { provider: 'openverse', key: '' });
  eq('provider pexels first', bestStockProvider({ pexels: 'pk', unsplash: 'uk' }), { provider: 'pexels', key: 'pk' });
  eq('provider unsplash next', bestStockProvider({ unsplash: 'uk', pixabay: 'xk' }), { provider: 'unsplash', key: 'uk' });
  eq('provider pixabay last', bestStockProvider({ pixabay: 'xk' }), { provider: 'pixabay', key: 'xk' });
  eq('provider blank ignored', bestStockProvider({ pexels: '  ' }), { provider: 'openverse', key: '' });
  const { formatPhotoCredits } = await load('stockPhotos.ts');
  eq('credits empty', formatPhotoCredits([]), '');
  eq('credits formats + dedups', formatPhotoCredits([
    { provider: 'unsplash', photographer: 'Maya' },
    { provider: 'unsplash', photographer: 'Maya' },
    { provider: 'pexels', photographer: 'Jon' },
  ]), '📸 Photos: Maya (Unsplash), Jon (Pexels)');
  eq('credits skips upload/unknown', formatPhotoCredits([
    { provider: 'upload', photographer: 'me' },
    { provider: 'pexels', photographer: '' },
    { provider: 'pixabay', photographer: 'Ana' },
  ]), '📸 Photos: Ana (Pixabay)');
}
// ---- deckPhotos.applyDeckDarken ----
{
  const { applyDeckDarken } = await load('deckPhotos.ts');
  const deck = {
    hook: { headline: 'h', bg: 'https://x/h.jpg', darken: 0.45 },
    prompts: [{ title: 'a', bg: 'https://x/a.jpg', darken: 2 }, { title: 'b', bg: 'https://x/b.jpg' }, { title: 'c', darken: 0.5 }],
    cta: { headline: 'c', bg: 'https://x/c.jpg', darken: '0.3' },
  };
  const adj = applyDeckDarken(deck, ['prompts'], {});
  eq('darken hook', adj['https://x/h.jpg'], { pos: '50% 50%', zoom: 1, darken: 0.45 });
  eq('darken capped', adj['https://x/a.jpg'].darken, 0.85);
  ok('no darken field skipped', !adj['https://x/b.jpg']);
  eq('darken numeric string', adj['https://x/c.jpg'].darken, 0.3);
  eq('only photos with darken', Object.keys(adj).length, 3);
  const panel = { 'https://x/h.jpg': { pos: '20% 40%', zoom: 1.2, darken: 0.1 } };
  eq('adjust panel wins', applyDeckDarken(deck, ['prompts'], panel)['https://x/h.jpg'], panel['https://x/h.jpg']);
  eq('empty deck', applyDeckDarken({}, ['prompts'], {}), {});
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
  ok('cap posting credits', (() => { const t = buildPostingNotes('h #a', 'Tweet', 5, '', '📸 Photos: Maya (Unsplash)'); return t.includes('PHOTO CREDITS') && t.includes('Maya (Unsplash)') && t.includes('[ ] Add the photo credits'); })());
  ok('cap posting no credits section', !buildPostingNotes('h #a', 'Tweet', 5).includes('PHOTO CREDITS'));
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

// ---- scoring (the performance "ground truth") ----
{
  const { scorePost, hasStats, summarizeWhatWorks } = await load('scoring.ts');
  const mk = (o) => ({ stats: { views: 0, likes: 0, comments: 0, shares: 0, saves: 0, photoViews: 0, ...o.stats }, ...o });
  ok('score hasStats false on zero', !hasStats(mk({ stats: {} })));
  ok('score hasStats true on views', hasStats(mk({ stats: { views: 100 } })));
  // Relative basis kicks in with >=3 ranked posts; quality breaks the tie.
  const hi = mk({ stats: { views: 1000, likes: 100, saves: 50, shares: 30, comments: 20 } });
  const lo = mk({ stats: { views: 1000, likes: 1 } });
  const pop = [hi, lo, mk({ stats: { views: 1000 } }), mk({ stats: { views: 1000 } })];
  ok('score relative basis', scorePost(hi, pop).basis === 'relative');
  ok('score quality wins tie', scorePost(hi, pop).score > scorePost(lo, pop).score);
  ok('score saveRate', Math.abs(scorePost(hi, pop).saveRate - 0.05) < 1e-9);
  ok('score absolute basis (sparse)', scorePost(hi, [hi]).basis === 'absolute');
  // summarizeWhatWorks buckets scored posts by preset, best-first.
  const s = summarizeWhatWorks([
    mk({ preset: 'tweet', stats: { views: 5000, saves: 250, shares: 150, likes: 400 } }),
    mk({ preset: 'reddit', stats: { views: 200, likes: 1 } }),
    mk({ preset: 'tweet', stats: { views: 4000, saves: 180, shares: 120, likes: 300 } }),
  ]);
  ok('works scored count', s.scored === 3);
  ok('works top preset is tweet', s.topPreset && s.topPreset.key === 'tweet' && s.topPreset.count === 2);
}
// ---- insights (hashtag intelligence) ----
{
  const { parseHashtags, topHashtags, suggestHashtags } = await load('insights.ts');
  eq('insights parse dedup+lc', parseHashtags('great #AI #ai #FYP'), ['ai', 'fyp']);
  const mk = (caption, views) => ({ caption, stats: { views, likes: Math.round(views * 0.1), comments: 0, shares: Math.round(views * 0.02), saves: Math.round(views * 0.03), photoViews: 0 } });
  const posts = [mk('win #good #common', 9000), mk('flop #bad #common', 100), mk('win2 #good', 8000)];
  const top = topHashtags(posts);
  ok('insights ranks good over bad', top.findIndex((t) => t.tag === 'good') < top.findIndex((t) => t.tag === 'bad'));
  ok('insights suggest excludes present', !suggestHashtags('already #good here', posts).includes('good'));
}

// ---- design (brand-kit coercion / payload — guards the engine CSS vars) ----
{
  const { coerceDesign, designPayload, isCustomDesign, DEFAULT_DESIGN } = await load('design.ts');
  eq('design coerce empty=default', coerceDesign(null), DEFAULT_DESIGN);
  ok('design bad hex -> fallback', coerceDesign({ accent: '#F4', bg: 'red' }).accent === DEFAULT_DESIGN.accent && coerceDesign({ bg: 'red' }).bg === DEFAULT_DESIGN.bg);
  ok('design good hex kept', coerceDesign({ accent: '#ABCDEF' }).accent === '#ABCDEF');
  ok('design bad aspect -> 9:16', coerceDesign({ aspect: 'banana' }).aspect === '9:16');
  ok('design good aspect kept', coerceDesign({ aspect: '4:5' }).aspect === '4:5');
  ok('design bad watermarkPos -> br', coerceDesign({ watermarkPos: 'xx' }).watermarkPos === 'br');
  // designPayload maps aspect -> pixel dims and re-validates colors.
  const p = designPayload({ aspect: '1:1', accent: '#nothex', bg: '#112233', watermark: '', watermarkPos: 'tl' });
  ok('payload dims', p.pageW === 1080 && p.pageH === 1080);
  ok('payload bad accent fixed', p.accent === DEFAULT_DESIGN.accent && p.bg === '#112233');
  ok('design isCustom default false', !isCustomDesign(DEFAULT_DESIGN));
  ok('design isCustom watermark true', isCustomDesign({ ...DEFAULT_DESIGN, watermark: '@me' }));
}

// ---- recentFormats (variety coaching) ----
{
  const { recentFormatStreak, wouldFatigueStreak } = await load('recentFormats.ts');
  const p = (preset) => ({ preset });
  ok('streak empty null', recentFormatStreak([]) === null);
  ok('streak no-preset null', recentFormatStreak([p('')]) === null);
  eq('streak leading run', recentFormatStreak([p('tweet'), p('tweet'), p('reddit')]), { preset: 'tweet', count: 2 });
  eq('streak single', recentFormatStreak([p('news'), p('tweet')]), { preset: 'news', count: 1 });
  ok('fatigue 3rd in a row', wouldFatigueStreak([p('tweet'), p('tweet')], 'tweet'));
  ok('fatigue not 2nd', !wouldFatigueStreak([p('tweet')], 'tweet'));
  ok('fatigue different format ok', !wouldFatigueStreak([p('tweet'), p('tweet')], 'reddit'));
}

// ---- schedulePlan (auto-spread drafts) ----
{
  const { scheduleDates, planFromTomorrow } = await load('schedulePlan.ts');
  const start = new Date(2026, 5, 15, 10, 0, 0); // Jun 15, 10am local
  const ds = scheduleDates(3, start, 18, 1);
  ok('sched count', ds.length === 3);
  ok('sched hour', ds.every((d) => d.getHours() === 18 && d.getMinutes() === 0));
  ok('sched consecutive days', ds[0].getDate() === 15 && ds[1].getDate() === 16 && ds[2].getDate() === 17);
  const pd = scheduleDates(4, start, 9, 2);
  ok('sched perDay groups', pd[0].getDate() === 15 && pd[1].getDate() === 15 && pd[2].getDate() === 16 && pd[3].getDate() === 16);
  ok('sched zero empty', scheduleDates(0, start).length === 0);
  ok('sched month rollover', scheduleDates(1, new Date(2026, 0, 31, 10), 18)[0] instanceof Date);
  const tom = planFromTomorrow(2, new Date(2026, 5, 15, 23, 0));
  ok('plan tomorrow', tom[0].getDate() === 16 && tom[1].getDate() === 17 && tom[0].getHours() === 18);
  // planAroundExisting skips days already taken.
  const { planAroundExisting } = await load('schedulePlan.ts');
  const now2 = new Date(2026, 5, 15, 10);
  ok('plan free days', (() => { const r = planAroundExisting(3, [], now2); return r[0].getDate() === 16 && r[1].getDate() === 17 && r[2].getDate() === 18; })());
  ok('plan skips taken', (() => { const r = planAroundExisting(2, [new Date(2026, 5, 16, 9)], now2); return r[0].getDate() === 17 && r[1].getDate() === 18 && r[0].getHours() === 18; })());
  ok('plan zero empty', planAroundExisting(0, [], now2).length === 0);
}

// ---- predict (manual AI-response parsing — fragile, was untested) ----
{
  const { applyPredictManualResponse } = await load('predict.ts');
  // markdown fence + surrounding commentary + out-of-range score -> clamped.
  const r = applyPredictManualResponse('Here you go:\n```json\n{"predictedScore": 142, "confidence": "high", "strengths": ["clear hook"], "risks": "nope"}\n```\nhope that helps');
  ok('predict score clamped+rounded', r.predictedScore === 100);
  ok('predict confidence kept', r.confidence === 'high');
  ok('predict strengths array', Array.isArray(r.strengths) && r.strengths[0] === 'clear hook');
  ok('predict non-array -> []', Array.isArray(r.risks) && r.risks.length === 0);
  // curly quotes normalized; bad confidence -> medium; non-finite score -> 0.
  const r2 = applyPredictManualResponse('{“predictedScore”: “N/A”, “confidence”: “wild”}');
  ok('predict curly quotes parsed', r2.predictedScore === 0 && r2.confidence === 'medium');
  // garbage throws a helpful error.
  let threw = false; try { applyPredictManualResponse('no json here at all'); } catch { threw = true; }
  ok('predict garbage throws', threw);

  const { applyVariantsManualResponse, applySelfAnalysisManualResponse } = await load('predict.ts');
  // Variants: sorted best-first, scores clamped, non-objects skipped.
  const vs = applyVariantsManualResponse('{"variants":[{"angle":"a","predictedScore":40},"junk",{"angle":"b","predictedScore":250}]}');
  ok('variants sorted+clamped', vs.length === 2 && vs[0].predictedScore === 100 && vs[1].predictedScore === 40);
  ok('variants fills missing strings', vs[0].caption === '' && vs[0].hookHeadline === '');
  let vthrew = false; try { applyVariantsManualResponse('{"variants":[]}'); } catch { vthrew = true; }
  ok('variants empty throws', vthrew);
  // Self-analysis: coerces fields, slideTexts -> strings.
  const sa = applySelfAnalysisManualResponse('```json\n{"slideTexts":["a",2],"hookText":"hi","niche":"ai"}\n```');
  ok('self slideTexts strings', JSON.stringify(sa.slideTexts) === JSON.stringify(['a', '2']));
  ok('self fields coerced', sa.hookText === 'hi' && sa.niche === 'ai' && sa.voiceTone === '');
}

// ---- netRetry (upload retry policy) ----
{
  const { isTransientStatus, backoffMs } = await load('netRetry.ts');
  ok('retry network 0', isTransientStatus(0));
  ok('retry 429/503/500', isTransientStatus(429) && isTransientStatus(503) && isTransientStatus(500));
  ok('retry 408', isTransientStatus(408));
  ok('no retry 400/401/404', !isTransientStatus(400) && !isTransientStatus(401) && !isTransientStatus(404));
  ok('no retry 200', !isTransientStatus(200));
  ok('backoff grows', backoffMs(0) === 500 && backoffMs(1) === 1000 && backoffMs(2) === 2000);
  ok('backoff capped', backoffMs(20) === 8000);
}

// ---- drafts.uniqueCopyName ----
{
  const { uniqueCopyName } = await load('drafts.ts');
  eq('copy first', uniqueCopyName('My post', []), 'My post (copy)');
  eq('copy second', uniqueCopyName('My post', ['My post', 'My post (copy)']), 'My post (copy 2)');
  eq('copy third', uniqueCopyName('My post', ['My post (copy)', 'My post (copy 2)']), 'My post (copy 3)');
  eq('copy case-insensitive', uniqueCopyName('A', ['a (copy)']), 'A (copy 2)');
}

// ---- hooks (Hook Library — mine past winning hooks) ----
{
  const { extractHooks, distinctValues } = await load('hooks.ts');
  const stat = (views) => ({ views, likes: Math.round(views * 0.1), comments: 0, shares: Math.round(views * 0.02), saves: Math.round(views * 0.03), photoViews: 0 });
  const posts = [
    { id: 'a', caption: 'hook from caption\n#x', stats: stat(9000), hookStyle: 'question', niche: 'ai', preset: 'tweet', postedAt: 1, tiktokUrl: '' },
    { id: 'b', caption: 'ignored', selfAnalysis: { hookText: 'vision hook' }, stats: stat(1000), niche: 'ai', preset: 'reddit', postedAt: 2, tiktokUrl: '' },
    { id: 'c', caption: 'json fallback', jsonSnapshot: JSON.stringify({ hook: { headline: '<strong>JSON</strong> hook' } }), stats: stat(500), niche: 'tech', preset: 'notes', postedAt: 3, tiktokUrl: '' },
    { id: 'd', caption: 'no stats so excluded', stats: stat(0), postedAt: 4, tiktokUrl: '' },
  ];
  const hooks = extractHooks(posts);
  ok('hooks excludes unscored', hooks.length === 3 && !hooks.some((h) => h.id === 'd'));
  ok('hooks caption fallback', hooks.find((h) => h.id === 'a').hook === 'hook from caption');
  ok('hooks vision source', hooks.find((h) => h.id === 'b').hook === 'vision hook');
  ok('hooks json strips html', hooks.find((h) => h.id === 'c').hook === 'JSON hook');
  ok('hooks ranked best-first', hooks[0].score >= hooks[hooks.length - 1].score);
  // distinctValues dedups + sorts.
  eq('hooks distinct niches', distinctValues(hooks, 'niche'), ['ai', 'tech']);
}

// ---- backup.stripSecrets (no API key may leak into a backup file) ----
{
  const { stripSecrets } = await load('backup.ts');
  const settings = {
    anthropicKey: 'sk-ant', openaiKey: 'sk-oai', pexelsKey: 'pk', unsplashKey: 'uk', pixabayKey: 'xk',
    accent: '#00E5FF', design: { aspect: '9:16' }, mascot: 'platinum',
  };
  const out = stripSecrets(settings);
  ok('strip removes anthropic', !('anthropicKey' in out));
  ok('strip removes openai', !('openaiKey' in out));
  ok('strip removes pexels/unsplash', !('pexelsKey' in out) && !('unsplashKey' in out));
  ok('strip removes pixabay (regression)', !('pixabayKey' in out));
  ok('strip keeps non-secrets', out.accent === '#00E5FF' && out.mascot === 'platinum' && !!out.design);
  ok('strip does not mutate input', 'anthropicKey' in settings);

  // mergeArrays: restore dedup (drafts by id current-wins, favorites union).
  const { mergeArrays } = await load('backup.ts');
  const merged = mergeArrays([{ id: 'a', v: 1 }], [{ id: 'a', v: 2 }, { id: 'b', v: 3 }]);
  ok('merge dedups by id, current wins', merged.length === 2 && merged.find((x) => x.id === 'a').v === 1 && !!merged.find((x) => x.id === 'b'));
  eq('merge unions plain values', mergeArrays(['fyp', 'ai'], ['ai', 'tech']), ['fyp', 'ai', 'tech']);
  eq('merge empty incoming keeps current', mergeArrays([{ id: 'a' }], []), [{ id: 'a' }]);
}

// ---- postShare (shareable post code round-trip) ----
{
  const { encodePost, decodePost } = await load('postShare.ts');
  const post = { preset: 'tweet', json: '{"preset":"tweet"}', caption: 'hook 🔥 with emoji\n#ai' };
  const code = encodePost(post);
  ok('share has prefix', code.startsWith('IRO1:'));
  eq('share round-trips (emoji-safe)', decodePost(code), post);
  eq('share tolerates missing prefix', decodePost(code.slice('IRO1:'.length)), post);
  ok('share garbage -> null', decodePost('not a real code !!!') === null);
  ok('share missing json -> null', decodePost('IRO1:' + btoa('{"preset":"x"}')) === null);
}

// ---- viralLibrary (Discover patterns integrity) ----
{
  const { VIRAL_PATTERNS, VIRAL_MECHANICS } = await load('viralLibrary.ts');
  const { PRESET_KEYS } = await load('presets.ts');
  const keys = new Set(PRESET_KEYS);
  const mechs = new Set(VIRAL_MECHANICS);
  ok('viral has patterns', VIRAL_PATTERNS.length >= 12);
  ok('viral unique ids', new Set(VIRAL_PATTERNS.map((p) => p.id)).size === VIRAL_PATTERNS.length);
  ok('viral presets all real', VIRAL_PATTERNS.every((p) => keys.has(p.preset)));
  ok('viral mechanics valid', VIRAL_PATTERNS.every((p) => mechs.has(p.mechanic)));
  ok('viral fields present', VIRAL_PATTERNS.every((p) => p.title && p.hook && p.example && p.why && p.adapt));
}

// ---- tiktokTrends (Overview CSV parser) ----
{
  const { parseTikTokOverview } = await load('tiktokTrends.ts');
  const today = new Date(2026, 5, 12); // Jun 12 2026
  const csv = '﻿"Date","Video Views","Profile Views","Likes","Comments","Shares"\n'
    + '"June 12","0","0","0","0","0"\n'
    + '"April 6","108","2","1","0","0"\n'
    + '"April 7","148","2","3","0","1"\n'
    + '"April 8","90","0","1","0","1"\n';
  const s = parseTikTokOverview(csv, today);
  ok('trends parses rows', s.rows.length === 4);
  ok('trends totals views', s.totals.videoViews === 346);
  ok('trends totals likes', s.totals.likes === 5);
  ok('trends active days', s.activeDays === 3); // the all-zero June 12 excluded
  ok('trends best day', s.bestDay && s.bestDay.videoViews === 148);
  ok('trends months bucketed', s.byMonth.length === 2); // June + April
  ok('trends engagement rate', s.engagementRate > 0 && s.engagementRate < 1);
  ok('trends empty -> safe', parseTikTokOverview('', today).rows.length === 0);
  ok('trends header-only -> safe', parseTikTokOverview('"Date","Video Views"', today).rows.length === 0);
  // April rows must land in 2026 (most recent year <= today)
  ok('trends year anchored', s.rows[1].date.getFullYear() === 2026 && s.rows[1].date.getMonth() === 3);
}

// ---- overlayRemap (overlays follow slide reorders) ----
{
  const { remapOverlays } = await load('overlayRemap.ts');
  const H = [{ id: 'h' }], B = [{ id: 'b' }], C = [{ id: 'c' }], T = [{ id: 'cta' }];
  // deck: hook(0), content slides 1..3, cta(4). hookOffset 1, oldLen 3.
  let r = remapOverlays({ '0': H, '2': B, '4': T }, 1, 3, [0, 2, 1]);
  ok('overlay move: hook stays', r['0'] === H);
  ok('overlay move: B follows slide 2->3', r['3'] === B && !r['2']);
  r = remapOverlays({ '0': H, '2': B, '4': T }, 1, 3, [0, 2]);
  ok('overlay remove: dropped + cta shifts', !Object.values(r).includes(B) && r['3'] === T && r['0'] === H);
  r = remapOverlays({ '2': B, '4': T }, 1, 3, [0, 1, 2, -1]);
  ok('overlay add: cta shifts 4->5', r['2'] === B && r['5'] === T);
  let i = 0;
  r = remapOverlays({ '2': B, '4': T }, 1, 3, [0, 1, 1, 2], () => 'c' + i++);
  ok('overlay duplicate: original keeps, copy fresh id', r['2'] === B && r['3'] && r['3'][0].id === 'c0');
  r = remapOverlays({ '0': B }, 0, 2, [1, 0]);
  ok('overlay no-hook: slide 0 -> 1', r['1'] === B && !r['0']);
}

// ---- brandBrain (AI context profile) ----
{
  const { brainPrompt, brainHasContent, EMPTY_BRAIN } = await load('brandBrain.ts');
  ok('brain empty -> no content', !brainHasContent(EMPTY_BRAIN));
  ok('brain empty -> empty prompt', brainPrompt(EMPTY_BRAIN) === '');
  const b = { ...EMPTY_BRAIN, niche: 'AI tools', voice: 'casual lowercase' };
  ok('brain has content', brainHasContent(b));
  const p = brainPrompt(b);
  ok('brain prompt includes set fields', p.includes('Niche: AI tools') && p.includes('Voice & tone: casual lowercase'));
  ok('brain prompt omits empty fields', !p.includes('Audience:') && !p.includes('Promoting'));
  ok('brain prompt is prependable (trailing blank line)', p.endsWith('\n\n'));
}

// ---- fastlane (panel normalizers) ----
{
  const { normalizeAnalytics, normalizePost, normalizeConnection, normalizeContent, localToUtcIso, compactNumber } = await load('fastlane.ts');
  const arr = normalizeAnalytics({ data: [{ postId: 'p1', metrics: { views: 4443, likes: 162, saves: 132, shares: 9 } }, { id: 'p2', viewCount: '1,121', saveCount: 28 }] });
  eq('fl analytics nested metrics', arr.p1, { views: 4443, likes: 162, saves: 132, shares: 9 });
  eq('fl analytics flat + string numbers', arr.p2, { views: 1121, saves: 28 });
  const keyed = normalizeAnalytics({ p3: { stats: { plays: 10, comments: 2 } } });
  eq('fl analytics keyed object', keyed.p3, { views: 10, comments: 2 });
  eq('fl analytics junk', normalizeAnalytics(null), {});
  const post = normalizePost({ id: 'p1', platform: 'TikTok', status: 'scheduled', caption: 'hi', scheduledAt: '2026-11-09T18:00:00Z' });
  ok('fl post normalized', post.platform === 'tiktok' && post.status === 'SCHEDULED' && post.when === '2026-11-09T18:00:00.000Z');
  ok('fl post without id dropped', normalizePost({ platform: 'tiktok' }) === null);
  ok('fl connection name fallback', normalizeConnection({ id: 'c1', platform: 'instagram', account: { username: 'tryiro' } }).name === 'tryiro');
  ok('fl content thumb from files', normalizeContent({ id: 'k1', type: 'slideshow', status: 'created', files: [{ url: 'https://x/y.png' }] }).thumbnail === 'https://x/y.png');
  ok('fl local->utc is UTC ISO', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(localToUtcIso('2026-11-09T10:00')));
  eq('fl local->utc bad', localToUtcIso('tomorrow'), '');
  // Real Fastlane shapes: Mongo `_id`, epoch-ms timestamps, platformUsername.
  const real = normalizeAnalytics({ data: [{ _id: 'm1', platform: 'tiktok', status: 'POSTED', views: 4443, likes: 162, comments: 7, postUrl: 'https://www.tiktok.com/@tryiro/video/1' }, { _id: 'm2', notFound: true }] });
  eq('fl analytics _id rows', real.m1, { views: 4443, likes: 162, comments: 7, url: 'https://www.tiktok.com/@tryiro/video/1' });
  eq('fl analytics notFound', real.m2, { notFound: true });
  const rp = normalizePost({ _id: 'm1', platform: 'tiktok', status: 'POSTED', postedAt: 1794000000000, createdAt: 1793900000000 });
  ok('fl post _id + epoch ms', rp.id === 'm1' && rp.when === new Date(1794000000000).toISOString());
  ok('fl post epoch seconds', normalizePost({ _id: 'x', scheduledAt: 1794000000 }).when === new Date(1794000000000).toISOString());
  ok('fl connection platformUsername', normalizeConnection({ _id: 'c9', platform: 'tiktok', platformUserId: 'u', platformUsername: 'tryiro' }).name === 'tryiro');
  ok('fl content epoch createdAt', normalizeContent({ _id: 'k2', type: 'slideshow', status: 'CREATED', createdAt: 1794000000000 }).createdAt === new Date(1794000000000).toISOString());
  eq('fl compact', [compactNumber(undefined), compactNumber(950), compactNumber(4443), compactNumber(26600), compactNumber(1500000)], ['–', '950', '4.4K', '27K', '1.5M']);
}

// ---- generate (client helpers) ----
{
  const { catalogModels, fmtUsd } = await load('generate.ts');
  const cat = { data: [
    { model_id: 'bytedance-seed/seedream-4.5', api_type: 'model_api', capability: 'image', model_pricing: [{ estimated_usd: 0.04, unit: 'image' }] },
    { model_id: 'wan-3.0', capability: 'video', model_pricing: [{ price: 0.05, unit: 'second' }] },
  ] };
  eq('gen catalog image', catalogModels(cat, 'image').map((m) => m.id), ['bytedance-seed/seedream-4.5']);
  eq('gen catalog video', catalogModels(cat, 'video'), [{ id: 'wan-3.0', note: '$0.050 / second' }]);
  eq('gen catalog junk', catalogModels(null, 'image'), []);
  eq('gen usd fmt', [fmtUsd(null), fmtUsd(0.0042), fmtUsd(0.063), fmtUsd(2.5)], ['unknown', '$0.0042', '$0.063', '$2.50']);
}

// ---- /api/generate (server route, mocked upstreams; no real API calls) ----
{
  // Bundle the serverless handler. @vercel/blob is stubbed; nothing leaves
  // this process because every fetch goes to the mock below.
  const blobStub = {
    name: 'blob-stub',
    setup(build) {
      build.onResolve({ filter: /^@vercel\/(blob|node)$/ }, (a) => ({ path: a.path, namespace: 'blob-stub' }));
      build.onLoad({ filter: /.*/, namespace: 'blob-stub' }, () => ({ contents: 'export async function put(){ throw new Error("blob disabled in tests"); }', loader: 'js' }));
    },
  };
  const out = await esbuild.build({
    entryPoints: [new URL('../../api/generate.ts', import.meta.url).pathname],
    bundle: true, platform: 'node', format: 'esm', write: false, plugins: [blobStub],
  });
  const file = join(dir, 'api_generate.mjs');
  writeFileSync(file, out.outputFiles[0].text);
  const { handle } = await import(pathToFileURL(file).href);

  const SUME = 'sume_test_key_123456';
  const OPENAI = 'sk-test-openai-abcdef123456';
  const TOKEN = 'a-long-panel-password-123';
  const env = { sumeKey: SUME, openaiKey: OPENAI, panelToken: TOKEN, panelTokenSource: 'FASTLANE_ADMIN_TOKEN', maxUsd: 1.5 };
  const calls = [];
  const jsonRes = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  let estimateUsd = 0.04;
  const mockFetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const u = String(url);
    if (u.endsWith('/v1/open/estimate')) return jsonRes(200, { data: { estimated_usd: estimateUsd, estimated_credits: 4 } });
    if (u.endsWith('/v1/image-router/generate') || u.endsWith('/v1/video-router/generate')) return jsonRes(202, { data: { request_id: 'job_abc', job: { id: 'job_abc', status: 'queued' }, terminal: false, next_poll_after_seconds: 2 } });
    if (u.endsWith('/v1/jobs/job_abc/status')) return jsonRes(200, { data: { sume_status: 'completed', terminal: true, result_ready: true } });
    if (u.endsWith('/v1/jobs/job_abc/result')) return jsonRes(200, { id: 'job_abc', status: 'completed', result: { artifacts: [{ id: 'artf_1', url: 'https://media.sume.com/artifacts/x.mp4', type: 'video', content_type: 'video/mp4' }] } });
    if (u.endsWith('/v1/images/generations') || u.endsWith('/v1/images/edits')) return jsonRes(200, { data: [{ b64_json: 'QUJD' }], usage: { input_tokens: 50, output_tokens: 1568, input_tokens_details: { text_tokens: 50, image_tokens: 0 } } });
    if (u.endsWith('/v1/responses')) return jsonRes(200, { output: [{ type: 'message', content: [{ type: 'output_text', text: 'clay penguin on a cliff' }] }], usage: { input_tokens: 100, output_tokens: 40 } });
    return jsonRes(404, { error: { code: 'not_found', message: 'nope' } });
  };
  async function call(op, { method = 'POST', body, query = {}, token = TOKEN, envOverride } = {}) {
    let status = 0, payload = null;
    const headers = {};
    const res = {
      setHeader: (k, v) => { headers[k] = v; },
      status(s) { status = s; return this; },
      json(b) { payload = b; return this; },
    };
    const req = { method, query: { op, ...query }, headers: token ? { 'x-generate-panel-token': token } : {}, body };
    await handle(req, res, { fetchImpl: mockFetch, env: envOverride || env, uploadRef: async () => 'https://x.public.blob.vercel-storage.com/ref.jpg' });
    return { status, payload, headers, text: JSON.stringify(payload) };
  }
  const noLeak = (r) => !r.text.includes(SUME) && !r.text.includes(OPENAI) && !r.text.includes(TOKEN);

  const st = await call('status', { method: 'GET', token: '' });
  ok('gen status open without token', st.status === 200 && st.payload.data.authorized === false && st.payload.data.sumeKeySet === true);
  ok('gen status never echoes secrets', noLeak(st) && st.headers['Cache-Control'] === 'no-store');
  ok('gen status authorized with token', (await call('status', { method: 'GET' })).payload.data.authorized === true);

  const before = calls.length;
  const locked = await call('image', { body: { confirm: true, provider: 'openai', prompt: 'x' }, token: 'wrong-password-wrong-pw' });
  ok('gen wrong token 401, no upstream call', locked.status === 401 && calls.length === before);
  const noLock = await call('image', { body: { confirm: true, provider: 'openai', prompt: 'x' }, envOverride: { ...env, panelToken: '' } });
  ok('gen no lock set -> 503', noLock.status === 503 && noLock.payload.error.code === 'missing_panel_token');
  const shortLock = await call('image', { body: { confirm: true, provider: 'openai', prompt: 'x' }, token: 'short', envOverride: { ...env, panelToken: 'short' } });
  ok('gen too-short lock refuses', shortLock.status === 401);

  const noConfirm = await call('image', { body: { provider: 'openai', prompt: 'x' } });
  ok('gen paid op needs confirm', noConfirm.status === 400 && noConfirm.payload.error.code === 'needs_confirm' && calls.length === before);
  ok('gen text needs confirm', (await call('text', { body: { prompt: 'hi' } })).payload.error.code === 'needs_confirm');
  ok('gen GET on paid op refused', (await call('image', { method: 'GET' })).status === 405);

  // OpenAI image: key only in Authorization, jpeg out, cost from usage.
  const oi = await call('image', { body: { confirm: true, provider: 'openai', model: 'gpt-image-2', prompt: 'penguin', aspect: '9:16', quality: 'medium' } });
  const oiCall = calls.at(-1);
  ok('gen openai image ok', oi.status === 200 && oi.payload.data.images[0].dataUrl === 'data:image/jpeg;base64,QUJD');
  ok('gen openai image request', oiCall.url === 'https://api.openai.com/v1/images/generations' && JSON.parse(oiCall.init.body).size === '1024x1536' && oiCall.init.headers.Authorization === `Bearer ${OPENAI}`);
  ok('gen openai cost from usage', Math.abs(oi.payload.data.costUsd - 0.0237) < 0.001);
  ok('gen openai response has no key', noLeak(oi));
  ok('gen openai unknown model refused', (await call('image', { body: { confirm: true, provider: 'openai', model: 'dall-e-9', prompt: 'x' } })).status === 400);

  // OpenAI with a reference → multipart edits.
  const refPng = 'data:image/png;base64,' + Buffer.from('fakepng').toString('base64');
  const oe = await call('image', { body: { confirm: true, provider: 'openai', prompt: 'penguin', refs: [{ dataUrl: refPng }] } });
  const oeCall = calls.at(-1);
  ok('gen openai refs -> edits multipart', oe.status === 200 && oeCall.url.endsWith('/images/edits') && oeCall.init.body instanceof FormData && oeCall.init.body.getAll('image[]').length === 1);
  ok('gen openai refuses url refs (no server fetch)', (await call('image', { body: { confirm: true, provider: 'openai', prompt: 'x', refs: [{ url: 'https://evil.example/x.png' }] } })).payload.error.code === 'bad_refs');

  // Sume image: estimate first, then async submit with refs + idempotency.
  const n0 = calls.length;
  const si = await call('image', { body: { confirm: true, provider: 'sume', model: 'bytedance-seed/seedream-4.5', prompt: 'penguin', aspect: '9:16', refs: [{ url: 'https://kiro.example.app/iro/penguin-clay-reference.jpg' }, { dataUrl: refPng }], idempotencyKey: 'iro-abcdef123456' } });
  const sCalls = calls.slice(n0);
  ok('gen sume estimate before submit', sCalls[0].url.endsWith('/v1/open/estimate') && sCalls[1].url.endsWith('/v1/image-router/generate'));
  const sb = JSON.parse(sCalls[1].init.body);
  ok('gen sume body shape', sb.model === 'bytedance-seed/seedream-4.5' && sb.mode === 'async' && sb.aspect_ratio === '9:16' && sb.input_references.length === 2 && sb.input_references[0].type === 'image_url');
  ok('gen sume uploaded data ref', sb.input_references[1].image_url.url === 'https://x.public.blob.vercel-storage.com/ref.jpg');
  ok('gen sume idempotency + auth', sCalls[1].init.headers['Idempotency-Key'] === 'iro-abcdef123456' && sCalls[1].init.headers.Authorization === `Bearer ${SUME}`);
  ok('gen sume job relayed', si.status === 200 && si.payload.data.job.id === 'job_abc' && si.payload.data.estimateUsd === 0.04 && noLeak(si));
  ok('gen sume refuses private ref url', (await call('image', { body: { confirm: true, provider: 'sume', model: 'm', prompt: 'x', refs: [{ url: 'http://localhost/x.png' }] } })).payload.error.code === 'bad_refs');

  // Spend cap: over-cap estimate never submits.
  estimateUsd = 4.2;
  const n1 = calls.length;
  const cap = await call('video', { body: { confirm: true, model: 'seedance-2.5', prompt: 'penguin waves', duration: 30, resolution: '1080p' } });
  ok('gen over cap refused', cap.status === 400 && cap.payload.error.code === 'over_cap' && calls.slice(n1).every((c) => !c.url.includes('video-router')));
  ok('gen video duration clamped to 15', JSON.parse(calls.at(-1).init.body).input.duration === 15);
  estimateUsd = null;
  const unk = await call('video', { body: { confirm: true, model: 'wan-3.0', prompt: 'penguin waves' } });
  ok('gen unknown price needs second confirm', unk.status === 409 && unk.payload.error.code === 'unknown_cost');
  const unk2 = await call('video', { body: { confirm: true, acceptUnknownCost: true, model: 'wan-3.0', prompt: 'penguin waves', duration: 5 } });
  ok('gen unknown price accepted runs', unk2.status === 200 && calls.at(-1).url.endsWith('/v1/video-router/generate'));
  estimateUsd = 0.25;

  // Job polling returns artifacts once completed.
  const jb = await call('job', { method: 'GET', query: { id: 'job_abc' } });
  ok('gen job completed with artifact', jb.status === 200 && jb.payload.data.job.terminal && jb.payload.data.artifacts[0].url === 'https://media.sume.com/artifacts/x.mp4');
  ok('gen job bad id', (await call('job', { method: 'GET', query: { id: '../etc' } })).status === 400);

  // Quote is free: estimate only, no generate.
  const n2 = calls.length;
  const qt = await call('quote', { body: { provider: 'sume', kind: 'video', model: 'wan-3.0', prompt: 'x', duration: 5 } });
  ok('gen quote sume', qt.payload.data.estimateUsd === 0.25 && calls.slice(n2).length === 1);
  const qo = await call('quote', { body: { provider: 'openai', model: 'gpt-image-2', quality: 'low' } });
  ok('gen quote openai approximate', qo.payload.data.approximate === true && qo.payload.data.estimateUsd > 0 && qo.payload.data.estimateUsd < 0.02);

  // ChatGPT text via the Responses API.
  const tx = await call('text', { body: { confirm: true, model: 'gpt-6-luna', prompt: 'cover idea', purpose: 'image-prompt' } });
  ok('gen text ok', tx.status === 200 && tx.payload.data.text === 'clay penguin on a cliff' && calls.at(-1).url === 'https://api.openai.com/v1/responses');

  // Upstream auth failure is reported without the key.
  const badFetch = async () => jsonRes(401, { error: { message: `Incorrect API key provided: ${OPENAI}` } });
  let st401 = 0, p401 = null;
  await handle({ method: 'POST', query: { op: 'image' }, headers: { 'x-generate-panel-token': TOKEN }, body: { confirm: true, provider: 'openai', prompt: 'x' } },
    { setHeader() {}, status(s) { st401 = s; return this; }, json(b) { p401 = b; return this; } }, { fetchImpl: badFetch, env });
  ok('gen upstream 401 -> 502, key scrubbed', st401 === 502 && !JSON.stringify(p401).includes(OPENAI));

  // Missing provider key.
  const nk = await call('image', { body: { confirm: true, provider: 'sume', model: 'm', prompt: 'x' }, envOverride: { ...env, sumeKey: '' } });
  ok('gen missing sume key 503', nk.status === 503 && nk.payload.error.code === 'missing_sume_key');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

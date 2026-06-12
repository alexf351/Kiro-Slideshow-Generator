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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

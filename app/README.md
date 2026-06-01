# Iro Slideshow Generator — Frontend

Vite + React + TypeScript + Tailwind shell around `kiro_slideshow_engine_v3.html`.

State (mascot, emote, platform, JSON) persists in browser `localStorage`. No backend, no auth.

## First time setup

```bash
cd app
npm install
```

## Run it locally

```bash
npm run dev
```

Opens at http://localhost:5173.

## Build

```bash
npm run build
npm run preview
```

## Deploy to Vercel (use it from your phone)

The repo includes a `vercel.json` at the root so Vercel builds the Vite app inside `app/` automatically.

1. Push this branch to GitHub.
2. Go to https://vercel.com/new and import the repo.
3. Leave the build settings on defaults — `vercel.json` handles build command + output dir.
4. Click Deploy. You get a `https://<project>.vercel.app` URL.
5. Open that URL on your phone.

On screens narrower than `md` (768px) the layout switches to a tabbed **Edit / Preview** view. Tapping "Render slides" on the Edit tab auto-jumps you to the Preview tab.

The engine HTML has `<meta name="viewport" content="width=1080">`, so the 1080×1920 slides scale-to-fit the iframe on phone. Tap the engine's "Download all slides" button in the Preview tab to save the PNGs (Photos on iOS, Downloads on Android), then open TikTok and post as a photo carousel.

## Prediction engine (Performance tab)

The **Stats / Performance** tab turns the app into a learning loop that scores your posts and predicts how a draft will do *before* you publish.

1. **Analyze my TikTok post** — paste one of your own post URLs. We scrape its slides + caption and Claude reads the on-screen text off each photo (vision, API mode) or works from text you type in (free, manual mode). It's saved as a `my post` row.
2. **Enter the numbers** — open the row and type the metrics off TikTok's analytics screen: views, likes, comments, shares, saves, and photo views.
3. **Score** — each post gets a 0-100 performance score (`scoring.ts`), computed *relative to your own history* (where its reach ranks) blended with absolute engagement quality (save rate + share rate are weighted hardest, since TikTok rewards them with distribution). The header rolls up which formats, hooks, and niches score best for *your* account.
4. **Predict before posting** — on the Edit tab, the **Score this draft** panel reads your scored history and forecasts the draft's score, with strengths/risks/suggestions to lift it. "Attach to next save" persists the prediction with the post.
5. **Calibration** — once the real numbers come in, each row shows `Predicted → Actual (Δ)`, and the header tracks the engine's mean prediction error so you can see it sharpen as you label more posts.
6. **Hook Library** — the **Hooks** tab mines every scored post for its opening hook and ranks them by that post's actual score, filterable by style + niche. Tap **→ Editor** to drop a proven hook straight into a new draft's caption.

Scoring is deterministic and free. Predicting + reading your slides uses Claude — one-tap with a BYOK Anthropic key, or free via the manual claude.ai copy-paste path, exactly like Clone/Propose. IG + YT are not wired up yet; the data model and scoring are platform-agnostic so they can be added later.

## Quick Edit (no JSON)

The Edit tab's **Content** section defaults to **Quick edit** — a structured form that parses the slides into labeled fields (hook, each content slide, CTA) with add / remove / reorder, so you never have to touch raw JSON. A **Quick edit | JSON** toggle keeps the raw textarea for power users. It's preset-agnostic (works for every format) and pauses gracefully if the JSON is mid-edit and unparseable.

## Design & brand kit

The **Design & brand** panel makes the output brand-agnostic and multi-platform:

- **Aspect ratio** — 9:16 (TikTok/Reels/Shorts), 4:5 (IG feed), 1:1 (square), 16:9 (YouTube/LinkedIn). 9:16 is fully tuned; the others export at the correct size and are labeled *beta* (layouts are tuned for 9:16).
- **Brand colors** — accent + background, applied to the engine's theme variables.
- **Watermark / logo** — upload a PNG, choose a corner; it's baked into every exported slide.

Defaults reproduce the original 1080×1920 cyan-on-black look exactly, so existing posts are unchanged.

## Hashtag intelligence

The Stats tab ranks **your hashtags by the average score** of the posts that used them. On the Edit tab, **＃ Suggest hashtags** appends your proven winners (that aren't already in the caption).

## Backup & export

Settings → **Backup** exports your whole post history + scores + brand kit to a JSON file (API keys excluded) and imports it back on another device or after clearing your browser. The Stats tab also has **Export CSV** for every post's metrics + computed/predicted scores.

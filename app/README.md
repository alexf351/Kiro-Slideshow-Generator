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

Scoring is deterministic and free. Predicting + reading your slides uses Claude — one-tap with a BYOK Anthropic key, or free via the manual claude.ai copy-paste path, exactly like Clone/Propose. IG + YT are not wired up yet; the data model and scoring are platform-agnostic so they can be added later.

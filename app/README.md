# Kiro Slideshow Generator — Frontend

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

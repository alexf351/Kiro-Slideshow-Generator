# Kiro Slideshow Generator — Local Frontend

Vite + React + TypeScript + Tailwind shell around `kiro_slideshow_engine_v3.html`.

Local-only. Library (saved slideshows) lives in browser `localStorage`. No hosting, no backend, no auth.

## First time setup

```bash
cd app
npm install
```

## Run it

```bash
npm run dev
```

Opens at http://localhost:5173.

## Build (rarely needed — this is meant to be run locally)

```bash
npm run build
npm run preview
```

## What's here today

- Two-column shell: sidebar (library placeholder) + main panel.
- Tailwind wired up via `@tailwindcss/vite`.

## Coming next (subsequent commits)

- Engine renders inside the main panel via iframe + `postMessage`.
- Library persists to localStorage with thumbnails.
- "+ New slideshow" opens paste-JSON flow (same validator as engine).
- Separate "Copy caption" + "Download slides" buttons per saved slideshow.
- Manual stats fields (views / likes / saves / shares / App Store ticks).

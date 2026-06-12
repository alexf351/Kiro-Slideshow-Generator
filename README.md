# Iro Slideshow Generator

[![CI](https://github.com/alexf351/Kiro-Slideshow-Generator/actions/workflows/ci.yml/badge.svg)](https://github.com/alexf351/Kiro-Slideshow-Generator/actions/workflows/ci.yml)

A browser-based studio for making TikTok / Reels / Shorts **photo-slideshow** posts
for Iro AI — pick a format, fill in the content (by hand or with AI), and export
the slides, a video, or push them straight to TikTok.

It's **local-first**: everything (your posts, drafts, media, API keys) lives in
your browser. Nothing is uploaded unless you explicitly publish.

The app lives in [`app/`](app/); the rendering engine is a single self-contained
file, [`kiro_slideshow_engine_v3.html`](kiro_slideshow_engine_v3.html), driven
inside an iframe via `postMessage`.

## Quick start

1. **Pick a format** in the sidebar — it loads an example post you can edit.
2. **Edit the content** in Quick-edit (form fields) or raw JSON. Or let AI do it:
   type a topic and hit **Generate**, or use the **💡 Ideas → batch** pipeline.
3. **Style it** — pick a background (photo, gradient, or solid), drop on text /
   image overlays, adjust per-photo crop.
4. **Export** — download the slides, render an MP4, make a PDF (IG/LinkedIn
   carousel), send to your phone via QR, or push to your **TikTok inbox**.

## Formats (30)

| Format | What it is |
| --- | --- |
| Prompt Pack | Save-bait list. Big numbered prompts in chat-style boxes. |
| Pain Story | Aesthetic photo bg + italic serif confession. Soft CTA. |
| Aspirational | Cinematic luxury. Bottom-anchored bold hooks, gold + cyan accents. |
| Meme / POV | Image-dominant. Top/bottom captions with thick stroke. |
| Product Demo | Phone mockup + Iro screenshots. Branded benefit captions. |
| Checklist | Scannable "if you…" qualifier with tinted check / cross / warning icons. |
| Handwritten Pack | Cream paper + handwritten ink, notebook aesthetic. |
| App Stack | "5 apps I use every day" carousel — photo bgs + app icons. |
| Output vs Hype | One slide per AI tool — brand logo + two bars (Output vs Hype). |
| Curated List | Aesthetic photo + cream heading + a recommendation card per slide. |
| Tier List | S/A/B/C ranking, one colored tier per slide ("I ranked every X"). |
| Myth vs Fact | Red ✗ MYTH card over a green ✓ FACT card per slide. |
| Hot Take | Bold full-bleed opinions on a fiery gradient. |
| Storytime | iMessage-style chat that plays forward as you swipe. |
| Stat Drop | One giant glowing statistic + context per slide. |
| This or That | Binary "comment your pick" polls split by a VS badge. |
| Quote Card | Aesthetic serif quotes with a big mark + author. |
| Before / After | Muted BEFORE card → arrow → glowing AFTER card. |
| Countdown | Ranked listicle counting down to a gold #1. |
| Definition | Dictionary-style term cards on cream ("AI word of the day"). |
| Q&A | Sticker-style question + answer per slide ("you asked, I answered"). |
| Flags | Green-flag / red-flag cards per slide. |
| Steps | Numbered how-to steps with a progress indicator. |
| Timeline | Dated milestones down a vertical line ("how it started → now"). |
| Receipts | Social-proof testimonials — one gold-star review per slide. |
| Tweet | "Screenshot of a tweet" cards — avatar, verified check, engagement row. |
| Notes App | iOS Notes-app screenshot look — one note per slide (announcements/lists). |
| Reddit | "Screenshot of a Reddit post" — subreddit, votes, comments (AITA/stories). |
| Breaking News | Broadcast "BREAKING" lower-third over a photo (news parody). |
| Search Bar | Google search bar + autocomplete ("what your search history says"). |

## Features

**AI (bring your own Anthropic key):**
- **Fill from topic** — type an idea, AI fills the current format's JSON.
- **💡 Ideas → Batch** — brainstorm topics for a niche, then generate a draft for each.
- **AI caption** (with tone: Funny / Educational / Aesthetic / Hype / Relatable) and **translation** to other languages.
- **Improve** the whole post (punchier / simpler / spicier / shorter) or **rewrite a single slide**.
- **Clone from TikTok** and **Propose** the next post from your history.

**Backgrounds & styling:**
- Stock photos from **Openverse (keyless)**, Pexels, Unsplash, Pixabay.
- 23 **gradient** + 16 **solid** built-in backgrounds (no photo/API needed).
- Per-photo crop/zoom, draggable **text & image overlays** (paste a photo onto a slide), one-tap text style presets.

**Workflow & export:**
- **Drafts** with a lightweight **content calendar** (schedule by date).
- **Share/import** a post as a portable code; **saved hashtag sets**.
- **Pre-publish checklist** + caption length / hook helper.
- Export: PNG slides, **MP4 video** (with pacing), **PDF**, **QR to phone**, and
  **Send to TikTok inbox** (see [`TIKTOK_SETUP.md`](TIKTOK_SETUP.md)).
- Output aspect ratios: 9:16, 4:5, 1:1, 16:9.

## API keys

All keys are **bring-your-own** and stored only in your browser (Settings panel):

- **Anthropic** — powers the AI features. Pay-per-use.
- **OpenAI** — optional, for AI-editing slide backgrounds.
- **Pexels / Unsplash / Pixabay** — free stock photo search. (Openverse needs no key.)

## Development

```bash
cd app
npm install
npm run dev      # local dev server
npm run build    # production build → app/dist
```

The serverless functions in [`api/`](api/) (image proxy, TikTok publishing) run
on Vercel; see [`vercel.json`](vercel.json) and [`TIKTOK_SETUP.md`](TIKTOK_SETUP.md).

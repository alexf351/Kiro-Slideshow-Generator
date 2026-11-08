# Fastlane panel setup

The **Fastlane** group in the sidebar shows your connected accounts and recent
posts with views / likes / saves / shares from [Fastlane](https://usefastlane.ai),
and can schedule a finished Fastlane library item to TikTok, Instagram Reels or
YouTube Shorts.

Your Fastlane API key lives only in Vercel. The browser talks to this app's own
`/api/fastlane` route, which adds the key on the server.

## 1. Add the environment variables

Vercel → project **kiro-slideshow-generator** → **Settings → Environment
Variables** (Production, plus Preview if you test on previews):

| Variable | Value |
| --- | --- |
| `FASTLANE_API_KEY` | your Fastlane API key |
| `FASTLANE_ADMIN_TOKEN` | a long random password you make up (16+ characters). Unlocks stats **and** scheduling. |
| `FASTLANE_READ_TOKEN` | *(optional)* a second password that only unlocks stats. Give this one to an automation that should read numbers but never post. |

Then **redeploy** (Deployments → latest → Redeploy). Env vars only reach new
deployments.

Why the admin token: the production URL is public, so without it anyone who
found `/api/fastlane` could read your stats or schedule posts with your key.
Until `FASTLANE_ADMIN_TOKEN` (or the read token) is set, every Fastlane route
answers "locked".

## 2. Use it

1. Open the app → **Fastlane** in the sidebar.
2. Paste the same `FASTLANE_ADMIN_TOKEN` value into **Panel token** (saved in
   this browser only).
3. **Load accounts & stats**.
4. To schedule: **Load library** → pick an item, platform, account and time →
   **Review & schedule…** → confirm the dialog. Scheduled posts get a
   **Cancel this post** button (also confirmed).

## What the route can and can't do

`/api/fastlane?op=…`: `status`, `connections`, `posts`, `post`, `content`,
`content-item`, `analytics`, `stats` (read-only), plus `schedule` and `cancel`
(admin token + `confirm: true` in the body).

Not exposed on purpose: Blitz generation (`POST /blitz`), deleting content,
and editing angles or preferences.

Fastlane allows 20 requests a minute per workspace; the panel's refresh uses 3.

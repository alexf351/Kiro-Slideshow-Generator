# TikTok "Send to Inbox" setup

The **Publish to TikTok** panel pushes the current slideshow straight to a
connected TikTok account's **inbox** as a photo draft. You finish/publish from
the TikTok app. It uses the official
[Content Posting API](https://developers.tiktok.com/doc/content-posting-api-get-started/)
(photo, `MEDIA_UPLOAD` / inbox mode).

This needs a one-time setup because TikTok requires a registered developer app
and a verified domain. Everything is gated — without the env vars below the
panel simply reports "not configured".

## 1. Create a TikTok developer app

1. Go to <https://developers.tiktok.com/> → **Manage apps** → create an app.
2. Add the **Login Kit** and **Content Posting API** products.
3. Request scopes: `user.info.basic` and `video.upload`.
4. Under **Login Kit → Redirect URI**, add:
   `https://<your-domain>/api/tiktok/callback`
5. Under **URL Properties**, verify the prefix:
   `https://<your-domain>/api/tiktok/media`
   (this lets TikTok's `PULL_FROM_URL` fetch your slides — they're proxied
   through your own domain so the domain is verifiable).

> While your app is unaudited, the Content Posting API only works for accounts
> added as **test users** in the developer portal, and posts stay private.
> Submit the app for audit to post to any account. This is perfect for a
> personal/burner account: add it as a test user and you're done.

## 2. Enable Vercel Blob

In your Vercel project → **Storage → Blob → Create**. Vercel adds a
`BLOB_READ_WRITE_TOKEN` env var automatically. Slides are uploaded here briefly
so TikTok can pull them.

## 3. Set environment variables

In the Vercel project → **Settings → Environment Variables**:

| Variable | Value |
| --- | --- |
| `TIKTOK_CLIENT_KEY` | from your TikTok app |
| `TIKTOK_CLIENT_SECRET` | from your TikTok app |
| `BLOB_READ_WRITE_TOKEN` | auto-added by Vercel Blob |
| `TIKTOK_REDIRECT_URI` | *(optional)* override the callback URL; defaults to `<origin>/api/tiktok/callback` |

Redeploy.

## 4. Use it

1. Open the app → **Publish to TikTok** in the sidebar.
2. **Connect TikTok & send** → authorize in the popup.
3. The slides are captured, uploaded, and pushed to your TikTok inbox.
4. Open TikTok → your inbox/notifications → finish the photo post.

## Bonus: "Send to phone (QR)"

The same **Publish to TikTok** panel has a **📲 Send to phone (QR)** button. It
captures the slides, hosts them on a tiny mobile gallery page (Vercel Blob),
and shows a QR. Scan it with your phone, long-press each slide to save to
Photos, and the caption is on the page to copy. This only needs **Vercel Blob**
(step 2) — no TikTok app required.

## How it flows

```
React  ──capture-tiktok──▶ engine (html2canvas → JPEG data URLs)
React  ──POST /api/tiktok/upload──▶ Vercel Blob ──▶ media URL on your domain
React  ──POST /api/tiktok/post────▶ TikTok Content Posting API (PULL_FROM_URL)
TikTok ──GET  /api/tiktok/media──▶ streams each slide back from Blob
```

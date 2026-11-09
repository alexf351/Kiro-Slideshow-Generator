# AI generate panel setup

The **AI generate** group in the sidebar makes cover images (OpenAI or
[Sume](https://www.sume.com/sume-api)), short video clips (Sume) and has a
ChatGPT box. Your keys live only in Vercel. The browser talks to this app's own
`/api/generate` route, which adds the key on the server.

## 1. Environment variables

Vercel → project **kiro-slideshow-generator** → **Settings → Environment Variables**:

| Variable | Value |
| --- | --- |
| `OPENAI_API_KEY` | OpenAI Platform API key |
| `SUME_API_KEY` | Sume API key (sume.com → Sume API → API keys) |
| `FASTLANE_ADMIN_TOKEN` | already set for the Fastlane panel. The same password unlocks this panel. |
| `GENERATE_ADMIN_TOKEN` | *(optional)* a separate 16+ character password just for this panel. Used instead of the Fastlane one when set. |
| `GENERATE_MAX_USD` | *(optional)* most one run may cost, default `1.50`. Sume runs whose estimate is higher are refused before they start. |
| `BLOB_READ_WRITE_TOKEN` | already set by Vercel Blob. Only needed to send your own uploaded reference images to Sume. |

Env vars only reach new deployments, so **redeploy** after adding them. Vars set
for Production only won't be on preview deployments.

## 2. Use it

1. Open the app → **AI generate** in the sidebar. If the Fastlane panel is
   already unlocked in this browser, this one is too; otherwise paste the
   password.
2. **Image**: pick OpenAI or Sume, a model, quality and shape, write a prompt
   (or **Draft prompt from the hook with ChatGPT**), tick **Iro clay penguin**
   to use the mascot as a reference, add your own reference images if you like.
   **Check price** is free. **Generate…** shows the model and the estimated
   cost and only runs when you confirm. Then **Cover bg**, **All slides** or
   **Save**.
3. **Video** (Sume): model, seconds (2 to 15), resolution, shape, prompt.
   Optionally start from the last Sume image or the penguin (image-to-video
   models). Check price → Generate… → confirm. Sume jobs run in the background;
   the panel polls until the clip is ready and can cancel a job that hasn't
   started (Sume refunds failed and canceled jobs).
4. **ChatGPT**: ask anything; copy the answer or send it to the image prompt.

**Load Sume models & prices** reads Sume's live catalog into the model box.

## Costs

- Sume: the panel shows Sume's own estimate (`/v1/open/estimate`) before every
  run. If Sume returns no price, you're asked to confirm a second time.
- OpenAI images are billed per token, so the pre-run figure is an estimate
  ("about"). After a run the panel shows the cost worked out from OpenAI's
  reported token usage.

## Route

`/api/generate?op=…`: `status`, `catalog`, `quote`, `job`, `cancel` (free) and
`image`, `video`, `text` (paid, need `confirm: true`). Every op except
`status` needs the panel password. The route never fetches arbitrary URLs:
OpenAI references are sent as image data, Sume fetches public https links
itself.

## Known gaps

Sume's public docs don't show every response in full (the estimate response,
the catalog shape, the status body). The parsers read the field names the docs
and OpenAPI spec name and fall back gracefully; the first real run will show
whether any field needs adjusting. Video ids in the defaults (`wan-3.0`,
`seedance-2.5`, `kling-4`, `minimax-h3`) come from Sume's docs; use **Load
Sume models** for the live list.

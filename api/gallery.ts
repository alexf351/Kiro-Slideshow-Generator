// POST /api/gallery   body: { images: string[] (public blob URLs), caption?: string }
// Builds a tiny mobile-friendly "save these slides" gallery page, stores it in
// Vercel Blob as a public HTML file, and returns its URL. The desktop app
// renders a QR to this URL so you can open it on your phone and long-press
// each slide to save it to Photos, then copy the caption.
//
// Requires Vercel Blob enabled (BLOB_READ_WRITE_TOKEN) — same as the TikTok flow.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { put } from '@vercel/blob';
import { resolveBlobToken } from '../lib/tiktok.js';

export const config = { api: { bodyParser: { sizeLimit: '2mb' } } };

function esc(s: string): string {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

function galleryHtml(images: string[], caption: string): string {
  const imgs = images.map((u, i) =>
    `<img src="${esc(u)}" alt="Slide ${i + 1}" loading="lazy">`).join('\n');
  const cap = caption
    ? `<div class="cap"><div class="cap-label">Caption — tap to copy</div><pre id="cap" onclick="copyCap()">${esc(caption)}</pre></div>`
    : '';
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Your slides — Iro</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; background:#07090f; color:#e5e7eb; font:15px/1.5 system-ui,-apple-system,sans-serif; }
  header { padding:18px 16px 8px; text-align:center; }
  header h1 { font-size:17px; margin:0 0 4px; }
  header p { margin:0; color:#8a93a6; font-size:13px; }
  .grid { display:flex; flex-direction:column; gap:14px; padding:14px; max-width:520px; margin:0 auto; }
  .grid img { width:100%; height:auto; border-radius:14px; display:block; background:#000; box-shadow:0 8px 30px rgba(0,0,0,0.5); }
  .cap { max-width:520px; margin:6px auto 40px; padding:14px; }
  .cap-label { font-size:11px; text-transform:uppercase; letter-spacing:.12em; color:#8a93a6; margin-bottom:6px; }
  .cap pre { white-space:pre-wrap; word-break:break-word; background:#0e131d; border:1px solid #1d2738; border-radius:12px; padding:14px; font:inherit; cursor:pointer; }
  .toast { position:fixed; left:50%; bottom:24px; transform:translateX(-50%); background:#00E5FF; color:#04121a; font-weight:700; padding:10px 18px; border-radius:999px; opacity:0; transition:opacity .2s; }
  .toast.show { opacity:1; }
</style></head><body>
<header><h1>📲 Your slides are ready</h1><p>Long-press each image → <b>Save to Photos</b>, then paste them into TikTok.</p></header>
<div class="grid">${imgs}</div>
${cap}
<div class="toast" id="toast">Caption copied</div>
<script>
  function copyCap(){var t=document.getElementById('cap').innerText;
    (navigator.clipboard?navigator.clipboard.writeText(t):Promise.reject()).then(show).catch(function(){
      var r=document.createRange();r.selectNodeContents(document.getElementById('cap'));
      var s=getSelection();s.removeAllRanges();s.addRange(r);try{document.execCommand('copy');show();}catch(e){}});}
  function show(){var el=document.getElementById('toast');el.classList.add('show');setTimeout(function(){el.classList.remove('show');},1500);}
</script>
</body></html>`;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  const blobToken = resolveBlobToken();
  if (!blobToken) {
    res.status(501).json({ error: 'Vercel Blob is not enabled on this project (no BLOB_READ_WRITE_TOKEN).' });
    return;
  }
  const images = (req.body && (req.body.images as string[])) || [];
  const caption = ((req.body && (req.body.caption as string)) || '').slice(0, 2200);
  if (!Array.isArray(images) || images.length === 0) {
    res.status(400).json({ error: 'No slide images provided.' });
    return;
  }
  // Only allow our own blob URLs in the gallery.
  for (const u of images) {
    try {
      const h = new URL(u).hostname;
      if (!/\.blob\.vercel-storage\.com$/i.test(h)) { res.status(400).json({ error: 'Images must be Vercel Blob URLs.' }); return; }
    } catch { res.status(400).json({ error: 'Bad image URL.' }); return; }
  }
  try {
    const id = `gallery/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.html`;
    const blob = await put(id, galleryHtml(images, caption), {
      access: 'public', contentType: 'text/html; charset=utf-8', addRandomSuffix: false, token: blobToken,
    });
    res.status(200).json({ url: blob.url });
  } catch (e) {
    res.status(500).json({ error: `Gallery publish failed: ${(e as Error).message}` });
  }
}

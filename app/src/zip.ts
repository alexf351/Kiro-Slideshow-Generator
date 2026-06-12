// Minimal, dependency-free ZIP writer (STORE method — no compression).
//
// Why hand-rolled: the only thing we zip is exported slide images, which are
// already JPEG-compressed, so DEFLATE would buy nothing while pulling in a
// whole compression library. A "stored" ZIP is a handful of well-specified
// records (local file header + data per entry, then a central directory and
// an end-of-central-directory record), so we emit those bytes directly.
//
// Pure: bytes in, Blob out. The format is exactly per APPNOTE (PKWARE ZIP),
// little-endian throughout, which makes it openable by Finder, Windows
// Explorer, `unzip`, and every other standard tool.

export type ZipEntry = { name: string; data: Uint8Array };

// Standard CRC-32 (polynomial 0xEDB88320), table built once.
const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// UTF-8 encode a filename. We also set the language-encoding (UTF-8) flag in
// the headers so non-ASCII names decode correctly.
function encodeName(name: string): Uint8Array {
  return new TextEncoder().encode(name);
}

// DOS date/time pack of a JS Date. ZIP stores mod time in this legacy format;
// resolution is 2 seconds, year is offset from 1980.
function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2) & 0x1f);
  const date = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

// Build a STORE-method ZIP archive from the given entries.
export function makeZip(entries: ZipEntry[], now: Date = new Date()): Blob {
  const { time, date } = dosDateTime(now);
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encodeName(entry.name);
    const data = entry.data;
    const crc = crc32(data);
    const size = data.length;

    // ----- Local file header (30 bytes + name) -----
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);   // signature
    local.setUint16(4, 20, true);            // version needed
    local.setUint16(6, 0x0800, true);        // flags: UTF-8 name
    local.setUint16(8, 0, true);             // method: 0 = store
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);         // compressed size (== size for store)
    local.setUint32(22, size, true);         // uncompressed size
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);            // extra field length
    const localHeader = new Uint8Array(local.buffer);

    chunks.push(localHeader, nameBytes, data);

    // ----- Central directory record (46 bytes + name) -----
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);       // signature
    cd.setUint16(4, 20, true);               // version made by
    cd.setUint16(6, 20, true);               // version needed
    cd.setUint16(8, 0x0800, true);           // flags: UTF-8
    cd.setUint16(10, 0, true);               // method: store
    cd.setUint16(12, time, true);
    cd.setUint16(14, date, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, size, true);
    cd.setUint32(24, size, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint16(30, 0, true);               // extra length
    cd.setUint16(32, 0, true);               // comment length
    cd.setUint16(34, 0, true);               // disk number start
    cd.setUint16(36, 0, true);               // internal attrs
    cd.setUint32(38, 0, true);               // external attrs
    cd.setUint32(42, offset, true);          // local header offset
    central.push(new Uint8Array(cd.buffer), nameBytes);

    offset += localHeader.length + nameBytes.length + data.length;
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const c of central) centralSize += c.length;

  // ----- End of central directory record (22 bytes) -----
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);       // signature
  eocd.setUint16(4, 0, true);                // disk number
  eocd.setUint16(6, 0, true);                // central dir start disk
  eocd.setUint16(8, entries.length, true);   // entries on this disk
  eocd.setUint16(10, entries.length, true);  // total entries
  eocd.setUint32(12, centralSize, true);
  eocd.setUint32(16, centralStart, true);
  eocd.setUint16(20, 0, true);               // comment length

  // Concatenate every record into one contiguous buffer. (A single
  // fresh-ArrayBuffer-backed Uint8Array is also the BlobPart type the DOM
  // lib accepts without complaint about SharedArrayBuffer.)
  const all = [...chunks, ...central, new Uint8Array(eocd.buffer)];
  let total = 0;
  for (const part of all) total += part.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const part of all) { out.set(part, pos); pos += part.length; }
  return new Blob([out], { type: 'application/zip' });
}

// Decode a `data:` URL (e.g. the JPEG data URLs the engine returns) into raw
// bytes for zipping. Handles base64 and percent-encoded payloads.
export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  if (comma === -1) return new Uint8Array(0);
  const meta = dataUrl.slice(0, comma);
  const payload = dataUrl.slice(comma + 1);
  if (/;base64/i.test(meta)) {
    const bin = atob(payload);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new TextEncoder().encode(decodeURIComponent(payload));
}

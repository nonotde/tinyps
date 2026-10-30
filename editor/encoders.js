// TinyPS — client-side encoders for formats Chrome's canvas cannot export:
// 24-bit BMP and GIF89a (median-cut palette + LZW stream).
// Everything below is dependency-free and runs on plain ArrayBuffers.
'use strict';

/** Encode ImageData as a 24-bit bottom-up BMP. Returns Blob(image/bmp). */
function encodeBMP(imageData) {
  const w = imageData.width, h = imageData.height, data = imageData.data;
  const rowSize = (w * 3 + 3) & ~3;              // rows padded to 4 bytes
  const pixSize = rowSize * h;
  const buf = new ArrayBuffer(54 + pixSize);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);

  // BITMAPFILEHEADER
  dv.setUint8(0, 0x42); dv.setUint8(1, 0x4d);    // 'BM'
  dv.setUint32(2, 54 + pixSize, true);           // file size
  dv.setUint32(10, 54, true);                    // pixel data offset
  // BITMAPINFOHEADER
  dv.setUint32(14, 40, true);                    // header size
  dv.setInt32(18, w, true);
  dv.setInt32(22, h, true);                      // positive = bottom-up
  dv.setUint16(26, 1, true);                     // planes
  dv.setUint16(28, 24, true);                    // bpp
  dv.setUint32(30, 0, true);                     // BI_RGB
  dv.setUint32(34, pixSize, true);
  dv.setInt32(38, 2835, true);                   // 72 dpi
  dv.setInt32(42, 2835, true);

  for (let y = 0; y < h; y++) {
    const srcRow = (h - 1 - y) * w * 4;
    let off = 54 + y * rowSize;
    for (let x = 0; x < w; x++) {
      const i = srcRow + x * 4;
      const a = data[i + 3];
      // BMP has no alpha: composite over white
      u8[off++] = a === 255 ? data[i + 2] : Math.round(data[i + 2] * (a / 255) + 255 * (1 - a / 255));
      u8[off++] = a === 255 ? data[i + 1] : Math.round(data[i + 1] * (a / 255) + 255 * (1 - a / 255));
      u8[off++] = a === 255 ? data[i] : Math.round(data[i] * (a / 255) + 255 * (1 - a / 255));
    }
  }
  return new Blob([buf], { type: 'image/bmp' });
}

// ---------- GIF ----------

function buildGifPalette(imageData) {
  const data = imageData.data, n = data.length / 4;
  const counts = new Map();                       // rgb int -> count
  let hasAlpha = false;
  const step = Math.max(1, Math.floor(n / 60000)); // sample for stats
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    if (data[p + 3] < 128) { hasAlpha = true; continue; }
    const key = (data[p] << 16) | (data[p + 1] << 8) | data[p + 2];
    // count sampled pixels plus repeats of already-known colors
    if (i % step === 0 || counts.has(key)) {
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  if (counts.size === 0) { counts.set(0x000000, 1); hasAlpha = true; }

  const maxColors = hasAlpha ? 255 : 256;
  let palette;

  if (counts.size <= maxColors) {
    palette = [...counts.keys()].map(k => [(k >> 16) & 255, (k >> 8) & 255, k & 255]);
  } else {
    // median cut over (r,g,b,count) samples
    let boxes = [[...counts.entries()]];
    while (boxes.length < maxColors) {
      // split the box with the widest channel range
      let bi = -1, brange = -1, bch = 0;
      for (let i = 0; i < boxes.length; i++) {
        if (boxes[i].length < 2) continue;
        let rmin = 255, rmax = 0, gmin = 255, gmax = 0, bmin = 255, bmax = 0;
        for (const [k] of boxes[i]) {
          const r = (k >> 16) & 255, g = (k >> 8) & 255, b = k & 255;
          if (r < rmin) rmin = r; if (r > rmax) rmax = r;
          if (g < gmin) gmin = g; if (g > gmax) gmax = g;
          if (b < bmin) bmin = b; if (b > bmax) bmax = b;
        }
        const ranges = [rmax - rmin, gmax - gmin, bmax - bmin];
        const ch = ranges.indexOf(Math.max(...ranges));
        if (ranges[ch] > brange) { brange = ranges[ch]; bi = i; bch = ch; }
      }
      if (bi < 0 || brange <= 0) break;
      const box = boxes[bi];
      box.sort((a, b) => ((a[0] >> (16 - 8 * bch)) & 255) - ((b[0] >> (16 - 8 * bch)) & 255));
      // split at weighted median
      let total = 0; for (const [, c] of box) total += c;
      let acc = 0, cut = 0;
      for (; cut < box.length - 1; cut++) { acc += box[cut][1]; if (acc >= total / 2) break; }
      boxes.splice(bi, 1, box.slice(0, cut + 1), box.slice(cut + 1));
    }
    palette = boxes.map(box => {
      let r = 0, g = 0, b = 0, w = 0;
      for (const [k, c] of box) {
        r += ((k >> 16) & 255) * c; g += ((k >> 8) & 255) * c; b += (k & 255) * c; w += c;
      }
      return w ? [Math.round(r / w), Math.round(g / w), Math.round(b / w)] : [0, 0, 0];
    });
  }

  if (hasAlpha) palette.push([0, 0, 0]);          // last slot = transparent
  const transparentIdx = hasAlpha ? palette.length - 1 : -1;
  while (palette.length < 256) palette.push([0, 0, 0]);

  // nearest-color lookup cache keyed on 15-bit buckets
  const cache = new Array(32768);
  const nearest = (r, g, b) => {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let idx = cache[key];
    if (idx === undefined) {
      let best = 0, bd = Infinity;
      const lim = transparentIdx < 0 ? palette.length : transparentIdx;
      for (let i = 0; i < lim; i++) {
        const dr = r - palette[i][0], dg = g - palette[i][1], db = b - palette[i][2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bd) { bd = d; best = i; }
      }
      idx = cache[key] = best;
    }
    return idx;
  };

  const indices = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    indices[i] = transparentIdx >= 0 && data[p + 3] < 128 ? transparentIdx : nearest(data[p], data[p + 1], data[p + 2]);
  }
  return { palette, indices, transparentIdx };
}

/**
 * LZW minimum-code-size 8 stream using only literal codes, with a CLEAR code
 * every 200 codes so the decoder's table never outgrows 9-bit codes.
 */
function gifLzw(indices) {
  const CLEAR = 256, EOI = 257, WIDTH = 9;
  const out = [];
  let cur = 0, bits = 0;
  const emit = code => {
    cur |= code << bits;
    bits += WIDTH;
    while (bits >= 8) { out.push(cur & 0xff); cur >>= 8; bits -= 8; }
  };
  emit(CLEAR);
  for (let i = 0; i < indices.length; i++) {
    emit(indices[i]);
    if ((i + 1) % 200 === 0 && i + 1 < indices.length) emit(CLEAR);
  }
  emit(EOI);
  if (bits > 0) out.push(cur & 0xff);
  return out;
}

/** Encode ImageData as an animated-single-frame GIF89a. Returns Blob(image/gif). */
function encodeGIF(imageData) {
  const w = imageData.width, h = imageData.height;
  const { palette, indices, transparentIdx } = buildGifPalette(imageData);

  const bytes = [];
  const push = (...arr) => bytes.push(...arr);
  const u16 = v => bytes.push(v & 0xff, (v >> 8) & 0xff);

  push(0x47, 0x49, 0x46, 0x38, 0x39, 0x61);      // "GIF89a"
  u16(w); u16(h);
  push(0xf7, 0, 0);                                // GCT flag, 8-bit color res, size=256
  for (const [r, g, b] of palette) push(r, g, b);

  if (transparentIdx >= 0) {                       // graphics control extension
    push(0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, transparentIdx, 0x00);
  }
  push(0x2c);                                      // image descriptor
  u16(0); u16(0); u16(w); u16(h);
  push(0);                                         // no LCT, no interlace
  push(8);                                         // LZW minimum code size
  const lzw = gifLzw(indices);
  for (let i = 0; i < lzw.length; i += 255) {
    const chunk = lzw.slice(i, i + 255);
    bytes.push(chunk.length, ...chunk);
  }
  push(0);                                         // block terminator
  push(0x3b);                                      // trailer

  return new Blob([new Uint8Array(bytes)], { type: 'image/gif' });
}

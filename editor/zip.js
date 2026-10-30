// TinyPS — dependency-free ZIP writer.
// Uses the built-in CompressionStream('deflate-raw') so no third-party code
// ships with the extension (Chrome Web Store forbids remote code, and keeping
// the bundle tiny makes review easier).
'use strict';

const ZIP_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function zipCrc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = ZIP_CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function zipDeflateRaw(bytes) {
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch (e) {
    return null; // caller falls back to stored (uncompressed) entries
  }
}

/**
 * Build a ZIP archive.
 * @param {Array<{name: string, data: Uint8Array}>} entries
 * @returns {Promise<Blob>}
 */
async function createZip(entries) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;

  const header = (size) => { const b = new ArrayBuffer(size); return [new DataView(b), new Uint8Array(b)]; };

  for (const entry of entries) {
    const nameBytes = enc.encode(entry.name);
    const crc = zipCrc32(entry.data);
    const deflated = await zipDeflateRaw(entry.data);
    const useDeflate = deflated && deflated.length < entry.data.length;
    const payload = useDeflate ? deflated : entry.data;
    const method = useDeflate ? 8 : 0;

    const [lv, lu8] = header(30 + nameBytes.length);
    lv.setUint32(0, 0x04034b50, true);            // local file header signature
    lv.setUint16(4, 20, true);                    // version needed
    lv.setUint16(6, 0x0800, true);                // flags: UTF-8 names
    lv.setUint16(8, method, true);
    lv.setUint16(10, 0, true);                    // mod time
    lv.setUint16(12, ((2026 - 1980) << 9) | (8 << 5) | 20, true); // mod date
    lv.setUint32(14, crc, true);
    lv.setUint32(18, payload.length, true);
    lv.setUint32(22, entry.data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lu8.set(nameBytes, 30);
    parts.push(lu8);
    parts.push(payload);

    central.push({ nameBytes, crc, method, compSize: payload.length, uncompSize: entry.data.length, offset });
    offset += 30 + nameBytes.length + payload.length;
  }

  const cdStart = offset;
  for (const c of central) {
    const [dv, u8] = header(46 + c.nameBytes.length);
    dv.setUint32(0, 0x02014b50, true);            // central directory signature
    dv.setUint16(4, 20, true);                    // version made by
    dv.setUint16(6, 20, true);                    // version needed
    dv.setUint16(8, 0x0800, true);                // flags: UTF-8 names
    dv.setUint16(10, c.method, true);
    dv.setUint16(12, 0, true);
    dv.setUint16(14, ((2026 - 1980) << 9) | (8 << 5) | 20, true);
    dv.setUint32(16, c.crc, true);
    dv.setUint32(20, c.compSize, true);
    dv.setUint32(24, c.uncompSize, true);
    dv.setUint16(28, c.nameBytes.length, true);
    // 30 extra len, 32 comment len, 34 disk, 36 int attrs: 0
    dv.setUint32(38, 0, true);                    // ext attrs
    dv.setUint32(42, c.offset, true);
    u8.set(c.nameBytes, 46);
    parts.push(u8);
    offset += 46 + c.nameBytes.length;
  }

  const [ev, eu8] = header(22);
  ev.setUint32(0, 0x06054b50, true);              // EOCD signature
  ev.setUint16(8, central.length, true);
  ev.setUint16(10, central.length, true);
  ev.setUint32(12, offset - cdStart, true);
  ev.setUint32(16, cdStart, true);
  parts.push(eu8);

  return new Blob(parts, { type: 'application/zip' });
}

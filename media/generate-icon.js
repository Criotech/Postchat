// Generates media/icon.png (128x128) without any npm dependencies.
// Run: node media/generate-icon.js
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const W = 128, H = 128;

// RGBA pixel buffer — initialised to fully transparent black
const pixels = Buffer.alloc(W * H * 4, 0);

// ─── Drawing helpers ────────────────────────────────────────────────────────

function setPixel(x, y, r, g, b, a = 255) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 4;
  // Simple alpha composite over existing pixel
  const srcA = a / 255;
  const dstA = pixels[i + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA === 0) return;
  pixels[i]     = Math.round((r * srcA + pixels[i]     * dstA * (1 - srcA)) / outA);
  pixels[i + 1] = Math.round((g * srcA + pixels[i + 1] * dstA * (1 - srcA)) / outA);
  pixels[i + 2] = Math.round((b * srcA + pixels[i + 2] * dstA * (1 - srcA)) / outA);
  pixels[i + 3] = Math.round(outA * 255);
}

// Filled circle (for anti-aliased rounded-rect corners)
function fillCircle(cx, cy, radius, r, g, b) {
  const r2 = radius * radius;
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
      const dx = x - cx, dy = y - cy;
      const dist2 = dx * dx + dy * dy;
      if (dist2 <= r2) {
        setPixel(x, y, r, g, b);
      }
    }
  }
}

function fillRoundedRect(x1, y1, x2, y2, rx, r, g, b) {
  // Fill interior rects
  fillRect(x1 + rx, y1, x2 - rx, y2, r, g, b);
  fillRect(x1, y1 + rx, x2, y2 - rx, r, g, b);
  // Four corners
  fillCircle(x1 + rx, y1 + rx, rx, r, g, b);
  fillCircle(x2 - rx, y1 + rx, rx, r, g, b);
  fillCircle(x1 + rx, y2 - rx, rx, r, g, b);
  fillCircle(x2 - rx, y2 - rx, rx, r, g, b);
}

function fillRect(x1, y1, x2, y2, r, g, b) {
  for (let y = y1; y <= y2; y++)
    for (let x = x1; x <= x2; x++)
      setPixel(x, y, r, g, b);
}

// Scanline polygon fill
function fillPolygon(points, r, g, b) {
  const ys = points.map(p => p[1]);
  const minY = Math.floor(Math.min(...ys));
  const maxY = Math.ceil(Math.max(...ys));

  for (let y = minY; y <= maxY; y++) {
    const xs = [];
    for (let i = 0; i < points.length; i++) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[(i + 1) % points.length];
      if ((y1 <= y && y < y2) || (y2 <= y && y < y1)) {
        xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let j = 0; j < xs.length - 1; j += 2) {
      for (let x = Math.round(xs[j]); x <= Math.round(xs[j + 1]); x++) {
        setPixel(x, y, r, g, b);
      }
    }
  }
}

// ─── Icon design ─────────────────────────────────────────────────────────────

// 1. Dark navy background with rounded corners (radius 22)
fillRoundedRect(0, 0, 127, 127, 22, 15, 23, 42);      // #0f172a

// 2. Chat bubble body — indigo #4f46e5 = (79, 70, 229)
fillRoundedRect(14, 20, 100, 74, 11, 79, 70, 229);

// 3. Chat bubble tail — triangle (bottom-left)
fillPolygon([[14, 70], [14, 95], [42, 70]], 79, 70, 229);

// 4. Lightning bolt — amber #fbbf24 = (251, 191, 36)
//    Classic Z-bolt shape, centred inside the bubble
fillPolygon([
  [64, 28],  // top-right
  [47, 52],  // bottom-left of upper wing
  [58, 52],  // inner-left
  [49, 72],  // bottom tip
  [69, 48],  // top-right of lower wing
  [58, 48],  // inner-right
], 251, 191, 36);

// ─── PNG writer ───────────────────────────────────────────────────────────────

function crc32(buf) {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  let c = 0xffffffff;
  for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf  = Buffer.allocUnsafe(4); lenBuf.writeUInt32BE(data.length);
  const crcBuf  = Buffer.allocUnsafe(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function writePNG(outPath) {
  // IHDR
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8]  = 8; // bit depth
  ihdr[9]  = 6; // RGBA
  ihdr[10] = ihdr[11] = ihdr[12] = 0;

  // Raw scanlines (filter byte 0 per row)
  const raw = Buffer.allocUnsafe(H * (1 + W * 4));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 4)] = 0;
    pixels.copy(raw, y * (1 + W * 4) + 1, y * W * 4, (y + 1) * W * 4);
  }

  const idat = zlib.deflateSync(raw, { level: 9 });

  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);

  fs.writeFileSync(outPath, png);
  console.log('Written:', outPath);
}

writePNG(path.join(__dirname, 'icon.png'));

// -----------------------------------------------------------------------------
// Generates cover.png (800×534, the store size): a ring on a night sky, the
// bars of a night's sleep stages and a heart rate line. No logo.
// Plain Node (zlib), no dependency.
// Run: npm run cover
// -----------------------------------------------------------------------------

import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const WIDTH = 800;
const HEIGHT = 534;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * Math.min(1, Math.max(0, t))));
const smooth = (edge, distance) => Math.min(1, Math.max(0, edge - distance + 0.5));

const NIGHT = [14, 16, 38];
const DUSK = [40, 34, 78];
const SILVER = [205, 210, 222];
const SHADOW = [120, 126, 146];
const DEEP = [70, 90, 200];
const REM = [130, 110, 230];
const LIGHT = [120, 170, 240];
const PULSE = [240, 110, 130];
const STAR = [230, 232, 250];

// The sleep stages: [x start, width, height, color], from the left.
const STAGES = [
  [60, 40, 60, LIGHT],
  [100, 50, 110, DEEP],
  [150, 30, 60, LIGHT],
  [180, 40, 85, REM],
  [220, 45, 110, DEEP],
  [265, 35, 60, LIGHT],
  [300, 45, 85, REM],
  [345, 30, 60, LIGHT],
  [375, 50, 85, REM],
  [425, 30, 60, LIGHT],
];
const BASE = 470;
const pulse = (x) =>
  250 + 18 * Math.sin(x / 23) + (Math.abs(x - 300) < 12 ? -60 * (1 - Math.abs(x - 300) / 12) : 0);
const STARS = Array.from({ length: 40 }, (_, i) => [(i * 197) % WIDTH, (i * 89) % 200]);
// The ring: a torus seen from the front, on the right.
const RING = [620, 230, 120, 34];

function pixel(x, y) {
  let color = mix(NIGHT, DUSK, y / HEIGHT);
  for (const [sx, sy] of STARS) {
    color = mix(color, STAR, smooth(1.6, Math.hypot(x - sx, y - sy)) * 0.8);
  }
  for (const [sx, w, h, c] of STAGES) {
    if (x >= sx + 2 && x < sx + w - 2 && y <= BASE && y >= BASE - h) {
      color = mix(color, c, 0.85);
    }
  }
  if (x >= 40 && x <= 470) {
    const dy = (pulse(x + 1) - pulse(x - 1)) / 2;
    const dist = Math.abs(y - pulse(x)) / Math.sqrt(1 + dy * dy);
    color = mix(color, PULSE, smooth(3, dist));
  }
  const [cx, cy, r, band] = RING;
  const d = Math.hypot(x - cx, y - cy);
  const inBand = Math.abs(d - r);
  if (inBand < band) {
    // Shaded from the top left: a metal band.
    const light = 0.5 + 0.5 * ((cx - x + (cy - y)) / (2 * r));
    const edge = inBand / band;
    color = mix(color, mix(SHADOW, SILVER, light * (1 - edge * edge)), smooth(band, inBand));
  }
  // The sensors inside the ring: three small bumps at the bottom.
  for (const angle of [1.35, 1.57, 1.79]) {
    const bx = cx + (r - band + 6) * Math.cos(angle);
    const by = cy + (r - band + 6) * Math.sin(angle);
    color = mix(color, SHADOW, smooth(7, Math.hypot(x - bx, y - by)));
  }
  return color;
}

const raw = Buffer.alloc((WIDTH * 3 + 1) * HEIGHT);
for (let y = 0; y < HEIGHT; y += 1) {
  const row = y * (WIDTH * 3 + 1);
  raw[row] = 0;
  for (let x = 0; x < WIDTH; x += 1) {
    const [r, g, b] = pixel(x, y);
    raw.set([r, g, b], row + 1 + x * 3);
  }
}

const header = Buffer.alloc(13);
header.writeUInt32BE(WIDTH, 0);
header.writeUInt32BE(HEIGHT, 4);
header[8] = 8; // bit depth
header[9] = 2; // RGB
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(new URL('../cover.png', import.meta.url), png);
console.log(`cover.png: ${WIDTH}×${HEIGHT}, ${png.length} bytes`);

/**
 * Hub icon generator
 * ------------------
 * Rasterises the Hub logo (a 2x2 grid of rounded squares, sourced from the
 * `hub_backup` branch) into PNG icons for the PWA manifest and iOS
 * apple-touch-icon. Dependency-free: it renders the simple geometry directly
 * and encodes PNG using Node's built-in `zlib`.
 *
 * Usage: node scripts/generate-icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(HERE, '..', 'public');

/* ------------------------------------------------------------------ */
/* PNG encoding                                                        */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter type: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }

  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ */
/* Logo geometry (512x512 design space, from hub_backup/icon.svg)      */
/* ------------------------------------------------------------------ */

const BACKGROUND = [246, 244, 239]; // #f6f4ef
const FOREGROUND = [61, 90, 122]; // #3d5a7a

const ICON_SQUARES = [
  { x: 132, y: 132, size: 104, radius: 26, opacity: 1 },
  { x: 276, y: 132, size: 104, radius: 26, opacity: 0.55 },
  { x: 132, y: 276, size: 104, radius: 26, opacity: 0.55 },
  { x: 276, y: 276, size: 104, radius: 26, opacity: 0.3 },
];

const MASKABLE_SQUARES = [
  { x: 164, y: 164, size: 84, radius: 21, opacity: 1 },
  { x: 264, y: 164, size: 84, radius: 21, opacity: 0.55 },
  { x: 164, y: 264, size: 84, radius: 21, opacity: 0.55 },
  { x: 264, y: 264, size: 84, radius: 21, opacity: 0.3 },
];

function insideRoundedRect(x, y, rx, ry, w, h, radius) {
  if (x < rx || x > rx + w || y < ry || y > ry + h) {
    return false;
  }
  if (radius <= 0) {
    return true;
  }
  const cx = Math.min(Math.max(x, rx + radius), rx + w - radius);
  const cy = Math.min(Math.max(y, ry + radius), ry + h - radius);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

/** Render the logo at `size` px. `maskable` uses a full-bleed background. */
function render(size, maskable) {
  const buffer = Buffer.alloc(size * size * 4);
  const scale = size / 512;
  const samples = 4; // 4x4 supersampling for antialiasing
  const backgroundRadius = maskable ? 0 : 112;
  const squares = maskable ? MASKABLE_SQUARES : ICON_SQUARES;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let accR = 0;
      let accG = 0;
      let accB = 0;
      let accA = 0;

      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const x = (px + (sx + 0.5) / samples) / scale;
          const y = (py + (sy + 0.5) / samples) / scale;

          let r = 0;
          let g = 0;
          let b = 0;
          let a = 0;

          if (insideRoundedRect(x, y, 0, 0, 512, 512, backgroundRadius)) {
            r = BACKGROUND[0];
            g = BACKGROUND[1];
            b = BACKGROUND[2];
            a = 1;
          }

          for (const square of squares) {
            if (insideRoundedRect(x, y, square.x, square.y, square.size, square.size, square.radius)) {
              const sa = square.opacity;
              r = FOREGROUND[0] * sa + r * (1 - sa);
              g = FOREGROUND[1] * sa + g * (1 - sa);
              b = FOREGROUND[2] * sa + b * (1 - sa);
              a = sa + a * (1 - sa);
            }
          }

          accR += r;
          accG += g;
          accB += b;
          accA += a;
        }
      }

      const total = samples * samples;
      const index = (py * size + px) * 4;
      // Colour channels are accumulated in 0-255 space; alpha is 0-1 and is
      // scaled to 0-255 on write.
      buffer[index] = Math.round(accR / total);
      buffer[index + 1] = Math.round(accG / total);
      buffer[index + 2] = Math.round(accB / total);
      buffer[index + 3] = Math.round((accA / total) * 255);
    }
  }

  return buffer;
}

/* ------------------------------------------------------------------ */
/* Emit                                                                */
/* ------------------------------------------------------------------ */

mkdirSync(PUBLIC_DIR, { recursive: true });

const targets = [
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'icon-maskable-512.png', size: 512, maskable: true },
  { file: 'apple-touch-icon.png', size: 180, maskable: false },
];

for (const target of targets) {
  const rgba = render(target.size, target.maskable);
  const png = encodePng(target.size, target.size, rgba);
  writeFileSync(resolve(PUBLIC_DIR, target.file), png);
  console.log(`wrote public/${target.file} (${target.size}x${target.size}, ${png.length} bytes)`);
}

// Generates a minimal 128x128 PNG icon for MeetVault using raw PNG binary encoding.
// No external dependencies — uses only Node.js built-ins.
// Colors match the gemini-svg.svg palette: emerald/cyan/violet on dark slate.

import { createWriteStream } from 'fs';
import { createDeflate } from 'zlib';

const SIZE = 128;
const SCALE = SIZE;

// Raw RGBA pixel buffer
const pixels = new Uint8Array(SCALE * SCALE * 4);

function setPixel(x, y, r, g, b, a = 255) {
  if (x < 0 || x >= SCALE || y < 0 || y >= SCALE) return;
  const idx = (y * SCALE + x) * 4;
  pixels[idx] = r;
  pixels[idx + 1] = g;
  pixels[idx + 2] = b;
  pixels[idx + 3] = a;
}

function fillCircle(cx, cy, radius, r, g, b, a = 255) {
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (dist <= radius) {
        setPixel(x, y, r, g, b, a);
      }
    }
  }
}

function fillRect(x1, y1, w, h, r, g, b, a = 255) {
  for (let y = y1; y < y1 + h; y++) {
    for (let x = x1; x < x1 + w; x++) {
      setPixel(x, y, r, g, b, a);
    }
  }
}

function roundedRect(x1, y1, w, h, radius, r, g, b, a = 255) {
  // Fill body
  fillRect(x1 + radius, y1, w - radius * 2, h, r, g, b, a);
  fillRect(x1, y1 + radius, w, h - radius * 2, r, g, b, a);
  // Corners
  fillCircle(x1 + radius, y1 + radius, radius, r, g, b, a);
  fillCircle(x1 + w - radius - 1, y1 + radius, radius, r, g, b, a);
  fillCircle(x1 + radius, y1 + h - radius - 1, radius, r, g, b, a);
  fillCircle(x1 + w - radius - 1, y1 + h - radius - 1, radius, r, g, b, a);
}

// Background: dark slate #1E2433
roundedRect(4, 4, 120, 120, 24, 30, 36, 51, 255);

// Inner shield shape (simplified): semi-transparent emerald fill
fillRect(32, 24, 64, 68, 16, 185, 129, 20);  // emerald tint
fillRect(34, 26, 60, 64, 15, 23, 42, 220);   // dark overlay

// Three waveform bars (emerald, cyan, violet) matching the SVG
// Bar 1: emerald #10B981
fillRect(47, 54, 7, 20, 16, 185, 129, 255);
// Bar 2: cyan #06B6D4 (tallest)
fillRect(60, 44, 7, 40, 6, 182, 212, 255);
// Bar 3: violet #8B5CF6
fillRect(73, 52, 7, 24, 139, 92, 246, 255);

// Aurora border ring: gradient approximation
for (let i = 0; i < 360; i++) {
  const rad = (i * Math.PI) / 180;
  const t = i / 360;
  // Interpolate emerald -> cyan -> violet around the ring
  let r, g, b;
  if (t < 0.5) {
    const u = t / 0.5;
    r = Math.round(16 + (6 - 16) * u);
    g = Math.round(185 + (182 - 185) * u);
    b = Math.round(129 + (212 - 129) * u);
  } else {
    const u = (t - 0.5) / 0.5;
    r = Math.round(6 + (139 - 6) * u);
    g = Math.round(182 + (92 - 182) * u);
    b = Math.round(212 + (246 - 212) * u);
  }
  for (let thick = 0; thick < 4; thick++) {
    const px = Math.round(64 + (58 + thick) * Math.cos(rad));
    const py = Math.round(64 + (58 + thick) * Math.sin(rad));
    setPixel(px, py, r, g, b, 255);
  }
}

// CRC32 table
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (const b of buf) {
    crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const len = u32(data.length);
  const crc = u32(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([len, typeBytes, data, crc]);
}

// PNG signature
const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// IHDR
const ihdr = chunk('IHDR', Buffer.concat([
  u32(SCALE), u32(SCALE),
  Buffer.from([8, 2, 0, 0, 0]) // 8-bit depth, RGB truecolor (we'll embed alpha via RGBA manually below)
]));

// Actually rebuild IHDR for RGBA (colorType=6)
const ihdrRGBA = chunk('IHDR', Buffer.concat([
  u32(SCALE), u32(SCALE),
  Buffer.from([8, 6, 0, 0, 0]) // 8-bit RGBA
]));

// IDAT: build raw scanlines (filter byte 0 per row)
const rawRows = [];
for (let y = 0; y < SCALE; y++) {
  rawRows.push(0); // filter type None
  for (let x = 0; x < SCALE; x++) {
    const idx = (y * SCALE + x) * 4;
    rawRows.push(pixels[idx], pixels[idx + 1], pixels[idx + 2], pixels[idx + 3]);
  }
}
const rawBuf = Buffer.from(rawRows);

import { promisify } from 'util';
import { deflate } from 'zlib';
const deflateAsync = promisify(deflate);

const compressed = await deflateAsync(rawBuf, { level: 9 });
const idat = chunk('IDAT', compressed);
const iend = chunk('IEND', Buffer.alloc(0));

const pngBuf = Buffer.concat([sig, ihdrRGBA, idat, iend]);

// Write all icon sizes by scaling (simple nearest-neighbor for 16/48/128)
async function writeIcon(size, path) {
  if (size === 128) {
    await import('fs').then(({ writeFile, promisify: p }) => {
      const write = p ? p(writeFile) : (fp, data) => new Promise((res, rej) => writeFile(fp, data, e => e ? rej(e) : res()));
      return write(path, pngBuf);
    });
    return;
  }
  // Downsample the 128x128 buffer to target size
  const out = new Uint8Array(size * size * 4);
  const ratio = SCALE / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = Math.floor(x * ratio);
      const sy = Math.floor(y * ratio);
      const srcIdx = (sy * SCALE + sx) * 4;
      const dstIdx = (y * size + x) * 4;
      out[dstIdx] = pixels[srcIdx];
      out[dstIdx + 1] = pixels[srcIdx + 1];
      out[dstIdx + 2] = pixels[srcIdx + 2];
      out[dstIdx + 3] = pixels[srcIdx + 3];
    }
  }
  const rows = [];
  for (let y = 0; y < size; y++) {
    rows.push(0);
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      rows.push(out[idx], out[idx + 1], out[idx + 2], out[idx + 3]);
    }
  }
  const comp = await deflateAsync(Buffer.from(rows), { level: 9 });
  const ihdrSmall = chunk('IHDR', Buffer.concat([u32(size), u32(size), Buffer.from([8, 6, 0, 0, 0])]));
  const idatSmall = chunk('IDAT', comp);
  const pngSmall = Buffer.concat([sig, ihdrSmall, idatSmall, iend]);
  const { writeFile } = await import('fs');
  await new Promise((res, rej) => writeFile(path, pngSmall, e => e ? rej(e) : res()));
}

await writeIcon(128, 'icons/icon128.png');
await writeIcon(48, 'icons/icon48.png');
await writeIcon(32, 'icons/icon32.png');
await writeIcon(16, 'icons/icon16.png');

console.log('Icons generated: icons/icon16.png, icons/icon32.png, icons/icon48.png, icons/icon128.png');

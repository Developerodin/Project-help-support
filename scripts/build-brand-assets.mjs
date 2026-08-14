/**
 * One vector source, two raster outputs.
 *
 * frontend/app/icon.svg is the master mark. Mail clients cannot render SVG, so
 * the mark ships to mail as a PNG attached by content id; the same PNG is
 * copied into frontend/public so the /dev/emails preview can resolve that cid.
 *
 * Run after editing the SVG:  node scripts/build-brand-assets.mjs
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'frontend/app/icon.svg');

// 128px renders crisply at the 32px the mail header displays it at.
const OUTPUTS = [
  { path: 'shared/email/assets/dharwin-mark.png', size: 128 },
  { path: 'frontend/public/dharwin-mark.png', size: 128 },
];

const svg = await readFile(source);

for (const { path, size } of OUTPUTS) {
  const target = resolve(root, path);
  await mkdir(dirname(target), { recursive: true });
  const png = await sharp(svg, { density: 512 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(target, png);
  console.log(`${path}  ${size}x${size}  ${png.length} bytes`);
}

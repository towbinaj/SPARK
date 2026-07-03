#!/usr/bin/env node
/**
 * Regenerates the raster app icons from assets/favicon.svg.
 * One-off build tool — sharp is NOT a project dependency; install it first:
 *
 *   npm i -D sharp && node scripts/build-icons.js
 *
 * Browser tab PNGs keep the rounded tile; Apple/PWA icons use a full square
 * (iOS/Android apply their own rounding/masking to a full-bleed image).
 */
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const assets = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");
const rounded = readFileSync(join(assets, "favicon.svg"), "utf8");
const square = rounded.replace('rx="14"', 'rx="0"');

const render = async (svg, size, name) => {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(join(assets, name));
  console.log(`→ wrote assets/${name} (${size}px)`);
};

await render(rounded, 16, "favicon-16.png");
await render(rounded, 32, "favicon-32.png");
await render(square, 180, "apple-touch-icon.png");
await render(square, 192, "icon-192.png");
await render(square, 512, "icon-512.png");

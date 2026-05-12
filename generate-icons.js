#!/usr/bin/env node
/**
 * generate-icons.js
 * Run: node generate-icons.js
 * Requires: npm install sharp
 *
 * Generates all required PWA icon sizes from the base SVG.
 * Run this once before deploying, then commit the /icons/ folder.
 */

const sharp = require('sharp');
const fs    = require('fs');
const path  = require('path');

const SIZES = [72, 96, 128, 144, 152, 192, 384, 512];
const OUT   = path.join(__dirname, 'icons');

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

// Base SVG icon — waveform on purple background
const svgIcon = (size) => `
<svg width="${size}" height="${size}" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" rx="${Math.round(size * 0.22)}" fill="#6c63ff"/>
  <rect x="80"  y="196" width="48" height="120" rx="24" fill="white" opacity="0.9"/>
  <rect x="152" y="156" width="48" height="200" rx="24" fill="white"/>
  <rect x="224" y="116" width="48" height="280" rx="24" fill="white"/>
  <rect x="296" y="156" width="48" height="200" rx="24" fill="white"/>
  <rect x="368" y="196" width="48" height="120" rx="24" fill="white" opacity="0.9"/>
</svg>`;

async function generateIcons() {
  console.log('Generating PWA icons...\n');

  for (const size of SIZES) {
    const svg  = Buffer.from(svgIcon(size));
    const file = path.join(OUT, `icon-${size}.png`);
    await sharp(svg).resize(size, size).png().toFile(file);
    console.log(`  ✓ icon-${size}.png`);
  }

  // Generate placeholder screenshots (solid color with text)
  const mobileScreenshot = `
<svg width="390" height="844" xmlns="http://www.w3.org/2000/svg">
  <rect width="390" height="844" fill="#0a0a0f"/>
  <rect x="20" y="60" width="60" height="60" rx="14" fill="#6c63ff"/>
  <rect x="90" y="75" width="120" height="16" rx="8" fill="#f0f0f8"/>
  <rect x="90" y="100" width="80" height="10" rx="5" fill="#9090a8"/>
  <rect x="20" y="160" width="350" height="200" rx="16" fill="#1a1a24"/>
  <rect x="40" y="185" width="60" height="10" rx="5" fill="#6c63ff"/>
  <rect x="40" y="210" width="250" height="28" rx="6" fill="#f0f0f8"/>
  <rect x="40" y="250" width="200" height="16" rx="5" fill="#9090a8"/>
  <rect x="40" y="310" width="130" height="36" rx="18" fill="#6c63ff"/>
</svg>`;

  await sharp(Buffer.from(mobileScreenshot)).resize(390, 844).png()
    .toFile(path.join(OUT, 'screenshot-mobile.png'));
  console.log('  ✓ screenshot-mobile.png');

  const desktopScreenshot = `
<svg width="1280" height="720" xmlns="http://www.w3.org/2000/svg">
  <rect width="1280" height="720" fill="#0a0a0f"/>
  <rect width="240" height="720" fill="#111118"/>
  <rect x="20" y="20" width="200" height="60" rx="10" fill="#1a1a24"/>
  <rect x="260" y="40" width="980" height="360" rx="24" fill="#1a1a24"/>
  <rect x="290" y="80" width="200" height="16" rx="8" fill="#6c63ff"/>
  <rect x="290" y="115" width="500" height="48" rx="6" fill="#f0f0f8" opacity="0.9"/>
  <rect x="290" y="180" width="400" height="20" rx="5" fill="#9090a8"/>
  <rect x="290" y="260" width="160" height="44" rx="22" fill="#6c63ff"/>
</svg>`;

  await sharp(Buffer.from(desktopScreenshot)).resize(1280, 720).png()
    .toFile(path.join(OUT, 'screenshot-desktop.png'));
  console.log('  ✓ screenshot-desktop.png');

  console.log('\nAll icons generated in /icons/');
  console.log('Commit the /icons/ folder before deploying.');
}

generateIcons().catch(err => {
  console.error('Error generating icons:', err.message);
  console.log('\nIf sharp is not installed, run: npm install sharp');
  process.exit(1);
});

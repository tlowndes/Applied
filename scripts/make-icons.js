'use strict';

// Renders assets/icon.svg (and icon-small.svg for tiny sizes) to the PNG and ICO files
// the app and installer use. Needs Playwright with Chromium: `npx playwright` or a global
// install. Only needed when the logo changes; the generated files are committed.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ASSETS = path.join(__dirname, '..', 'assets');
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const SMALL_UNDER = 32;

async function render(page, svgFile, size) {
  const svg = fs.readFileSync(path.join(ASSETS, svgFile), 'utf8');
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

// An .ico is a small header, one directory entry per size, then each image as a PNG.
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + images.length * 16;
  for (const { size, png } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const images = [];
  for (const size of ICO_SIZES) {
    images.push({ size, png: await render(page, size < SMALL_UNDER ? 'icon-small.svg' : 'icon.svg', size) });
  }
  fs.writeFileSync(path.join(ASSETS, 'icon.ico'), buildIco(images));
  fs.writeFileSync(path.join(ASSETS, 'icon.png'), await render(page, 'icon.svg', 512));
  fs.writeFileSync(path.join(ASSETS, 'tray.png'), await render(page, 'icon-small.svg', 16));
  fs.writeFileSync(path.join(ASSETS, 'tray@2x.png'), await render(page, 'icon-small.svg', 32));
  await browser.close();
  console.log('Icons written to assets/');
})();

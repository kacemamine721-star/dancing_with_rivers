// Renders an SVG to PNG with Playwright (transparent background). usage: node render-svg.mjs file.svg outPrefix W[xH] ...
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const [svgPath, out, ...sizes] = process.argv.slice(2);
const svg = readFileSync(svgPath, 'utf8');
const b = await chromium.launch();
const p = await b.newPage();
for (const spec of sizes) {
  const [w, h = w] = spec.split('x').map(Number);
  await p.setViewportSize({ width: w, height: h });
  await p.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${w}" height="${h}" `)}</body></html>`);
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(150);
  await p.screenshot({ path: `${out}-${spec}.png`, omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
}
await b.close();

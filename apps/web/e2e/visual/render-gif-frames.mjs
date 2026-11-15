// Frames for the animated logo: the waves flow by one wavelength (36 units) over N frames.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const [svgPath, outDir, size = '256', n = '24', bg = '#F4F0E6'] = process.argv.slice(2);
let svg = readFileSync(svgPath, 'utf8');
// longer wave paths inside a clip so shifting them loops seamlessly
svg = svg
  .replace('M15 100 q9 -6 18 0 t18 0 t18 0 t18 0 t18 0', 'M-21 100 q9 -6 18 0 t18 0 t18 0 t18 0 t18 0 t18 0 t18 0 t18 0')
  .replace('M33 111 q9 -6 18 0 t18 0 t18 0', 'M-3 111 q9 -6 18 0 t18 0 t18 0 t18 0 t18 0')
  .replace('<g fill="none" stroke="#1A22B4" stroke-width="5.5" stroke-linecap="round">',
    '<linearGradient id="wfade" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".12" stop-color="#fff"/><stop offset=".88" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>' +
    '<mask id="wmask" maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="120"><rect x="10" y="88" width="100" height="16" fill="url(#wfade)"/><rect x="28" y="102" width="64" height="16" fill="url(#wfade)"/></mask>' +
    '<g mask="url(#wmask)"><g id="waves" fill="none" stroke="#1A22B4" stroke-width="5.5" stroke-linecap="round">')
  .replace('</svg>', '</g></svg>');
const s = Number(size);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: s, height: s } });
await p.setContent(`<html><body style="margin:0;background:${bg}">${svg.replace('<svg ', `<svg width="${s}" height="${s}" `)}</body></html>`);
for (let i = 0; i < Number(n); i++) {
  await p.evaluate((dx) => document.getElementById('waves').setAttribute('transform', `translate(${dx} 0)`), (36 * i) / Number(n));
  await p.screenshot({ path: `${outDir}/f${String(i).padStart(2, '0')}.png` });
}
await b.close();

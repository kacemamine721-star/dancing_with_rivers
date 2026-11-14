// ad-hoc: long frames around the dive (node e2e/visual/frames.mjs)
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:4173/?intro=1');
await page.waitForSelector('.ix-start.pop', { timeout: 60000 });
await page.waitForTimeout(1500);
const r = await page.evaluate(() => new Promise((done) => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Start the mission'));
  const t0 = performance.now(); let last = t0; const long = [];
  btn.click();
  const tick = (now) => { if (now - last > 40) long.push([Math.round(last - t0), Math.round(now - last), location.pathname]); last = now;
    if (now - t0 < 6000) requestAnimationFrame(tick); else done(long); };
  requestAnimationFrame(tick);
}));
console.log(JSON.stringify(r));
await browser.close();

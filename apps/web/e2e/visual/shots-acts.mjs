// Screenshot every act + pages at desktop and phone sizes (dev aid; not part of CI).
// usage: node e2e/visual/shots-acts.mjs [baseUrl] [outDir] [paths...]
import { chromium } from '@playwright/test';
const base = process.argv[2] ?? 'http://localhost:4174';
const out = process.argv[3] ?? '../../.playwright-mcp/v1';
const only = process.argv.slice(4);
const paths = only.length ? only : [...Array.from({ length: 9 }, (_, i) => `/story/${i + 1}`), '/watch', '/methods', '/sources', '/v2'];
const sizes = [ { w: 1440, h: 900, tag: 'd' }, { w: 390, h: 844, tag: 'm' } ];
const exe = process.env.PW_CHROME ?? 'C:/Users/Dell/AppData/Local/ms-playwright/chromium-1254/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=d3d11', '--enable-gpu'] });
for (const s of sizes) {
  const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  for (const p of paths) {
    await page.goto(base + p, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(p.startsWith('/story') ? 9000 : 2500);
    const name = `${out}/${s.tag}-${p.replace(/\//g, '_').replace(/^_/, '')}.png`;
    await page.screenshot({ path: name, fullPage: !p.startsWith('/story') });
    console.log(name);
  }
  await ctx.close();
}
await browser.close();

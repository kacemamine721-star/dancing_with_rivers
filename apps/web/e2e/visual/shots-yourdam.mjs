// Dev aid: screenshots of /v2 while the demonstration autoplays. usage: node shots-yourdam.mjs base out dam [w h]
import { chromium } from '@playwright/test';
const [base = 'http://localhost:4175', out = '.', dam = 'mellegue', w = '1440', h = '900'] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: +w, height: +h } })).newPage();
const errs = [];
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await page.goto(`${base}/v2?dam=${dam}`, { waitUntil: 'networkidle' });
const stage = page.locator('section[aria-label="Pipeline demonstration"]');
await stage.scrollIntoViewIfNeeded();
await page.waitForTimeout(2500);
const buttons = stage.locator('ol[aria-label="Steps"] button');
for (let i = 1; i <= 8; i++) {
  await buttons.nth(i - 1).click();
  await page.waitForTimeout(i === 6 ? 3800 : 2600);
  await stage.screenshot({ path: `${out}/yd-${dam}-${w}-${i}.png` });
}
await page.screenshot({ path: `${out}/yd-${dam}-${w}-page.png`, fullPage: true });
console.log('errors:', errs.length ? errs : 'none');
await browser.close();

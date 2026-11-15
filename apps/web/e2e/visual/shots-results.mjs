// Dev aid: the results panel of processed dams on /your-dam. usage: node shots-results.mjs base out id...
import { chromium } from '@playwright/test';
const [base, out, ...ids] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errs = [];
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
page.on('requestfailed', (r) => errs.push(`failed ${r.url()}`));
for (const id of ids) {
  await page.goto(`${base}/your-dam?dam=${id}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);
  const sec = page.locator('section[aria-label="Pipeline demonstration"]');
  await sec.screenshot({ path: `${out}/res-${id}.png` });
}
console.log('errors:', errs.length ? errs : 'none');
await browser.close();

// Captures the map of real results for the V2 page previews. usage: node shots-previews.mjs base outDir
import { chromium } from '@playwright/test';
const [base, out] = process.argv.slice(2);
const shots = [
  ['mellegue', 9, 'mellegue-anuga'],
  ['sidi-salem', 3, 'sidi-salem-radar'],
  ['el-aroussia', 9, 'el-aroussia-anuga'],
  ['ouldjet-mellegue', 8, 'ouldjet-mellegue-hand'],
];
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage();
for (const [dam, step, name] of shots) {
  await page.goto(`${base}/your-dam?dam=${dam}`, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: '[data-testid=topbar]{display:none!important}' });
  await page.waitForTimeout(2500);
  const sec = page.locator('section[aria-label="Pipeline demonstration"]');
  await sec.locator('ol[aria-label="Process"] button').nth(step - 1).click();
  await page.waitForTimeout(step === 3 ? 5200 : 4600);
  await sec.locator('svg[role="img"]').first().screenshot({ path: `${out}/${name}.png` });
  console.log(name);
}
await browser.close();

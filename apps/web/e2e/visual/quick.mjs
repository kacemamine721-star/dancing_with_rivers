// ad-hoc: node e2e/visual/quick.mjs <path> <out.png> [waitMs]
import { chromium } from '@playwright/test';
const [, , path, out, wait = '6000'] = process.argv;
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('console', m.type(), m.text().slice(0, 300)); });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:4173' + path);
await page.waitForTimeout(Number(wait));
await page.screenshot({ path: out });
await browser.close();

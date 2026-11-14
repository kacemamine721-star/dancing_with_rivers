/**
 * Visual parity + dive timing (not part of CI). Run against a running preview:
 *   pnpm build && pnpm preview --port 4173      (other terminal)
 *   node e2e/visual/parity.mjs
 * Output: e2e/visual/out/*.png (gitignored) + a JSON summary on stdout.
 *
 * Reference: reference/NISAR-HydroStress-Cinematic-Intro.html (three r128 from cdnjs), patched in a
 * COPY so its frame loop runs at a fixed 1/60 s per frame and freezes at a target elapsed time.
 * App: `/?t=<s>` and `/?dive=<s>` replay the same fixed-step history and freeze. Same 1440×900.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, 'out');
mkdirSync(out, { recursive: true });
const BASE = process.env.APP_URL ?? 'http://localhost:4173';
const VIEW = { width: 1440, height: 900 };
const INTRO_T = [0.5, 3.4, 6.8, 9.2, 11.5];
const DIVE_T = [1.0, 2.0, 2.8];
/** ONLY=parity,acts,dive (comma list) runs a subset. */
const ONLY = new Set((process.env.ONLY ?? 'parity,acts,dive').split(','));

// ---- patched reference copy
const refSrc = readFileSync(resolve(here, '../../../../reference/NISAR-HydroStress-Cinematic-Intro.html'), 'utf8');
const DT = 'const dt=Math.min((now-last)/1000,.05);last=now;';
if (!refSrc.includes(DT)) throw new Error('reference frame loop not found');
const patched = refSrc
  .replace(
    DT,
    'const dt=(window.__dt!=null?window.__dt:Math.min((now-last)/1000,.05));last=now;window.__el=(window.__el||0)+dt;' +
      'if(window.__stopAt!=null&&window.__el>=window.__stopAt-1e-9){window.__dt=0;window.__stopped=true;}',
  )
  .replace('</style>', '#loader{display:none!important}</style>');
const refFile = resolve(out, 'reference.patched.html');
writeFileSync(refFile, patched);

const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const summary = { parity: [], dive: null, errors: [] };

async function refShot(stopAt, file, dive) {
  const page = await browser.newPage({ viewport: VIEW });
  await page.addInitScript((s) => {
    window.__dt = 1 / 60;
    window.__stopAt = s;
  }, dive ? 11.2 + 0.5 : stopAt);
  await page.goto(pathToFileURL(refFile).href);
  await page.waitForFunction(() => window.__stopped === true, null, { timeout: 120_000 });
  if (dive) {
    await page.evaluate((td) => {
      window.__stopped = false;
      window.__stopAt = window.__el + td;
      document.querySelector('#startBtn').click();
      window.__dt = 1 / 60;
    }, stopAt);
    await page.waitForFunction(() => window.__stopped === true, null, { timeout: 60_000 });
  }
  await page.waitForTimeout(1500); // CSS transitions + caption scramble settle
  await page.screenshot({ path: file });
  await page.close();
}

async function appShot(query, file) {
  const page = await browser.newPage({ viewport: VIEW });
  page.on('pageerror', (e) => summary.errors.push(`${query}: ${e.message}`));
  await page.goto(`${BASE}/${query}`);
  await page.waitForSelector('.ix-loader.off', { timeout: 60_000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: file });
  await page.close();
}

async function sideBySide(a, b, label, file) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 470 } });
  const img = (p) => `data:image/png;base64,${readFileSync(p).toString('base64')}`;
  await page.setContent(`<body style="margin:0;background:#111;color:#9aa7bd;font:12px monospace">
    <div style="display:flex;gap:0"><figure style="margin:0;width:720px"><img src="${img(a)}" style="width:720px"><figcaption>reference r128 · ${label}</figcaption></figure>
    <figure style="margin:0;width:720px"><img src="${img(b)}" style="width:720px"><figcaption>app r187 · ${label}</figcaption></figure></div></body>`);
  await page.waitForTimeout(200);
  await page.screenshot({ path: file });
  await page.close();
}

if (ONLY.has('parity')) for (const t of INTRO_T) {
  const r = resolve(out, `ref_t${t}.png`);
  const a = resolve(out, `app_t${t}.png`);
  await refShot(t, r, false);
  await appShot(`?t=${t}`, a);
  await sideBySide(r, a, `t=${t}s`, resolve(out, `parity_t${t}.png`));
  summary.parity.push(`parity_t${t}.png`);
}
if (ONLY.has('parity')) for (const td of DIVE_T) {
  const r = resolve(out, `ref_dive${td}.png`);
  const a = resolve(out, `app_dive${td}.png`);
  await refShot(td, r, true);
  await appShot(`?dive=${td}`, a);
  await sideBySide(r, a, `dive ${td}s`, resolve(out, `parity_dive${td}.png`));
  summary.parity.push(`parity_dive${td}.png`);
}

// ---- Act screenshots
if (ONLY.has('acts')) for (const [path, file, wait] of [
  ['/story/1', 'story1_arrival.png', 700],
  ['/story/1', 'story1_damclose.png', 10_000],
  ['/story/3', 'story3_laketop.png', 6000],
]) {
  const page = await browser.newPage({ viewport: VIEW });
  page.on('pageerror', (e) => summary.errors.push(`${path}: ${e.message}`));
  await page.goto(`${BASE}${path}`);
  await page.waitForSelector('canvas', { timeout: 30_000 });
  await page.waitForTimeout(wait);
  await page.screenshot({ path: resolve(out, file) });
  await page.close();
}

// ---- dive timing: click "Start the mission" → Act 1 visible, no blank frames
if (ONLY.has('dive')) {
  const page = await browser.newPage({ viewport: VIEW });
  page.on('pageerror', (e) => summary.errors.push(`dive: ${e.message}`));
  await page.goto(`${BASE}/?intro=1`);
  await page.waitForSelector('.ix-start.pop', { timeout: 60_000 });
  await page.waitForTimeout(800);
  // 1) timing measured in-page (rAF, no screenshot stalls)
  const timing = await page.evaluate(
    () =>
      new Promise((done) => {
        const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Start the mission'));
        const flashEl = () => [...document.body.children].find((el) => el.style && el.style.zIndex === '60');
        const t0 = performance.now();
        let worst = 0;
        let last = t0;
        let visible = null;
        btn.click();
        const tick = (now) => {
          worst = Math.max(worst, now - last);
          last = now;
          const f = Number(flashEl()?.style.opacity || 0);
          if (visible === null && location.pathname === '/story/1' && f < 0.5) visible = now - t0;
          if (visible !== null || now - t0 > 8000) done({ actVisibleMs: visible && Math.round(visible), worstFrameMs: Math.round(worst) });
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
  // 2) replay with screenshots for blank-frame detection
  await page.goto(`${BASE}/?intro=1`);
  await page.waitForSelector('.ix-start.pop', { timeout: 60_000 });
  await page.waitForTimeout(800);
  const frames = [];
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Start the mission →' }).click();
  let actVisibleMs = null;
  while (Date.now() - t0 < 6000) {
    const buf = await page.screenshot({ type: 'jpeg', quality: 60 });
    const ms = Date.now() - t0;
    const state = await page.evaluate(() => {
      const flash = [...document.body.children].find((el) => el.style && el.style.zIndex === '60');
      return { path: location.pathname, flash: flash ? Number(flash.style.opacity || 0) : 0 };
    });
    frames.push({ ms, buf, ...state });
    if (actVisibleMs === null && state.path === '/story/1' && state.flash < 0.5) actVisibleMs = ms;
    if (actVisibleMs !== null && ms - actVisibleMs > 1200) break;
  }
  // luminance stats per frame (in-browser decode)
  const stats = await page.evaluate(async (list) => {
    const res = [];
    for (const b64 of list) {
      const img = new Image();
      img.src = `data:image/jpeg;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = 160;
      c.height = 100;
      const x = c.getContext('2d');
      x.drawImage(img, 0, 0, 160, 100);
      const d = x.getImageData(0, 0, 160, 100).data;
      let s = 0;
      let s2 = 0;
      for (let i = 0; i < d.length; i += 4) {
        const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        s += l;
        s2 += l * l;
      }
      const n = d.length / 4;
      const mean = s / n;
      res.push({ mean: Math.round(mean), std: Math.round(Math.sqrt(Math.max(0, s2 / n - mean * mean))) });
    }
    return res;
  }, frames.map((f) => f.buf.toString('base64')));
  const rows = frames.map((f, i) => ({ ms: f.ms, path: f.path, flash: Number(f.flash.toFixed(2)), ...stats[i] }));
  const blank = rows.filter((r) => r.mean < 6 && r.std < 4);
  frames.forEach((f, i) => {
    if (i % 3 === 0) writeFileSync(resolve(out, `dive_frame_${String(f.ms).padStart(4, '0')}.jpg`), f.buf);
  });
  summary.dive = { timing, actVisibleMsWithScreenshots: actVisibleMs, frames: rows.length, blankFrames: blank.length, rows };
  await page.close();
}

await browser.close();
writeFileSync(resolve(out, 'summary.json'), JSON.stringify(summary, null, 1));
console.log(JSON.stringify({ errors: summary.errors, timing: summary.dive?.timing, actVisibleMsWithScreenshots: summary.dive?.actVisibleMsWithScreenshots, blankFrames: summary.dive?.blankFrames, frames: summary.dive?.frames }, null, 1));

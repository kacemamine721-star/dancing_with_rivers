import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const isIgnorableConsole = (text: string) => {
  // Ignore headless WebGL / SwiftShader software-rendering notices on GPU-less CI
  return /swiftshader|angle|gl_vendor|context lost|webgl: error/i.test(text);
};

test('deep link /story/1 renders the shell with no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!isIgnorableConsole(text)) errors.push(text);
    }
  });
  page.on('pageerror', (err) => {
    if (!isIgnorableConsole(err.message)) errors.push(err.message);
  });
  page.on('requestfailed', (req) => errors.push(`request failed: ${req.url()}`));

  await page.goto('/story/1');

  const topbar = page.getByTestId('topbar');
  await expect(topbar).toBeVisible();
  await expect(topbar.getByRole('link', { name: /home/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /act 1/i })).toBeVisible();
  // the layer catalogue loads through the DataSource and is shown with its badge
  await expect(page.getByRole('button', { name: /show source and method/i }).first()).toBeVisible();

  const axe = await new AxeBuilder({ page }).analyze();
  const serious = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

  expect(errors).toEqual([]);
});

test('intro: debug seek reaches the hero, Esc skips to Act 1', async ({ page }) => {
  test.slow();
  const errors: string[] = [];
  page.on('pageerror', (err) => {
    if (!isIgnorableConsole(err.message)) errors.push(err.message);
  });

  await page.goto('/?t=11.5');
  const timeout = process.env.CI ? 60_000 : 30_000;
  await expect(page.getByRole('button', { name: 'Start the mission →' })).toBeVisible({ timeout });
  await expect(page.getByRole('button', { name: 'Explore the satellite' })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/story\/1$/);
  await expect(page.getByTestId('topbar')).toBeVisible();
  expect(errors).toEqual([]);
});

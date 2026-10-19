import { expect, test } from '@playwright/test';
import { BINANCE, blockMarketData, openAccount } from './helpers';

test.beforeEach(async ({ page }) => {
  await blockMarketData(page);
});

test('ships an installable manifest with complete branding', async ({ page, request }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const res = await request.get(href!);
  expect(res.ok()).toBe(true);
  const m = await res.json();
  expect(m.name).toBe('Kata — Paper Trading');
  expect(m.short_name).toBe('Kata');
  expect(m.display).toBe('standalone');
  expect(m.start_url).toContain('/');
  expect(m.theme_color).toBe('#0C0E11');
  const sizes = m.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes}:${i.purpose}`);
  expect(sizes).toEqual(expect.arrayContaining(['192x192:any', '512x512:any', '512x512:maskable']));
  for (const icon of [...m.icons, ...m.screenshots, ...m.shortcuts.flatMap((s: { icons: unknown[] }) => s.icons)]) {
    const r = await request.get(icon.src);
    expect(r.ok(), icon.src).toBe(true);
    expect(r.headers()['content-type']).toContain('image/png');
  }
  for (const sel of ['link[rel="apple-touch-icon"]', 'link[rel="icon"][type="image/svg+xml"]']) {
    const h = await page.locator(sel).first().getAttribute('href');
    expect((await request.get(h!)).ok()).toBe(true);
  }
  const launch = page.locator('link[rel="apple-touch-startup-image"]');
  expect(await launch.count()).toBeGreaterThan(20);
  expect((await request.get((await launch.first().getAttribute('href'))!)).ok()).toBe(true);
});

test('shows the branded launch screen, then hands over to the app', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#splash .sp-mark')).toBeAttached();
  await expect(page.locator('#splash-step')).not.toBeEmpty();
  await expect(page.getByRole('heading', { name: 'Rehearse every trade.' })).toBeVisible();
  await expect(page.locator('#splash')).toHaveCount(0, { timeout: 5_000 });
});

test('service worker takes over and the app opens offline', async ({ page, context }) => {
  await openAccount(page);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('hdr-equity')).toHaveText('100,000.00');
  // Real markets go dark offline; simulated instruments keep working and are labelled as such.
  await expect(page.getByTestId('feed-status')).toContainText(/No data|Connecting/);
  await expect(page.locator('.ch').getByText('Simulated')).toBeVisible();
  await context.setOffline(false);
});

test('only one window runs the engine', async ({ page, context }) => {
  await openAccount(page);
  const second = await context.newPage();
  await second.route(BINANCE, (r) => r.abort());
  await second.goto('/');
  await expect(second.getByRole('heading', { name: 'Kata is open in another window' })).toBeVisible();
  await second.getByRole('button', { name: 'Use Kata here' }).click();
  await expect(second.getByTestId('hdr-equity')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Kata is open in another window' })).toBeVisible();
});

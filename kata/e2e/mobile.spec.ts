import { expect, test } from '@playwright/test';
import { blockMarketData, openAccount } from './helpers';

test.beforeEach(async ({ page }) => {
  await blockMarketData(page);
});

test('mobile: trade from the bottom sheet and review positions', async ({ page }) => {
  await openAccount(page);
  await expect(page.getByTestId('chart')).toBeVisible();
  const chartBox = await page.getByTestId('chart').boundingBox();
  expect(chartBox!.height).toBeGreaterThan(250);
  await page.getByTestId('m-sell').click();
  await expect(page.getByRole('dialog', { name: 'New paper order' })).toBeVisible();
  await page.getByTestId('tk-size').fill('2');
  await page.locator('#tk-sl-on').click();
  await page.getByTestId('tk-submit').click();
  await expect(page.getByRole('dialog', { name: 'New paper order' })).toHaveCount(0);
  await expect(page.getByTestId('line-entry').locator('.lo-pill')).toBeVisible();
  await page.getByRole('button', { name: 'Positions' }).click();
  await expect(page.getByTestId('position-row')).toHaveCount(1);
  await expect(page.getByTestId('position-row')).toContainText('Short'.charAt(0));
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(page.viewportSize()!.width);
});

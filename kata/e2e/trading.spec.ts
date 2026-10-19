import { expect, test } from '@playwright/test';
import { blockMarketData, money, openAccount } from './helpers';

test.beforeEach(async ({ page }) => {
  await blockMarketData(page);
});

test('full trade lifecycle: bracket order, drag stop on chart, partial close, close, review, persist', async ({ page }) => {
  await openAccount(page);
  await expect(page.getByTestId('chart')).toBeVisible();
  await expect(page.locator('.ch').getByText('Simulated')).toBeVisible();

  // Bracket order: 10 ALPHA, stop 1% below, target at 2R.
  await page.getByTestId('tk-size').fill('10');
  await page.locator('#tk-sl-on').click();
  await page.locator('#tk-tp-on').click();
  await expect(page.getByTestId('line-draft-sl').locator('.lo-pill')).toBeVisible();
  await expect(page.getByTestId('line-draft-tp').locator('.lo-pill')).toBeVisible();
  await page.getByTestId('tk-submit').click();

  const row = page.getByTestId('position-row');
  await expect(row).toHaveCount(1);
  await expect(page.getByText('Long 10.000 ALPHA.SIM filled')).toBeVisible();

  // Accounting: balance is down by exactly the taker fee on the entry notional.
  const entry = money(await row.locator('td').nth(2).innerText());
  const balance = money(await page.getByTestId('ap-balance').innerText());
  expect(100_000 - balance).toBeCloseTo(10 * entry * 0.0005, 2);

  // Drag the stop-loss up on the chart; the position's stop follows.
  const slPill = page.getByTestId('line-sl').locator('.lo-pill');
  const before = await row.locator('.tbl-prot').innerText();
  const box = (await slPill.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 20, box.y + box.height / 2 - 8, { steps: 2 });
  await page.mouse.move(box.x + 20, box.y + box.height / 2 - 20, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => row.locator('.tbl-prot').innerText()).not.toBe(before);
  const slBefore = money(before.split('·')[0]);
  const slAfter = money((await row.locator('.tbl-prot').innerText()).split('·')[0]);
  expect(slAfter).toBeGreaterThan(slBefore);

  // Partial close 50% through the manage dialog.
  await page.getByTestId('position-edit').click();
  await page.getByRole('radio', { name: 'Close / reduce' }).click();
  await page.getByTestId('partial-close').click();
  await expect(row.locator('td').nth(1)).toHaveText('5.000');

  // Close the rest at market.
  await page.getByTestId('position-close').click();
  await expect(page.getByTestId('position-row')).toHaveCount(0);

  // The closed trade's net P&L reconciles with the wallet.
  await page.getByRole('tab', { name: 'Closed trades' }).click();
  const hist = page.getByTestId('history-row');
  await expect(hist).toHaveCount(1);
  const net = money(await hist.locator('td').nth(5).innerText());
  const finalBalance = money(await page.getByTestId('ap-balance').innerText());
  expect(finalBalance - 100_000).toBeCloseTo(net, 2);

  // Order history has the entry, the partial and the final close.
  await page.getByRole('tab', { name: 'Order history' }).click();
  await expect(page.getByTestId('order-log').locator('tbody tr')).toHaveCount(3);

  // Inspect the trade on its original chart.
  await page.getByRole('tab', { name: 'Closed trades' }).click();
  await hist.first().click();
  await expect(page.getByTestId('inspect-banner')).toBeVisible();
  await expect(page.locator('[data-testid="chart"]')).toBeVisible();
  await page.getByTestId('inspect-exit').click();
  await expect(page.getByTestId('inspect-banner')).toHaveCount(0);

  // Journal the trade.
  await page.getByRole('link', { name: 'Journal', exact: true }).click();
  await page.getByTestId('journal-setup').fill('Range fade');
  await page.getByTestId('journal-notes').fill('Trimmed half, closed the rest manually.');
  await expect(page.getByText('Saved on this device')).toBeVisible();

  // Everything survives a restart.
  await page.reload();
  await expect(page.getByTestId('journal-setup')).toHaveValue('Range fade');
  await expect(page.getByTestId('journal-notes')).toHaveValue('Trimmed half, closed the rest manually.');
  await page.getByRole('link', { name: 'Performance', exact: true }).click();
  await expect(page.getByTestId('kpi-net')).toHaveText(/[−+]?[\d,]+\.\d\d/);
  expect(money(await page.getByTestId('kpi-net').innerText())).toBeCloseTo(net, 2);
  await expect(page.getByTestId('kpi-winrate')).toHaveText(net > 0 ? '100.0%' : '0.0%');
});

test('limit order reserves margin, can be cancelled, and is recorded', async ({ page }) => {
  await openAccount(page);
  const last = money(await page.locator('.ch-last').innerText());
  await page.getByRole('radio', { name: 'Limit' }).click();
  await page.getByTestId('tk-price').fill((last * 0.9).toFixed(2));
  await page.getByTestId('tk-size').fill('10');
  await page.getByTestId('tk-submit').click();
  await page.getByRole('tab', { name: /Orders/ }).first().click();
  await expect(page.getByTestId('order-row')).toHaveCount(1);
  await expect(page.getByTestId('line-order').locator('.lo-pill')).toBeVisible();
  const available = money(await page.getByTestId('hdr-available').innerText());
  const reserved = 10 * last * 0.9 * (1 / 5 + 0.0005);
  expect(100_000 - available).toBeCloseTo(reserved, 0);
  await page.getByTestId('order-cancel').click();
  await expect(page.getByTestId('order-row')).toHaveCount(0);
  await expect.poll(async () => money(await page.getByTestId('hdr-available').innerText())).toBeCloseTo(100_000, 2);
  await page.getByRole('tab', { name: 'Order history' }).click();
  await expect(page.getByTestId('order-log').getByText('cancelled', { exact: true })).toBeVisible();
});

test('risk rules are enforced by the ticket', async ({ page }) => {
  await openAccount(page);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('link', { name: 'Risk rules' }).click();
  await page.getByRole('switch', { name: 'Require a stop-loss' }).click();
  await page.getByTestId('settings-save').click();
  await page.getByRole('link', { name: 'Trade', exact: true }).click();
  await page.getByTestId('tk-size').fill('1');
  await expect(page.getByTestId('tk-error')).toHaveText(/every entry needs a stop-loss/);
  await expect(page.getByTestId('tk-submit')).toBeDisabled();
  await page.locator('#tk-sl-on').click();
  await expect(page.getByTestId('tk-submit')).toBeEnabled();
});

test('orders resting while the app was closed are reconciled from real candle history', async ({ page }) => {
  await openAccount(page);
  // A tight bracket on a simulated instrument.
  await page.getByTestId('tk-size').fill('1');
  await page.locator('#tk-sl-on').click();
  await page.locator('#tk-tp-on').click();
  const last = money(await page.locator('.ch-last').innerText());
  await page.getByTestId('tk-sl').fill((last * 0.997).toFixed(2));
  await page.getByTestId('tk-tp').fill((last * 1.003).toFixed(2));
  await page.getByTestId('tk-submit').click();
  await expect(page.getByTestId('position-row')).toHaveCount(1);

  // Close the app (it flushes its state on pagehide), then rewrite history from a
  // static same-origin page as if the app had been closed six hours ago.
  await page.goto('/favicon.svg');
  await page.waitForTimeout(500);
  await page.evaluate(async () => {
    const sixHours = 6 * 3_600_000;
    const open = (name: string) =>
      new Promise<IDBDatabase>((res, rej) => {
        const r = indexedDB.open(name);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    const db = await open('kata');
    const tx = db.transaction(['positions', 'accounts'], 'readwrite');
    const ps = tx.objectStore('positions');
    const all: { openedAt: number; status: string }[] = await new Promise((res) => {
      const r = ps.getAll();
      r.onsuccess = () => res(r.result);
    });
    for (const p of all) if (p.status === 'open') ps.put({ ...p, openedAt: p.openedAt - sixHours });
    const as = tx.objectStore('accounts');
    const accts: { lastProcessedAt: number }[] = await new Promise((res) => {
      const r = as.getAll();
      r.onsuccess = () => res(r.result);
    });
    for (const a of accts) as.put({ ...a, lastProcessedAt: a.lastProcessedAt - sixHours });
    await new Promise((res) => (tx.oncomplete = res));
    db.close();
  });
  await page.goto('/');
  await expect(page.getByRole('dialog', { name: 'While you were away' })).toBeVisible();
  await expect(page.getByRole('dialog').getByText(/Stop-loss hit|Take-profit filled/)).toBeVisible();
  await page.getByRole('button', { name: 'Got it' }).click();
  await expect(page.getByTestId('position-row')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Closed trades' }).click();
  await expect(page.getByTestId('history-row')).toHaveCount(1);
});

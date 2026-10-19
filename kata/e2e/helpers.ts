import { expect, type Page } from '@playwright/test';

export const BINANCE = /binance\.(com|vision|us)/;

/** Keep tests hermetic: no real exchange traffic unless a test mocks it explicitly. */
export async function blockMarketData(page: Page) {
  await page.route(BINANCE, (r) => r.abort('internetdisconnected'));
  await page.routeWebSocket(BINANCE, (ws) => ws.close());
}

export async function openAccount(page: Page, opts: { symbol?: string; theme?: 'dark' | 'light'; capital?: string } = {}) {
  await page.addInitScript(
    ({ symbol, theme }) => {
      if (!localStorage.getItem('kata.ui.v1')) localStorage.setItem('kata.ui.v1', JSON.stringify({ state: { theme, symbol }, version: 0 }));
    },
    { symbol: opts.symbol ?? 'ALPHA.SIM', theme: opts.theme ?? 'dark' },
  );
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Rehearse every trade.' })).toBeVisible();
  if (opts.capital) await page.getByRole('radio', { name: opts.capital }).click();
  await page.getByTestId('open-account').click();
  await expect(page.getByTestId('hdr-equity')).toBeVisible();
}

export function money(s: string): number {
  return Number(s.replace(/[^\d.−-]/g, '').replace('−', '-'));
}

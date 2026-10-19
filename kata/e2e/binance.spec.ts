import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import { money, openAccount } from './helpers';

/**
 * Exercises the real Binance adapter (REST + combined WebSocket stream), the
 * honesty labels and execution against bid/ask. Network responses are test
 * fixtures shaped exactly like Binance's documented public API payloads.
 */

const BID = 67_000.1;
const ASK = 67_000.2;

function klines(n: number, intervalMs: number) {
  const end = Math.floor(Date.now() / intervalMs) * intervalMs;
  const out: (string | number)[][] = [];
  let p = 66_000;
  for (let i = n - 1; i >= 0; i--) {
    const t = end - i * intervalMs;
    const o = p;
    p = o + Math.sin(i / 7) * 40 + 3;
    const c = i === 0 ? BID : p;
    out.push([t, o.toFixed(2), (Math.max(o, c) + 25).toFixed(2), (Math.min(o, c) - 25).toFixed(2), c.toFixed(2), '12.5', t + intervalMs - 1, '800000', 900, '6', '400000', '0']);
  }
  return out;
}

const spec = (symbol: string, base: string, tick: string, step: string) => ({
  symbol,
  baseAsset: base,
  quoteAsset: 'USDT',
  status: 'TRADING',
  filters: [
    { filterType: 'PRICE_FILTER', minPrice: tick, maxPrice: '1000000', tickSize: tick },
    { filterType: 'LOT_SIZE', minQty: step, maxQty: '9000', stepSize: step },
    { filterType: 'NOTIONAL', minNotional: '5.00000000' },
  ],
});

async function mockBinance(page: Page, opts: { restUp: () => boolean }) {
  const sockets: WebSocketRoute[] = [];
  await page.route(/binance\.(vision|com)\/api\/v3\//, async (route) => {
    if (!opts.restUp()) return route.fulfill({ status: 503, body: 'unavailable' });
    const url = new URL(route.request().url());
    const symbols: string[] = JSON.parse(url.searchParams.get('symbols') ?? '[]');
    switch (url.pathname) {
      case '/api/v3/klines': {
        const iv = url.searchParams.get('interval') ?? '15m';
        const ms = { '1m': 60e3, '5m': 300e3, '15m': 900e3, '1h': 3600e3, '4h': 14400e3, '1d': 864e5, '1w': 6048e5 }[iv] ?? 900e3;
        return route.fulfill({ json: url.searchParams.get('endTime') ? [] : klines(300, ms) });
      }
      case '/api/v3/exchangeInfo':
        return route.fulfill({ json: { symbols: symbols.map((s) => (s === 'BTCUSDT' ? spec(s, 'BTC', '0.01000000', '0.00001000') : spec(s, s.replace('USDT', ''), '0.01000000', '0.00100000'))) } });
      case '/api/v3/ticker/24hr':
        return route.fulfill({
          json: symbols.map((s) => ({ symbol: s, lastPrice: String(BID), openPrice: '66000.00', highPrice: '67500.00', lowPrice: '65800.00', priceChangePercent: '1.515', quoteVolume: '1234567890.12' })),
        });
      case '/api/v3/ticker/bookTicker':
        return route.fulfill({ json: symbols.map((s) => ({ symbol: s, bidPrice: String(BID), askPrice: String(ASK) })) });
      case '/api/v3/ticker/price':
        return route.fulfill({ json: [{ symbol: 'BTCUSDT', price: String(BID) }, { symbol: 'ETHUSDT', price: '2500.00' }] });
      default:
        return route.fulfill({ status: 404, body: '{}' });
    }
  });
  await page.routeWebSocket(/binance\.(com|vision|us)/, (ws) => {
    sockets.push(ws);
    ws.onMessage((m) => {
      const msg = JSON.parse(String(m));
      if (msg.method) ws.send(JSON.stringify({ result: null, id: msg.id }));
    });
  });
  const push = (data: object, stream: string) => {
    for (const ws of sockets) ws.send(JSON.stringify({ stream, data }));
  };
  return {
    sockets,
    book: (bid: number, ask: number) => push({ u: Date.now(), s: 'BTCUSDT', b: bid.toFixed(2), B: '1.2', a: ask.toFixed(2), A: '0.8' }, 'btcusdt@bookTicker'),
    closeAll: () => {
      for (const ws of sockets) void ws.close();
      sockets.length = 0;
    },
  };
}

test('live Binance data is labelled live and fills at the real touch', async ({ page }) => {
  let restUp = true;
  const bn = await mockBinance(page, { restUp: () => restUp });
  await openAccount(page, { symbol: 'BTCUSDT' });
  await expect.poll(() => bn.sockets.length).toBeGreaterThan(0);
  const pump = setInterval(() => bn.book(BID, ASK), 250);
  try {
    await expect(page.getByTestId('feed-status')).toContainText('Live');
    await expect(page.locator('.ch').getByText('Live')).toBeVisible();
    await expect(page.locator('.tk-ba').first()).toContainText('67,000.10');

    await page.getByTestId('tk-size').fill('0.01');
    await page.getByTestId('tk-submit').click();
    const row = page.getByTestId('position-row');
    await expect(row).toHaveCount(1);
    // Market buy pays the ask plus 1bp slippage, rounded up to the tick.
    const expected = Math.ceil((ASK * 1.0001) / 0.01 - 1e-9) * 0.01;
    expect(money(await row.locator('td').nth(2).innerText())).toBeCloseTo(expected, 2);
    // Recorded with live provenance.
    await page.getByRole('tab', { name: 'Order history' }).click();
    await expect(page.getByTestId('order-log').locator('.k-src--live')).toHaveCount(1);
  } finally {
    clearInterval(pump);
  }

  // Stream goes silent: the label must stop claiming "live".
  await expect(page.locator('.ch').getByText('Delayed')).toBeVisible({ timeout: 15_000 });

  // Stream drops and REST is down too: no data, and the header says so.
  restUp = false;
  bn.closeAll();
  await expect(page.getByTestId('feed-status')).toContainText('No data', { timeout: 20_000 });
});

import { describe, expect, it, vi } from 'vitest';
import { BinanceRest, parseKlines, parseStreamMessage, parseSymbol, REST_HOSTS } from './binance';
import { SimProvider, simCandle, simDef, simQuote } from './sim';

// Payload shapes follow Binance's public spot API documentation.
const KLINE = [1760875200000, '67234.10', '67300.00', '67200.55', '67288.01', '12.34567', 1760875259999, '830000.1', 812, '6.1', '410000.2', '0'];

describe('Binance parsing', () => {
  it('parses klines', () => {
    const [c] = parseKlines([KLINE]);
    expect(c).toEqual({ time: 1760875200000, open: 67234.1, high: 67300, low: 67200.55, close: 67288.01, volume: 12.34567 });
  });

  it('parses exchangeInfo filters into a symbol spec', () => {
    const spec = parseSymbol({
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      filters: [
        { filterType: 'PRICE_FILTER', minPrice: '0.01', maxPrice: '1000000', tickSize: '0.01000000' },
        { filterType: 'LOT_SIZE', minQty: '0.00001000', maxQty: '9000', stepSize: '0.00001000' },
        { filterType: 'NOTIONAL', minNotional: '5.00000000' },
      ],
    });
    expect(spec).toMatchObject({ tickSize: 0.01, stepSize: 0.00001, minQty: 0.00001, minNotional: 5, name: 'Bitcoin', venue: 'binance' });
  });

  it('parses combined-stream messages', () => {
    expect(parseStreamMessage({ stream: 'btcusdt@bookTicker', data: { u: 1, s: 'BTCUSDT', b: '67000.10', B: '1', a: '67000.20', A: '2' } })).toEqual({
      kind: 'book',
      symbol: 'BTCUSDT',
      bid: 67000.1,
      ask: 67000.2,
    });
    const k = parseStreamMessage({
      stream: 'btcusdt@kline_1m',
      data: { e: 'kline', E: 5, s: 'BTCUSDT', k: { t: 60_000, i: '1m', o: '1', h: '3', l: '0.5', c: '2', v: '10', x: false } },
    });
    expect(k).toMatchObject({ kind: 'kline', interval: '1m', closed: false, candle: { open: 1, high: 3, low: 0.5, close: 2, volume: 10 } });
    const m = parseStreamMessage({ stream: 'btcusdt@miniTicker', data: { e: '24hrMiniTicker', E: 9, s: 'BTCUSDT', c: '110', o: '100', h: '120', l: '90', v: '5', q: '550' } });
    expect(m).toMatchObject({ kind: 'mini', ticker: { last: 110, changePct: 10, quoteVolume: 550 } });
    expect(parseStreamMessage({ result: null, id: 1 })).toEqual({ kind: 'ack' });
  });

  it('fails over to the next host when one is geo-blocked or unreachable', async () => {
    const calls: string[] = [];
    const fake = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.startsWith(REST_HOSTS[0])) return new Response('', { status: 451 });
      if (url.startsWith(REST_HOSTS[1])) throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify([KLINE]), { status: 200 });
    }) as unknown as typeof fetch;
    const rest = new BinanceRest(fake);
    const cs = await rest.fetchCandles('BTCUSDT', '1m', { limit: 1 });
    expect(cs).toHaveLength(1);
    expect(calls.map((u) => new URL(u).host)).toEqual(REST_HOSTS.map((h) => new URL(h).host));
    expect(rest.host).toBe(REST_HOSTS[2]);
    expect(calls[2]).toContain('symbol=BTCUSDT&interval=1m&limit=1');
  });

  it('does not retry client errors', async () => {
    const fake = vi.fn(async () => new Response('{"code":-1121,"msg":"Invalid symbol."}', { status: 400 })) as unknown as typeof fetch;
    await expect(new BinanceRest(fake).fetchCandles('NOPEUSDT', '1m')).rejects.toThrow(/Invalid symbol/);
    expect(fake).toHaveBeenCalledTimes(1);
  });
});

describe('Kata Sim', () => {
  const T = Date.UTC(2026, 9, 19, 12, 0, 0);

  it('is deterministic and consistent between quotes and candles', () => {
    const a = simQuote('ALPHA.SIM', T);
    const b = simQuote('ALPHA.SIM', T);
    expect(a).toEqual(b);
    expect(a.ask).toBeGreaterThan(a.bid);
    const def = simDef('ALPHA.SIM')!;
    const c = simCandle(def, T, 60_000);
    expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open, c.close));
    expect(c.low).toBeLessThanOrEqual(Math.min(c.open, c.close));
    expect(c.open).toBeCloseTo(simQuote('ALPHA.SIM', T).last, 2);
  });

  it('returns aligned history that never extends into the future', async () => {
    const sim = new SimProvider(() => T + 30_000);
    const cs = await sim.fetchCandles('BRAVO.SIM', '1m', { limit: 50 });
    expect(cs).toHaveLength(50);
    expect(cs.at(-1)!.time).toBe(T);
    for (let i = 1; i < cs.length; i++) expect(cs[i].time - cs[i - 1].time).toBe(60_000);
    const later = await sim.fetchCandles('BRAVO.SIM', '1h', { startTime: T - 10 * 3_600_000, limit: 5 });
    expect(later[0].time).toBe(T - 10 * 3_600_000);
  });

  it('moves with plausible volatility', () => {
    const def = simDef('ALPHA.SIM')!;
    const rets: number[] = [];
    for (let i = 0; i < 500; i++) {
      const c = simCandle(def, T + i * 3_600_000, 3_600_000);
      rets.push(Math.log(c.close / c.open));
    }
    const sd = Math.sqrt(rets.reduce((s, r) => s + r * r, 0) / rets.length);
    // Hourly sd of a ~3.5%/day instrument should be a fraction of a percent.
    expect(sd).toBeGreaterThan(0.0005);
    expect(sd).toBeLessThan(0.03);
  });
});

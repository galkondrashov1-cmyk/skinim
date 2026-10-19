import type { Candle, CandleQuery, Instrument, Interval, MarketProvider, Ticker } from './types';

/**
 * Binance public market data. No API key, no account, read-only.
 * `data-api.binance.vision` is Binance's market-data-only endpoint; the
 * main API hosts are fallbacks for networks that block it.
 */
export const REST_HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com', 'https://api-gcp.binance.com'];
export const WS_HOSTS = ['wss://data-stream.binance.vision', 'wss://stream.binance.com:9443', 'wss://stream.binance.com:443'];

const NAMES: Record<string, string> = {
  BTC: 'Bitcoin',
  ETH: 'Ethereum',
  SOL: 'Solana',
  BNB: 'BNB',
  XRP: 'XRP',
  DOGE: 'Dogecoin',
  ADA: 'Cardano',
  AVAX: 'Avalanche',
  LINK: 'Chainlink',
  LTC: 'Litecoin',
  DOT: 'Polkadot',
  TRX: 'TRON',
  TON: 'Toncoin',
  SUI: 'Sui',
  NEAR: 'NEAR Protocol',
  APT: 'Aptos',
  ARB: 'Arbitrum',
  OP: 'Optimism',
  ATOM: 'Cosmos',
  UNI: 'Uniswap',
  AAVE: 'Aave',
  PEPE: 'Pepe',
  SHIB: 'Shiba Inu',
  BCH: 'Bitcoin Cash',
  ETC: 'Ethereum Classic',
  FIL: 'Filecoin',
  INJ: 'Injective',
  SEI: 'Sei',
  TIA: 'Celestia',
  HBAR: 'Hedera',
  XLM: 'Stellar',
  PAXG: 'PAX Gold',
};

export function displayName(base: string): string {
  return NAMES[base] ?? base;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type Fetch = typeof fetch;

export class BinanceRest implements MarketProvider {
  readonly venue = 'binance' as const;
  private hostIndex = 0;
  private readonly fetchImpl: Fetch;

  constructor(fetchImpl?: Fetch) {
    this.fetchImpl = fetchImpl ?? ((...args) => fetch(...args));
  }

  get host(): string {
    return REST_HOSTS[this.hostIndex];
  }

  /** GET with host failover. Network/CORS/geo errors rotate to the next host. */
  async get<T>(path: string, params: Record<string, string | number | undefined> = {}, signal?: AbortSignal): Promise<T> {
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join('&');
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < REST_HOSTS.length; attempt++) {
      const host = REST_HOSTS[(this.hostIndex + attempt) % REST_HOSTS.length];
      try {
        const res = await this.fetchImpl(`${host}${path}${qs ? `?${qs}` : ''}`, { signal });
        if (res.status === 451 || res.status === 403) {
          lastErr = new HttpError(res.status, `Binance unavailable from this region via ${new URL(host).host}`);
          continue;
        }
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new HttpError(res.status, `Binance ${res.status}: ${body.slice(0, 160)}`);
        }
        this.hostIndex = (this.hostIndex + attempt) % REST_HOSTS.length;
        return (await res.json()) as T;
      } catch (e) {
        if (signal?.aborted) throw e;
        if (e instanceof HttpError && e.status !== 451 && e.status !== 403 && e.status < 500) throw e;
        lastErr = e;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('Binance unreachable');
  }

  async fetchCandles(symbol: string, interval: Interval, q: CandleQuery = {}, signal?: AbortSignal): Promise<Candle[]> {
    const raw = await this.get<unknown[][]>(
      '/api/v3/klines',
      { symbol, interval, limit: q.limit ?? 1000, endTime: q.endTime, startTime: q.startTime },
      signal,
    );
    return parseKlines(raw);
  }

  async fetchSpecs(symbols: string[]): Promise<Instrument[]> {
    if (!symbols.length) return [];
    const raw = await this.get<{ symbols: RawSymbol[] }>('/api/v3/exchangeInfo', { symbols: JSON.stringify(symbols) });
    return raw.symbols.map(parseSymbol);
  }

  async fetchTickers(symbols: string[]): Promise<Ticker[]> {
    if (!symbols.length) return [];
    const raw = await this.get<Raw24h[]>('/api/v3/ticker/24hr', { symbols: JSON.stringify(symbols) });
    const now = Date.now();
    return raw.map((t) => parse24h(t, now));
  }

  async fetchBookTickers(symbols: string[]): Promise<{ symbol: string; bid: number; ask: number }[]> {
    if (!symbols.length) return [];
    const raw = await this.get<{ symbol: string; bidPrice: string; askPrice: string }[]>('/api/v3/ticker/bookTicker', {
      symbols: JSON.stringify(symbols),
    });
    return raw.map((r) => ({ symbol: r.symbol, bid: +r.bidPrice, ask: +r.askPrice }));
  }

  /** All tradable USDT spot pairs, for search. */
  async listUsdtSymbols(): Promise<string[]> {
    const raw = await this.get<{ symbol: string; price: string }[]>('/api/v3/ticker/price');
    return raw
      .map((r) => r.symbol)
      .filter((s) => s.endsWith('USDT') && !/(UP|DOWN|BULL|BEAR)USDT$/.test(s) && !/^(USDC|FDUSD|TUSD|BUSD|USDP|DAI|EUR|AEUR)USDT$/.test(s))
      .sort();
  }
}

// ───────────────────────────────────────────────────────────── parsing ──

export function parseKlines(raw: unknown[][]): Candle[] {
  return raw.map((k) => ({
    time: Number(k[0]),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
  }));
}

export interface RawSymbol {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  status?: string;
  filters: { filterType: string; [k: string]: unknown }[];
}

export function parseSymbol(s: RawSymbol): Instrument {
  const f = (type: string) => s.filters.find((x) => x.filterType === type);
  const price = f('PRICE_FILTER');
  const lot = f('LOT_SIZE');
  const notional = f('NOTIONAL') ?? f('MIN_NOTIONAL');
  return {
    symbol: s.symbol,
    base: s.baseAsset,
    quote: s.quoteAsset,
    tickSize: Number(price?.tickSize ?? 0.01),
    stepSize: Number(lot?.stepSize ?? 0.00001),
    minQty: Number(lot?.minQty ?? 0.00001),
    minNotional: Number(notional?.minNotional ?? 5),
    venue: 'binance',
    name: displayName(s.baseAsset),
  };
}

export interface Raw24h {
  symbol: string;
  lastPrice: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
  closeTime?: number;
}

export function parse24h(t: Raw24h, now: number): Ticker {
  return {
    symbol: t.symbol,
    last: +t.lastPrice,
    open24h: +t.openPrice,
    high24h: +t.highPrice,
    low24h: +t.lowPrice,
    changePct: +t.priceChangePercent,
    quoteVolume: +t.quoteVolume,
    ts: now,
  };
}

/** Websocket payloads (combined-stream envelope: { stream, data }). */
export type StreamMessage =
  | { kind: 'book'; symbol: string; bid: number; ask: number }
  | { kind: 'kline'; symbol: string; interval: Interval; candle: Candle; closed: boolean; eventTime: number }
  | { kind: 'mini'; ticker: Omit<Ticker, 'ts'>; eventTime: number }
  | { kind: 'ack' }
  | { kind: 'unknown' };

export function parseStreamMessage(msg: unknown): StreamMessage {
  if (!msg || typeof msg !== 'object') return { kind: 'unknown' };
  const m = msg as Record<string, unknown>;
  if ('result' in m && 'id' in m) return { kind: 'ack' };
  const data = (m.data ?? m) as Record<string, unknown>;
  const stream = typeof m.stream === 'string' ? m.stream : '';
  if (stream.endsWith('@bookTicker') || ('b' in data && 'a' in data && 'u' in data && !('e' in data))) {
    return { kind: 'book', symbol: String(data.s), bid: Number(data.b), ask: Number(data.a) };
  }
  if (data.e === 'kline') {
    const k = data.k as Record<string, unknown>;
    return {
      kind: 'kline',
      symbol: String(data.s),
      interval: k.i as Interval,
      closed: Boolean(k.x),
      eventTime: Number(data.E),
      candle: { time: Number(k.t), open: Number(k.o), high: Number(k.h), low: Number(k.l), close: Number(k.c), volume: Number(k.v) },
    };
  }
  if (data.e === '24hrMiniTicker') {
    const open = Number(data.o);
    const last = Number(data.c);
    return {
      kind: 'mini',
      eventTime: Number(data.E),
      ticker: {
        symbol: String(data.s),
        last,
        open24h: open,
        high24h: Number(data.h),
        low24h: Number(data.l),
        changePct: open > 0 ? ((last - open) / open) * 100 : 0,
        quoteVolume: Number(data.q),
      },
    };
  }
  return { kind: 'unknown' };
}

export const streamName = {
  book: (s: string) => `${s.toLowerCase()}@bookTicker`,
  kline: (s: string, i: Interval) => `${s.toLowerCase()}@kline_${i}`,
  mini: (s: string) => `${s.toLowerCase()}@miniTicker`,
};

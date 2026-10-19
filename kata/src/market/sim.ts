import type { Candle, CandleQuery, Instrument, Interval, MarketProvider, Ticker } from './types';
import { INTERVAL_MS } from './types';

/**
 * Kata Sim — synthetic instruments for offline practice.
 *
 * Prices are a deterministic function of wall-clock time (multi-octave value
 * noise with Brownian amplitude scaling), so history, live ticks and trade
 * inspection always agree, and two devices see the same tape.
 * These prices are NOT market data and are labelled as simulated everywhere.
 */

interface SimDef {
  symbol: string;
  base: string;
  name: string;
  seed: number;
  p0: number;
  /** Daily volatility as a fraction (0.03 = 3%). */
  vol: number;
  tickSize: number;
  stepSize: number;
  baseVolume: number;
}

const DEFS: SimDef[] = [
  { symbol: 'ALPHA.SIM', base: 'ALPHA', name: 'Alpha (simulated)', seed: 11, p0: 1_250, vol: 0.035, tickSize: 0.01, stepSize: 0.001, baseVolume: 40 },
  { symbol: 'BRAVO.SIM', base: 'BRAVO', name: 'Bravo (simulated)', seed: 23, p0: 84, vol: 0.055, tickSize: 0.001, stepSize: 0.01, baseVolume: 900 },
  { symbol: 'DELTA.SIM', base: 'DELTA', name: 'Delta (simulated)', seed: 37, p0: 18_400, vol: 0.022, tickSize: 0.1, stepSize: 0.0001, baseVolume: 3 },
];

export const SIM_SYMBOLS = DEFS.map((d) => d.symbol);
export const isSimSymbol = (s: string) => s.endsWith('.SIM');

function hash(seed: number, i: number): number {
  // xorshift-multiply hash → [−1, 1)
  let h = (Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(seed, 0x165667b1) ^ Math.imul((i / 4294967296) | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 2147483648 - 1;
}

function valueNoise(seed: number, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash(seed, i) * (1 - u) + hash(seed, i + 1) * u;
}

const DAY_S = 86_400;
// Wavelengths in seconds, from ~15 seconds to ~60 days.
const OCTAVES = [15, 45, 135, 405, 1_215, 3_645, 10_935, 32_805, 98_415, 295_245, 885_735, 2_657_205, 5_314_410];

function logPrice(def: SimDef, tMs: number): number {
  const t = tMs / 1000;
  let x = 0;
  for (let k = 0; k < OCTAVES.length; k++) {
    const lambda = OCTAVES[k];
    // Brownian scaling: displacement over λ seconds ∝ √(λ / day) × daily vol.
    const amp = def.vol * Math.sqrt(lambda / DAY_S) * 0.9;
    x += amp * valueNoise(def.seed * 131 + k, t / lambda);
  }
  return x;
}

export function simPrice(def: SimDef, tMs: number): number {
  return def.p0 * Math.exp(logPrice(def, tMs));
}

function round(x: number, step: number): number {
  const d = Math.max(0, Math.round(-Math.log10(step)));
  return Number((Math.round(x / step) * step).toFixed(d));
}

export function simDef(symbol: string): SimDef | undefined {
  return DEFS.find((d) => d.symbol === symbol);
}

export function simQuote(symbol: string, tMs: number): { bid: number; ask: number; last: number } {
  const def = simDef(symbol)!;
  const mid = simPrice(def, tMs);
  const half = Math.max(def.tickSize, round(mid * 0.00005, def.tickSize));
  const bid = round(mid - half / 2, def.tickSize);
  return { bid, ask: round(bid + Math.max(def.tickSize, half), def.tickSize), last: round(mid, def.tickSize) };
}

export function simCandle(def: SimDef, time: number, intervalMs: number, upTo = Infinity): Candle {
  const end = Math.min(time + intervalMs - 1, upTo);
  const span = end - time;
  const samples = Math.max(2, Math.min(64, Math.ceil(span / 5_000)));
  const open = simPrice(def, time);
  let high = open;
  let low = open;
  let close = open;
  for (let i = 1; i <= samples; i++) {
    const p = simPrice(def, time + (span * i) / samples);
    if (p > high) high = p;
    if (p < low) low = p;
    close = p;
  }
  const move = Math.abs(Math.log(close / open)) / (def.vol * Math.sqrt(intervalMs / 86_400_000) + 1e-9);
  const volume = def.baseVolume * (intervalMs / 60_000) * (0.6 + 0.8 * move + 0.4 * (hash(def.seed + 7, Math.floor(time / intervalMs)) + 1));
  return {
    time,
    open: round(open, def.tickSize),
    high: round(high, def.tickSize),
    low: round(low, def.tickSize),
    close: round(close, def.tickSize),
    volume: Number(volume.toFixed(3)),
  };
}

export class SimProvider implements MarketProvider {
  readonly venue = 'sim' as const;
  constructor(private readonly clock: () => number = Date.now) {}

  async fetchCandles(symbol: string, interval: Interval, q: CandleQuery = {}): Promise<Candle[]> {
    const def = simDef(symbol);
    if (!def) throw new Error(`Unknown simulated instrument ${symbol}`);
    const ms = INTERVAL_MS[interval];
    const now = this.clock();
    const limit = Math.min(q.limit ?? 1000, 1000);
    const endT = Math.min(q.endTime ?? now, now);
    let last = Math.floor(endT / ms) * ms;
    let first = last - (limit - 1) * ms;
    if (q.startTime != null) {
      first = Math.ceil(q.startTime / ms) * ms;
      last = Math.min(last, first + (limit - 1) * ms);
    }
    const out: Candle[] = [];
    for (let t = first; t <= last; t += ms) out.push(simCandle(def, t, ms, now));
    return out;
  }

  async fetchSpecs(symbols: string[]): Promise<Instrument[]> {
    return symbols.flatMap((s) => {
      const d = simDef(s);
      return d ? [simInstrument(d)] : [];
    });
  }

  async fetchTickers(symbols: string[]): Promise<Ticker[]> {
    const now = this.clock();
    return symbols.flatMap((s) => {
      const d = simDef(s);
      if (!d) return [];
      return [simTicker(d, now)];
    });
  }
}

export function simTicker(d: SimDef, now: number): Ticker {
  const last = simQuote(d.symbol, now).last;
  const open = round(simPrice(d, now - 86_400_000), d.tickSize);
  let hi = Math.max(open, last);
  let lo = Math.min(open, last);
  for (let i = 1; i < 96; i++) {
    const p = simPrice(d, now - i * 900_000);
    hi = Math.max(hi, p);
    lo = Math.min(lo, p);
  }
  return {
    symbol: d.symbol,
    last,
    open24h: open,
    high24h: round(hi, d.tickSize),
    low24h: round(lo, d.tickSize),
    changePct: ((last - open) / open) * 100,
    quoteVolume: d.baseVolume * 1440 * last,
    ts: now,
  };
}

export function simInstrument(d: SimDef): Instrument {
  return {
    symbol: d.symbol,
    base: d.base,
    quote: 'USDT',
    tickSize: d.tickSize,
    stepSize: d.stepSize,
    minQty: d.stepSize,
    minNotional: 5,
    venue: 'sim',
    name: d.name,
  };
}

export const SIM_INSTRUMENTS: Instrument[] = DEFS.map(simInstrument);

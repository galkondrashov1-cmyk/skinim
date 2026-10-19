import type { Candle } from '@/market/types';

/** Indicator outputs are aligned with their input; warm-up values are NaN. */
export type Series = number[];

export function sma(values: readonly number[], n: number): Series {
  const out = new Array<number>(values.length).fill(NaN);
  let s = 0;
  for (let i = 0; i < values.length; i++) {
    s += values[i];
    if (i >= n) s -= values[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}

/** EMA seeded with the SMA of the first n values (standard charting convention). */
export function ema(values: readonly number[], n: number): Series {
  const out = new Array<number>(values.length).fill(NaN);
  const k = 2 / (n + 1);
  let start = values.findIndex((v) => Number.isFinite(v));
  if (start === -1) return out;
  if (values.length - start < n) return out;
  let seed = 0;
  for (let i = start; i < start + n; i++) seed += values[i];
  let prev = seed / n;
  out[start + n - 1] = prev;
  for (let i = start + n; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  start = 0;
  return out;
}

/** Wilder's smoothing (RMA), seeded with a simple average. */
function rma(values: readonly number[], n: number, from = 0): Series {
  const out = new Array<number>(values.length).fill(NaN);
  if (values.length - from < n) return out;
  let s = 0;
  for (let i = from; i < from + n; i++) s += values[i];
  let prev = s / n;
  out[from + n - 1] = prev;
  for (let i = from + n; i < values.length; i++) {
    prev = (prev * (n - 1) + values[i]) / n;
    out[i] = prev;
  }
  return out;
}

export function rsi(closes: readonly number[], n = 14): Series {
  const out = new Array<number>(closes.length).fill(NaN);
  if (closes.length <= n) return out;
  const gains: number[] = [0];
  const losses: number[] = [0];
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gains.push(Math.max(0, d));
    losses.push(Math.max(0, -d));
  }
  const ag = rma(gains, n, 1);
  const al = rma(losses, n, 1);
  for (let i = n; i < closes.length; i++) {
    if (al[i] === 0) out[i] = ag[i] === 0 ? 50 : 100;
    else out[i] = 100 - 100 / (1 + ag[i] / al[i]);
  }
  return out;
}

export interface MacdResult {
  macd: Series;
  signal: Series;
  hist: Series;
}

export function macd(closes: readonly number[], fast = 12, slow = 26, signalN = 9): MacdResult {
  const f = ema(closes, fast);
  const s = ema(closes, slow);
  const line = closes.map((_, i) => f[i] - s[i]);
  const sig = ema(line, signalN);
  return { macd: line, signal: sig, hist: line.map((v, i) => v - sig[i]) };
}

export interface BandsResult {
  mid: Series;
  upper: Series;
  lower: Series;
}

/** Bollinger Bands with population standard deviation. */
export function bollinger(closes: readonly number[], n = 20, k = 2): BandsResult {
  const mid = sma(closes, n);
  const upper = new Array<number>(closes.length).fill(NaN);
  const lower = new Array<number>(closes.length).fill(NaN);
  for (let i = n - 1; i < closes.length; i++) {
    let v = 0;
    for (let j = i - n + 1; j <= i; j++) v += (closes[j] - mid[i]) ** 2;
    const sd = Math.sqrt(v / n);
    upper[i] = mid[i] + k * sd;
    lower[i] = mid[i] - k * sd;
  }
  return { mid, upper, lower };
}

export function atr(candles: readonly Candle[], n = 14): Series {
  const tr = candles.map((c, i) =>
    i === 0 ? c.high - c.low : Math.max(c.high - c.low, Math.abs(c.high - candles[i - 1].close), Math.abs(c.low - candles[i - 1].close)),
  );
  return rma(tr, n);
}

/** Session VWAP, anchored at each UTC day. */
export function vwap(candles: readonly Candle[]): Series {
  const out: number[] = [];
  let day = -1;
  let pv = 0;
  let vol = 0;
  for (const c of candles) {
    const d = Math.floor(c.time / 86_400_000);
    if (d !== day) {
      day = d;
      pv = 0;
      vol = 0;
    }
    const tp = (c.high + c.low + c.close) / 3;
    pv += tp * c.volume;
    vol += c.volume;
    out.push(vol > 0 ? pv / vol : tp);
  }
  return out;
}

export type IndicatorId = 'ema20' | 'ema50' | 'ema200' | 'sma20' | 'bb' | 'vwap' | 'rsi' | 'macd' | 'volume';

export interface IndicatorDef {
  id: IndicatorId;
  label: string;
  short: string;
  pane: 'price' | 'lower';
  description: string;
}

export const INDICATORS: IndicatorDef[] = [
  { id: 'volume', label: 'Volume', short: 'VOL', pane: 'price', description: 'Traded base volume per candle' },
  { id: 'ema20', label: 'EMA 20', short: 'EMA20', pane: 'price', description: 'Exponential moving average, 20 periods' },
  { id: 'ema50', label: 'EMA 50', short: 'EMA50', pane: 'price', description: 'Exponential moving average, 50 periods' },
  { id: 'ema200', label: 'EMA 200', short: 'EMA200', pane: 'price', description: 'Exponential moving average, 200 periods' },
  { id: 'sma20', label: 'SMA 20', short: 'SMA20', pane: 'price', description: 'Simple moving average, 20 periods' },
  { id: 'bb', label: 'Bollinger Bands', short: 'BB 20·2', pane: 'price', description: '20-period SMA ± 2 standard deviations' },
  { id: 'vwap', label: 'VWAP', short: 'VWAP', pane: 'price', description: 'Volume-weighted average price, reset daily (UTC)' },
  { id: 'rsi', label: 'RSI 14', short: 'RSI14', pane: 'lower', description: "Wilder's relative strength index" },
  { id: 'macd', label: 'MACD 12·26·9', short: 'MACD', pane: 'lower', description: 'Moving average convergence/divergence' },
];

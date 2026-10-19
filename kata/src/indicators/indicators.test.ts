import { describe, expect, it } from 'vitest';
import { atr, bollinger, ema, macd, rsi, sma, vwap } from './indicators';

// Classic Wilder RSI worksheet series. Expected values are computed exactly
// (avg gain 3.34/14, avg loss 1.40/14); published worksheets round the averages.
const CLOSES = [
  44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.0, 46.03, 46.41, 46.22, 45.64,
];

describe('moving averages', () => {
  it('computes SMA with NaN warm-up', () => {
    const s = sma([1, 2, 3, 4, 5], 3);
    expect(s.slice(0, 2).every(Number.isNaN)).toBe(true);
    expect(s.slice(2)).toEqual([2, 3, 4]);
  });

  it('seeds EMA with the SMA and applies 2/(n+1) smoothing', () => {
    const e = ema([1, 2, 3, 4, 5, 6], 3);
    expect(e[2]).toBe(2);
    expect(e[3]).toBeCloseTo(3); // 4·0.5 + 2·0.5
    expect(e[4]).toBeCloseTo(4);
    expect(e[5]).toBeCloseTo(5);
  });

  it('skips leading NaNs (used for MACD signal)', () => {
    const e = ema([NaN, NaN, 2, 4, 6], 2);
    expect(e[3]).toBe(3);
    expect(e[4]).toBeCloseTo(5);
  });
});

describe('oscillators', () => {
  it('matches the reference Wilder RSI values', () => {
    const r = rsi(CLOSES, 14);
    expect(Number.isNaN(r[13])).toBe(true);
    expect(r[14]).toBeCloseTo(100 - 100 / (1 + 3.34 / 1.4), 10); // 70.464
    const ag = (3.34 / 14) * 13 / 14;
    const al = (1.4 / 14 * 13 + 0.28) / 14;
    expect(r[15]).toBeCloseTo(100 - 100 / (1 + ag / al), 10); // 66.25
    expect(r[19]).toBeGreaterThan(50);
    expect(r[19]).toBeLessThan(r[18]);
  });

  it('pins RSI at 100 for a one-way market', () => {
    const r = rsi(Array.from({ length: 20 }, (_, i) => i + 1), 14);
    expect(r[19]).toBe(100);
  });

  it('builds MACD line, signal and histogram consistently', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 5) * 5 + i * 0.1);
    const m = macd(closes);
    const e12 = ema(closes, 12);
    const e26 = ema(closes, 26);
    expect(m.macd[40]).toBeCloseTo(e12[40] - e26[40], 10);
    expect(Number.isNaN(m.signal[32])).toBe(true);
    expect(Number.isFinite(m.signal[33])).toBe(true);
    expect(m.hist[50]).toBeCloseTo(m.macd[50] - m.signal[50], 10);
  });
});

describe('bands, ATR and VWAP', () => {
  it('computes Bollinger bands with population SD', () => {
    const b = bollinger([2, 4, 4, 4, 5, 5, 7, 9], 8, 2);
    expect(b.mid[7]).toBe(5);
    expect(b.upper[7]).toBe(9); // sd = 2
    expect(b.lower[7]).toBe(1);
  });

  const candles = [
    { time: 0, open: 10, high: 12, low: 9, close: 11, volume: 100 },
    { time: 60_000, open: 11, high: 13, low: 10, close: 12, volume: 300 },
    { time: 86_400_000, open: 12, high: 15, low: 12, close: 14, volume: 50 },
  ];

  it('computes ATR from true ranges', () => {
    const a = atr(candles, 2);
    expect(a[1]).toBe(3); // (3 + 3) / 2
    expect(a[2]).toBe(3); // TR = max(3, |15−12|, |12−12|) = 3
  });

  it('anchors VWAP at the UTC day', () => {
    const v = vwap(candles);
    const tp0 = (12 + 9 + 11) / 3;
    const tp1 = (13 + 10 + 12) / 3;
    expect(v[1]).toBeCloseTo((tp0 * 100 + tp1 * 300) / 400);
    expect(v[2]).toBeCloseTo((15 + 12 + 14) / 3); // new session
  });
});

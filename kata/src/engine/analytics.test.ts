import { describe, expect, it } from 'vitest';
import { balanceCurve, bySymbol, computeStats, dailyPnl, drawdown, rHistogram, type TradeRow } from './analytics';
import { lossAtStop } from './margin';
import { offsetPrice, sizeForMargin, sizeForRisk, targetForR } from './sizing';
import { T0 } from './testkit';

const row = (i: number, net: number, r: number | null = null, side: 'long' | 'short' = 'long', symbol = 'BTCUSDT'): TradeRow => ({
  id: `t${i}`,
  no: i,
  symbol,
  side,
  openedAt: T0 + i * 3_600_000,
  closedAt: T0 + i * 3_600_000 + 600_000,
  entry: 100,
  exit: 100,
  qty: 1,
  leverage: 1,
  gross: net + 1,
  fees: 1,
  net,
  r,
  holdMs: 600_000,
  closeReason: 'manual',
  efficiency: null,
});

describe('trade statistics', () => {
  const rows = [row(1, 100, 1), row(2, 200, 2), row(3, -50, -0.5, 'short'), row(4, -50, -0.5), row(5, -20, null, 'short', 'ETHUSDT'), row(6, 30, 0.3)];

  it('computes win rate, profit factor, expectancy and payoff', () => {
    const s = computeStats(rows);
    expect(s.count).toBe(6);
    expect(s.wins).toBe(3);
    expect(s.losses).toBe(3);
    expect(s.winRate).toBeCloseTo(0.5);
    expect(s.grossProfit).toBe(330);
    expect(s.grossLoss).toBe(120);
    expect(s.profitFactor).toBeCloseTo(2.75);
    expect(s.netPnl).toBe(210);
    expect(s.expectancy).toBeCloseTo(35);
    expect(s.avgWin).toBeCloseTo(110);
    expect(s.avgLoss).toBeCloseTo(40);
    expect(s.payoff).toBeCloseTo(2.75);
    expect(s.largestWin).toBe(200);
    expect(s.largestLoss).toBe(-50);
    expect(s.maxConsecWins).toBe(2);
    expect(s.maxConsecLosses).toBe(3);
    expect(s.fees).toBe(6);
  });

  it('computes R statistics only over trades with a defined 1R', () => {
    const s = computeStats(rows);
    expect(s.rCount).toBe(5);
    expect(s.totalR).toBeCloseTo(2.3);
    expect(s.avgR).toBeCloseTo(0.46);
  });

  it('splits by side and symbol', () => {
    const s = computeStats(rows);
    expect(s.long.count).toBe(4);
    expect(s.short.count).toBe(2);
    expect(s.short.net).toBe(-70);
    const bs = bySymbol(rows);
    expect(bs[0]).toMatchObject({ symbol: 'BTCUSDT', count: 5, net: 230 });
    expect(bs[1]).toMatchObject({ symbol: 'ETHUSDT', net: -20 });
  });

  it('handles the empty and loss-free cases', () => {
    expect(computeStats([]).profitFactor).toBeNull();
    expect(computeStats([]).winRate).toBe(0);
    expect(computeStats([row(1, 10)]).profitFactor).toBe(Infinity);
  });
});

describe('curves', () => {
  it('builds a realized balance curve and measures max drawdown', () => {
    const curve = balanceCurve(1_000, [row(1, 200), row(2, -300), row(3, 400), row(4, -260)], T0);
    expect(curve.map((p) => p.value)).toEqual([1_000, 1_200, 900, 1_300, 1_040]);
    const dd = drawdown(curve);
    expect(dd.maxPct).toBeCloseTo(25);
    expect(dd.maxAbs).toBe(300);
    expect(dd.series.at(-1)!.value).toBeCloseTo(20);
  });

  it('aggregates daily P&L and an R histogram', () => {
    const d = dailyPnl([row(1, 10), row(2, -4)]);
    expect([...d.values()][0]).toEqual({ net: 6, count: 2 });
    const h = rHistogram([row(1, 1, 1.2), row(2, 1, -0.4), row(3, 1, 9)], 1, 3);
    expect(h).toHaveLength(6);
    expect(h.find((b) => b.from === 1)!.count).toBe(1);
    expect(h.find((b) => b.from === -1)!.count).toBe(1);
    expect(h.at(-1)!.count).toBe(1); // clamped outlier
  });
});

describe('position sizing', () => {
  it('sizes a trade to a fixed risk including round-trip fees', () => {
    const qty = sizeForRisk({ side: 'long', riskAmount: 100, entry: 50_000, stop: 49_000, takerFee: 0.0005, spec: { stepSize: 0.00001 } });
    expect(qty).toBe(0.09528);
    const loss = lossAtStop('long', qty, 50_000, 49_000, 0.0005, 0.0005);
    expect(loss).toBeLessThanOrEqual(100);
    expect(loss).toBeGreaterThan(99.9);
    expect(sizeForRisk({ side: 'short', riskAmount: 100, entry: 50_000, stop: 49_000, takerFee: 0, spec: { stepSize: 0.001 } })).toBe(0);
  });

  it('sizes from margin and computes offsets and R targets', () => {
    expect(sizeForMargin({ amount: 1_000, price: 50_000, leverage: 10, takerFee: 0.0005, spec: { stepSize: 0.001 } })).toBe(0.199);
    expect(offsetPrice('long', 100, 2, 'stop')).toBeCloseTo(98);
    expect(offsetPrice('short', 100, 2, 'stop')).toBeCloseTo(102);
    expect(offsetPrice('short', 100, 2, 'target')).toBeCloseTo(98);
    expect(targetForR('long', 100, 98, 2.5)).toBeCloseTo(105);
    expect(targetForR('short', 100, 102, 2)).toBeCloseTo(96);
  });
});

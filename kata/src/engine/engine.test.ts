import { describe, expect, it } from 'vitest';
import {
  cancelOrder,
  closePosition,
  computeMetrics,
  evaluateRisk,
  modifyOrder,
  placeOrder,
  processBar,
  processQuote,
  setProtection,
  unlockAccount,
  validateOrder,
} from './engine';
import { liquidationPrice, lossAtStop, netRealized } from './margin';
import { BTC, cfg, harness, T0 } from './testkit';
import type { OrderRequest } from './types';

const req = (o: Partial<OrderRequest>): OrderRequest => ({
  symbol: 'BTCUSDT',
  side: 'buy',
  type: 'market',
  qty: 0.1,
  price: null,
  leverage: 10,
  sl: null,
  tp: null,
  trail: null,
  ...o,
});

describe('market orders', () => {
  it('opens a long at the ask, charges taker fee and locks isolated margin', () => {
    const h = harness();
    h.quote('BTCUSDT', 50_000, 50_000.1);
    const r = h.apply(placeOrder(h.state, req({}), h.ctx()));
    expect(r.error).toBeNull();
    const [p] = h.state.positions;
    expect(p.side).toBe('long');
    expect(p.entryPrice).toBe(50_000.1);
    expect(p.margin).toBeCloseTo(500.001, 8);
    expect(p.entryFee).toBeCloseTo(2.500005, 8);
    expect(h.state.account.balance).toBeCloseTo(9_997.499995, 8);
    const m = computeMetrics(h.state, h.quotes, h.now);
    expect(m.unrealizedPnl).toBeCloseTo(-0.01, 8); // marked at the bid
    expect(m.equity).toBeCloseTo(9_997.489995, 8);
    expect(m.available).toBeCloseTo(9_497.498995, 8);
    expect(m.grossExposure).toBeCloseTo(5_000, 6);
  });

  it('opens a short at the bid', () => {
    const h = harness();
    h.quote('BTCUSDT', 50_000, 50_000.1);
    h.apply(placeOrder(h.state, req({ side: 'sell' }), h.ctx()));
    const [p] = h.state.positions;
    expect(p.side).toBe('short');
    expect(p.entryPrice).toBe(50_000);
  });

  it('applies adverse slippage rounded to the tick against the trader', () => {
    const h = harness({ config: cfg({ slippageBps: 1, risk: { dailyLossLimitPct: null } }) });
    h.quote('BTCUSDT', 50_000, 50_000);
    h.apply(placeOrder(h.state, req({}), h.ctx()));
    expect(h.state.positions[0].entryPrice).toBe(50_005); // +1bp
    h.apply(placeOrder(h.state, req({ side: 'sell' }), h.ctx()));
    expect(h.state.positions[1].entryPrice).toBe(49_995);
  });

  it('closes fully with exact realized P&L, fees and balance', () => {
    const h = harness();
    h.quote('BTCUSDT', 50_000, 50_000.1);
    h.apply(placeOrder(h.state, req({}), h.ctx()));
    const id = h.state.positions[0].id;
    h.quote('BTCUSDT', 51_000, 51_000.1);
    h.apply(closePosition(h.state, id, 'all', h.ctx()));
    expect(h.state.positions).toHaveLength(0);
    const [closed] = h.closed();
    expect(closed.realizedPnl).toBeCloseTo(99.99, 8);
    expect(closed.exitFees).toBeCloseTo(2.55, 8);
    expect(netRealized(closed)).toBeCloseTo(94.939995, 8);
    expect(closed.closeReason).toBe('manual');
    expect(h.state.account.balance).toBeCloseTo(10_094.939995, 8);
    expect(h.state.account.balance).toBeCloseTo(h.ledgerSum(), 8);
  });

  it('supports partial closes with proportional margin release', () => {
    const h = harness();
    h.quote('BTCUSDT', 50_000, 50_000);
    h.apply(placeOrder(h.state, req({ qty: 0.2, leverage: 5 }), h.ctx()));
    const id = h.state.positions[0].id;
    h.quote('BTCUSDT', 52_000, 52_000);
    h.apply(closePosition(h.state, id, 0.05, h.ctx()));
    const p = h.state.positions[0];
    expect(p.qty).toBeCloseTo(0.15, 10);
    expect(p.margin).toBeCloseTo(1_500, 8);
    expect(p.realizedPnl).toBeCloseTo(100, 8);
    expect(p.exitFees).toBeCloseTo(1.3, 8);
    h.quote('BTCUSDT', 49_000, 49_000);
    h.apply(closePosition(h.state, id, 'all', h.ctx()));
    const [closed] = h.closed();
    expect(closed.realizedPnl).toBeCloseTo(-50, 8);
    expect(closed.entryFee + closed.exitFees).toBeCloseTo(9.975, 8);
    expect(netRealized(closed)).toBeCloseTo(-59.975, 8);
    expect(closed.exitQty).toBeCloseTo(0.2, 10);
    expect(closed.exitValue / closed.exitQty).toBeCloseTo((0.05 * 52_000 + 0.15 * 49_000) / 0.2, 6);
    expect(h.state.account.balance).toBeCloseTo(9_940.025, 8);
    expect(h.state.account.balance).toBeCloseTo(h.ledgerSum(), 8);
  });

  it('closes everything instead of leaving dust below the minimum size', () => {
    const h = harness();
    h.specs.set('BTCUSDT', { ...BTC, minQty: 0.0001 });
    h.quote('BTCUSDT', 50_000, 50_000);
    h.apply(placeOrder(h.state, req({ qty: 0.0002 }), h.ctx()));
    const id = h.state.positions[0].id;
    h.apply(closePosition(h.state, id, 0.00015, h.ctx()));
    expect(h.state.positions).toHaveLength(0);
    expect(h.closed()[0].exitQty).toBeCloseTo(0.0002, 10);
  });
});

describe('limit and stop entries', () => {
  it('reserves margin for a resting limit and fills it as maker at the limit price', () => {
    const h = harness();
    h.quote('BTCUSDT', 50_000, 50_000.1);
    h.apply(placeOrder(h.state, req({ type: 'limit', price: 49_000 }), h.ctx()));
    expect(h.state.orders).toHaveLength(1);
    expect(h.state.orders[0].reserved).toBeCloseTo(492.45, 8);
    expect(computeMetrics(h.state, h.quotes, h.now).available).toBeCloseTo(9_507.55, 8);
    h.apply(processQuote(h.state, h.quote('BTCUSDT', 49_200, 49_200.1), h.ctx()));
    expect(h.state.positions).toHaveLength(0);
    h.apply(processQuote(h.state, h.quote('BTCUSDT', 48_990, 48_990.1), h.ctx()));
    expect(h.state.orders).toHaveLength(0);
    const [p] = h.state.positions;
    expect(p.entryPrice).toBe(49_000);
    expect(p.entryFee).toBeCloseTo(0.98, 8); // maker 0.02%
    expect(h.fills().at(-1)!.liquidity).toBe('maker');
    expect(h.state.account.balance).toBeCloseTo(9_999.02, 8);
  });

  it('executes a marketable limit immediately as taker with price improvement', () => {
    const h = harness();
    h.quote('BTCUSDT', 50_000, 50_000.1);
    h.apply(placeOrder(h.state, req({ type: 'limit', price: 50_100 }), h.ctx()));
    expect(h.state.orders).toHaveLength(0);
    expect(h.state.positions[0].entryPrice).toBe(50_000.1);
    expect(h.fills()[0].liquidity).toBe('taker');
  });

  it('rejects stops that would trigger immediately', () => {
    const h = harness();
    h.quote('BTCUSDT', 50_000, 50_000.1);
    const v = validateOrder(h.state, req({ type: 'stop', price: 49_999 }), h.ctx());
    expect(v.ok).toBe(false);
    const v2 = validateOrder(h.state, req({ type: 'stop', side: 'sell', price: 50_001 }), h.ctx());
    expect(v2.ok).toBe(false);
  });

  it('triggers a buy stop and fills at the (gapped) ask', () => {
    const h = harness();
    h.quote('BTCUSDT', 50_000, 50_000.1);
    h.apply(placeOrder(h.state, req({ type: 'stop', price: 51_000 }), h.ctx()));
    h.apply(processQuote(h.state, h.quote('BTCUSDT', 50_998, 50_999), h.ctx()));
    expect(h.state.positions).toHaveLength(0);
    h.apply(processQuote(h.state, h.quote('BTCUSDT', 51_005.4, 51_005.5), h.ctx()));
    expect(h.state.positions[0].entryPrice).toBe(51_005.5);
    expect(h.fills()[0].liquidity).toBe('taker');
  });

  it('triggers a sell stop at the bid', () => {
    const h = harness();
    h.quote('BTCUSDT', 50_000, 50_000.1);
    h.apply(placeOrder(h.state, req({ type: 'stop', side: 'sell', price: 49_000 }), h.ctx()));
    h.apply(processQuote(h.state, h.quote('BTCUSDT', 48_900, 48_900.1), h.ctx()));
    expect(h.state.positions[0].side).toBe('short');
    expect(h.state.positions[0].entryPrice).toBe(48_900);
  });

  it('cancels an order and releases its reservation', () => {
    const h = harness();
    h.quote('BTCUSDT', 50_000, 50_000.1);
    const r = h.apply(placeOrder(h.state, req({ type: 'limit', price: 49_000 }), h.ctx()));
    h.apply(cancelOrder(h.state, r.orderId!, h.ctx()));
    expect(h.state.orders).toHaveLength(0);
    expect(computeMetrics(h.state, h.quotes, h.now).available).toBeCloseTo(10_000, 8);
    const cancelled = h.events.filter((e) => e.type === 'order').at(-1);
    expect(cancelled?.type === 'order' && cancelled.order.status).toBe('cancelled');
  });

  it('modifies a working order and re-reserves; moving it through the market fills it', () => {
    const h = harness();
    h.quote('BTCUSDT', 50_000, 50_000.1);
    const r = h.apply(placeOrder(h.state, req({ type: 'limit', price: 49_000 }), h.ctx()));
    h.apply(modifyOrder(h.state, r.orderId!, { price: 48_000 }, h.ctx()));
    expect(h.state.orders[0].price).toBe(48_000);
    expect(h.state.orders[0].reserved).toBeCloseTo(482.4, 8);
    h.apply(modifyOrder(h.state, r.orderId!, { price: 50_100 }, h.ctx()));
    expect(h.state.orders).toHaveLength(0);
    expect(h.state.positions[0].entryPrice).toBe(50_000.1);
  });
});

describe('protective exits', () => {
  function longWithBracket() {
    const h = harness();
    h.quote('BTCUSDT', 50_000, 50_000);
    h.apply(placeOrder(h.state, req({ sl: 49_000, tp: 52_000 }), h.ctx()));
    return h;
  }

  it('hits the stop-loss and fills at the bid as taker', () => {
    const h = longWithBracket();
    h.apply(processQuote(h.state, h.quote('BTCUSDT', 49_500), h.ctx()));
    expect(h.state.positions).toHaveLength(1);
    h.apply(processQuote(h.state, h.quote('BTCUSDT', 48_990, 48_990.5), h.ctx()));
    const [c] = h.closed();
    expect(c.closeReason).toBe('sl');
    expect(c.exitValue / c.exitQty).toBe(48_990);
    expect(c.realizedPnl).toBeCloseTo(-101, 8);
    expect(h.state.account.balance).toBeCloseTo(h.ledgerSum(), 8);
  });

  it('fills the take-profit at its price as maker', () => {
    const h = longWithBracket();
    h.apply(processQuote(h.state, h.quote('BTCUSDT', 52_000.5, 52_001), h.ctx()));
    const [c] = h.closed();
    expect(c.closeReason).toBe('tp');
    expect(c.exitValue / c.exitQty).toBe(52_000);
    expect(c.realizedPnl).toBeCloseTo(200, 8);
    expect(c.exitFees).toBeCloseTo(1.04, 8);
  });

  it('handles short brackets symmetrically', () => {
    const h = harness();
    h.quote('BTCUSDT', 50_000, 50_000);
    h.apply(placeOrder(h.state, req({ side: 'sell', sl: 51_000, tp: 48_000 }), h.ctx()));
    h.apply(processQuote(h.state, h.quote('BTCUSDT', 47_999, 48_000), h.ctx()));
    const [c] = h.closed();
    expect(c.closeReason).toBe('tp');
    expect(c.realizedPnl).toBeCloseTo(200, 8);
  });

  it('validates protective levels against the market', () => {
    const h = harness();
    h.quote('BTCUSDT', 50_000, 50_000);
    expect(validateOrder(h.state, req({ sl: 50_100 }), h.ctx()).ok).toBe(false);
    expect(validateOrder(h.state, req({ tp: 49_000 }), h.ctx()).ok).toBe(false);
    expect(validateOrder(h.state, req({ side: 'sell', sl: 49_000 }), h.ctx()).ok).toBe(false);
    h.apply(placeOrder(h.state, req({}), h.ctx()));
    const id = h.state.positions[0].id;
    expect(setProtection(h.state, id, { sl: 50_100 }, h.ctx()).error).toMatch(/below/);
    h.apply(setProtection(h.state, id, { sl: 49_000 }, h.ctx()));
    expect(h.state.positions[0].initialSl).toBe(49_000);
    h.apply(setProtection(h.state, id, { sl: 49_500, tp: 53_000 }, h.ctx()));
    expect(h.state.positions[0].sl).toBe(49_500);
    expect(h.state.positions[0].initialSl).toBe(49_000); // 1R is fixed by the first stop
    h.apply(setProtection(h.state, id, { sl: null }, h.ctx()));
    expect(h.state.positions[0].sl).toBeNull();
  });

  it('ratchets a trailing stop and exits with reason "trail"', () => {
    const h = harness();
    h.quote('BTCUSDT', 50_000, 50_000);
    h.apply(placeOrder(h.state, req({ trail: { mode: 'percent', value: 1 } }), h.ctx()));
    expect(h.state.positions[0].sl).toBe(49_500);
    expect(h.state.positions[0].initialSl).toBe(49_500);
    h.apply(processQuote(h.state, h.quote('BTCUSDT', 51_000), h.ctx()));
    expect(h.state.positions[0].sl).toBe(50_490);
    h.apply(processQuote(h.state, h.quote('BTCUSDT', 50_800), h.ctx()));
    expect(h.state.positions[0].sl).toBe(50_490); // never loosens
    h.apply(processQuote(h.state, h.quote('BTCUSDT', 50_480), h.ctx()));
    const [c] = h.closed();
    expect(c.closeReason).toBe('trail');
    expect(c.realizedPnl).toBeCloseTo(48, 8);
  });

  it('tracks max favourable and adverse excursion', () => {
    const h = harness();
    h.quote('BTCUSDT', 50_000, 50_000);
    h.apply(placeOrder(h.state, req({}), h.ctx()));
    for (const px of [50_300, 49_800, 50_600, 50_100]) h.apply(processQuote(h.state, h.quote('BTCUSDT', px), h.ctx()));
    expect(h.state.positions[0].mfe).toBe(600);
    expect(h.state.positions[0].mae).toBe(200);
  });
});

describe('liquidation', () => {
  it('computes isolated liquidation prices', () => {
    expect(liquidationPrice('long', 0.1, 50_000, 500, 0.005)).toBeCloseTo(4_500 / 0.0995, 6);
    expect(liquidationPrice('short', 0.1, 50_000, 500, 0.005)).toBeCloseTo(5_500 / 0.1005, 6);
    expect(liquidationPrice('long', 1, 100, 100, 0.005)).toBeNull(); // 1× long cannot be liquidated
  });

  it('liquidates and forfeits exactly the isolated margin', () => {
    const h = harness();
    h.quote('BTCUSDT', 50_000, 50_000);
    h.apply(placeOrder(h.state, req({}), h.ctx()));
    h.apply(processQuote(h.state, h.quote('BTCUSDT', 45_300), h.ctx()));
    expect(h.state.positions).toHaveLength(1);
    h.apply(processQuote(h.state, h.quote('BTCUSDT', 45_200), h.ctx()));
    const [c] = h.closed();
    expect(c.closeReason).toBe('liquidation');
    expect(netRealized(c)).toBeCloseTo(-502.5, 6); // margin 500 + entry fee 2.5
    expect(h.state.account.balance).toBeCloseTo(9_497.5, 6);
    expect(h.state.account.balance).toBeCloseTo(h.ledgerSum(), 8);
  });

  it('prefers the stop when it sits above the liquidation price', () => {
    const h = harness();
    h.quote('BTCUSDT', 50_000, 50_000);
    h.apply(placeOrder(h.state, req({ sl: 46_000 }), h.ctx()));
    h.apply(processQuote(h.state, h.quote('BTCUSDT', 45_900), h.ctx()));
    expect(h.closed()[0].closeReason).toBe('sl');
  });
});

describe('validation and risk rules', () => {
  it('rejects insufficient margin, bad steps, min notional and stale data', () => {
    const h = harness();
    h.quote('BTCUSDT', 50_000, 50_000);
    expect(validateOrder(h.state, req({ qty: 3 }), h.ctx())).toMatchObject({ ok: false, reason: expect.stringMatching(/Insufficient/) });
    expect(validateOrder(h.state, req({ qty: 0.000015 }), h.ctx()).ok).toBe(false);
    expect(validateOrder(h.state, req({ qty: 0.00001 }), h.ctx())).toMatchObject({ ok: false, reason: expect.stringMatching(/at least/) });
    expect(validateOrder(h.state, req({ leverage: 51 }), h.ctx()).ok).toBe(false);
    h.now = T0 + 31_000;
    expect(validateOrder(h.state, req({}), h.ctx())).toMatchObject({ ok: false, reason: expect.stringMatching(/stale/) });
  });

  it('records engine-side rejections in order history', () => {
    const h = harness();
    h.quote('BTCUSDT', 50_000, 50_000);
    const r = h.apply(placeOrder(h.state, req({ qty: 3 }), h.ctx()));
    expect(r.error).toMatch(/Insufficient/);
    const o = h.events.find((e) => e.type === 'order');
    expect(o?.type === 'order' && o.order.status).toBe('rejected');
  });

  it('enforces stop-loss, max risk and max positions rules', () => {
    const h = harness({ config: cfg({ slippageBps: 0, risk: { dailyLossLimitPct: null, requireStopLoss: true, maxRiskPerTradePct: 1, maxOpenPositions: 1 } }) });
    h.quote('BTCUSDT', 50_000, 50_000);
    expect(validateOrder(h.state, req({}), h.ctx())).toMatchObject({ ok: false, reason: expect.stringMatching(/stop-loss/) });
    // 0.1 BTC with a 1,000 stop risks 100 + fees ≈ 1.05% of equity
    expect(validateOrder(h.state, req({ sl: 49_000 }), h.ctx())).toMatchObject({ ok: false, reason: expect.stringMatching(/1% limit/) });
    expect(validateOrder(h.state, req({ qty: 0.09, sl: 49_000 }), h.ctx()).ok).toBe(true);
    h.apply(placeOrder(h.state, req({ qty: 0.09, sl: 49_000 }), h.ctx()));
    expect(validateOrder(h.state, req({ qty: 0.01, sl: 49_000 }), h.ctx())).toMatchObject({ ok: false, reason: expect.stringMatching(/max 1/) });
  });

  it('locks entries after the daily loss limit and lifts the lock next UTC day', () => {
    const h = harness({ config: cfg({ slippageBps: 0, risk: { dailyLossLimitPct: 5 } }) });
    h.quote('BTCUSDT', 50_000, 50_000);
    h.apply(placeOrder(h.state, req({ qty: 1 }), h.ctx()));
    h.apply(placeOrder(h.state, req({ type: 'limit', price: 40_000, qty: 0.01 }), h.ctx()));
    h.quote('BTCUSDT', 49_600);
    h.apply(evaluateRisk(h.state, h.ctx()));
    expect(h.state.account.locked).toBeNull(); // −425 = −4.25%
    h.quote('BTCUSDT', 49_500);
    h.apply(evaluateRisk(h.state, h.ctx()));
    expect(h.state.account.locked?.reason).toBe('daily');
    expect(h.state.orders).toHaveLength(0); // working orders cancelled
    expect(h.state.positions).toHaveLength(1); // not flattened by default
    expect(validateOrder(h.state, req({ qty: 0.01 }), h.ctx())).toMatchObject({ ok: false, reason: expect.stringMatching(/Daily loss/) });
    h.now = Date.UTC(2026, 9, 20, 0, 0, 1);
    h.quote('BTCUSDT', 49_500);
    h.apply(evaluateRisk(h.state, h.ctx()));
    expect(h.state.account.locked).toBeNull();
    expect(h.state.account.dayKey).toBe('2026-10-20');
    expect(h.state.account.dayStartEquity).toBeCloseTo(10_000 - 25 - 500, 6);
  });

  it('can flatten positions on a risk lock', () => {
    const h = harness({ config: cfg({ slippageBps: 0, risk: { dailyLossLimitPct: 2, flattenOnDailyLimit: true } }) });
    h.quote('BTCUSDT', 50_000, 50_000);
    h.apply(placeOrder(h.state, req({ qty: 1 }), h.ctx()));
    h.quote('BTCUSDT', 49_700);
    h.apply(evaluateRisk(h.state, h.ctx()));
    expect(h.state.positions).toHaveLength(0);
    expect(h.closed()[0].closeReason).toBe('risk');
  });

  it('locks on max drawdown until manually reviewed', () => {
    const h = harness({ config: cfg({ slippageBps: 0, risk: { dailyLossLimitPct: null, maxDrawdownPct: 10 } }) });
    h.quote('BTCUSDT', 50_000, 50_000);
    h.apply(placeOrder(h.state, req({ qty: 1 }), h.ctx()));
    h.quote('BTCUSDT', 49_000);
    h.apply(evaluateRisk(h.state, h.ctx()));
    expect(h.state.account.locked?.reason).toBe('drawdown');
    h.apply(unlockAccount(h.state, h.ctx()));
    expect(h.state.account.locked).toBeNull();
    expect(h.state.account.peakEquity).toBeCloseTo(10_000 - 25 - 1_000, 6);
  });
});

describe('candle replay (offline catch-up)', () => {
  const H = 60_000;
  function bracket() {
    const h = harness();
    h.quote('BTCUSDT', 50_000, 50_000);
    h.apply(placeOrder(h.state, req({ sl: 49_000, tp: 52_000 }), h.ctx()));
    return h;
  }

  it('walks bullish candles low-first and fills the stop at its level', () => {
    const h = bracket();
    h.apply(processBar(h.state, 'BTCUSDT', { time: T0 + H, open: 50_000, high: 52_500, low: 48_500, close: 51_000 }, H, h.ctx()));
    const [c] = h.closed();
    expect(c.closeReason).toBe('sl');
    expect(c.exitValue / c.exitQty).toBe(49_000);
    expect(h.fills().at(-1)!.source).toBe('replay');
  });

  it('walks bearish candles high-first', () => {
    const h = bracket();
    h.apply(processBar(h.state, 'BTCUSDT', { time: T0 + H, open: 50_000, high: 52_500, low: 48_500, close: 49_500 }, H, h.ctx()));
    expect(h.closed()[0].closeReason).toBe('tp');
  });

  it('fills at the open when the market gaps through a stop', () => {
    const h = bracket();
    h.apply(processBar(h.state, 'BTCUSDT', { time: T0 + H, open: 48_000, high: 48_200, low: 47_900, close: 48_100 }, H, h.ctx()));
    const [c] = h.closed();
    expect(c.exitValue / c.exitQty).toBe(48_000);
  });

  it('never applies history from before an order or position existed', () => {
    const h = harness();
    h.quote('BTCUSDT', 50_000, 50_000);
    h.apply(placeOrder(h.state, req({ sl: 49_000 }), h.ctx()));
    h.apply(placeOrder(h.state, req({ type: 'limit', price: 48_000 }), h.ctx()));
    // A candle that printed an hour before the trade would have hit both the stop and the limit.
    h.apply(processBar(h.state, 'BTCUSDT', { time: T0 - 3_600_000, open: 50_000, high: 50_100, low: 47_000, close: 50_000 }, H, h.ctx()));
    expect(h.state.positions).toHaveLength(1);
    expect(h.state.orders).toHaveLength(1);
    expect(h.closed()).toHaveLength(0);
  });

  it('can fill an entry and its stop inside the same candle', () => {
    const h = harness();
    h.quote('BTCUSDT', 50_000, 50_000);
    h.apply(placeOrder(h.state, req({ type: 'limit', price: 49_000, sl: 48_000 }), h.ctx()));
    h.apply(processBar(h.state, 'BTCUSDT', { time: T0 + H, open: 50_000, high: 50_500, low: 47_500, close: 50_200 }, H, h.ctx()));
    const [c] = h.closed();
    expect(c.entryPrice).toBe(49_000);
    expect(c.exitValue / c.exitQty).toBe(48_000);
    expect(c.closedAt!).toBeGreaterThan(c.openedAt);
    expect(c.closedAt! - T0 - H).toBeLessThan(H);
  });
});

describe('accounting invariants', () => {
  it('keeps balance equal to deposits plus net results across a random session', () => {
    const h = harness({ balance: 50_000, config: cfg({ slippageBps: 2, risk: { dailyLossLimitPct: null } }) });
    let px = 50_000;
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 400; i++) {
      px = Math.round(px * (1 + (rnd() - 0.5) * 0.004) * 100) / 100;
      const q = h.quote('BTCUSDT', px, px + 0.1);
      h.apply(processQuote(h.state, q, h.ctx()));
      const roll = rnd();
      if (roll < 0.08) {
        const side = rnd() < 0.5 ? 'buy' : 'sell';
        const sl = side === 'buy' ? Math.round(px * 0.99) : Math.round(px * 1.01);
        const tp = side === 'buy' ? Math.round(px * 1.015) : Math.round(px * 0.985);
        h.apply(placeOrder(h.state, req({ side, qty: 0.05, leverage: 1 + Math.floor(rnd() * 20), sl, tp }), h.ctx()));
      } else if (roll < 0.1 && h.state.positions.length) {
        h.apply(closePosition(h.state, h.state.positions[0].id, 0.02, h.ctx()));
      }
      h.now += 1_000;
    }
    for (const p of h.state.positions) h.apply(closePosition(h.state, p.id, 'all', h.ctx()));
    const closed = h.closed();
    expect(closed.length).toBeGreaterThan(5);
    const net = closed.reduce((s, p) => s + netRealized(p), 0);
    expect(h.state.account.balance).toBeCloseTo(50_000 + net, 6);
    expect(h.state.account.balance).toBeCloseTo(h.ledgerSum(), 6);
    expect(computeMetrics(h.state, h.quotes, h.now).available).toBeCloseTo(h.state.account.balance, 6);
  });

  it('agrees with the loss-at-stop estimate used by the ticket', () => {
    const h = harness();
    h.quote('BTCUSDT', 50_000, 50_000);
    h.apply(placeOrder(h.state, req({ sl: 49_000 }), h.ctx()));
    h.apply(processQuote(h.state, h.quote('BTCUSDT', 49_000), h.ctx()));
    const [c] = h.closed();
    expect(-netRealized(c)).toBeCloseTo(lossAtStop('long', 0.1, 50_000, 49_000, 0.0005, 0.0005), 8);
  });
});

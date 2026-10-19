import type { Position, PositionSide, Quote, OrderSide, TrailSpec } from './types';
import { money } from './num';

export const dir = (side: PositionSide): 1 | -1 => (side === 'long' ? 1 : -1);
export const openSideFor = (side: PositionSide): OrderSide => (side === 'long' ? 'buy' : 'sell');
export const closeSideFor = (side: PositionSide): OrderSide => (side === 'long' ? 'sell' : 'buy');
export const positionSideFor = (side: OrderSide): PositionSide => (side === 'buy' ? 'long' : 'short');

export function notional(qty: number, price: number): number {
  return money(qty * price);
}

export function initialMargin(qty: number, price: number, leverage: number): number {
  return money((qty * price) / leverage);
}

export function fee(qty: number, price: number, rate: number): number {
  return money(qty * price * rate);
}

/** Gross P&L of `qty` units moving from entry to exit. */
export function grossPnl(side: PositionSide, qty: number, entry: number, exit: number): number {
  return money(dir(side) * qty * (exit - entry));
}

/**
 * Isolated-margin liquidation price.
 * Liquidation happens when margin + uPnL falls to maintenance margin (mmr × notional at mark).
 *   long:  M + q(P − E) = mmr·q·P  →  P = (qE − M) / (q(1 − mmr))
 *   short: M + q(E − P) = mmr·q·P  →  P = (qE + M) / (q(1 + mmr))
 * Returns null when the position cannot be liquidated (e.g. a 1× long).
 */
export function liquidationPrice(
  side: PositionSide,
  qty: number,
  entry: number,
  margin: number,
  mmr: number,
): number | null {
  if (qty <= 0) return null;
  if (side === 'long') {
    const p = (qty * entry - margin) / (qty * (1 - mmr));
    return p > 0 ? p : null;
  }
  return (qty * entry + margin) / (qty * (1 + mmr));
}

export function liquidationPriceFor(p: Pick<Position, 'side' | 'qty' | 'entryPrice' | 'margin'>, mmr: number) {
  return liquidationPrice(p.side, p.qty, p.entryPrice, p.margin, mmr);
}

/** Price you would get closing now: bid for longs, ask for shorts. */
export function exitPriceOf(side: PositionSide, q: Pick<Quote, 'bid' | 'ask'>): number {
  return side === 'long' ? q.bid : q.ask;
}

/** Price you pay entering now: ask for buys, bid for sells. */
export function entryPriceOf(side: OrderSide, q: Pick<Quote, 'bid' | 'ask'>): number {
  return side === 'buy' ? q.ask : q.bid;
}

export function mid(q: Pick<Quote, 'bid' | 'ask'>): number {
  return (q.bid + q.ask) / 2;
}

export function unrealizedPnl(p: Pick<Position, 'side' | 'qty' | 'entryPrice'>, q: Pick<Quote, 'bid' | 'ask'>): number {
  return grossPnl(p.side, p.qty, p.entryPrice, exitPriceOf(p.side, q));
}

/** Apply adverse slippage (bps) to a taker fill price. */
export function slip(side: OrderSide, price: number, bps: number): number {
  const k = bps / 10_000;
  return side === 'buy' ? price * (1 + k) : price * (1 - k);
}

export function trailDistance(trail: TrailSpec, anchor: number): number {
  return trail.mode === 'percent' ? (anchor * trail.value) / 100 : trail.value;
}

/** Stop level implied by a trailing spec at the given anchor (best price). */
export function trailStopAt(side: PositionSide, trail: TrailSpec, anchor: number): number {
  const d = trailDistance(trail, anchor);
  return side === 'long' ? anchor - d : anchor + d;
}

/** Reward-to-risk ratio for an entry with stop and target. Null when undefined. */
export function rewardRisk(side: PositionSide, entry: number, sl: number | null, tp: number | null): number | null {
  if (sl == null || tp == null) return null;
  const risk = dir(side) * (entry - sl);
  const reward = dir(side) * (tp - entry);
  if (risk <= 0 || reward <= 0) return null;
  return reward / risk;
}

/** Loss (positive number) if the stop is hit, including round-trip fees. */
export function lossAtStop(
  side: PositionSide,
  qty: number,
  entry: number,
  sl: number,
  entryFeeRate: number,
  exitFeeRate: number,
): number {
  const move = dir(side) * (entry - sl) * qty; // positive when stop is on the losing side
  return money(move + qty * entry * entryFeeRate + qty * sl * exitFeeRate);
}

export function gainAtTarget(
  side: PositionSide,
  qty: number,
  entry: number,
  tp: number,
  entryFeeRate: number,
  exitFeeRate: number,
): number {
  const move = dir(side) * (tp - entry) * qty;
  return money(move - qty * entry * entryFeeRate - qty * tp * exitFeeRate);
}

/** Net P&L of a (possibly still open) position: realized − all fees. */
export function netRealized(p: Pick<Position, 'realizedPnl' | 'entryFee' | 'exitFees'>): number {
  return money(p.realizedPnl - p.entryFee - p.exitFees);
}

export function avgExitPrice(p: Pick<Position, 'exitQty' | 'exitValue'>): number | null {
  return p.exitQty > 0 ? p.exitValue / p.exitQty : null;
}

/** Initial risk (1R) in quote currency, excluding fees. */
export function initialRisk(p: Pick<Position, 'initialQty' | 'entryPrice' | 'initialSl' | 'side'>): number | null {
  if (p.initialSl == null) return null;
  const r = dir(p.side) * (p.entryPrice - p.initialSl) * p.initialQty;
  return r > 0 ? r : null;
}

export function rMultiple(p: Position): number | null {
  const r = initialRisk(p);
  if (r == null) return null;
  return netRealized(p) / r;
}

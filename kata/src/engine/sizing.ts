import type { PositionSide, SymbolSpec } from './types';
import { dir } from './margin';
import { floorToStep } from './num';

/**
 * Position size that loses `riskAmount` (quote currency) if the stop is hit,
 * accounting for taker fees on both entry and exit. Rounded down to the lot step.
 */
export function sizeForRisk(opts: {
  side: PositionSide;
  riskAmount: number;
  entry: number;
  stop: number;
  takerFee: number;
  spec: Pick<SymbolSpec, 'stepSize'>;
}): number {
  const perUnit = dir(opts.side) * (opts.entry - opts.stop) + opts.entry * opts.takerFee + opts.stop * opts.takerFee;
  if (!(perUnit > 0) || !(opts.riskAmount > 0)) return 0;
  return floorToStep(opts.riskAmount / perUnit, opts.spec.stepSize);
}

/** Size whose initial margin + entry fee uses `amount` of available balance. */
export function sizeForMargin(opts: {
  amount: number;
  price: number;
  leverage: number;
  takerFee: number;
  spec: Pick<SymbolSpec, 'stepSize'>;
}): number {
  const perUnit = opts.price / opts.leverage + opts.price * opts.takerFee;
  if (!(perUnit > 0) || !(opts.amount > 0)) return 0;
  return floorToStep(opts.amount / perUnit, opts.spec.stepSize);
}

export function sizeForNotional(notional: number, price: number, spec: Pick<SymbolSpec, 'stepSize'>): number {
  if (!(price > 0) || !(notional > 0)) return 0;
  return floorToStep(notional / price, spec.stepSize);
}

/** Price `pct` percent away from `from` in the losing (stop) or winning (target) direction. */
export function offsetPrice(side: PositionSide, from: number, pct: number, kind: 'stop' | 'target'): number {
  const sign = kind === 'target' ? dir(side) : -dir(side);
  return from * (1 + (sign * pct) / 100);
}

/** Target price at a given reward multiple of the stop distance. */
export function targetForR(side: PositionSide, entry: number, stop: number, r: number): number {
  return entry + dir(side) * Math.abs(entry - stop) * r;
}

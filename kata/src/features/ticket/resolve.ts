import { validateOrder, type Validation } from '@/engine/engine';
import { entryPriceOf, fee as feeOf, gainAtTarget, initialMargin, liquidationPrice, lossAtStop, positionSideFor, rewardRisk } from '@/engine/margin';
import { floorToStep, roundToStep } from '@/engine/num';
import { sizeForNotional, sizeForRisk } from '@/engine/sizing';
import type { AccountMetrics, EngineContext, EngineState, OrderRequest, OrderSide, Quote, SymbolSpec } from '@/engine/types';
import { parseNum } from '@/lib/format';
import type { TicketDraft } from '@/store/ui';

export interface ResolvedTicket {
  orderSide: OrderSide;
  /** Limit/stop price as entered (rounded to tick), null for market or empty. */
  price: number | null;
  /** Expected entry price. */
  ref: number | null;
  qty: number;
  sl: number | null;
  tp: number | null;
  notional: number;
  margin: number;
  fee: number;
  liq: number | null;
  /** Loss if the stop is hit, including round-trip fees (positive number). */
  risk: number | null;
  riskPct: number | null;
  reward: number | null;
  rr: number | null;
  req: OrderRequest | null;
  validation: Validation | null;
  /** Problem with the draft itself (before engine validation). */
  issue: string | null;
}

export function resolveTicket(
  d: TicketDraft,
  o: {
    symbol: string;
    spec: SymbolSpec;
    quote: Quote | undefined;
    metrics: AccountMetrics | null;
    engine: EngineState | null;
    ctx: Pick<EngineContext, 'now' | 'quotes' | 'specs'>;
  },
): ResolvedTicket {
  const { spec, quote, metrics, engine } = o;
  const cfg = engine?.account.config;
  const orderSide: OrderSide = d.side === 'long' ? 'buy' : 'sell';
  const side = positionSideFor(orderSide);
  const rawPrice = parseNum(d.price);
  const price = d.type !== 'market' && rawPrice > 0 ? roundToStep(rawPrice, spec.tickSize) : null;

  let ref: number | null = null;
  if (quote) {
    const touch = entryPriceOf(orderSide, quote);
    if (d.type === 'market') ref = touch;
    else if (price != null) ref = d.type === 'limit' ? (orderSide === 'buy' ? Math.min(price, touch) : Math.max(price, touch)) : price;
  } else if (price != null) ref = price;

  const slRaw = parseNum(d.sl);
  const tpRaw = parseNum(d.tp);
  const sl = d.slOn && slRaw > 0 ? roundToStep(slRaw, spec.tickSize) : null;
  const tp = d.tpOn && tpRaw > 0 ? roundToStep(tpRaw, spec.tickSize) : null;

  let qty = 0;
  let issue: string | null = null;
  const sizeIn = parseNum(d.size);
  if (ref != null && sizeIn > 0) {
    if (d.sizeMode === 'qty') qty = floorToStep(sizeIn, spec.stepSize);
    else if (d.sizeMode === 'notional') qty = sizeForNotional(sizeIn, ref, spec);
    else if (d.sizeMode === 'risk') {
      if (sl == null) issue = 'Risk-based sizing needs a stop-loss';
      else if (!metrics) issue = 'Account not ready';
      else qty = sizeForRisk({ side, riskAmount: (metrics.equity * sizeIn) / 100, entry: ref, stop: sl, takerFee: cfg?.takerFee ?? 0, spec });
    }
  }

  const notional = ref != null ? qty * ref : 0;
  const margin = ref != null ? initialMargin(qty, ref, d.leverage) : 0;
  const fee = ref != null ? feeOf(qty, ref, cfg?.takerFee ?? 0) : 0;
  const liq = ref != null && qty > 0 ? liquidationPrice(side, qty, ref, margin, cfg?.maintenanceMargin ?? 0.005) : null;
  const risk = ref != null && sl != null && qty > 0 ? lossAtStop(side, qty, ref, sl, cfg?.takerFee ?? 0, cfg?.takerFee ?? 0) : null;
  const reward = ref != null && tp != null && qty > 0 ? gainAtTarget(side, qty, ref, tp, cfg?.takerFee ?? 0, cfg?.makerFee ?? 0) : null;
  const rr = ref != null ? rewardRisk(side, ref, sl, tp) : null;
  const riskPct = risk != null && metrics && metrics.equity > 0 ? (risk / metrics.equity) * 100 : null;

  const trail = d.trailOn && d.trail.value > 0 ? d.trail : null;
  const req: OrderRequest | null =
    qty > 0 && (d.type === 'market' || price != null)
      ? { symbol: o.symbol, side: orderSide, type: d.type, qty, price: d.type === 'market' ? null : price, leverage: d.leverage, sl, tp, trail }
      : null;
  const validation = req && engine && !issue ? validateOrder(engine, req, o.ctx) : null;
  if (!issue && d.type !== 'market' && price == null && sizeIn > 0) issue = `Enter a ${d.type} price`;
  // A protective level that is switched on must never be dropped silently.
  if (!issue && d.slOn && sl == null) issue = 'Enter a valid stop-loss price, or switch the stop off';
  if (!issue && d.tpOn && tp == null) issue = 'Enter a valid take-profit price, or switch the target off';

  return { orderSide, price, ref, qty, sl, tp, notional, margin, fee, liq, risk, riskPct, reward, rr, req, validation, issue };
}

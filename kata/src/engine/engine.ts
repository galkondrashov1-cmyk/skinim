import type {
  Account,
  AccountConfig,
  AccountMetrics,
  CloseReason,
  EngineContext,
  EngineEvent,
  EngineResult,
  EngineState,
  Fill,
  LedgerEntry,
  LedgerType,
  Liquidity,
  Notice,
  Order,
  OrderRequest,
  OrderType,
  Position,
  PositionSide,
  PriceSource,
  Quote,
  SymbolSpec,
  TrailSpec,
} from './types';
import {
  closeSideFor,
  dir,
  entryPriceOf,
  exitPriceOf,
  fee as feeOf,
  grossPnl,
  initialMargin,
  liquidationPriceFor,
  mid,
  netRealized,
  positionSideFor,
  slip,
  trailStopAt,
  unrealizedPnl,
} from './margin';
import { ceilToStep, floorToStep, isMultipleOf, money, nextUtcMidnight, roundToStep, stepDecimals, utcDayKey } from './num';

/** Quotes older than this cannot be used to execute market orders. */
export const STALE_QUOTE_MS = 30_000;

export const DEFAULT_CONFIG: AccountConfig = {
  takerFee: 0.0005,
  makerFee: 0.0002,
  slippageBps: 1,
  maintenanceMargin: 0.005,
  maxLeverage: 50,
  risk: {
    dailyLossLimitPct: 5,
    maxDrawdownPct: null,
    maxRiskPerTradePct: null,
    requireStopLoss: false,
    maxOpenPositions: null,
    flattenOnDailyLimit: false,
  },
};

export function createAccount(opts: {
  id: string;
  name: string;
  initialBalance: number;
  now: number;
  config?: AccountConfig;
  ledgerId: string;
}): { account: Account; ledger: LedgerEntry } {
  const account: Account = {
    id: opts.id,
    name: opts.name,
    currency: 'USDT',
    initialBalance: money(opts.initialBalance),
    balance: money(opts.initialBalance),
    createdAt: opts.now,
    config: structuredClone(opts.config ?? DEFAULT_CONFIG),
    peakEquity: money(opts.initialBalance),
    dayKey: utcDayKey(opts.now),
    dayStartEquity: money(opts.initialBalance),
    locked: null,
    lastProcessedAt: opts.now,
    nextNo: 1,
  };
  const ledger: LedgerEntry = {
    id: opts.ledgerId,
    accountId: opts.id,
    ts: opts.now,
    type: 'deposit',
    amount: account.balance,
    balanceAfter: account.balance,
    ref: null,
    note: 'Initial paper capital',
  };
  return { account, ledger };
}

// ───────────────────────────────────────────────────────────── metrics ──

export function computeMetrics(state: EngineState, quotes: ReadonlyMap<string, Quote>, now = Date.now()): AccountMetrics {
  const { account } = state;
  let upnl = 0;
  let positionMargin = 0;
  let gross = 0;
  let net = 0;
  let openRisk = 0;
  for (const p of state.positions) {
    positionMargin += p.margin;
    const q = quotes.get(p.symbol);
    const mark = q ? exitPriceOf(p.side, q) : p.entryPrice;
    if (q) upnl += unrealizedPnl(p, q);
    gross += p.qty * mark;
    net += dir(p.side) * p.qty * mark;
    if (p.sl != null) openRisk += Math.max(0, dir(p.side) * (p.entryPrice - p.sl) * p.qty);
    else openRisk += p.margin;
  }
  const orderMargin = state.orders.reduce((s, o) => s + (o.status === 'working' ? o.reserved : 0), 0);
  const equity = money(account.balance + upnl);
  const peak = Math.max(account.peakEquity, equity);
  const dayStart = account.dayKey === utcDayKey(now) ? account.dayStartEquity : equity;
  const dayPnl = money(equity - dayStart);
  return {
    balance: account.balance,
    equity,
    unrealizedPnl: money(upnl),
    positionMargin: money(positionMargin),
    orderMargin: money(orderMargin),
    available: money(account.balance - positionMargin - orderMargin),
    grossExposure: money(gross),
    netExposure: money(net),
    effectiveLeverage: equity > 0 ? gross / equity : 0,
    dayPnl,
    dayPnlPct: dayStart > 0 ? (dayPnl / dayStart) * 100 : 0,
    drawdownPct: peak > 0 ? Math.max(0, ((peak - equity) / peak) * 100) : 0,
    peakEquity: money(peak),
    openRisk: money(openRisk),
  };
}

// ────────────────────────────────────────────────────────── validation ──

export type Validation = { ok: true; refPrice: number; margin: number; fee: number } | { ok: false; reason: string };

function fmtPrice(x: number, spec: SymbolSpec | undefined): string {
  const d = spec ? stepDecimals(spec.tickSize) : 2;
  return x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtQty(x: number, spec: SymbolSpec | undefined): string {
  const d = spec ? stepDecimals(spec.stepSize) : 4;
  return x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtMoney(x: number): string {
  const s = Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (x < 0 ? '−' : x > 0 ? '+' : '') + s;
}

export function quoteIsFresh(q: Quote | undefined, now: number): q is Quote {
  return !!q && now - q.ts <= STALE_QUOTE_MS && q.bid > 0 && q.ask > 0;
}

/**
 * Validate an entry order. The UI calls this on every keystroke so the
 * ticket and the engine always agree on what is allowed.
 */
export function validateOrder(
  state: EngineState,
  req: OrderRequest,
  ctx: Pick<EngineContext, 'now' | 'quotes' | 'specs'>,
  opts: { excludeOrderId?: string } = {},
): Validation {
  const { account } = state;
  const cfg = account.config;
  const spec = ctx.specs.get(req.symbol);
  if (!spec) return { ok: false, reason: 'Unknown instrument' };
  if (account.locked) return { ok: false, reason: account.locked.message };
  if (!(req.qty > 0)) return { ok: false, reason: 'Enter a size' };
  if (!isMultipleOf(req.qty, spec.stepSize)) return { ok: false, reason: `Size must be a multiple of ${spec.stepSize}` };
  if (req.qty < spec.minQty) return { ok: false, reason: `Minimum size is ${fmtQty(spec.minQty, spec)} ${spec.base}` };
  if (!Number.isInteger(req.leverage) || req.leverage < 1 || req.leverage > cfg.maxLeverage)
    return { ok: false, reason: `Leverage must be 1–${cfg.maxLeverage}×` };

  const q = ctx.quotes.get(req.symbol);
  if (!quoteIsFresh(q, ctx.now)) return { ok: false, reason: 'No current price — market data is stale or offline' };

  const side = positionSideFor(req.side);
  let ref: number;
  if (req.type === 'market') {
    ref = entryPriceOf(req.side, q);
  } else {
    if (req.price == null || !(req.price > 0)) return { ok: false, reason: 'Enter a price' };
    if (!isMultipleOf(req.price, spec.tickSize)) return { ok: false, reason: `Price must be a multiple of ${spec.tickSize}` };
    if (req.type === 'stop') {
      if (req.side === 'buy' && req.price <= q.ask)
        return { ok: false, reason: `Buy stop must be above the ask (${fmtPrice(q.ask, spec)})` };
      if (req.side === 'sell' && req.price >= q.bid)
        return { ok: false, reason: `Sell stop must be below the bid (${fmtPrice(q.bid, spec)})` };
      ref = req.price;
    } else {
      // A marketable limit executes immediately at the touch (price improvement).
      ref = req.side === 'buy' ? Math.min(req.price, q.ask) : Math.max(req.price, q.bid);
    }
  }

  const notionalValue = req.qty * ref;
  if (notionalValue < spec.minNotional)
    return { ok: false, reason: `Order value must be at least ${spec.minNotional} ${spec.quote}` };

  // Protective levels must sit on the correct side of the entry.
  if (req.sl != null) {
    if (!(req.sl > 0)) return { ok: false, reason: 'Invalid stop-loss' };
    const exitNow = req.type === 'market' ? exitPriceOf(side, q) : ref;
    if (side === 'long' && !(req.sl < Math.min(ref, exitNow))) return { ok: false, reason: 'Stop-loss must be below entry for a long' };
    if (side === 'short' && !(req.sl > Math.max(ref, exitNow))) return { ok: false, reason: 'Stop-loss must be above entry for a short' };
  }
  if (req.tp != null) {
    if (!(req.tp > 0)) return { ok: false, reason: 'Invalid take-profit' };
    if (side === 'long' && !(req.tp > ref)) return { ok: false, reason: 'Take-profit must be above entry for a long' };
    if (side === 'short' && !(req.tp < ref)) return { ok: false, reason: 'Take-profit must be below entry for a short' };
  }
  if (req.trail != null && !(req.trail.value > 0)) return { ok: false, reason: 'Trailing distance must be positive' };

  const margin = initialMargin(req.qty, ref, req.leverage);
  const fee = feeOf(req.qty, ref, cfg.takerFee);
  const metrics = computeMetrics(state, ctx.quotes, ctx.now);
  const released = opts.excludeOrderId ? (state.orders.find((o) => o.id === opts.excludeOrderId)?.reserved ?? 0) : 0;
  const available = metrics.available + released;
  if (margin + fee > available + 1e-9)
    return {
      ok: false,
      reason: `Insufficient margin: needs ${fmtMoney(margin + fee).replace('+', '')} USDT, available ${fmtMoney(Math.max(0, available)).replace('+', '')}`,
    };

  // Discipline rules.
  const rules = cfg.risk;
  if (rules.requireStopLoss && req.sl == null) return { ok: false, reason: 'Risk rule: every entry needs a stop-loss' };
  if (rules.maxOpenPositions != null) {
    const open = state.positions.length + state.orders.filter((o) => o.status === 'working' && o.id !== opts.excludeOrderId).length;
    if (open >= rules.maxOpenPositions) return { ok: false, reason: `Risk rule: max ${rules.maxOpenPositions} open positions/orders` };
  }
  if (rules.maxRiskPerTradePct != null && metrics.equity > 0) {
    const risk =
      req.sl != null
        ? req.qty * Math.abs(ref - req.sl) + fee + feeOf(req.qty, req.sl, cfg.takerFee)
        : margin + fee; // without a stop the isolated margin is the maximum loss
    const pct = (risk / metrics.equity) * 100;
    if (pct > rules.maxRiskPerTradePct + 1e-9)
      return {
        ok: false,
        reason: `Risk rule: ${pct.toFixed(2)}% of equity at risk exceeds the ${rules.maxRiskPerTradePct}% limit`,
      };
  }
  return { ok: true, refPrice: ref, margin, fee };
}

/** Validate new protective levels for an open position against the current market. */
export function validateProtection(
  p: Pick<Position, 'side' | 'entryPrice'>,
  levels: { sl?: number | null; tp?: number | null },
  quote: Quote | undefined,
): string | null {
  const exitNow = quote ? exitPriceOf(p.side, quote) : p.entryPrice;
  if (levels.sl != null) {
    if (!(levels.sl > 0)) return 'Invalid stop-loss';
    if (p.side === 'long' && !(levels.sl < exitNow)) return 'Stop-loss must be below the current bid';
    if (p.side === 'short' && !(levels.sl > exitNow)) return 'Stop-loss must be above the current ask';
  }
  if (levels.tp != null) {
    if (!(levels.tp > 0)) return 'Invalid take-profit';
    if (p.side === 'long' && !(levels.tp > exitNow)) return 'Take-profit must be above the current bid';
    if (p.side === 'short' && !(levels.tp < exitNow)) return 'Take-profit must be below the current ask';
  }
  return null;
}

// ────────────────────────────────────────────────────────── transaction ──

class Tx {
  account: Account;
  positions: Position[];
  orders: Order[];
  events: EngineEvent[] = [];
  private accountDirty = false;
  private readonly ctx: EngineContext;

  constructor(state: EngineState, ctx: EngineContext) {
    this.account = { ...state.account };
    this.positions = state.positions.slice();
    this.orders = state.orders.slice();
    this.ctx = ctx;
  }

  spec(symbol: string) {
    return this.ctx.specs.get(symbol);
  }

  touchAccount() {
    this.accountDirty = true;
  }

  notice(n: Notice) {
    this.events.push({ type: 'notice', notice: n });
  }

  nextNo(): number {
    const n = this.account.nextNo;
    this.account.nextNo = n + 1;
    this.touchAccount();
    return n;
  }

  ledger(type: LedgerType, amount: number, ts: number, ref: string | null, note: string | null) {
    if (amount === 0 && type !== 'deposit') return;
    this.account.balance = money(this.account.balance + amount);
    this.touchAccount();
    this.events.push({
      type: 'ledger',
      entry: {
        id: this.ctx.ids(),
        accountId: this.account.id,
        ts,
        type,
        amount: money(amount),
        balanceAfter: this.account.balance,
        ref,
        note,
      },
    });
  }

  putOrder(o: Order) {
    const i = this.orders.findIndex((x) => x.id === o.id);
    if (o.status === 'working') {
      if (i === -1) this.orders.push(o);
      else this.orders[i] = o;
    } else if (i !== -1) {
      this.orders.splice(i, 1);
    }
    this.events.push({ type: 'order', order: o });
  }

  putPosition(p: Position, emit = true) {
    const i = this.positions.findIndex((x) => x.id === p.id);
    if (p.status === 'open') {
      if (i === -1) this.positions.push(p);
      else this.positions[i] = p;
    } else if (i !== -1) {
      this.positions.splice(i, 1);
    }
    if (emit) this.events.push({ type: 'position', position: p });
  }

  result(): EngineResult {
    if (this.accountDirty) this.events.unshift({ type: 'account', account: this.account });
    return { state: { account: this.account, positions: this.positions, orders: this.orders }, events: this.events };
  }

  /** Execute an entry order: open a new position. */
  fillEntry(order: Order, price: number, liquidity: Liquidity, ts: number, source: PriceSource): Position | null {
    const spec = this.spec(order.symbol);
    const cfg = this.account.config;
    const px = price;
    const margin = initialMargin(order.qty, px, order.leverage);
    const fee = feeOf(order.qty, px, liquidity === 'maker' ? cfg.makerFee : cfg.takerFee);

    // Funds check at execution (the reservation was an estimate).
    const metrics = computeMetrics({ account: this.account, positions: this.positions, orders: this.orders }, this.ctx.quotes, ts);
    const available = metrics.available + (order.status === 'working' ? order.reserved : 0);
    if (margin + fee > available + 1e-9) {
      const rejected: Order = {
        ...order,
        status: 'rejected',
        reserved: 0,
        updatedAt: ts,
        rejectReason: 'Insufficient margin at execution',
      };
      this.putOrder(rejected);
      this.notice({ level: 'error', title: `Order #${order.no} rejected`, body: 'Insufficient margin at execution', ref: { kind: 'order', id: order.id } });
      return null;
    }

    const side = positionSideFor(order.side);
    const position: Position = {
      id: this.ctx.ids(),
      no: this.nextNo(),
      accountId: this.account.id,
      symbol: order.symbol,
      side,
      status: 'open',
      qty: order.qty,
      initialQty: order.qty,
      entryPrice: px,
      leverage: order.leverage,
      margin,
      sl: order.sl,
      tp: order.tp,
      trail: order.trail,
      trailAnchor: null,
      initialSl: order.sl,
      initialTp: order.tp,
      openedAt: ts,
      closedAt: null,
      entryFee: fee,
      exitFees: 0,
      realizedPnl: 0,
      exitQty: 0,
      exitValue: 0,
      closeReason: null,
      mfe: 0,
      mae: 0,
      entryOrderId: order.id,
      entrySource: source,
    };
    if (position.trail) {
      armTrail(position, px, spec);
      if (position.initialSl == null) position.initialSl = position.sl;
    }

    const filled: Order = {
      ...order,
      status: 'filled',
      reserved: 0,
      updatedAt: ts,
      filledAt: ts,
      fillPrice: px,
      fee,
      liquidity,
      source,
      positionId: position.id,
    };
    this.putOrder(filled);
    this.putPosition(position);
    this.events.push({
      type: 'fill',
      fill: {
        id: this.ctx.ids(),
        accountId: this.account.id,
        orderId: order.id,
        positionId: position.id,
        symbol: order.symbol,
        side: order.side,
        intent: 'open',
        qty: order.qty,
        price: px,
        fee,
        liquidity,
        realizedPnl: 0,
        ts,
        source,
        closeReason: null,
      },
    });
    this.ledger('fee', -fee, ts, order.id, `${liquidity} fee · open #${position.no}`);
    this.notice({
      level: 'success',
      title: `${side === 'long' ? 'Long' : 'Short'} ${fmtQty(order.qty, spec)} ${order.symbol} filled`,
      body: `@ ${fmtPrice(px, spec)} · ${order.leverage}× · ${order.type}${source === 'replay' ? ' · reconstructed from candles' : ''}`,
      ref: { kind: 'position', id: position.id },
    });
    return position;
  }

  /** Close `qty` of a position at `price`. Returns the updated position. */
  fillExit(
    p: Position,
    qty: number,
    price: number,
    opts: { liquidity: Liquidity; ts: number; source: PriceSource; reason: CloseReason; type: OrderType },
  ): Position {
    const spec = this.spec(p.symbol);
    const cfg = this.account.config;
    const closeAll = qty >= p.qty - 1e-12;
    const q = closeAll ? p.qty : qty;
    const px = price;
    const pnl = grossPnl(p.side, q, p.entryPrice, px);
    let fee = feeOf(q, px, opts.liquidity === 'maker' ? cfg.makerFee : cfg.takerFee);
    if (opts.reason === 'liquidation') {
      // The whole isolated margin is forfeited: the liquidation fee absorbs what is left of it.
      fee = money(Math.max(0, p.margin + pnl));
    }
    const marginReleased = closeAll ? p.margin : money((p.margin * q) / p.qty);

    const orderId = this.ctx.ids();
    const order: Order = {
      id: orderId,
      no: this.nextNo(),
      accountId: this.account.id,
      symbol: p.symbol,
      side: closeSideFor(p.side),
      intent: 'close',
      type: opts.type,
      qty: q,
      price: opts.type === 'market' ? null : px,
      leverage: p.leverage,
      sl: null,
      tp: null,
      trail: null,
      status: 'filled',
      createdAt: opts.ts,
      updatedAt: opts.ts,
      reserved: 0,
      positionId: p.id,
      filledAt: opts.ts,
      fillPrice: px,
      fee,
      liquidity: opts.liquidity,
      source: opts.source,
      closeReason: opts.reason,
      rejectReason: null,
      cancelReason: null,
    };
    this.putOrder(order);

    const next: Position = {
      ...p,
      qty: closeAll ? 0 : floorToStep(p.qty - q, spec?.stepSize ?? 0),
      margin: closeAll ? 0 : money(p.margin - marginReleased),
      exitFees: money(p.exitFees + fee),
      realizedPnl: money(p.realizedPnl + pnl),
      exitQty: p.exitQty + q,
      exitValue: p.exitValue + q * px,
    };
    if (closeAll) {
      next.status = 'closed';
      next.closedAt = opts.ts;
      next.closeReason = opts.reason;
    }
    this.putPosition(next);
    const fill: Fill = {
      id: this.ctx.ids(),
      accountId: this.account.id,
      orderId,
      positionId: p.id,
      symbol: p.symbol,
      side: closeSideFor(p.side),
      intent: 'close',
      qty: q,
      price: px,
      fee,
      liquidity: opts.liquidity,
      realizedPnl: pnl,
      ts: opts.ts,
      source: opts.source,
      closeReason: opts.reason,
    };
    this.events.push({ type: 'fill', fill });
    this.ledger('realized', pnl, opts.ts, orderId, `${closeAll ? 'Close' : 'Partial close'} #${p.no}`);
    this.ledger(opts.reason === 'liquidation' ? 'liquidation' : 'fee', -fee, opts.ts, orderId,
      opts.reason === 'liquidation' ? `Liquidation · #${p.no}` : `${opts.liquidity} fee · close #${p.no}`);

    const label: Record<CloseReason, string> = {
      manual: closeAll ? 'Position closed' : 'Partial close',
      sl: 'Stop-loss hit',
      tp: 'Take-profit filled',
      trail: 'Trailing stop hit',
      liquidation: 'Position liquidated',
      risk: 'Closed by risk lock',
    };
    const net = closeAll ? netRealized(next) : money(pnl - fee);
    this.notice({
      level: opts.reason === 'liquidation' ? 'error' : net >= 0 ? 'success' : 'warning',
      title: `${label[opts.reason]} · ${p.symbol} ${p.side}`,
      body: `${fmtQty(q, spec)} @ ${fmtPrice(px, spec)} · ${fmtMoney(net)} USDT${closeAll ? ' net' : ''}${opts.source === 'replay' ? ' · reconstructed from candles' : ''}`,
      ref: { kind: 'position', id: p.id },
    });
    return next;
  }
}

function better(side: PositionSide, a: number | null, b: number): number {
  if (a == null) return b;
  return side === 'long' ? Math.max(a, b) : Math.min(a, b);
}

function armTrail(p: Position, anchor: number, spec: SymbolSpec | undefined) {
  if (!p.trail) return;
  p.trailAnchor = anchor;
  const stop = trailStopAt(p.side, p.trail, anchor);
  const rounded = spec ? roundToStep(stop, spec.tickSize) : stop;
  p.sl = better(p.side, p.sl, rounded);
}

// ──────────────────────────────────────────────────────────── commands ──

export type Outcome = EngineResult & { error: string | null; orderId?: string; positionId?: string };

const fail = (state: EngineState, error: string): Outcome => ({ state, events: [], error });

export function placeOrder(state: EngineState, req: OrderRequest, ctx: EngineContext): Outcome {
  const tx = new Tx(state, ctx);
  const v = validateOrder(state, req, ctx);
  const base: Order = {
    id: ctx.ids(),
    no: tx.nextNo(),
    accountId: state.account.id,
    symbol: req.symbol,
    side: req.side,
    intent: 'open',
    type: req.type,
    qty: req.qty,
    price: req.type === 'market' ? null : req.price,
    leverage: req.leverage,
    sl: req.sl,
    tp: req.tp,
    trail: req.trail,
    status: 'working',
    createdAt: ctx.now,
    updatedAt: ctx.now,
    reserved: 0,
    positionId: null,
    filledAt: null,
    fillPrice: null,
    fee: null,
    liquidity: null,
    source: null,
    closeReason: null,
    rejectReason: null,
    cancelReason: null,
  };
  if (!v.ok) {
    tx.putOrder({ ...base, status: 'rejected', rejectReason: v.reason });
    tx.notice({ level: 'error', title: `Order #${base.no} rejected`, body: v.reason, ref: { kind: 'order', id: base.id } });
    return { ...tx.result(), error: v.reason, orderId: base.id };
  }
  const q = ctx.quotes.get(req.symbol)!;
  const cfg = state.account.config;
  if (req.type === 'market' || (req.type === 'limit' && isMarketable(req.side, req.price!, q))) {
    const px = takerPrice(req.side, entryPriceOf(req.side, q), cfg, ctx.specs.get(req.symbol));
    const pos = tx.fillEntry(base, px, 'taker', ctx.now, q.source);
    const r = tx.result();
    return { ...r, error: pos ? null : 'Insufficient margin at execution', orderId: base.id, positionId: pos?.id };
  }
  const order: Order = { ...base, reserved: money(v.margin + v.fee) };
  tx.putOrder(order);
  const spec = ctx.specs.get(req.symbol);
  tx.notice({
    level: 'info',
    title: `${req.type === 'limit' ? 'Limit' : 'Stop'} ${req.side} ${fmtQty(req.qty, spec)} ${req.symbol} working`,
    body: `@ ${fmtPrice(req.price!, spec)} · ${req.leverage}×`,
    ref: { kind: 'order', id: order.id },
  });
  return { ...tx.result(), error: null, orderId: order.id };
}

/**
 * Execution price for a taker fill: touch price plus adverse slippage,
 * rounded to the tick against the trader (buys round up, sells round down).
 */
export function takerPrice(side: 'buy' | 'sell', touch: number, cfg: AccountConfig, spec: SymbolSpec | undefined): number {
  const raw = slip(side, touch, cfg.slippageBps);
  if (!spec) return raw;
  return side === 'buy' ? ceilToStep(raw, spec.tickSize) : floorToStep(raw, spec.tickSize);
}

function isMarketable(side: 'buy' | 'sell', price: number, q: Quote): boolean {
  return side === 'buy' ? price >= q.ask : price <= q.bid;
}

export function cancelOrder(state: EngineState, orderId: string, ctx: EngineContext, reason = 'Cancelled by you'): Outcome {
  const o = state.orders.find((x) => x.id === orderId && x.status === 'working');
  if (!o) return fail(state, 'Order is no longer working');
  const tx = new Tx(state, ctx);
  tx.putOrder({ ...o, status: 'cancelled', reserved: 0, updatedAt: ctx.now, cancelReason: reason });
  return { ...tx.result(), error: null, orderId };
}

export interface OrderPatch {
  price?: number;
  qty?: number;
  leverage?: number;
  sl?: number | null;
  tp?: number | null;
  trail?: TrailSpec | null;
}

export function modifyOrder(state: EngineState, orderId: string, patch: OrderPatch, ctx: EngineContext): Outcome {
  const o = state.orders.find((x) => x.id === orderId && x.status === 'working');
  if (!o) return fail(state, 'Order is no longer working');
  const req: OrderRequest = {
    symbol: o.symbol,
    side: o.side,
    type: o.type,
    qty: patch.qty ?? o.qty,
    price: patch.price ?? o.price,
    leverage: patch.leverage ?? o.leverage,
    sl: patch.sl !== undefined ? patch.sl : o.sl,
    tp: patch.tp !== undefined ? patch.tp : o.tp,
    trail: patch.trail !== undefined ? patch.trail : o.trail,
  };
  const v = validateOrder(state, req, ctx, { excludeOrderId: o.id });
  if (!v.ok) return fail(state, v.reason);
  const tx = new Tx(state, ctx);
  const next: Order = { ...o, ...req, reserved: money(v.margin + v.fee), updatedAt: ctx.now };
  const q = ctx.quotes.get(o.symbol)!;
  if (next.type === 'limit' && isMarketable(next.side, next.price!, q)) {
    const px = takerPrice(next.side, entryPriceOf(next.side, q), state.account.config, ctx.specs.get(o.symbol));
    const pos = tx.fillEntry(next, px, 'taker', ctx.now, q.source);
    return { ...tx.result(), error: null, orderId, positionId: pos?.id };
  }
  tx.putOrder(next);
  return { ...tx.result(), error: null, orderId };
}

export function closePosition(
  state: EngineState,
  positionId: string,
  qty: number | 'all',
  ctx: EngineContext,
  reason: CloseReason = 'manual',
): Outcome {
  const p = state.positions.find((x) => x.id === positionId);
  if (!p) return fail(state, 'Position is already closed');
  const q = ctx.quotes.get(p.symbol);
  if (!quoteIsFresh(q, ctx.now)) return fail(state, 'No current price — cannot close at market');
  const spec = ctx.specs.get(p.symbol);
  let closeQty = qty === 'all' ? p.qty : floorToStep(qty, spec?.stepSize ?? 0);
  if (!(closeQty > 0)) return fail(state, 'Enter a size to close');
  if (closeQty > p.qty + 1e-12) return fail(state, 'Cannot close more than the open size');
  // Leaving dust behind is never useful: close everything instead.
  if (spec && p.qty - closeQty < spec.minQty) closeQty = p.qty;
  const tx = new Tx(state, ctx);
  const side = closeSideFor(p.side);
  const px = takerPrice(side, exitPriceOf(p.side, q), state.account.config, spec);
  const next = tx.fillExit(p, closeQty, px, { liquidity: 'taker', ts: ctx.now, source: q.source, reason, type: 'market' });
  return { ...tx.result(), error: null, positionId: next.id };
}

export function setProtection(
  state: EngineState,
  positionId: string,
  patch: { sl?: number | null; tp?: number | null; trail?: TrailSpec | null },
  ctx: EngineContext,
): Outcome {
  const p = state.positions.find((x) => x.id === positionId);
  if (!p) return fail(state, 'Position is already closed');
  const spec = ctx.specs.get(p.symbol);
  const q = ctx.quotes.get(p.symbol);
  const sl = patch.sl === undefined ? undefined : patch.sl == null ? null : spec ? roundToStep(patch.sl, spec.tickSize) : patch.sl;
  const tp = patch.tp === undefined ? undefined : patch.tp == null ? null : spec ? roundToStep(patch.tp, spec.tickSize) : patch.tp;
  const err = validateProtection(p, { sl, tp }, q);
  if (err) return fail(state, err);
  const next: Position = { ...p };
  if (sl !== undefined) {
    next.sl = sl;
    if (sl != null && next.initialSl == null) next.initialSl = sl; // first stop placed defines 1R
  }
  if (tp !== undefined) {
    next.tp = tp;
    if (tp != null && next.initialTp == null) next.initialTp = tp;
  }
  if (patch.trail !== undefined) {
    next.trail = patch.trail;
    next.trailAnchor = null;
    if (patch.trail) {
      armTrail(next, q ? exitPriceOf(p.side, q) : p.entryPrice, spec);
      if (next.initialSl == null) next.initialSl = next.sl;
    }
  }
  const tx = new Tx(state, ctx);
  tx.putPosition(next);
  return { ...tx.result(), error: null, positionId };
}

// ─────────────────────────────────────────────────────── market events ──

export interface QuoteResult extends EngineResult {
  /** True when open positions changed in ways not worth an event (MFE/MAE, trailing ratchet). */
  softDirty: boolean;
}

/** Apply a price update: trigger working orders, protective exits and liquidations. */
export function processQuote(state: EngineState, quote: Quote, ctx: EngineContext): QuoteResult {
  // A price can only act on orders/positions that already existed when it printed
  // (matters when replaying history after a crash or a long absence).
  const touchesOrders = state.orders.some((o) => o.symbol === quote.symbol && o.status === 'working' && o.createdAt <= quote.ts);
  const touchesPositions = state.positions.some((p) => p.symbol === quote.symbol && p.openedAt <= quote.ts);
  if (!touchesOrders && !touchesPositions) return { state, events: [], softDirty: false };

  const quotes = new Map(ctx.quotes);
  quotes.set(quote.symbol, quote);
  const tctx: EngineContext = { ...ctx, quotes };
  const tx = new Tx(state, tctx);
  const cfg = state.account.config;
  const ts = quote.ts;
  let softDirty = false;

  // 1. Working entry orders.
  for (const o of state.orders) {
    if (o.symbol !== quote.symbol || o.status !== 'working' || o.createdAt > ts) continue;
    if (o.type === 'limit') {
      const hit = o.side === 'buy' ? quote.ask <= o.price! : quote.bid >= o.price!;
      if (hit) tx.fillEntry(o, o.price!, 'maker', ts, quote.source);
    } else if (o.type === 'stop') {
      const hit = o.side === 'buy' ? quote.ask >= o.price! : quote.bid <= o.price!;
      if (hit) {
        const touch = o.side === 'buy' ? Math.max(quote.ask, o.price!) : Math.min(quote.bid, o.price!);
        tx.fillEntry(o, takerPrice(o.side, touch, cfg, tctx.specs.get(o.symbol)), 'taker', ts, quote.source);
      }
    }
  }

  // 2. Open positions (including any just opened).
  for (const p0 of tx.positions.slice()) {
    if (p0.symbol !== quote.symbol || p0.openedAt > ts) continue;
    const spec = tctx.specs.get(p0.symbol);
    const px = exitPriceOf(p0.side, quote);
    const p: Position = { ...p0 };
    const move = dir(p.side) * (px - p.entryPrice);
    if (move > p.mfe) {
      p.mfe = move;
      softDirty = true;
    }
    if (-move > p.mae) {
      p.mae = -move;
      softDirty = true;
    }
    if (p.trail) {
      const improved = p.trailAnchor == null || dir(p.side) * (px - p.trailAnchor) > 0;
      if (improved) {
        const prevSl = p.sl;
        armTrail(p, px, spec);
        softDirty = true;
        if (prevSl !== p.sl && (p.initialSl == null)) p.initialSl = p.sl;
      }
    }

    const liq = liquidationPriceFor(p, cfg.maintenanceMargin);
    const m = mid(quote);
    if (liq != null && (p.side === 'long' ? m <= liq : m >= liq)) {
      tx.fillExit(p, p.qty, liq, { liquidity: 'taker', ts, source: quote.source, reason: 'liquidation', type: 'market' });
      continue;
    }
    if (p.sl != null && (p.side === 'long' ? quote.bid <= p.sl : quote.ask >= p.sl)) {
      const touch = p.side === 'long' ? Math.min(quote.bid, p.sl) : Math.max(quote.ask, p.sl);
      const trailed = p.trail != null && p.trailAnchor != null && p.sl !== p0.initialSl;
      tx.fillExit(p, p.qty, takerPrice(closeSideFor(p.side), touch, cfg, spec), {
        liquidity: 'taker',
        ts,
        source: quote.source,
        reason: trailed ? 'trail' : 'sl',
        type: 'stop',
      });
      continue;
    }
    if (p.tp != null && (p.side === 'long' ? quote.bid >= p.tp : quote.ask <= p.tp)) {
      tx.fillExit(p, p.qty, p.tp, { liquidity: 'maker', ts, source: quote.source, reason: 'tp', type: 'limit' });
      continue;
    }
    if (softDirty) tx.putPosition(p, false);
  }
  return { ...tx.result(), softDirty };
}

export interface Bar {
  time: number; // open time, ms
  open: number;
  high: number;
  low: number;
  close: number;
}

/**
 * Price path through a candle. Without tick data the intrabar order is unknown;
 * we use the common convention: bullish bars visit the low first, bearish bars the high first.
 */
export function barPath(bar: Bar): number[] {
  return bar.close >= bar.open ? [bar.open, bar.low, bar.high, bar.close] : [bar.open, bar.high, bar.low, bar.close];
}

/** Every price level on `symbol` that could trigger something. */
function triggerLevels(state: EngineState, symbol: string): number[] {
  const out: number[] = [];
  const mmr = state.account.config.maintenanceMargin;
  for (const o of state.orders) if (o.symbol === symbol && o.status === 'working' && o.price != null) out.push(o.price);
  for (const p of state.positions) {
    if (p.symbol !== symbol) continue;
    if (p.sl != null) out.push(p.sl);
    if (p.tp != null) out.push(p.tp);
    const liq = liquidationPriceFor(p, mmr);
    if (liq != null) out.push(liq);
  }
  return out;
}

/**
 * Replay a historical candle (used to catch up on time the app was closed).
 * The path is walked continuously so stops fill at their level unless the
 * market gapped through them at the candle open.
 */
export function processBar(
  state: EngineState,
  symbol: string,
  bar: Bar,
  intervalMs: number,
  ctx: EngineContext,
): QuoteResult {
  const path = barPath(bar);
  const events: EngineEvent[] = [];
  let soft = false;
  let s = state;
  const at = (i: number, frac = 0) => bar.time + Math.min(intervalMs - 1, Math.round(((i + frac) / (path.length - 1)) * (intervalMs - 1)));
  const quoteAt = (price: number, ts: number): Quote => ({ symbol, bid: price, ask: price, last: price, ts, source: 'replay' });
  const apply = (price: number, ts: number) => {
    const r = processQuote(s, quoteAt(price, ts), ctx);
    s = r.state;
    events.push(...r.events);
    soft = soft || r.softDirty;
  };

  apply(path[0], at(0));
  for (let i = 1; i < path.length; i++) {
    let cur = path[i - 1];
    const target = path[i];
    const up = target > cur;
    for (let guard = 0; guard < 64; guard++) {
      const next = triggerLevels(s, symbol)
        .filter((l) => (up ? l > cur && l < target : l < cur && l > target))
        .sort((a, b) => (up ? a - b : b - a))[0];
      if (next === undefined) break;
      const frac = target === cur ? 0 : (next - path[i - 1]) / (target - path[i - 1]);
      apply(next, at(i - 1, frac));
      cur = next;
    }
    apply(target, at(i));
  }
  return { state: s, events, softDirty: soft };
}

/** Day rollover, peak tracking, and enforcement of daily-loss / drawdown locks. */
export function evaluateRisk(state: EngineState, ctx: EngineContext): QuoteResult {
  const m = computeMetrics(state, ctx.quotes, ctx.now);
  const tx = new Tx(state, ctx);
  const a = tx.account;
  const rules = a.config.risk;
  let soft = false;
  const today = utcDayKey(ctx.now);

  if (a.dayKey !== today) {
    a.dayKey = today;
    a.dayStartEquity = m.equity;
    tx.touchAccount();
    if (a.locked?.reason === 'daily') {
      a.locked = null;
      tx.notice({ level: 'info', title: 'New trading day', body: 'Daily loss lock lifted.' });
    }
  }
  if (a.locked?.until != null && ctx.now >= a.locked.until) {
    a.locked = null;
    tx.touchAccount();
  }
  if (m.equity > a.peakEquity) {
    a.peakEquity = m.equity;
    soft = true;
  }

  let lock: Account['locked'] = null;
  if (!a.locked && rules.dailyLossLimitPct != null && a.dayStartEquity > 0) {
    const dayPnl = m.equity - a.dayStartEquity;
    if (dayPnl <= -(rules.dailyLossLimitPct / 100) * a.dayStartEquity) {
      lock = {
        reason: 'daily',
        until: nextUtcMidnight(ctx.now),
        at: ctx.now,
        message: `Daily loss limit (${rules.dailyLossLimitPct}%) reached — new entries locked until 00:00 UTC`,
      };
    }
  }
  if (!a.locked && !lock && rules.maxDrawdownPct != null && a.peakEquity > 0) {
    if (m.equity <= a.peakEquity * (1 - rules.maxDrawdownPct / 100)) {
      lock = {
        reason: 'drawdown',
        until: null,
        at: ctx.now,
        message: `Max drawdown (${rules.maxDrawdownPct}%) breached — account locked until you review it in Settings`,
      };
    }
  }
  if (lock) {
    a.locked = lock;
    tx.touchAccount();
    tx.notice({ level: 'error', title: 'Risk lock engaged', body: lock.message });
    for (const o of tx.orders.slice()) {
      tx.putOrder({ ...o, status: 'cancelled', reserved: 0, updatedAt: ctx.now, cancelReason: 'Risk lock' });
    }
    if (rules.flattenOnDailyLimit) {
      for (const p of tx.positions.slice()) {
        const q = ctx.quotes.get(p.symbol);
        if (!quoteIsFresh(q, ctx.now)) continue;
        const px = takerPrice(closeSideFor(p.side), exitPriceOf(p.side, q), a.config, ctx.specs.get(p.symbol));
        tx.fillExit(p, p.qty, px, { liquidity: 'taker', ts: ctx.now, source: q.source, reason: 'risk', type: 'market' });
      }
    }
  }
  return { ...tx.result(), softDirty: soft };
}

/** Manually lift a drawdown lock; drawdown tracking restarts from current equity. */
export function unlockAccount(state: EngineState, ctx: EngineContext): EngineResult {
  const m = computeMetrics(state, ctx.quotes, ctx.now);
  const tx = new Tx(state, ctx);
  tx.account.locked = null;
  tx.account.peakEquity = m.equity;
  tx.touchAccount();
  return tx.result();
}

export function updateConfig(state: EngineState, config: AccountConfig, ctx: EngineContext): EngineResult {
  const tx = new Tx(state, ctx);
  tx.account.config = structuredClone(config);
  tx.touchAccount();
  return tx.result();
}

export function renameAccount(state: EngineState, name: string, ctx: EngineContext): EngineResult {
  const tx = new Tx(state, ctx);
  tx.account.name = name;
  tx.touchAccount();
  return tx.result();
}

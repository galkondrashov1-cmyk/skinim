import type { Position, PositionSide } from './types';
import { avgExitPrice, initialRisk, netRealized } from './margin';
import { money, utcDayKey } from './num';

export interface TradeRow {
  id: string;
  no: number;
  symbol: string;
  side: PositionSide;
  openedAt: number;
  closedAt: number;
  entry: number;
  exit: number;
  qty: number;
  leverage: number;
  gross: number;
  fees: number;
  net: number;
  /** Net P&L in multiples of initial risk, when a stop defined 1R. */
  r: number | null;
  holdMs: number;
  closeReason: Position['closeReason'];
  /** Share of the best open profit that was actually captured (0–1), when meaningful. */
  efficiency: number | null;
}

export function toTradeRow(p: Position): TradeRow {
  const net = netRealized(p);
  const risk = initialRisk(p);
  const bestMove = p.mfe * p.initialQty;
  return {
    id: p.id,
    no: p.no,
    symbol: p.symbol,
    side: p.side,
    openedAt: p.openedAt,
    closedAt: p.closedAt ?? p.openedAt,
    entry: p.entryPrice,
    exit: avgExitPrice(p) ?? p.entryPrice,
    qty: p.initialQty,
    leverage: p.leverage,
    gross: p.realizedPnl,
    fees: money(p.entryFee + p.exitFees),
    net,
    r: risk ? net / risk : null,
    holdMs: (p.closedAt ?? p.openedAt) - p.openedAt,
    closeReason: p.closeReason,
    efficiency: bestMove > p.entryFee + p.exitFees ? Math.max(-1, Math.min(1, p.realizedPnl / bestMove)) : null,
  };
}

export interface SideStats {
  count: number;
  wins: number;
  net: number;
  winRate: number;
}

export interface Stats {
  count: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number;
  grossProfit: number;
  grossLoss: number;
  netPnl: number;
  fees: number;
  /** Gross profit ÷ gross loss of net trade results. Infinity when there are no losses. */
  profitFactor: number | null;
  /** Average net P&L per trade. */
  expectancy: number;
  avgWin: number;
  avgLoss: number;
  /** Average win ÷ average loss. */
  payoff: number | null;
  largestWin: number;
  largestLoss: number;
  maxConsecWins: number;
  maxConsecLosses: number;
  avgHoldMs: number;
  /** R statistics over trades that had a stop at entry. */
  rCount: number;
  avgR: number | null;
  totalR: number;
  long: SideStats;
  short: SideStats;
}

function sideStats(rows: TradeRow[]): SideStats {
  const wins = rows.filter((r) => r.net > 0).length;
  return {
    count: rows.length,
    wins,
    net: money(rows.reduce((s, r) => s + r.net, 0)),
    winRate: rows.length ? wins / rows.length : 0,
  };
}

export function computeStats(input: readonly TradeRow[]): Stats {
  const rows = [...input].sort((a, b) => a.closedAt - b.closedAt);
  const wins = rows.filter((r) => r.net > 0);
  const losses = rows.filter((r) => r.net < 0);
  const grossProfit = money(wins.reduce((s, r) => s + r.net, 0));
  const grossLoss = money(-losses.reduce((s, r) => s + r.net, 0));
  const netPnl = money(rows.reduce((s, r) => s + r.net, 0));
  let cw = 0;
  let cl = 0;
  let maxW = 0;
  let maxL = 0;
  for (const r of rows) {
    if (r.net > 0) {
      cw++;
      cl = 0;
    } else if (r.net < 0) {
      cl++;
      cw = 0;
    } else {
      cw = 0;
      cl = 0;
    }
    maxW = Math.max(maxW, cw);
    maxL = Math.max(maxL, cl);
  }
  const rRows = rows.filter((r) => r.r != null);
  const totalR = rRows.reduce((s, r) => s + (r.r as number), 0);
  const avgWin = wins.length ? grossProfit / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  return {
    count: rows.length,
    wins: wins.length,
    losses: losses.length,
    breakeven: rows.length - wins.length - losses.length,
    winRate: rows.length ? wins.length / rows.length : 0,
    grossProfit,
    grossLoss,
    netPnl,
    fees: money(rows.reduce((s, r) => s + r.fees, 0)),
    profitFactor: rows.length === 0 ? null : grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : null,
    expectancy: rows.length ? netPnl / rows.length : 0,
    avgWin,
    avgLoss,
    payoff: avgLoss > 0 && wins.length ? avgWin / avgLoss : null,
    largestWin: wins.length ? Math.max(...wins.map((r) => r.net)) : 0,
    largestLoss: losses.length ? Math.min(...losses.map((r) => r.net)) : 0,
    maxConsecWins: maxW,
    maxConsecLosses: maxL,
    avgHoldMs: rows.length ? rows.reduce((s, r) => s + r.holdMs, 0) / rows.length : 0,
    rCount: rRows.length,
    avgR: rRows.length ? totalR / rRows.length : null,
    totalR,
    long: sideStats(rows.filter((r) => r.side === 'long')),
    short: sideStats(rows.filter((r) => r.side === 'short')),
  };
}

export interface CurvePoint {
  ts: number;
  value: number;
}

/** Realized balance after each closed trade, starting from the initial deposit. */
export function balanceCurve(initial: number, rows: readonly TradeRow[], start: number): CurvePoint[] {
  const sorted = [...rows].sort((a, b) => a.closedAt - b.closedAt);
  const out: CurvePoint[] = [{ ts: start, value: initial }];
  let bal = initial;
  for (const r of sorted) {
    bal = money(bal + r.net);
    out.push({ ts: r.closedAt, value: bal });
  }
  return out;
}

export interface DrawdownResult {
  maxPct: number;
  maxAbs: number;
  /** Drawdown (%, ≥ 0) at each point. */
  series: CurvePoint[];
  /** Index range of the deepest drawdown: peak → trough. */
  peakTs: number | null;
  troughTs: number | null;
}

export function drawdown(curve: readonly CurvePoint[]): DrawdownResult {
  let peak = -Infinity;
  let peakTs: number | null = null;
  let maxPct = 0;
  let maxAbs = 0;
  let worst: { peakTs: number | null; troughTs: number | null } = { peakTs: null, troughTs: null };
  const series: CurvePoint[] = [];
  for (const p of curve) {
    if (p.value > peak) {
      peak = p.value;
      peakTs = p.ts;
    }
    const abs = peak - p.value;
    const pct = peak > 0 ? (abs / peak) * 100 : 0;
    series.push({ ts: p.ts, value: pct });
    if (pct > maxPct) {
      maxPct = pct;
      maxAbs = abs;
      worst = { peakTs, troughTs: p.ts };
    }
  }
  return { maxPct, maxAbs: money(maxAbs), series, ...worst };
}

/** Net P&L per UTC day (by close time). */
export function dailyPnl(rows: readonly TradeRow[]): Map<string, { net: number; count: number }> {
  const m = new Map<string, { net: number; count: number }>();
  for (const r of rows) {
    const k = utcDayKey(r.closedAt);
    const cur = m.get(k) ?? { net: 0, count: 0 };
    cur.net = money(cur.net + r.net);
    cur.count++;
    m.set(k, cur);
  }
  return m;
}

export interface Bucket {
  from: number;
  to: number;
  count: number;
}

/** Histogram of R-multiples with fixed-width buckets, clamped to ±maxR. */
export function rHistogram(rows: readonly TradeRow[], width = 0.5, maxR = 5): Bucket[] {
  const rs = rows.map((r) => r.r).filter((r): r is number => r != null);
  const buckets: Bucket[] = [];
  for (let from = -maxR; from < maxR; from += width) buckets.push({ from, to: from + width, count: 0 });
  for (const r of rs) {
    const clamped = Math.max(-maxR, Math.min(maxR - 1e-9, r));
    const i = Math.floor((clamped + maxR) / width);
    buckets[i].count++;
  }
  return buckets;
}

export interface SymbolBreakdown {
  symbol: string;
  count: number;
  net: number;
  winRate: number;
}

export function bySymbol(rows: readonly TradeRow[]): SymbolBreakdown[] {
  const m = new Map<string, TradeRow[]>();
  for (const r of rows) m.set(r.symbol, [...(m.get(r.symbol) ?? []), r]);
  return [...m.entries()]
    .map(([symbol, rs]) => ({
      symbol,
      count: rs.length,
      net: money(rs.reduce((s, r) => s + r.net, 0)),
      winRate: rs.filter((r) => r.net > 0).length / rs.length,
    }))
    .sort((a, b) => b.net - a.net);
}

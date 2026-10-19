import { dir, gainAtTarget, grossPnl, initialRisk, liquidationPriceFor, lossAtStop, netRealized, avgExitPrice, unrealizedPnl } from '@/engine/margin';
import type { AccountConfig, Order, Position, Quote, SymbolSpec } from '@/engine/types';
import { fmtMoney, fmtNum, fmtPct, fmtPrice, fmtQty, toneOf } from '@/lib/format';
import type { TicketDraft } from '@/store/ui';
import type { ResolvedTicket } from '../ticket/resolve';
import type { Segment, Zone, ZoneScene } from './zones';

export type LineTone = 'up' | 'down' | 'order' | 'neutral' | 'liq' | 'draft';

export interface ChartLine {
  id: string;
  price: number;
  tone: LineTone;
  style: 'solid' | 'dashed' | 'dotted';
  /** Short title on the price axis. */
  axis: string;
  /** Pill text. */
  label: string;
  /** Secondary text, recomputed while dragging. */
  detail?: (price: number) => { text: string; tone?: 'up' | 'down' | '' };
  draggable: boolean;
  onCommit?: (price: number) => void;
  /** Called continuously while dragging (drafts update the ticket live). */
  onPreview?: (price: number) => void;
  remove?: { label: string; run: () => void };
  actions?: { label: string; run: () => void; testId?: string }[];
  zone?: { from: number | null; to: number | null; base: number; tone: 'up' | 'down' };
  testId?: string;
  emphasis?: boolean;
}

export interface LineHandlers {
  setProtection: (id: string, patch: { sl?: number | null; tp?: number | null }) => void;
  closePosition: (id: string) => void;
  cancelOrder: (id: string) => void;
  modifyOrder: (id: string, patch: { price?: number; sl?: number | null; tp?: number | null }) => void;
  setDraft: (patch: Partial<TicketDraft>) => void;
}

const sideWord = (p: { side: 'long' | 'short' }) => (p.side === 'long' ? 'Long' : 'Short');

function positionLines(p: Position, q: Quote | undefined, spec: SymbolSpec, cfg: AccountConfig, h: LineHandlers): ChartLine[] {
  const out: ChartLine[] = [];
  const r1 = initialRisk(p);
  const px = (x: number) => fmtPrice(x, spec.tickSize);
  const rText = (pnl: number) => (r1 ? ` · ${fmtNum(pnl / r1, 2, { sign: true })}R` : '');
  const defaultGap = Math.max(spec.tickSize * 10, p.entryPrice * 0.01);
  const ref = q ? (p.side === 'long' ? q.bid : q.ask) : p.entryPrice;

  out.push({
    id: `pos:${p.id}:entry`,
    price: p.entryPrice,
    tone: p.side === 'long' ? 'up' : 'down',
    style: 'solid',
    axis: p.side === 'long' ? 'LONG' : 'SHORT',
    label: `${sideWord(p)} ${fmtQty(p.qty, spec.stepSize)} · ${p.leverage}×`,
    detail: () => {
      if (!q) return { text: '—' };
      const u = unrealizedPnl(p, q);
      return { text: `${fmtMoney(u, { sign: true })}${r1 ? rText(u) : ` · ${fmtPct((u / p.margin) * 100, { sign: true, decimals: 1 })}`}`, tone: toneOf(u) };
    },
    draggable: false,
    remove: { label: 'Close position at market', run: () => h.closePosition(p.id) },
    actions: [
      ...(p.sl == null ? [{ label: '+ SL', testId: 'chart-add-sl', run: () => h.setProtection(p.id, { sl: snap(ref - dir(p.side) * defaultGap, spec) }) }] : []),
      ...(p.tp == null ? [{ label: '+ TP', testId: 'chart-add-tp', run: () => h.setProtection(p.id, { tp: snap(ref + dir(p.side) * defaultGap * 2, spec) }) }] : []),
    ],
    testId: 'line-entry',
    emphasis: true,
  });
  if (p.sl != null) {
    out.push({
      id: `pos:${p.id}:sl`,
      price: p.sl,
      tone: 'down',
      style: 'dashed',
      axis: p.trail ? 'TRAIL' : 'SL',
      label: p.trail ? 'Trailing stop' : 'Stop-loss',
      detail: (x) => {
        const pnl = grossPnl(p.side, p.qty, p.entryPrice, x) - p.qty * x * cfg.takerFee;
        return { text: `${px(x)} · ${fmtMoney(pnl, { sign: true })}${rText(pnl)}`, tone: toneOf(pnl) };
      },
      draggable: true,
      onCommit: (x) => h.setProtection(p.id, { sl: x }),
      remove: { label: 'Remove stop-loss', run: () => h.setProtection(p.id, { sl: null }) },
      zone: { from: p.openedAt, to: null, base: p.entryPrice, tone: 'down' },
      testId: 'line-sl',
    });
  }
  if (p.tp != null) {
    out.push({
      id: `pos:${p.id}:tp`,
      price: p.tp,
      tone: 'up',
      style: 'dashed',
      axis: 'TP',
      label: 'Take-profit',
      detail: (x) => {
        const pnl = grossPnl(p.side, p.qty, p.entryPrice, x) - p.qty * x * cfg.makerFee;
        return { text: `${px(x)} · ${fmtMoney(pnl, { sign: true })}${rText(pnl)}`, tone: toneOf(pnl) };
      },
      draggable: true,
      onCommit: (x) => h.setProtection(p.id, { tp: x }),
      remove: { label: 'Remove take-profit', run: () => h.setProtection(p.id, { tp: null }) },
      zone: { from: p.openedAt, to: null, base: p.entryPrice, tone: 'up' },
      testId: 'line-tp',
    });
  }
  const liq = liquidationPriceFor(p, cfg.maintenanceMargin);
  if (liq != null) {
    out.push({ id: `pos:${p.id}:liq`, price: liq, tone: 'liq', style: 'dotted', axis: 'LIQ', label: 'Liquidation', draggable: false });
  }
  return out;
}

function orderLines(o: Order, q: Quote | undefined, spec: SymbolSpec, h: LineHandlers): ChartLine[] {
  if (o.price == null) return [];
  const out: ChartLine[] = [];
  const touch = q ? (o.side === 'buy' ? q.ask : q.bid) : null;
  out.push({
    id: `ord:${o.id}`,
    price: o.price,
    tone: 'order',
    style: 'solid',
    axis: `${o.side === 'buy' ? 'BUY' : 'SELL'} ${o.type === 'limit' ? 'LMT' : 'STP'}`,
    label: `${o.side === 'buy' ? 'Buy' : 'Sell'} ${o.type} ${fmtQty(o.qty, spec.stepSize)} · ${o.leverage}×`,
    detail: (x) => ({ text: touch ? `${fmtPrice(x, spec.tickSize)} · ${fmtPct(((x - touch) / touch) * 100, { sign: true })} from market` : fmtPrice(x, spec.tickSize) }),
    draggable: true,
    onCommit: (x) => h.modifyOrder(o.id, { price: x }),
    remove: { label: 'Cancel order', run: () => h.cancelOrder(o.id) },
    testId: 'line-order',
  });
  if (o.sl != null)
    out.push({
      id: `ord:${o.id}:sl`,
      price: o.sl,
      tone: 'down',
      style: 'dotted',
      axis: 'SL',
      label: `Stop · order #${o.no}`,
      draggable: true,
      onCommit: (x) => h.modifyOrder(o.id, { sl: x }),
      remove: { label: 'Remove stop', run: () => h.modifyOrder(o.id, { sl: null }) },
      zone: { from: null, to: null, base: o.price, tone: 'down' },
    });
  if (o.tp != null)
    out.push({
      id: `ord:${o.id}:tp`,
      price: o.tp,
      tone: 'up',
      style: 'dotted',
      axis: 'TP',
      label: `Target · order #${o.no}`,
      draggable: true,
      onCommit: (x) => h.modifyOrder(o.id, { tp: x }),
      remove: { label: 'Remove target', run: () => h.modifyOrder(o.id, { tp: null }) },
      zone: { from: null, to: null, base: o.price, tone: 'up' },
    });
  return out;
}

function draftLines(d: TicketDraft, r: ResolvedTicket, spec: SymbolSpec, cfg: AccountConfig, lastTime: number | null, h: LineHandlers): ChartLine[] {
  const out: ChartLine[] = [];
  const side = d.side;
  const entry = r.ref;
  const s = (x: number) => snap(x, spec);
  if (d.type !== 'market' && r.price != null) {
    out.push({
      id: 'draft:entry',
      price: r.price,
      tone: 'draft',
      style: 'dashed',
      axis: d.type === 'limit' ? 'LMT' : 'STP',
      label: `New ${side} ${d.type}${r.qty > 0 ? ` ${fmtQty(r.qty, spec.stepSize)}` : ''}`,
      detail: (x) => ({ text: fmtPrice(x, spec.tickSize) }),
      draggable: true,
      onPreview: (x) => h.setDraft({ price: s(x).toString() }),
      onCommit: (x) => h.setDraft({ price: s(x).toString() }),
      testId: 'line-draft-entry',
    });
  }
  if (entry == null) return out;
  if (r.sl != null)
    out.push({
      id: 'draft:sl',
      price: r.sl,
      tone: 'down',
      style: 'dashed',
      axis: 'SL',
      label: 'Planned stop',
      detail: (x) => {
        if (!r.qty) return { text: fmtPrice(x, spec.tickSize) };
        const loss = lossAtStop(side, r.qty, entry, x, cfg.takerFee, cfg.takerFee);
        return { text: `${fmtPrice(x, spec.tickSize)} · ${fmtMoney(-loss, { sign: true })}`, tone: 'down' };
      },
      draggable: true,
      onPreview: (x) => h.setDraft({ sl: s(x).toString() }),
      onCommit: (x) => h.setDraft({ sl: s(x).toString() }),
      zone: { from: lastTime, to: null, base: entry, tone: 'down' },
      testId: 'line-draft-sl',
    });
  if (r.tp != null)
    out.push({
      id: 'draft:tp',
      price: r.tp,
      tone: 'up',
      style: 'dashed',
      axis: 'TP',
      label: 'Planned target',
      detail: (x) => {
        if (!r.qty) return { text: fmtPrice(x, spec.tickSize) };
        const gain = gainAtTarget(side, r.qty, entry, x, cfg.takerFee, cfg.makerFee);
        const rr = r.sl != null ? Math.abs(x - entry) / Math.abs(entry - r.sl) : null;
        return { text: `${fmtPrice(x, spec.tickSize)} · ${fmtMoney(gain, { sign: true })}${rr ? ` · ${rr.toFixed(2)}R` : ''}`, tone: 'up' };
      },
      draggable: true,
      onPreview: (x) => h.setDraft({ tp: s(x).toString() }),
      onCommit: (x) => h.setDraft({ tp: s(x).toString() }),
      zone: { from: lastTime, to: null, base: entry, tone: 'up' },
      testId: 'line-draft-tp',
    });
  return out;
}

export function inspectLines(p: Position, spec: SymbolSpec): { lines: ChartLine[]; segments: Segment[]; zones: Zone[] } {
  const exit = avgExitPrice(p) ?? p.entryPrice;
  const net = netRealized(p);
  const lines: ChartLine[] = [
    {
      id: 'insp:entry',
      price: p.entryPrice,
      tone: p.side === 'long' ? 'up' : 'down',
      style: 'solid',
      axis: 'ENTRY',
      label: `#${p.no} ${sideWord(p)} entry`,
      detail: () => ({ text: fmtPrice(p.entryPrice, spec.tickSize) }),
      draggable: false,
      emphasis: true,
    },
    {
      id: 'insp:exit',
      price: exit,
      tone: 'neutral',
      style: 'solid',
      axis: 'EXIT',
      label: `Exit · ${p.closeReason ?? ''}`,
      detail: () => ({ text: `${fmtPrice(exit, spec.tickSize)} · ${fmtMoney(net, { sign: true })} net`, tone: toneOf(net) }),
      draggable: false,
    },
  ];
  const zones: Zone[] = [];
  if (p.initialSl != null) {
    lines.push({ id: 'insp:sl', price: p.initialSl, tone: 'down', style: 'dashed', axis: 'SL', label: 'Initial stop', draggable: false });
    zones.push({ t1: p.openedAt, t2: p.closedAt, p1: p.entryPrice, p2: p.initialSl, tone: 'down', bounded: true });
  }
  if (p.initialTp != null) {
    lines.push({ id: 'insp:tp', price: p.initialTp, tone: 'up', style: 'dashed', axis: 'TP', label: 'Initial target', draggable: false });
    zones.push({ t1: p.openedAt, t2: p.closedAt, p1: p.entryPrice, p2: p.initialTp, tone: 'up', bounded: true });
  }
  const segments: Segment[] = [{ t1: p.openedAt, p1: p.entryPrice, t2: p.closedAt ?? p.openedAt, p2: exit, tone: 'fg', dash: [4, 3] }];
  return { lines, segments, zones };
}

function snap(x: number, spec: SymbolSpec): number {
  const d = Math.max(0, Math.round(-Math.log10(spec.tickSize)));
  return Number((Math.round(x / spec.tickSize) * spec.tickSize).toFixed(d));
}

export function buildLines(o: {
  positions: Position[];
  orders: Order[];
  quote: Quote | undefined;
  spec: SymbolSpec;
  cfg: AccountConfig;
  draft: TicketDraft | null;
  resolved: ResolvedTicket | null;
  lastTime: number | null;
  handlers: LineHandlers;
}): ChartLine[] {
  const lines: ChartLine[] = [];
  for (const p of o.positions) lines.push(...positionLines(p, o.quote, o.spec, o.cfg, o.handlers));
  for (const ord of o.orders) lines.push(...orderLines(ord, o.quote, o.spec, o.handlers));
  if (o.draft && o.resolved) lines.push(...draftLines(o.draft, o.resolved, o.spec, o.cfg, o.lastTime, o.handlers));
  return lines;
}

/** Zones follow their lines — including while a line is being dragged. */
export function sceneFor(lines: ChartLine[], override: { id: string; price: number } | null, extra?: { zones: Zone[]; segments: Segment[] }): ZoneScene {
  const priceOf = (l: ChartLine) => (override && override.id === l.id ? override.price : l.price);
  const zones: Zone[] = lines
    .filter((l) => l.zone)
    .map((l) => ({
      t1: l.zone!.from,
      t2: l.zone!.to,
      p1: l.zone!.base,
      p2: priceOf(l),
      tone: l.zone!.tone,
    }));
  return {
    zones: [...zones, ...(extra?.zones ?? [])],
    segments: extra?.segments ?? [],
    levels: lines.filter((l) => l.tone !== 'liq').map(priceOf),
  };
}

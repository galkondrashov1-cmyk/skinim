import { stepDecimals } from '@/engine/num';

const MINUS = '−';

const cache = new Map<string, Intl.NumberFormat>();
function nf(min: number, max: number, compact = false): Intl.NumberFormat {
  const k = `${min}|${max}|${compact}`;
  let f = cache.get(k);
  if (!f) {
    f = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: min,
      maximumFractionDigits: max,
      notation: compact ? 'compact' : 'standard',
    });
    cache.set(k, f);
  }
  return f;
}

function signed(s: string, x: number, sign: boolean): string {
  if (x < 0) return MINUS + s;
  if (sign && x > 0) return '+' + s;
  return s;
}

export function fmtNum(x: number | null | undefined, decimals = 2, opts: { sign?: boolean } = {}): string {
  if (x == null || !Number.isFinite(x)) return '—';
  return signed(nf(decimals, decimals).format(Math.abs(x)), x, !!opts.sign);
}

export function fmtPrice(x: number | null | undefined, tick: number): string {
  if (x == null || !Number.isFinite(x)) return '—';
  return fmtNum(x, Math.min(8, stepDecimals(tick)));
}

/** Price with sub-tick precision (e.g. slipped fills, liquidation levels). */
export function fmtPriceFine(x: number | null | undefined, tick: number): string {
  if (x == null || !Number.isFinite(x)) return '—';
  const d = Math.min(8, stepDecimals(tick));
  const exact = Number(x.toFixed(d));
  return fmtNum(x, Math.abs(exact - x) > 1e-12 ? d + 1 : d);
}

export function fmtQty(x: number | null | undefined, step: number): string {
  if (x == null || !Number.isFinite(x)) return '—';
  return fmtNum(x, Math.min(8, stepDecimals(step)));
}

export function fmtMoney(x: number | null | undefined, opts: { sign?: boolean; decimals?: number } = {}): string {
  return fmtNum(x, opts.decimals ?? 2, { sign: opts.sign });
}

export function fmtPct(x: number | null | undefined, opts: { sign?: boolean; decimals?: number } = {}): string {
  if (x == null || !Number.isFinite(x)) return '—';
  return fmtNum(x, opts.decimals ?? 2, { sign: opts.sign }) + '%';
}

export function fmtCompact(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return '—';
  return nf(0, 2, true).format(x);
}

export function fmtR(r: number | null | undefined): string {
  if (r == null || !Number.isFinite(r)) return '—';
  return fmtNum(r, 2, { sign: true }) + 'R';
}

export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export function fmtAgo(ms: number): string {
  if (ms < 1500) return 'now';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

const dtf = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const tf = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const df = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

export function fmtDateTime(ts: number | null | undefined): string {
  return ts == null ? '—' : dtf.format(ts);
}
export function fmtTime(ts: number | null | undefined): string {
  return ts == null ? '—' : tf.format(ts);
}
export function fmtDate(ts: number | null | undefined): string {
  return ts == null ? '—' : df.format(ts);
}

export function toneOf(x: number | null | undefined): 'up' | 'down' | '' {
  if (x == null || !Number.isFinite(x) || Math.abs(x) < 1e-12) return '';
  return x > 0 ? 'up' : 'down';
}

/** Parse user input like "67,234.5" or "1e-3". Returns NaN for empty/invalid. */
export function parseNum(s: string): number {
  const t = s.replace(/[,\s_]/g, '').replace(MINUS, '-');
  if (!t) return NaN;
  const x = Number(t);
  return Number.isFinite(x) ? x : NaN;
}

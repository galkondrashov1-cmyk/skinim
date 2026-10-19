import {
  cancelOrder as engCancel,
  closePosition as engClose,
  createAccount as engCreateAccount,
  DEFAULT_CONFIG,
  evaluateRisk,
  modifyOrder as engModify,
  placeOrder as engPlace,
  processBar,
  processQuote,
  quoteIsFresh,
  renameAccount as engRename,
  setProtection as engProtect,
  unlockAccount as engUnlock,
  updateConfig as engUpdateConfig,
  computeMetrics,
  type OrderPatch,
  type Outcome,
} from '@/engine/engine';
import { uid } from '@/engine/num';
import type { AccountConfig, EngineContext, EngineEvent, EngineResult, EngineState, Notice, OrderRequest, Quote, TrailSpec } from '@/engine/types';
import { db, deleteAccountData, enqueue, flushWrites, kvGet, kvSet, persistEvents } from '@/db/db';
import { hub } from '@/market/hub';
import { INTERVAL_MS, type Candle, type Interval } from '@/market/types';
import { pushToast, useApp, type AwaySummary } from './app';
import { useUI } from './ui';
import { wireMarketStore } from './market';

/**
 * The runtime owns the authoritative engine state for every account, feeds it
 * market data, persists every event and mirrors state into React.
 * Only one tab may run it (Web Locks); others are told to step aside.
 */

const engines = new Map<string, EngineState>();
const softDirty = new Set<string>();
const replaying = new Set<string>();
let leader = false;
let commitScheduled = false;
let quoteWatch: (() => void) | null = null;
let watchedKey = '';

function ctx(now = Date.now()): EngineContext {
  return { now, quotes: hub.quotes, specs: hub.instruments, ids: uid };
}

function commit(immediate = false) {
  const flush = () => {
    commitScheduled = false;
    const obj: Record<string, EngineState> = {};
    for (const [k, v] of engines) obj[k] = v;
    useApp.setState({ engines: obj, accounts: [...engines.values()].map((e) => e.account).sort((a, b) => a.createdAt - b.createdAt) });
  };
  if (immediate) return flush();
  if (commitScheduled) return;
  commitScheduled = true;
  setTimeout(flush, 100);
}

function notices(events: readonly EngineEvent[]): Notice[] {
  return events.flatMap((e) => (e.type === 'notice' ? [e.notice] : []));
}

function apply(accountId: string, r: EngineResult, opts: { toast?: boolean } = {}) {
  engines.set(accountId, r.state);
  if (r.events.length) {
    void persistEvents(r.events);
    if (opts.toast !== false && accountId === useApp.getState().activeId) for (const n of notices(r.events)) pushToast(n);
    if (r.events.some((e) => e.type === 'fill')) snapshotEquity(accountId);
    commit(true);
    syncQuoteWatch();
  } else {
    commit();
  }
}

function snapshotEquity(accountId: string, now = Date.now()) {
  const st = engines.get(accountId);
  if (!st) return;
  const m = computeMetrics(st, hub.quotes, now);
  void enqueue(() => db.equity.put({ accountId, ts: now, equity: m.equity, balance: m.balance }));
}

/** Symbols the engine must see prices for: open positions, working orders, the chart and watchlist. */
function relevantSymbols(): Set<string> {
  const s = new Set<string>();
  for (const st of engines.values()) {
    for (const p of st.positions) s.add(p.symbol);
    for (const o of st.orders) s.add(o.symbol);
  }
  return s;
}

export function syncQuoteWatch() {
  // Best bid/ask only where execution or the chart needs it; the watchlist runs on 1s mini-tickers.
  const ui = useUI.getState();
  const set = relevantSymbols();
  set.add(ui.symbol);
  const key = [...set].sort().join(',');
  if (key === watchedKey) return;
  watchedKey = key;
  const prev = quoteWatch;
  quoteWatch = hub.watchQuotes([...set]);
  prev?.();
}

// ─────────────────────────────────────────────────────────── leadership ──

const LOCK = 'kata-engine';
const STEAL_FLAG = 'kata.steal';

function acquireLock(): Promise<boolean> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks) return Promise.resolve(true);
  let steal = false;
  try {
    steal = sessionStorage.getItem(STEAL_FLAG) === '1';
    sessionStorage.removeItem(STEAL_FLAG);
  } catch {
    /* private mode */
  }
  return new Promise((resolve) => {
    const opts: LockOptions = steal ? { steal: true } : { ifAvailable: true };
    locks
      .request(LOCK, opts, async (lock) => {
        if (!lock) {
          resolve(false);
          return;
        }
        resolve(true);
        await new Promise<void>(() => {}); // hold for the life of the tab
      })
      .catch(() => {
        // Another tab took over.
        leader = false;
        useApp.setState({ phase: 'blocked' });
      });
  });
}

export function takeOver() {
  try {
    sessionStorage.setItem(STEAL_FLAG, '1');
  } catch {
    /* ignore */
  }
  location.reload();
}

// ──────────────────────────────────────────────────────────────── boot ──

let booted = false;

export async function boot() {
  if (booted) return;
  booted = true;
  const step = (bootStep: string) => useApp.setState({ bootStep });
  try {
    wireMarketStore();
    step('Claiming this window');
    leader = await acquireLock();
    if (!leader) {
      useApp.setState({ phase: 'blocked' });
      return;
    }
    step('Opening your books');
    const accounts = await db.accounts.toArray();
    for (const a of accounts) {
      const [positions, orders] = await Promise.all([
        db.positions.where('[accountId+status]').equals([a.id, 'open']).toArray(),
        db.orders.where('[accountId+status]').equals([a.id, 'working']).toArray(),
      ]);
      engines.set(a.id, { account: a, positions, orders });
    }
    let activeId = await kvGet<string | null>('activeAccount', null);
    if (!activeId || !engines.has(activeId)) activeId = accounts[0]?.id ?? null;
    useApp.setState({ activeId });
    commit(true);

    step('Connecting to market data');
    hub.start();
    syncQuoteWatch();
    useUI.subscribe((s, p) => {
      if (s.symbol !== p.symbol || s.watchlist !== p.watchlist) syncQuoteWatch();
    });
    hub.onQuote.on(onQuote);
    hub.onStatus.on((st) => {
      if (st.state === 'live' || st.state === 'delayed') void reconcileAll();
    });
    setInterval(tickRisk, 1_000);
    setInterval(reconcileAll, 10_000);
    setInterval(persistSoft, 3_000);
    setInterval(periodicSnapshots, 60_000);
    const onHide = () => {
      persistSoft(true);
    };
    addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') onHide();
    });

    if (!engines.size) {
      useApp.setState({ phase: 'welcome' });
      return;
    }
    step('Reconciling time away');
    await reconcileAll(true);
    useApp.setState({ phase: 'ready' });
  } catch (e) {
    console.error(e);
    useApp.setState({ phase: 'error', error: e instanceof Error ? e.message : String(e) });
  }
}

// ────────────────────────────────────────────────────────────── market ──

function onQuote(q: Quote) {
  if (!leader) return;
  for (const [id, st] of engines) {
    if (replaying.has(id)) continue;
    const r = processQuote(st, q, ctx());
    if (r.events.length || r.softDirty) {
      if (r.softDirty) softDirty.add(id);
      apply(id, r);
    }
  }
}

function tickRisk() {
  if (!leader) return;
  for (const [id, st] of engines) {
    if (replaying.has(id)) continue;
    const r = evaluateRisk(st, ctx());
    if (r.events.length) apply(id, r);
    else if (r.softDirty) {
      engines.set(id, r.state);
      softDirty.add(id);
    }
  }
}

function persistSoft(force = false) {
  if (!softDirty.size && !force) return;
  const ids = force ? [...engines.keys()] : [...softDirty];
  softDirty.clear();
  const rows = ids.flatMap((id) => {
    const st = engines.get(id);
    return st ? [st] : [];
  });
  void enqueue(() =>
    db.transaction('rw', [db.positions, db.accounts], async () => {
      for (const st of rows) {
        await db.accounts.put(st.account);
        for (const p of st.positions) await db.positions.put(p);
      }
    }),
  );
}

function periodicSnapshots() {
  for (const [id, st] of engines) if (st.positions.length) snapshotEquity(id);
}

/** Pick candle resolution for replaying a gap: fine for short gaps, coarser for long ones. */
function replayInterval(gapMs: number): Interval {
  if (gapMs <= 2 * 86_400_000) return '1m';
  if (gapMs <= 20 * 86_400_000) return '15m';
  if (gapMs <= 120 * 86_400_000) return '1h';
  return '1d';
}

async function fetchRange(symbol: string, interval: Interval, from: number, to: number): Promise<Candle[]> {
  const ms = INTERVAL_MS[interval];
  const out: Candle[] = [];
  let start = from;
  for (let page = 0; page < 12 && start <= to; page++) {
    const batch = await hub.getCandles(symbol, interval, { startTime: start, limit: 1000 });
    const fresh = batch.filter((c) => c.time >= start && c.time <= to);
    out.push(...fresh);
    if (batch.length < 1000) break;
    start = batch[batch.length - 1].time + ms;
  }
  return out;
}

let reconciling = false;

/**
 * Bring every account up to date. When an account's positions or orders have
 * gone unwatched (app closed, network down), replay real candles for the gap so
 * stops, targets, limits and liquidations that happened are honoured.
 */
async function reconcileAll(initial = false) {
  if (!leader || reconciling) return;
  reconciling = true;
  const now = Date.now();
  try {
    for (const [id, st] of engines) {
      const symbols = new Set([...st.positions.map((p) => p.symbol), ...st.orders.map((o) => o.symbol)]);
      const allFresh = [...symbols].every((s) => quoteIsFresh(hub.quotes.get(s), now));
      const gap = now - st.account.lastProcessedAt;
      if (!symbols.size || (gap < 120_000 && allFresh)) {
        if (!symbols.size || allFresh) {
          engines.set(id, { ...st, account: { ...st.account, lastProcessedAt: now } });
          softDirty.add(id); // persisted by the 3s soft flush
        }
        continue;
      }
      if (gap < 120_000) continue; // short gap, live data not back yet
      await replayGap(id, [...symbols], st.account.lastProcessedAt, now, initial);
    }
  } finally {
    reconciling = false;
    commit();
  }
}

async function replayGap(accountId: string, symbols: string[], from: number, to: number, initial: boolean) {
  const interval = replayInterval(to - from);
  const ms = INTERVAL_MS[interval];
  const start = Math.floor(from / ms) * ms + ms; // first full candle after the last processed price
  replaying.add(accountId);
  useApp.setState({ catchup: { state: 'running', detail: `Replaying ${interval} candles since ${new Date(from).toLocaleString()}` } });
  try {
    const series = await Promise.all(symbols.map(async (s) => ({ s, candles: await fetchRange(s, interval, start, to) })));
    const bars = series.flatMap(({ s, candles }) => candles.map((c) => ({ s, c }))).sort((a, b) => a.c.time - b.c.time);
    let st = engines.get(accountId)!;
    const replayQuotes = new Map(hub.quotes);
    const events: EngineEvent[] = [];
    for (const { s, c } of bars) {
      const end = Math.min(c.time + ms - 1, to);
      const r = processBar(st, s, c, ms, { now: end, quotes: replayQuotes, specs: hub.instruments, ids: uid });
      st = r.state;
      events.push(...r.events);
      replayQuotes.set(s, { symbol: s, bid: c.close, ask: c.close, last: c.close, ts: end, source: 'replay' });
    }
    st = { ...st, account: { ...st.account, lastProcessedAt: to } };
    engines.set(accountId, st);
    events.push({ type: 'account', account: st.account });
    await persistEvents(events);
    const ns = notices(events);
    if (ns.length) {
      const away: AwaySummary = { accountId, from, to, notices: ns, interval };
      useApp.setState({ away });
      if (!initial) for (const n of ns) pushToast(n);
      snapshotEquity(accountId, to);
    }
    useApp.setState({ catchup: { state: 'idle', detail: null } });
  } catch (e) {
    useApp.setState({
      catchup: { state: 'failed', detail: `Could not reconcile time away (${e instanceof Error ? e.message : 'network'}). Retrying when data is available.` },
    });
  } finally {
    replaying.delete(accountId);
    commit(true);
    syncQuoteWatch();
  }
}

// ───────────────────────────────────────────────────────────── actions ──

function activeId(): string {
  const id = useApp.getState().activeId;
  if (!id) throw new Error('No active account');
  return id;
}

function run(fn: (st: EngineState, c: EngineContext) => Outcome): Outcome {
  const id = activeId();
  const st = engines.get(id)!;
  const r = fn(st, ctx());
  if (r.error && !r.events.length) {
    pushToast({ level: 'error', title: 'Not executed', body: r.error });
    return r;
  }
  apply(id, r);
  return r;
}

export const actions = {
  placeOrder: (req: OrderRequest) => run((st, c) => engPlace(st, req, c)),
  cancelOrder: (orderId: string) => run((st, c) => engCancel(st, orderId, c)),
  cancelAll: () => {
    const id = activeId();
    for (const o of engines.get(id)!.orders) run((st, c) => engCancel(st, o.id, c));
  },
  modifyOrder: (orderId: string, patch: OrderPatch) => run((st, c) => engModify(st, orderId, patch, c)),
  closePosition: (positionId: string, qty: number | 'all') => run((st, c) => engClose(st, positionId, qty, c)),
  closeAll: () => {
    const id = activeId();
    for (const p of engines.get(id)!.positions) run((st, c) => engClose(st, p.id, 'all', c));
  },
  setProtection: (positionId: string, patch: { sl?: number | null; tp?: number | null; trail?: TrailSpec | null }) =>
    run((st, c) => engProtect(st, positionId, patch, c)),

  async createAccount(name: string, capital: number, config: AccountConfig = DEFAULT_CONFIG) {
    const id = uid();
    const { account, ledger } = engCreateAccount({ id, name, initialBalance: capital, now: Date.now(), config, ledgerId: uid() });
    engines.set(id, { account, positions: [], orders: [] });
    await persistEvents([
      { type: 'account', account },
      { type: 'ledger', entry: ledger },
    ]);
    await enqueue(() => db.equity.put({ accountId: id, ts: account.createdAt, equity: capital, balance: capital }));
    await actions.switchAccount(id);
    if (useApp.getState().phase === 'welcome') useApp.setState({ phase: 'ready' });
    return id;
  },

  async switchAccount(id: string) {
    if (!engines.has(id)) return;
    useApp.setState({ activeId: id });
    await kvSet('activeAccount', id);
    commit(true);
  },

  async renameAccount(id: string, name: string) {
    const st = engines.get(id);
    if (!st) return;
    apply(id, engRename(st, name, ctx()), { toast: false });
  },

  async updateConfig(id: string, config: AccountConfig) {
    const st = engines.get(id);
    if (!st) return;
    apply(id, engUpdateConfig(st, config, ctx()), { toast: false });
  },

  unlock() {
    const id = activeId();
    apply(id, engUnlock(engines.get(id)!, ctx()), { toast: false });
    pushToast({ level: 'info', title: 'Account unlocked', body: 'Drawdown tracking restarts from current equity.' });
  },

  /** Wipe an account's history and start again with the same name and settings. */
  async resetAccount(id: string, capital?: number) {
    const st = engines.get(id);
    if (!st) return;
    const { name, config, initialBalance } = st.account;
    await deleteAccountData(id);
    const { account, ledger } = engCreateAccount({ id, name, initialBalance: capital ?? initialBalance, now: Date.now(), config, ledgerId: uid() });
    engines.set(id, { account, positions: [], orders: [] });
    await persistEvents([
      { type: 'account', account },
      { type: 'ledger', entry: { ...ledger, type: 'reset', note: 'Account reset' } },
    ]);
    await enqueue(() => db.equity.put({ accountId: id, ts: account.createdAt, equity: account.balance, balance: account.balance }));
    commit(true);
    syncQuoteWatch();
    pushToast({ level: 'info', title: `${name} reset`, body: 'Fresh paper capital. History cleared.' });
  },

  async deleteAccount(id: string) {
    await deleteAccountData(id);
    engines.delete(id);
    const next = [...engines.keys()][0] ?? null;
    if (useApp.getState().activeId === id) {
      useApp.setState({ activeId: next });
      await kvSet('activeAccount', next);
    }
    commit(true);
    syncQuoteWatch();
    if (!engines.size) useApp.setState({ phase: 'welcome' });
  },

  dismissAway() {
    useApp.setState({ away: null });
  },
};

export function engineContext() {
  return ctx();
}

export async function flushAll() {
  persistSoft(true);
  await flushWrites();
}

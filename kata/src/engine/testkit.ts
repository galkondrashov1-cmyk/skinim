import type { AccountConfig, EngineContext, EngineEvent, EngineState, Quote, SymbolSpec } from './types';
import { createAccount, DEFAULT_CONFIG } from './engine';

export const BTC: SymbolSpec = {
  symbol: 'BTCUSDT',
  base: 'BTC',
  quote: 'USDT',
  tickSize: 0.01,
  stepSize: 0.00001,
  minQty: 0.00001,
  minNotional: 5,
  venue: 'binance',
};

export const ETH: SymbolSpec = { ...BTC, symbol: 'ETHUSDT', base: 'ETH', stepSize: 0.0001, minQty: 0.0001 };

export const T0 = Date.UTC(2026, 9, 19, 12, 0, 0);

export function cfg(over: Partial<Omit<AccountConfig, 'risk'>> & { risk?: Partial<AccountConfig['risk']> } = {}): AccountConfig {
  return { ...DEFAULT_CONFIG, ...over, risk: { ...DEFAULT_CONFIG.risk, ...(over.risk ?? {}) } };
}

/** A deterministic harness around the pure engine. */
export function harness(opts: { balance?: number; config?: AccountConfig } = {}) {
  let n = 0;
  const ids = () => `id${++n}`;
  const { account, ledger } = createAccount({
    id: 'acc',
    name: 'Test',
    initialBalance: opts.balance ?? 10_000,
    now: T0,
    config: opts.config ?? cfg({ slippageBps: 0, risk: { dailyLossLimitPct: null } }),
    ledgerId: 'l0',
  });
  const h = {
    state: { account, positions: [], orders: [] } as EngineState,
    quotes: new Map<string, Quote>(),
    specs: new Map<string, SymbolSpec>([
      [BTC.symbol, BTC],
      [ETH.symbol, ETH],
    ]),
    now: T0,
    events: [] as EngineEvent[],
    ledger: [ledger.amount],
    ctx(): EngineContext {
      return { now: h.now, quotes: h.quotes, specs: h.specs, ids };
    },
    quote(symbol: string, bid: number, ask = bid, source: Quote['source'] = 'live'): Quote {
      const q = { symbol, bid, ask, last: (bid + ask) / 2, ts: h.now, source };
      h.quotes.set(symbol, q);
      return q;
    },
    apply<T extends { state: EngineState; events: EngineEvent[] }>(r: T): T {
      h.state = r.state;
      h.events.push(...r.events);
      for (const e of r.events) if (e.type === 'ledger') h.ledger.push(e.entry.amount);
      return r;
    },
    fills() {
      return h.events.flatMap((e) => (e.type === 'fill' ? [e.fill] : []));
    },
    closed() {
      const last = new Map<string, import('./types').Position>();
      for (const e of h.events) if (e.type === 'position') last.set(e.position.id, e.position);
      return [...last.values()].filter((p) => p.status === 'closed');
    },
    ledgerSum() {
      return h.ledger.reduce((a, b) => a + b, 0);
    },
  };
  return h;
}

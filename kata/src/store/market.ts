import { create } from 'zustand';
import type { Quote } from '@/engine/types';
import { hub } from '@/market/hub';
import type { FeedStatus, Ticker, Venue } from '@/market/types';

interface MarketStore {
  quotes: Record<string, Quote>;
  tickers: Record<string, Ticker>;
  status: Record<Venue, FeedStatus>;
  /** Bumped when instrument specs change. */
  specsVersion: number;
  /** Bumped every second so "x seconds ago" labels and staleness re-evaluate. */
  clock: number;
}

export const useMarket = create<MarketStore>(() => ({
  quotes: {},
  tickers: {},
  status: { ...hub.status },
  specsVersion: 0,
  clock: Date.now(),
}));

let wired = false;

/** Mirror the hub into React at a UI-friendly rate (≈8 Hz) — the engine itself sees every tick. */
export function wireMarketStore() {
  if (wired) return;
  wired = true;
  const pendingQuotes = new Map<string, Quote>();
  const pendingTickers = new Map<string, Ticker>();
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    if (!pendingQuotes.size && !pendingTickers.size) return;
    const q = Object.fromEntries(pendingQuotes);
    const t = Object.fromEntries(pendingTickers);
    pendingQuotes.clear();
    pendingTickers.clear();
    useMarket.setState((s) => ({ quotes: { ...s.quotes, ...q }, tickers: { ...s.tickers, ...t } }));
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(flush, 125);
  };
  hub.onQuote.on((q) => {
    pendingQuotes.set(q.symbol, q);
    schedule();
  });
  hub.onTicker.on((t) => {
    pendingTickers.set(t.symbol, t);
    schedule();
  });
  hub.onStatus.on((st) => useMarket.setState((s) => ({ status: { ...s.status, [st.venue]: st } })));
  hub.onInstruments.on(() => useMarket.setState((s) => ({ specsVersion: s.specsVersion + 1 })));
  setInterval(() => useMarket.setState({ clock: Date.now() }), 1_000);
}

export function useQuote(symbol: string | null | undefined): Quote | undefined {
  return useMarket((s) => (symbol ? s.quotes[symbol] : undefined));
}

export function useTicker(symbol: string): Ticker | undefined {
  return useMarket((s) => s.tickers[symbol]);
}

export function useInstrument(symbol: string) {
  useMarket((s) => s.specsVersion);
  return hub.instrument(symbol);
}

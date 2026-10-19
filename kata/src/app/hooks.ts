import { useEffect, useMemo, useState } from 'react';
import { computeMetrics } from '@/engine/engine';
import type { AccountMetrics } from '@/engine/types';
import { hub } from '@/market/hub';
import { useActiveEngine } from '@/store/app';
import { useMarket } from '@/store/market';
import type { TagKind } from './SourceTag';

/** Live account metrics for the active account (re-evaluated at UI rate). */
export function useMetrics(): AccountMetrics | null {
  const engine = useActiveEngine();
  const quotes = useMarket((s) => s.quotes);
  const clock = useMarket((s) => s.clock);
  return useMemo(() => (engine ? computeMetrics(engine, hub.quotes, Date.now()) : null), [engine, quotes, clock]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Honest data label for a symbol right now. */
export function useSourceOf(symbol: string): { kind: TagKind; detail?: string; ageMs: number | null } {
  const q = useMarket((s) => s.quotes[symbol]);
  const status = useMarket((s) => s.status);
  const clock = useMarket((s) => s.clock);
  const venue = hub.venueOf(symbol);
  if (venue === 'sim') return { kind: 'simulated', ageMs: q ? clock - q.ts : null };
  const st = status.binance;
  const age = q ? Math.max(0, clock - q.ts) : null;
  if (!q) return { kind: st.state === 'offline' ? 'offline' : 'connecting', ageMs: null };
  if (age! > 30_000) return { kind: 'offline', detail: `${Math.round(age! / 1000)}s old`, ageMs: age };
  if (q.source === 'delayed' || st.state === 'delayed' || age! > 5_000)
    return { kind: 'delayed', detail: age! >= 1_000 ? `${Math.round(age! / 1000)}s` : undefined, ageMs: age };
  return { kind: 'live', ageMs: age };
}

export function useMediaQuery(q: string): boolean {
  const [m, setM] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const mq = matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    on();
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}

export const useIsMobile = () => useMediaQuery('(max-width: 899px)');

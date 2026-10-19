import { create } from 'zustand';
import type { Account, EngineState, Notice } from '@/engine/types';

export type Phase = 'booting' | 'welcome' | 'ready' | 'blocked' | 'error';

export interface Toast extends Notice {
  id: number;
  ts: number;
}

export interface AwaySummary {
  accountId: string;
  from: number;
  to: number;
  notices: Notice[];
  /** Interval of the real candles used to reconstruct the gap. */
  interval: string;
}

export interface AppStore {
  phase: Phase;
  bootStep: string;
  error: string | null;
  accounts: Account[];
  activeId: string | null;
  engines: Record<string, EngineState>;
  toasts: Toast[];
  away: AwaySummary | null;
  catchup: { state: 'idle' | 'running' | 'failed'; detail: string | null };
}

export const useApp = create<AppStore>(() => ({
  phase: 'booting',
  bootStep: 'Opening your books',
  error: null,
  accounts: [],
  activeId: null,
  engines: {},
  toasts: [],
  away: null,
  catchup: { state: 'idle', detail: null },
}));

let toastSeq = 0;

export function pushToast(n: Notice) {
  const t: Toast = { ...n, id: ++toastSeq, ts: Date.now() };
  useApp.setState((s) => ({ toasts: [...s.toasts.slice(-4), t] }));
  return t.id;
}

export function dismissToast(id: number) {
  useApp.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

/** Engine state of the active account. */
export function useActiveEngine(): EngineState | null {
  return useApp((s) => (s.activeId ? (s.engines[s.activeId] ?? null) : null));
}

export function useActiveAccount(): Account | null {
  return useApp((s) => (s.activeId ? (s.engines[s.activeId]?.account ?? null) : null));
}

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { IndicatorId } from '@/indicators/indicators';
import { DEFAULT_WATCHLIST } from '@/market/instruments';
import type { Interval } from '@/market/types';
import type { OrderType, PositionSide, TrailSpec } from '@/engine/types';

export type Theme = 'system' | 'dark' | 'light';
export type Palette = 'standard' | 'colorblind';
export type SizeMode = 'qty' | 'notional' | 'risk';

export interface UIPrefs {
  symbol: string;
  interval: Interval;
  indicators: IndicatorId[];
  watchlist: string[];
  theme: Theme;
  palette: Palette;
  confirmOrders: boolean;
  /** Show bid/ask and P&L lines for all accounts' positions on the chart. */
  showHistoryMarkers: boolean;
  bottomTab: 'positions' | 'orders' | 'history' | 'fills';
  /** Install banner dismissed. */
  installDismissedAt: number | null;
  defaultLeverage: number;
}

export const useUI = create<UIPrefs>()(
  persist(
    (): UIPrefs => ({
      symbol: 'BTCUSDT',
      interval: '15m',
      indicators: ['volume', 'ema20', 'ema50'],
      watchlist: DEFAULT_WATCHLIST,
      theme: 'system',
      palette: 'standard',
      confirmOrders: false,
      showHistoryMarkers: true,
      bottomTab: 'positions',
      installDismissedAt: null,
      defaultLeverage: 5,
    }),
    {
      name: 'kata.ui.v1',
      storage: createJSONStorage(() => {
        try {
          return localStorage;
        } catch {
          const mem = new Map<string, string>();
          return { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) };
        }
      }),
    },
  ),
);

/** Order ticket draft. Lives outside prefs so the chart can draw and drag it. */
export interface TicketDraft {
  side: PositionSide;
  type: OrderType;
  /** Limit/stop price as typed (string keeps user formatting). */
  price: string;
  sizeMode: SizeMode;
  size: string;
  leverage: number;
  slOn: boolean;
  sl: string;
  tpOn: boolean;
  tp: string;
  trailOn: boolean;
  trail: TrailSpec;
}

export const emptyDraft = (leverage: number): TicketDraft => ({
  side: 'long',
  type: 'market',
  price: '',
  sizeMode: 'qty',
  size: '',
  leverage,
  slOn: false,
  sl: '',
  tpOn: false,
  tp: '',
  trailOn: false,
  trail: { mode: 'percent', value: 1 },
});

export const useTicket = create<TicketDraft & { set: (p: Partial<TicketDraft>) => void; reset: () => void }>((set) => ({
  ...emptyDraft(useUI.getState().defaultLeverage),
  set: (p) => set(p),
  reset: () => set((s) => ({ ...emptyDraft(useUI.getState().defaultLeverage), side: s.side, type: s.type, leverage: s.leverage, sizeMode: s.sizeMode })),
}));

/** Transient view state (not persisted). */
export interface ViewState {
  /** Closed position being inspected on the chart. */
  inspectId: string | null;
  mobilePane: 'markets' | 'chart' | 'trade' | 'positions';
  ticketOpen: boolean;
  dialog: null | { kind: 'close'; positionId: string } | { kind: 'edit-order'; orderId: string } | { kind: 'edit-position'; positionId: string } | { kind: 'accounts' } | { kind: 'search' } | { kind: 'install' } | { kind: 'about' };
}

export const useView = create<ViewState>(() => ({ inspectId: null, mobilePane: 'chart', ticketOpen: false, dialog: null }));

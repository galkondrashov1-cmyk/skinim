import type { Quote, SymbolSpec } from '@/engine/types';

export type Interval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w';

export const INTERVALS: Interval[] = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'];

export const INTERVAL_MS: Record<Interval, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
  '1w': 604_800_000,
};

export const INTERVAL_LABEL: Record<Interval, string> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '1h': '1H',
  '4h': '4H',
  '1d': '1D',
  '1w': '1W',
};

export interface Candle {
  /** Open time, ms UTC. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Base-asset volume. */
  volume: number;
}

export interface Ticker {
  symbol: string;
  last: number;
  open24h: number;
  high24h: number;
  low24h: number;
  changePct: number;
  quoteVolume: number;
  ts: number;
}

export type Venue = 'binance' | 'sim';

/**
 * Connection-level state of a data venue.
 *  live       streaming in real time
 *  delayed    real data, but via polling or arriving late
 *  connecting first connection in progress
 *  offline    no data — trading on this venue is paused
 *  simulated  synthetic prices (Kata Sim)
 */
export type FeedState = 'connecting' | 'live' | 'delayed' | 'offline' | 'simulated';

export interface FeedStatus {
  venue: Venue;
  state: FeedState;
  since: number;
  /** Human-readable explanation for anything other than live. */
  detail: string | null;
  /** Host currently serving data, for transparency. */
  host: string | null;
}

export interface Instrument extends SymbolSpec {
  /** Display name, e.g. "Bitcoin". */
  name: string;
}

export interface CandleQuery {
  endTime?: number;
  startTime?: number;
  limit?: number;
}

export interface MarketProvider {
  venue: Venue;
  fetchCandles(symbol: string, interval: Interval, q?: CandleQuery): Promise<Candle[]>;
  fetchSpecs(symbols: string[]): Promise<Instrument[]>;
  fetchTickers(symbols: string[]): Promise<Ticker[]>;
}

export type QuoteListener = (q: Quote) => void;
export type CandleListener = (c: Candle) => void;
export type TickerListener = (t: Ticker) => void;
export type StatusListener = (s: FeedStatus) => void;

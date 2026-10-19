import type { Instrument } from './types';
import { displayName } from './binance';
import { SIM_INSTRUMENTS } from './sim';

/**
 * Fallback filters for common pairs so the app can validate orders before
 * exchangeInfo arrives. They are replaced by live exchange filters on load.
 */
const FALLBACK: [string, number, number][] = [
  ['BTCUSDT', 0.01, 0.00001],
  ['ETHUSDT', 0.01, 0.0001],
  ['SOLUSDT', 0.01, 0.001],
  ['BNBUSDT', 0.01, 0.001],
  ['XRPUSDT', 0.0001, 0.1],
  ['DOGEUSDT', 0.00001, 1],
  ['ADAUSDT', 0.0001, 0.1],
  ['AVAXUSDT', 0.01, 0.01],
  ['LINKUSDT', 0.01, 0.01],
  ['LTCUSDT', 0.01, 0.001],
];

export const FALLBACK_INSTRUMENTS: Instrument[] = FALLBACK.map(([symbol, tickSize, stepSize]) => {
  const base = symbol.replace(/USDT$/, '');
  return { symbol, base, quote: 'USDT', tickSize, stepSize, minQty: stepSize, minNotional: 5, venue: 'binance', name: displayName(base) };
});

export const DEFAULT_WATCHLIST = [
  'BTCUSDT',
  'ETHUSDT',
  'SOLUSDT',
  'XRPUSDT',
  'BNBUSDT',
  'DOGEUSDT',
  'LINKUSDT',
  'AVAXUSDT',
  ...SIM_INSTRUMENTS.map((i) => i.symbol),
];

export function guessInstrument(symbol: string): Instrument {
  const base = symbol.replace(/USDT$/, '');
  return { symbol, base, quote: 'USDT', tickSize: 0.0001, stepSize: 0.001, minQty: 0.001, minNotional: 5, venue: 'binance', name: displayName(base) };
}

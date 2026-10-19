/**
 * Core domain model for the Kata paper-trading engine.
 *
 * Model: USDT-margined, isolated-margin trading on real spot prices.
 * Every filled entry order opens its own position (hedging model), so a
 * position is exactly one trade in the journal and analytics.
 */

export type PositionSide = 'long' | 'short';
export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop';
export type OrderStatus = 'working' | 'filled' | 'cancelled' | 'rejected';
export type OrderIntent = 'open' | 'close';
export type Liquidity = 'maker' | 'taker';

/**
 * Provenance of a price. Every fill records it so history never blurs
 * real market data with anything else.
 *  - live:      real-time exchange stream
 *  - delayed:   real exchange data that arrived late or via polling
 *  - simulated: synthetic Kata Sim instruments (never real market data)
 *  - replay:    reconstructed from real historical candles while the app was closed
 */
export type PriceSource = 'live' | 'delayed' | 'simulated' | 'replay';

export type CloseReason = 'manual' | 'sl' | 'tp' | 'trail' | 'liquidation' | 'risk';

export interface Quote {
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  /** Local receive time (ms). */
  ts: number;
  source: PriceSource;
}

export interface SymbolSpec {
  symbol: string;
  base: string;
  quote: string;
  tickSize: number;
  stepSize: number;
  minQty: number;
  minNotional: number;
  venue: 'binance' | 'sim';
}

export interface TrailSpec {
  mode: 'percent' | 'price';
  /** Percent (e.g. 1.5 = 1.5%) or absolute price distance. */
  value: number;
}

export interface RiskRules {
  /** Lock new entries when the day's equity loss reaches this % of day-start equity. */
  dailyLossLimitPct: number | null;
  /** Lock the account when equity falls this % below its peak. */
  maxDrawdownPct: number | null;
  /** Reject entries whose loss at the stop exceeds this % of equity. */
  maxRiskPerTradePct: number | null;
  requireStopLoss: boolean;
  /** Max open positions + working entry orders. */
  maxOpenPositions: number | null;
  /** Close everything at market when the daily loss limit is hit. */
  flattenOnDailyLimit: boolean;
}

export interface AccountConfig {
  /** Fee rates as fractions of notional (0.0005 = 0.05%). */
  takerFee: number;
  makerFee: number;
  /** Adverse slippage applied to market/stop fills, in basis points. */
  slippageBps: number;
  /** Maintenance margin rate used for liquidation (0.005 = 0.5%). */
  maintenanceMargin: number;
  maxLeverage: number;
  risk: RiskRules;
}

export interface Account {
  id: string;
  name: string;
  currency: 'USDT';
  initialBalance: number;
  /** Wallet balance: deposits + realized P&L − fees. */
  balance: number;
  createdAt: number;
  config: AccountConfig;
  peakEquity: number;
  /** UTC day key (YYYY-MM-DD) that dayStartEquity belongs to. */
  dayKey: string;
  dayStartEquity: number;
  locked: null | { reason: 'daily' | 'drawdown'; until: number | null; at: number; message: string };
  /** Last time market data was processed for this account (for offline catch-up). */
  lastProcessedAt: number;
  /** Sequence for human-friendly order / position numbers. */
  nextNo: number;
}

export interface Order {
  id: string;
  no: number;
  accountId: string;
  symbol: string;
  side: OrderSide;
  intent: OrderIntent;
  type: OrderType;
  qty: number;
  /** Limit price, or trigger price for stops. Null for market. */
  price: number | null;
  leverage: number;
  /** Protective levels attached to an entry order; applied to the position on fill. */
  sl: number | null;
  tp: number | null;
  trail: TrailSpec | null;
  status: OrderStatus;
  createdAt: number;
  updatedAt: number;
  /** Margin + worst-case fee held while working. */
  reserved: number;
  positionId: string | null;
  filledAt: number | null;
  fillPrice: number | null;
  fee: number | null;
  liquidity: Liquidity | null;
  source: PriceSource | null;
  /** For close orders: what caused the exit. */
  closeReason: CloseReason | null;
  rejectReason: string | null;
  cancelReason: string | null;
}

export interface Position {
  id: string;
  no: number;
  accountId: string;
  symbol: string;
  side: PositionSide;
  status: 'open' | 'closed';
  qty: number;
  initialQty: number;
  entryPrice: number;
  leverage: number;
  /** Isolated margin currently locked. */
  margin: number;
  sl: number | null;
  tp: number | null;
  trail: TrailSpec | null;
  /** Best price seen since the trailing stop was armed. */
  trailAnchor: number | null;
  /** Stop at entry; defines 1R. */
  initialSl: number | null;
  initialTp: number | null;
  openedAt: number;
  closedAt: number | null;
  entryFee: number;
  exitFees: number;
  /** Gross realized P&L from all exits (before fees). */
  realizedPnl: number;
  exitQty: number;
  exitValue: number;
  closeReason: CloseReason | null;
  /** Max favourable / adverse excursion in price units (both ≥ 0). */
  mfe: number;
  mae: number;
  entryOrderId: string;
  entrySource: PriceSource;
}

export interface Fill {
  id: string;
  accountId: string;
  orderId: string;
  positionId: string;
  symbol: string;
  side: OrderSide;
  intent: OrderIntent;
  qty: number;
  price: number;
  fee: number;
  liquidity: Liquidity;
  /** Gross realized P&L (closing fills only). */
  realizedPnl: number;
  ts: number;
  source: PriceSource;
  closeReason: CloseReason | null;
}

export type LedgerType = 'deposit' | 'fee' | 'realized' | 'liquidation' | 'reset';

export interface LedgerEntry {
  id: string;
  accountId: string;
  ts: number;
  type: LedgerType;
  amount: number;
  balanceAfter: number;
  ref: string | null;
  note: string | null;
}

export type NoticeLevel = 'info' | 'success' | 'warning' | 'error';

export interface Notice {
  level: NoticeLevel;
  title: string;
  body?: string;
  ref?: { kind: 'order' | 'position'; id: string };
}

export type EngineEvent =
  | { type: 'account'; account: Account }
  | { type: 'order'; order: Order }
  | { type: 'position'; position: Position }
  | { type: 'fill'; fill: Fill }
  | { type: 'ledger'; entry: LedgerEntry }
  | { type: 'notice'; notice: Notice };

/** Live, mutable-by-engine slice of an account: only open positions and working orders. */
export interface EngineState {
  account: Account;
  positions: Position[];
  orders: Order[];
}

export interface EngineResult {
  state: EngineState;
  events: EngineEvent[];
}

export interface EngineContext {
  now: number;
  quotes: ReadonlyMap<string, Quote>;
  specs: ReadonlyMap<string, SymbolSpec>;
  ids: () => string;
}

export interface OrderRequest {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  qty: number;
  price: number | null;
  leverage: number;
  sl: number | null;
  tp: number | null;
  trail: TrailSpec | null;
}

export interface AccountMetrics {
  balance: number;
  equity: number;
  unrealizedPnl: number;
  positionMargin: number;
  orderMargin: number;
  available: number;
  grossExposure: number;
  netExposure: number;
  /** Equity / total notional, i.e. effective account leverage. */
  effectiveLeverage: number;
  dayPnl: number;
  dayPnlPct: number;
  drawdownPct: number;
  peakEquity: number;
  /** Total loss if every stop were hit now (positions without a stop count their full margin). */
  openRisk: number;
}

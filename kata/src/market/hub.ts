import type { Quote } from '@/engine/types';
import { BinanceRest, parseStreamMessage, streamName, WS_HOSTS } from './binance';
import { FALLBACK_INSTRUMENTS, guessInstrument } from './instruments';
import { isSimSymbol, SIM_INSTRUMENTS, simCandle, simDef, simQuote, simTicker, SimProvider } from './sim';
import type {
  Candle,
  CandleListener,
  CandleQuery,
  FeedStatus,
  Instrument,
  Interval,
  Ticker,
  Venue,
} from './types';
import { INTERVAL_MS } from './types';

const WS_OPEN = 1;
const LIVE_SILENCE_MS = 12_000;
const POLL_QUOTES_MS = 3_000;
const POLL_SLOW_MS = 10_000;
const SIM_TICK_MS = 500;
const BACKOFF = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000];

type Key = string;
const ckey = (s: string, i: Interval): Key => `${s}|${i}`;

class Emitter<T> {
  private ls = new Set<(v: T) => void>();
  on(l: (v: T) => void) {
    this.ls.add(l);
    return () => void this.ls.delete(l);
  }
  emit(v: T) {
    for (const l of this.ls) l(v);
  }
}

/**
 * Single source of market data for the app. Routes each symbol to Binance
 * (real data) or Kata Sim (synthetic), tracks the honesty status of each
 * venue, and degrades from streaming → polling → offline without ever
 * relabelling stale data as live.
 */
export class MarketHub {
  readonly rest: BinanceRest;
  readonly sim: SimProvider;
  readonly quotes = new Map<string, Quote>();
  readonly tickers = new Map<string, Ticker>();
  readonly instruments = new Map<string, Instrument>();
  readonly status: Record<Venue, FeedStatus>;

  readonly onQuote = new Emitter<Quote>();
  readonly onTicker = new Emitter<Ticker>();
  readonly onStatus = new Emitter<FeedStatus>();
  readonly onInstruments = new Emitter<void>();

  private quoteRefs = new Map<string, number>();
  private tickerRefs = new Map<string, number>();
  private candleListeners = new Map<Key, Set<CandleListener>>();

  private ws: WebSocket | null = null;
  private wsHost = 0;
  private wsStreams = new Set<string>();
  private wsAttempts = 0;
  private wsTimer: ReturnType<typeof setTimeout> | null = null;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private lastWsMessage = 0;
  private book = new Map<string, { bid: number; ask: number }>();
  private pollQuotesTimer: ReturnType<typeof setInterval> | null = null;
  private pollSlowTimer: ReturnType<typeof setInterval> | null = null;
  private simTimer: ReturnType<typeof setInterval> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private pendingSpecs = new Set<string>();
  private started = false;
  private readonly WS: typeof WebSocket | undefined;

  constructor(opts: { fetch?: typeof fetch; WebSocket?: typeof WebSocket; clock?: () => number } = {}) {
    this.rest = new BinanceRest(opts.fetch);
    this.sim = new SimProvider(opts.clock);
    this.WS = opts.WebSocket ?? (typeof WebSocket !== 'undefined' ? WebSocket : undefined);
    const now = Date.now();
    this.status = {
      binance: { venue: 'binance', state: 'connecting', since: now, detail: 'Connecting to Binance', host: null },
      sim: { venue: 'sim', state: 'simulated', since: now, detail: 'Synthetic prices generated on this device', host: null },
    };
    for (const i of [...FALLBACK_INSTRUMENTS, ...SIM_INSTRUMENTS]) this.instruments.set(i.symbol, i);
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.watchdog = setInterval(() => this.checkLiveness(), 2_000);
    this.simTimer = setInterval(() => this.simTick(), SIM_TICK_MS);
    this.simTick();
  }

  stop() {
    this.started = false;
    for (const t of [this.watchdog, this.simTimer, this.pollQuotesTimer, this.pollSlowTimer]) if (t) clearInterval(t);
    if (this.wsTimer) clearTimeout(this.wsTimer);
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.ws?.close();
    this.ws = null;
  }

  instrument(symbol: string): Instrument {
    return this.instruments.get(symbol) ?? guessInstrument(symbol);
  }

  venueOf(symbol: string): Venue {
    return isSimSymbol(symbol) ? 'sim' : 'binance';
  }

  // ─────────────────────────────────────────────────────── subscriptions ──

  /** Keep best bid/ask flowing for these symbols (needed for order triggers). */
  watchQuotes(symbols: string[]): () => void {
    return this.ref(this.quoteRefs, symbols);
  }

  /** 24h statistics (watchlist). */
  watchTickers(symbols: string[]): () => void {
    return this.ref(this.tickerRefs, symbols);
  }

  watchCandles(symbol: string, interval: Interval, l: CandleListener): () => void {
    const k = ckey(symbol, interval);
    let set = this.candleListeners.get(k);
    if (!set) this.candleListeners.set(k, (set = new Set()));
    set.add(l);
    this.scheduleSync();
    return () => {
      set!.delete(l);
      if (!set!.size) this.candleListeners.delete(k);
      this.scheduleSync();
    };
  }

  private ref(map: Map<string, number>, symbols: string[]): () => void {
    for (const s of symbols) map.set(s, (map.get(s) ?? 0) + 1);
    void this.ensureInstruments(symbols);
    this.scheduleSync();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const s of symbols) {
        const n = (map.get(s) ?? 1) - 1;
        if (n <= 0) map.delete(s);
        else map.set(s, n);
      }
      this.scheduleSync();
    };
  }

  // ───────────────────────────────────────────────────────────── REST ──

  async getCandles(symbol: string, interval: Interval, q: CandleQuery = {}, signal?: AbortSignal): Promise<Candle[]> {
    if (isSimSymbol(symbol)) return this.sim.fetchCandles(symbol, interval, q);
    return this.rest.fetchCandles(symbol, interval, q, signal);
  }

  async ensureInstruments(symbols: string[]) {
    const need = symbols.filter((s) => !isSimSymbol(s) && !this.pendingSpecs.has(s));
    if (!need.length) return;
    for (const s of need) this.pendingSpecs.add(s);
    try {
      const specs = await this.rest.fetchSpecs(need);
      for (const s of specs) this.instruments.set(s.symbol, s);
      this.onInstruments.emit();
    } catch {
      for (const s of need) this.pendingSpecs.delete(s); // retry on next request
    }
  }

  async searchSymbols(): Promise<string[]> {
    return this.rest.listUsdtSymbols();
  }

  // ───────────────────────────────────────────────────────── streaming ──

  private scheduleSync() {
    if (this.syncTimer) return;
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      this.sync();
    }, 150);
  }

  private desiredStreams(): Set<string> {
    const out = new Set<string>();
    for (const s of this.quoteRefs.keys()) if (!isSimSymbol(s)) out.add(streamName.book(s));
    for (const s of this.tickerRefs.keys()) if (!isSimSymbol(s)) out.add(streamName.mini(s));
    for (const k of this.candleListeners.keys()) {
      const [s, i] = k.split('|') as [string, Interval];
      if (!isSimSymbol(s)) out.add(streamName.kline(s, i));
    }
    return out;
  }

  private sync() {
    if (!this.started) return;
    const desired = this.desiredStreams();
    if (!desired.size) return;
    if (!this.WS) {
      this.setStatus('binance', 'delayed', 'Streaming unavailable — polling');
      this.startPolling();
      return;
    }
    if (!this.ws) {
      this.connect(desired);
      return;
    }
    if (this.ws.readyState !== WS_OPEN) return; // will resubscribe on open
    const add = [...desired].filter((s) => !this.wsStreams.has(s));
    const remove = [...this.wsStreams].filter((s) => !desired.has(s));
    if (add.length) this.ws.send(JSON.stringify({ method: 'SUBSCRIBE', params: add, id: Date.now() }));
    if (remove.length) this.ws.send(JSON.stringify({ method: 'UNSUBSCRIBE', params: remove, id: Date.now() + 1 }));
    this.wsStreams = desired;
  }

  private connect(streams: Set<string>) {
    const host = WS_HOSTS[this.wsHost % WS_HOSTS.length];
    const url = `${host}/stream?streams=${[...streams].join('/')}`;
    let ws: WebSocket;
    try {
      ws = new this.WS!(url);
    } catch {
      this.onWsDown();
      return;
    }
    this.ws = ws;
    this.wsStreams = new Set(streams);
    ws.onopen = () => {
      this.wsAttempts = 0;
      this.lastWsMessage = Date.now();
      this.status.binance.host = new URL(host.replace('wss:', 'https:')).host;
      this.setStatus('binance', 'live', null);
      this.stopPolling();
      this.sync();
    };
    ws.onmessage = (ev) => {
      this.lastWsMessage = Date.now();
      let parsed;
      try {
        parsed = parseStreamMessage(JSON.parse(String(ev.data)));
      } catch {
        return;
      }
      this.handleStream(parsed, 'live');
    };
    ws.onerror = () => {
      /* onclose follows */
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.onWsDown();
    };
  }

  private onWsDown() {
    this.wsAttempts++;
    if (this.wsAttempts % 2 === 0) this.wsHost++; // rotate host every other failure
    this.startPolling();
    if (!this.started) return;
    const delay = BACKOFF[Math.min(BACKOFF.length - 1, this.wsAttempts - 1)];
    if (this.wsTimer) clearTimeout(this.wsTimer);
    this.wsTimer = setTimeout(() => {
      this.wsTimer = null;
      if (!this.ws && this.desiredStreams().size) this.connect(this.desiredStreams());
    }, delay);
  }

  private handleStream(m: ReturnType<typeof parseStreamMessage>, source: 'live' | 'delayed') {
    const now = Date.now();
    if (m.kind === 'book') {
      this.book.set(m.symbol, { bid: m.bid, ask: m.ask });
      const prev = this.quotes.get(m.symbol);
      this.pushQuote({ symbol: m.symbol, bid: m.bid, ask: m.ask, last: prev?.last ?? (m.bid + m.ask) / 2, ts: now, source });
    } else if (m.kind === 'kline') {
      const set = this.candleListeners.get(ckey(m.symbol, m.interval));
      if (set) for (const l of set) l(m.candle);
      const prev = this.quotes.get(m.symbol);
      if (prev) this.quotes.set(m.symbol, { ...prev, last: m.candle.close });
    } else if (m.kind === 'mini') {
      const t: Ticker = { ...m.ticker, ts: now };
      this.tickers.set(t.symbol, t);
      this.onTicker.emit(t);
    }
  }

  private pushQuote(q: Quote) {
    this.quotes.set(q.symbol, q);
    this.onQuote.emit(q);
  }

  private checkLiveness() {
    const st = this.status.binance;
    if (this.ws && this.ws.readyState === WS_OPEN) {
      const silent = Date.now() - this.lastWsMessage;
      if (silent > LIVE_SILENCE_MS && st.state === 'live') {
        this.setStatus('binance', 'delayed', `No stream updates for ${Math.round(silent / 1000)}s`);
      } else if (silent > LIVE_SILENCE_MS * 2.5) {
        // Zombie socket: force a reconnect.
        const ws = this.ws;
        this.ws = null;
        ws.close();
        this.onWsDown();
      } else if (silent <= LIVE_SILENCE_MS && st.state !== 'live') {
        this.setStatus('binance', 'live', null);
      }
    }
  }

  private setStatus(venue: Venue, state: FeedStatus['state'], detail: string | null) {
    const cur = this.status[venue];
    if (cur.state === state && cur.detail === detail) return;
    this.status[venue] = { ...cur, state, detail, since: cur.state === state ? cur.since : Date.now() };
    this.onStatus.emit(this.status[venue]);
  }

  // ─────────────────────────────────────────────────────────── polling ──

  private startPolling() {
    if (this.pollQuotesTimer) return;
    const pollQuotes = async () => {
      const symbols = [...this.quoteRefs.keys()].filter((s) => !isSimSymbol(s));
      const tick = [...this.tickerRefs.keys()].filter((s) => !isSimSymbol(s));
      if (!symbols.length && !tick.length) return;
      try {
        if (symbols.length) {
          const books = await this.rest.fetchBookTickers(symbols);
          for (const b of books) this.handleStream({ kind: 'book', symbol: b.symbol, bid: b.bid, ask: b.ask }, 'delayed');
        } else {
          // Nothing to execute against; a cheap ticker call still tells us whether Binance is reachable.
          await this.rest.fetchTickers(tick.slice(0, 1));
        }
        this.status.binance.host = new URL(this.rest.host).host;
        if (!this.ws || this.ws.readyState !== WS_OPEN) this.setStatus('binance', 'delayed', 'Stream disconnected — polling every 3s');
      } catch (e) {
        this.setStatus('binance', 'offline', e instanceof Error && e.message !== 'Failed to fetch' ? e.message : 'Binance is unreachable from this network');
      }
    };
    const pollSlow = async () => {
      const tick = [...this.tickerRefs.keys()].filter((s) => !isSimSymbol(s));
      try {
        if (tick.length) {
          const ts = await this.rest.fetchTickers(tick);
          for (const t of ts) {
            this.tickers.set(t.symbol, t);
            this.onTicker.emit(t);
          }
        }
        for (const k of this.candleListeners.keys()) {
          const [s, i] = k.split('|') as [string, Interval];
          if (isSimSymbol(s)) continue;
          const cs = await this.rest.fetchCandles(s, i, { limit: 2 });
          for (const c of cs) for (const l of this.candleListeners.get(k) ?? []) l(c);
        }
      } catch {
        /* status is driven by the quote poll */
      }
    };
    void pollQuotes();
    void pollSlow();
    this.pollQuotesTimer = setInterval(pollQuotes, POLL_QUOTES_MS);
    this.pollSlowTimer = setInterval(pollSlow, POLL_SLOW_MS);
  }

  private stopPolling() {
    if (this.pollQuotesTimer) clearInterval(this.pollQuotesTimer);
    if (this.pollSlowTimer) clearInterval(this.pollSlowTimer);
    this.pollQuotesTimer = null;
    this.pollSlowTimer = null;
  }

  // ─────────────────────────────────────────────────────────────── sim ──

  private simTickCount = 0;
  private simTick() {
    const now = Date.now();
    const want = new Set<string>();
    for (const s of this.quoteRefs.keys()) if (isSimSymbol(s)) want.add(s);
    for (const s of this.tickerRefs.keys()) if (isSimSymbol(s)) want.add(s);
    for (const s of want) {
      const q = simQuote(s, now);
      this.pushQuote({ symbol: s, ...q, ts: now, source: 'simulated' });
    }
    if (this.simTickCount++ % 4 === 0) {
      for (const s of this.tickerRefs.keys()) {
        const d = simDef(s);
        if (!d) continue;
        const t = simTicker(d, now);
        this.tickers.set(s, t);
        this.onTicker.emit(t);
      }
    }
    for (const [k, set] of this.candleListeners) {
      const [s, i] = k.split('|') as [string, Interval];
      const d = simDef(s);
      if (!d) continue;
      const ms = INTERVAL_MS[i];
      const c = simCandle(d, Math.floor(now / ms) * ms, ms, now);
      for (const l of set) l(c);
    }
  }
}

export const hub = new MarketHub();

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  createTextWatermark,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  TickMarkType,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type ITextWatermarkPluginApi,
  type Logical,
  type SeriesMarker,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useLiveQuery } from 'dexie-react-hooks';
import { Loader } from '@/brand/Brand';
import { db } from '@/db/db';
import type { Position } from '@/engine/types';
import { stepDecimals } from '@/engine/num';
import { bollinger, ema, INDICATORS, macd, rsi, sma, vwap, type IndicatorId } from '@/indicators/indicators';
import { hub } from '@/market/hub';
import { INTERVAL_MS, type Candle, type Interval } from '@/market/types';
import { useActiveEngine, useApp } from '@/store/app';
import { useInstrument, useQuote } from '@/store/market';
import { actions, engineContext } from '@/store/runtime';
import { useTicket, useUI } from '@/store/ui';
import { fmtCompact, fmtPct, fmtPrice } from '@/lib/format';
import { disposeChart, safeLocale } from '@/lib/locale';
import { Button } from '@/ui/primitives';
import { navigate, inspectHref } from '@/app/router';
import { useMetrics } from '@/app/hooks';
import { resolveTicket } from '../ticket/resolve';
import { buildLines, inspectLines, sceneFor, type ChartLine } from './lines';
import { LineOverlay, type ToneColors } from './LineOverlay';
import { rgba, useChartTheme, type ChartTheme } from './theme';
import { ZonesPrimitive } from './zones';

interface Api {
  chart: IChartApi;
  candle: ISeriesApi<'Candlestick'>;
  volume: ISeriesApi<'Histogram'>;
  zones: ZonesPrimitive;
  markers: ISeriesMarkersPluginApi<Time>;
}

/** Chart teardown order is not guaranteed across effects; ignore calls on a disposed chart. */
function safe(fn: () => void) {
  try {
    fn();
  } catch {
    /* disposed */
  }
}

const toTime = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp;
const pad2 = (n: number) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Interval that frames a trade of this duration with room around it. */
export function intervalForDuration(ms: number): Interval {
  if (ms < 90 * 60_000) return '1m';
  if (ms < 6 * 3_600_000) return '5m';
  if (ms < 20 * 3_600_000) return '15m';
  if (ms < 5 * 86_400_000) return '1h';
  if (ms < 25 * 86_400_000) return '4h';
  return '1d';
}

function themeOptions(t: ChartTheme) {
  return {
    layout: {
      background: { type: ColorType.Solid, color: t.panel },
      textColor: t.fg2,
      fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
      fontSize: 10.5,
      attributionLogo: false,
      panes: { separatorColor: t.line, separatorHoverColor: t.line2, enableResize: true },
    },
    grid: { vertLines: { color: t.grid }, horzLines: { color: t.grid } },
    rightPriceScale: { borderColor: t.line, textColor: t.fg2 },
    timeScale: { borderColor: t.line },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: t.fg3, width: 1 as const, style: LineStyle.Dashed, labelBackgroundColor: t.dark ? '#2a303a' : '#d8d2c5' },
      horzLine: { color: t.fg3, width: 1 as const, style: LineStyle.Dashed, labelBackgroundColor: t.dark ? '#2a303a' : '#d8d2c5' },
    },
  };
}

function tickMark(time: Time, type: TickMarkType): string {
  const d = new Date((time as number) * 1000);
  switch (type) {
    case TickMarkType.Year:
      return String(d.getFullYear());
    case TickMarkType.Month:
      return MONTHS[d.getMonth()];
    case TickMarkType.DayOfMonth:
      return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
    case TickMarkType.TimeWithSeconds:
      return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
    default:
      return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
}

function timeLabel(time: Time): string {
  const d = new Date((time as number) * 1000);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ’${String(d.getFullYear()).slice(2)}  ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

type IndSeries = { id: IndicatorId; series: ISeriesApi<SeriesType>[] };

function computeInd(id: IndicatorId, cs: Candle[]): number[][] {
  const closes = cs.map((c) => c.close);
  switch (id) {
    case 'ema20':
      return [ema(closes, 20)];
    case 'ema50':
      return [ema(closes, 50)];
    case 'ema200':
      return [ema(closes, 200)];
    case 'sma20':
      return [sma(closes, 20)];
    case 'vwap':
      return [vwap(cs)];
    case 'bb': {
      const b = bollinger(closes, 20, 2);
      return [b.upper, b.mid, b.lower];
    }
    case 'rsi':
      return [rsi(closes, 14)];
    case 'macd': {
      const m = macd(closes);
      return [m.hist, m.macd, m.signal];
    }
    default:
      return [];
  }
}

export interface Legend {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  chg: number;
  time: Time;
  ind: { id: string; label: string; values: number[]; colors: string[] }[];
}

export function ChartCanvas({ symbol, interval, inspect }: { symbol: string; interval: Interval; inspect: Position | null }) {
  const host = useRef<HTMLDivElement>(null);
  const [api, setApi] = useState<Api | null>(null);
  const [status, setStatus] = useState<{ s: 'loading' | 'ready' | 'empty' | 'error'; msg?: string }>({ s: 'loading' });
  const [retry, setRetry] = useState(0);
  const [version, setVersion] = useState(0);
  const candles = useRef<Candle[]>([]);
  const indRef = useRef<IndSeries[]>([]);
  const [legend, setLegend] = useState<Legend | null>(null);
  const hoverRef = useRef(false);
  const t = useChartTheme();
  const spec = useInstrument(symbol);
  const indicators = useUI((s) => s.indicators);
  const ms = INTERVAL_MS[interval];
  const inspectKey = inspect ? `${inspect.id}:${inspect.closedAt}` : '';

  // ── chart lifecycle ──
  useEffect(() => {
    const el = host.current!;
    const chart = createChart(el, {
      autoSize: true,
      ...themeOptions(t),
      rightPriceScale: { borderColor: t.line, scaleMargins: { top: 0.1, bottom: 0.18 } },
      timeScale: { borderColor: t.line, timeVisible: true, secondsVisible: false, rightOffset: 10, barSpacing: 7, minBarSpacing: 1.5, tickMarkFormatter: tickMark },
      localization: { locale: safeLocale(), timeFormatter: timeLabel },
      handleScale: { axisPressedMouseMove: { time: true, price: true } },
      kineticScroll: { touch: true, mouse: false },
    });
    const candle = chart.addSeries(CandlestickSeries, { priceLineVisible: true, priceLineWidth: 1, priceLineStyle: LineStyle.Dotted, lastValueVisible: true });
    const volume = chart.addSeries(HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 }, visible: false });
    const zones = new ZonesPrimitive();
    candle.attachPrimitive(zones);
    const markers = createSeriesMarkers(candle, [], { autoScale: false });
    setApi({ chart, candle, volume, zones, markers });
    return () => {
      disposeChart(chart);
      setApi(null);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── theme ──
  useEffect(() => {
    if (!api) return;
    api.chart.applyOptions(themeOptions(t));
    api.candle.applyOptions({ upColor: t.up, downColor: t.down, wickUpColor: t.up, wickDownColor: t.down, borderVisible: false, priceLineColor: t.fg2 });
    api.zones.setPalette({ up: t.up, down: t.down, fg: t.fg1 });
    setVersion((v) => v + 1);
  }, [api, t]);

  // ── price format + simulated watermark ──
  useEffect(() => {
    if (!api) return;
    api.candle.applyOptions({ priceFormat: { type: 'price', precision: Math.min(8, stepDecimals(spec.tickSize)), minMove: spec.tickSize } });
    let wm: ITextWatermarkPluginApi<Time> | null = null;
    if (spec.venue === 'sim') {
      wm = createTextWatermark(api.chart.panes()[0], {
        horzAlign: 'center',
        vertAlign: 'center',
        lines: [
          { text: 'SIMULATED PRICES', color: rgba(t.sim.startsWith('#') ? t.sim : '#9aa4b5', 0.13), fontSize: 30, fontFamily: "'Barlow Semi Condensed', sans-serif", fontStyle: '600' },
          { text: 'Kata Sim · not market data', color: rgba(t.sim.startsWith('#') ? t.sim : '#9aa4b5', 0.16), fontSize: 13, fontFamily: "'IBM Plex Mono', monospace" },
        ],
      });
    }
    return () => safe(() => wm?.detach());
  }, [api, spec.tickSize, spec.venue, t.sim]);

  // ── indicators ──
  const applyIndicators = useCallback(
    (full: boolean) => {
      if (!api) return;
      const cs = candles.current;
      const volOn = indicators.includes('volume');
      if (full) {
        api.volume.applyOptions({ visible: volOn });
        for (const s of indRef.current) for (const x of s.series) api.chart.removeSeries(x);
        indRef.current = [];
        let pane = 1;
        let ci = 0;
        for (const id of indicators) {
          const def = INDICATORS.find((d) => d.id === id);
          if (!def || id === 'volume') continue;
          const series: ISeriesApi<SeriesType>[] = [];
          const base = { lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false };
          if (def.pane === 'price') {
            const color = t.ind[ci++ % t.ind.length];
            if (id === 'bb') {
              for (let k = 0; k < 3; k++)
                series.push(api.chart.addSeries(LineSeries, { ...base, color: rgba(color, k === 1 ? 0.55 : 0.8), lineWidth: 1, lineStyle: k === 1 ? LineStyle.Dashed : LineStyle.Solid }));
            } else {
              series.push(api.chart.addSeries(LineSeries, { ...base, color, lineWidth: 1, lineStyle: id === 'vwap' ? LineStyle.Dashed : LineStyle.Solid }));
            }
          } else {
            if (id === 'rsi') {
              const s = api.chart.addSeries(LineSeries, { ...base, color: t.ind[0], lineWidth: 1, lastValueVisible: true, priceFormat: { type: 'price', precision: 1, minMove: 0.1 } }, pane);
              s.createPriceLine({ price: 70, color: t.fg3, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false, title: '' });
              s.createPriceLine({ price: 30, color: t.fg3, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false, title: '' });
              series.push(s);
            } else if (id === 'macd') {
              series.push(api.chart.addSeries(HistogramSeries, { ...base, priceFormat: { type: 'price', precision: 4, minMove: 0.0001 } }, pane));
              series.push(api.chart.addSeries(LineSeries, { ...base, color: t.ind[0], lineWidth: 1 }, pane));
              series.push(api.chart.addSeries(LineSeries, { ...base, color: t.ind[1], lineWidth: 1 }, pane));
            }
            pane++;
          }
          indRef.current.push({ id, series });
        }
        const panes = api.chart.panes();
        panes[0]?.setStretchFactor(1);
        for (let i = 1; i < panes.length; i++) panes[i].setStretchFactor(0.24);
      }
      if (!cs.length) return;
      const vol = cs.map((c) => ({ time: toTime(c.time), value: c.volume, color: rgba(c.close >= c.open ? t.up : t.down, 0.32) }));
      if (full) api.volume.setData(vol);
      else api.volume.update(vol[vol.length - 1]);
      for (const { id, series } of indRef.current) {
        const out = computeInd(id, cs);
        out.forEach((vals, k) => {
          const s = series[k];
          if (!s) return;
          const isHist = id === 'macd' && k === 0;
          const mk = (i: number) =>
            Number.isFinite(vals[i])
              ? isHist
                ? { time: toTime(cs[i].time), value: vals[i], color: rgba(vals[i] >= 0 ? t.up : t.down, 0.45) }
                : { time: toTime(cs[i].time), value: vals[i] }
              : { time: toTime(cs[i].time) };
          if (full) s.setData(cs.map((_, i) => mk(i)) as never);
          else s.update(mk(cs.length - 1) as never);
        });
      }
    },
    [api, indicators, t],
  );

  useEffect(() => applyIndicators(true), [applyIndicators, version]);

  // ── data ──
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    setStatus({ s: 'loading' });
    candles.current = [];
    api.candle.setData([]);
    api.volume.setData([]);
    const now = Date.now();
    const endTime = inspect?.closedAt ? Math.min(now, inspect.closedAt + 60 * ms) : undefined;
    const live = !endTime || endTime >= now - ms;
    const ctrl = new AbortController();
    hub
      .getCandles(symbol, interval, { limit: 1000, endTime }, ctrl.signal)
      .then((cs) => {
        if (cancelled) return;
        candles.current = cs;
        api.candle.setData(cs.map((c) => ({ time: toTime(c.time), open: c.open, high: c.high, low: c.low, close: c.close })));
        api.zones.setData(cs, ms);
        applyIndicators(true);
        setStatus({ s: cs.length ? 'ready' : 'empty' });
        setVersion((v) => v + 1);
        const n = cs.length;
        if (inspect && n) {
          const a = api.zones.logicalAt(inspect.openedAt);
          const b = api.zones.logicalAt(inspect.closedAt ?? inspect.openedAt);
          const padBars = Math.max(20, (b - a) * 0.6);
          api.chart.timeScale().setVisibleLogicalRange({ from: (a - padBars) as Logical, to: (b + padBars) as Logical });
        } else if (n) {
          api.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 140) as Logical, to: (n + 10) as Logical });
        }
      })
      .catch((e: unknown) => {
        if (cancelled || ctrl.signal.aborted) return;
        setStatus({ s: 'error', msg: e instanceof Error ? e.message : 'Network error' });
      });

    const off = live
      ? hub.watchCandles(symbol, interval, (c) => {
          const cs = candles.current;
          if (!cs.length) return;
          const last = cs[cs.length - 1];
          if (c.time < last.time) return;
          if (c.time === last.time) cs[cs.length - 1] = c;
          else cs.push(c);
          api.candle.update({ time: toTime(c.time), open: c.open, high: c.high, low: c.low, close: c.close });
          applyIndicators(false);
          if (c.time !== last.time) api.zones.setData(cs, ms);
          if (!hoverRef.current) setLegend(legendAt(cs.length - 1));
        })
      : () => {};

    // Lazy-load older candles as the user scrolls back in time.
    let loadingOlder = false;
    let exhausted = false;
    const onRange = (r: { from: number; to: number } | null) => {
      if (!r || r.from > 15 || loadingOlder || exhausted || !candles.current.length) return;
      loadingOlder = true;
      const first = candles.current[0].time;
      hub
        .getCandles(symbol, interval, { endTime: first - 1, limit: 500 })
        .then((older) => {
          if (cancelled) return;
          const add = older.filter((c) => c.time < first);
          if (!add.length) {
            exhausted = true;
            return;
          }
          const range = api.chart.timeScale().getVisibleLogicalRange();
          candles.current = [...add, ...candles.current];
          api.candle.setData(candles.current.map((c) => ({ time: toTime(c.time), open: c.open, high: c.high, low: c.low, close: c.close })));
          api.zones.setData(candles.current, ms);
          applyIndicators(true);
          setVersion((v) => v + 1);
          if (range) api.chart.timeScale().setVisibleLogicalRange({ from: (range.from + add.length) as Logical, to: (range.to + add.length) as Logical });
        })
        .catch(() => {})
        .finally(() => {
          loadingOlder = false;
        });
    };
    api.chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);

    return () => {
      cancelled = true;
      ctrl.abort();
      off();
      safe(() => api.chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange));
    };
  }, [api, symbol, interval, inspectKey, retry]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── legend ──
  const legendAt = useCallback(
    (i: number): Legend | null => {
      const cs = candles.current;
      const c = cs[i];
      if (!c) return null;
      const prev = cs[i - 1];
      const ind = indRef.current
        .filter((x) => x.id !== 'volume')
        .map(({ id, series }) => {
          const out = computeInd(id, cs.slice(Math.max(0, i - 400), i + 1));
          const def = INDICATORS.find((d) => d.id === id)!;
          return {
            id,
            label: def.short,
            values: out.map((v) => v[v.length - 1]),
            colors: series.map((s) => (s.options() as { color?: string }).color ?? t.fg1),
          };
        });
      return { o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume, chg: prev ? ((c.close - prev.close) / prev.close) * 100 : 0, time: toTime(c.time), ind };
    },
    [t.fg1],
  );

  useEffect(() => {
    if (!api) return;
    setLegend(legendAt(candles.current.length - 1));
    let raf = 0;
    const onMove = (p: { time?: Time; logical?: Logical }) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const cs = candles.current;
        if (p.time == null || p.logical == null) {
          hoverRef.current = false;
          setLegend(legendAt(cs.length - 1));
          return;
        }
        hoverRef.current = true;
        const i = Math.max(0, Math.min(cs.length - 1, Math.round(p.logical)));
        setLegend(legendAt(i));
      });
    };
    api.chart.subscribeCrosshairMove(onMove);
    return () => {
      cancelAnimationFrame(raf);
      safe(() => api.chart.unsubscribeCrosshairMove(onMove));
    };
  }, [api, legendAt, version]);

  // ── overlay lines ──
  const engine = useActiveEngine();
  const quote = useQuote(symbol);
  const draft = useTicket();
  const metrics = useMetrics();
  const activeId = useApp((s) => s.activeId);
  const resolved = useMemo(
    () => (inspect ? null : resolveTicket(draft, { symbol, spec, quote, metrics, engine, ctx: engineContext() })),
    [draft, symbol, spec, quote, metrics, engine, inspect],
  );
  const lastTime = candles.current.length ? candles.current[candles.current.length - 1].time : null;

  const handlers = useMemo(
    () => ({
      setProtection: (id: string, patch: { sl?: number | null; tp?: number | null }) => void actions.setProtection(id, patch),
      closePosition: (id: string) => void actions.closePosition(id, 'all'),
      cancelOrder: (id: string) => void actions.cancelOrder(id),
      modifyOrder: (id: string, patch: { price?: number; sl?: number | null; tp?: number | null }) => void actions.modifyOrder(id, patch),
      setDraft: (patch: Partial<typeof draft>) => useTicket.getState().set(patch),
    }),
    [],
  );

  const showDraft = !inspect && (draft.slOn || draft.tpOn || draft.type !== 'market');
  const { lines, extra } = useMemo(() => {
    if (inspect) {
      const r = inspectLines(inspect, spec);
      return { lines: r.lines, extra: { zones: r.zones, segments: r.segments } };
    }
    if (!engine) return { lines: [] as ChartLine[], extra: undefined };
    return {
      lines: buildLines({
        positions: engine.positions.filter((p) => p.symbol === symbol),
        orders: engine.orders.filter((o) => o.symbol === symbol),
        quote,
        spec,
        cfg: engine.account.config,
        draft: showDraft ? draft : null,
        resolved: showDraft ? resolved : null,
        lastTime,
        handlers,
      }),
      extra: undefined,
    };
  }, [inspect, engine, symbol, quote, spec, draft, resolved, lastTime, handlers, showDraft]);

  // Lines are rebuilt on every quote; keep a structurally stable list for the overlay.
  const stableKey = lines.map((l) => `${l.id}@${l.price}@${l.label}@${l.axis}@${l.actions?.length ?? 0}`).join('|');
  const stableLines = useMemo(() => lines, [stableKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const latestLines = useRef(lines);
  latestLines.current = lines;
  const overlayLines = useMemo(
    () => stableLines.map((l) => ({ ...l, detail: l.detail ? (p: number) => latestLines.current.find((x) => x.id === l.id)?.detail?.(p) ?? l.detail!(p) : undefined })),
    [stableLines],
  );

  const [dragging, setDragging] = useState<{ id: string; price: number } | null>(null);
  useEffect(() => {
    api?.zones.setScene(sceneFor(lines, dragging, extra));
  }, [api, lines, dragging, extra]);

  const toneColors: ToneColors = useMemo(
    () => ({ up: t.up, down: t.down, order: t.order, neutral: t.fg1, liq: t.liq, draft: t.fg1, ink: t.panel }),
    [t],
  );

  // ── fill markers ──
  const fills = useLiveQuery(
    () => (activeId ? db.fills.where('[accountId+ts]').between([activeId, 0], [activeId, Infinity]).filter((f) => f.symbol === symbol).reverse().limit(400).toArray() : []),
    [activeId, symbol],
  );
  useEffect(() => {
    if (!api) return;
    const cs = candles.current;
    if (!cs.length || !fills) {
      api.markers.setMarkers([]);
      return;
    }
    const first = cs[0].time;
    const end = cs[cs.length - 1].time + ms;
    const mk: SeriesMarker<Time>[] = fills
      .filter((f) => f.ts >= first && f.ts < end)
      .sort((a, b) => a.ts - b.ts)
      .map((f) => {
        const focus = inspect?.id === f.positionId;
        const buy = f.side === 'buy';
        return {
          time: toTime(Math.floor(f.ts / ms) * ms),
          position: buy ? 'atPriceBottom' : 'atPriceTop',
          price: f.price,
          shape: buy ? 'arrowUp' : 'arrowDown',
          color: focus ? t.fg0 : buy ? t.up : t.down,
          size: focus ? 1.4 : 0.8,
          id: f.positionId,
          text: focus ? (f.intent === 'open' ? 'Entry' : 'Exit') : undefined,
        } as SeriesMarker<Time>;
      });
    api.markers.setMarkers(mk);
  }, [api, fills, version, inspect, ms, t]);

  // ── clicks: inspect a historical trade, Alt/⌥-click to place an order price ──
  useEffect(() => {
    if (!api) return;
    const onClick = (p: { hoveredObjectId?: unknown; point?: { x: number; y: number }; sourceEvent?: { altKey?: boolean } }) => {
      if (typeof p.hoveredObjectId === 'string') {
        const pos = p.hoveredObjectId;
        void db.positions.get(pos).then((x) => {
          if (x?.status === 'closed') navigate(inspectHref(pos));
        });
        return;
      }
      if (p.sourceEvent?.altKey && p.point && !inspect) {
        const price = api.candle.coordinateToPrice(p.point.y);
        const q = hub.quotes.get(symbol);
        if (price == null || !q) return;
        const tk = useTicket.getState();
        const above = price > (tk.side === 'long' ? q.ask : q.bid);
        const type = tk.side === 'long' ? (above ? 'stop' : 'limit') : above ? 'limit' : 'stop';
        tk.set({ type, price: (Math.round(price / spec.tickSize) * spec.tickSize).toFixed(stepDecimals(spec.tickSize)) });
      }
    };
    api.chart.subscribeClick(onClick);
    return () => safe(() => api.chart.unsubscribeClick(onClick));
  }, [api, inspect, symbol, spec.tickSize]);

  return (
    <div className="cc">
      <div ref={host} className="cc-host" data-testid="chart" />
      {legend && status.s === 'ready' && (
        <div className="cc-legend num" aria-hidden="true">
          <span>
            <i>O</i>
            {fmtPrice(legend.o, spec.tickSize)}
          </span>
          <span>
            <i>H</i>
            {fmtPrice(legend.h, spec.tickSize)}
          </span>
          <span>
            <i>L</i>
            {fmtPrice(legend.l, spec.tickSize)}
          </span>
          <span>
            <i>C</i>
            {fmtPrice(legend.c, spec.tickSize)}
          </span>
          <span className={legend.chg >= 0 ? 'up' : 'down'}>{fmtPct(legend.chg, { sign: true })}</span>
          {indicators.includes('volume') && (
            <span>
              <i>V</i>
              {fmtCompact(legend.v)}
            </span>
          )}
          {legend.ind.length > 0 && (
            <div className="cc-legend-ind">
              {legend.ind.map((x) => (
                <span key={x.id}>
                  <i>{x.label}</i>
                  {x.values
                    .filter((_, k) => !(x.id === 'macd' && k === 0))
                    .map((v, k) => (
                      <b key={k} style={{ color: x.colors[x.id === 'macd' ? k + 1 : k] }}>
                        {Number.isFinite(v) ? (x.id === 'rsi' ? v.toFixed(1) : x.id === 'macd' ? v.toPrecision(4) : fmtPrice(v, spec.tickSize)) : '—'}
                      </b>
                    ))}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {api && status.s === 'ready' && (
        <LineOverlay lines={overlayLines} chart={api.chart} series={api.candle} tick={spec.tickSize} colors={toneColors} onDrag={setDragging} pulse={quote?.ts} />
      )}
      {status.s === 'loading' && (
        <div className="cc-state">
          <Loader label={`Loading ${symbol} · ${interval}`} />
        </div>
      )}
      {status.s === 'error' && (
        <div className="cc-state">
          <div className="cc-error">
            <div className="cc-error-title">Couldn’t load {symbol} candles</div>
            <div className="cc-error-msg num">{status.msg}</div>
            <p>Kata never draws made-up prices. Check your connection, or practise on a ·SIM instrument meanwhile.</p>
            <Button size="sm" icon="refresh" onClick={() => setRetry((r) => r + 1)}>
              Retry
            </Button>
          </div>
        </div>
      )}
      {status.s === 'empty' && (
        <div className="cc-state">
          <div className="cc-error">
            <div className="cc-error-title">No candles in this range</div>
          </div>
        </div>
      )}
    </div>
  );
}

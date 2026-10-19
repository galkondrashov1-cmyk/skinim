import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AreaSeries, ColorType, createChart, CrosshairMode, LineStyle, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
import { db } from '@/db/db';
import { balanceCurve, bySymbol, computeStats, dailyPnl, drawdown, rHistogram, toTradeRow, type CurvePoint, type TradeRow } from '@/engine/analytics';
import { utcDayKey } from '@/engine/num';
import { useActiveAccount, useApp } from '@/store/app';
import { fmtDate, fmtDuration, fmtMoney, fmtNum, fmtPct, fmtR, toneOf } from '@/lib/format';
import { disposeChart, safeLocale } from '@/lib/locale';
import { Button, cx, Empty, Segmented } from '@/ui/primitives';
import { navigate } from '@/app/router';
import { useMetrics } from '@/app/hooks';
import { rgba, useChartTheme, type ChartTheme } from '../chart/theme';
import './performance.css';

type Period = '7d' | '30d' | '90d' | 'all';
type SideF = 'all' | 'long' | 'short';
const PERIOD_MS: Record<Period, number> = { '7d': 7 * 864e5, '30d': 30 * 864e5, '90d': 90 * 864e5, all: Infinity };

export default function PerformanceView() {
  const activeId = useApp((s) => s.activeId);
  const account = useActiveAccount();
  const metrics = useMetrics();
  const [period, setPeriod] = useState<Period>('all');
  const [side, setSide] = useState<SideF>('all');
  const [symbol, setSymbol] = useState<string>('all');
  const closed = useLiveQuery(
    () => (activeId ? db.positions.where('[accountId+closedAt]').between([activeId, 0], [activeId, Infinity]).toArray() : []),
    [activeId],
  );
  const equityPts = useLiveQuery(() => (activeId ? db.equity.where('accountId').equals(activeId).sortBy('ts') : []), [activeId]);

  const allRows = useMemo(() => (closed ?? []).map(toTradeRow), [closed]);
  const symbols = useMemo(() => [...new Set(allRows.map((r) => r.symbol))].sort(), [allRows]);
  const since = period === 'all' ? 0 : Date.now() - PERIOD_MS[period];
  const rows = useMemo(
    () => allRows.filter((r) => r.closedAt >= since && (side === 'all' || r.side === side) && (symbol === 'all' || r.symbol === symbol)),
    [allRows, since, side, symbol],
  );
  const stats = useMemo(() => computeStats(rows), [rows]);
  const filtered = side !== 'all' || symbol !== 'all';

  // Realized balance after each trade. With filters, start from zero (cumulative P&L of the slice).
  const curve = useMemo(() => {
    if (!account) return [];
    const base = filtered ? 0 : account.initialBalance + allRows.filter((r) => r.closedAt < since).reduce((s, r) => s + r.net, 0);
    return balanceCurve(base, rows, Math.max(account.createdAt, since === 0 ? account.createdAt : since));
  }, [account, rows, allRows, since, filtered]);
  const dd = useMemo(() => drawdown(filtered ? curve.map((p) => ({ ...p, value: p.value + (account?.initialBalance ?? 0) })) : curve), [curve, filtered, account]);
  const markedDd = useMemo(() => drawdown((equityPts ?? []).filter((p) => p.ts >= since).map((p) => ({ ts: p.ts, value: p.equity }))), [equityPts, since]);

  if (!closed || !account) return null;

  return (
    <div className="pv">
      <div className="pv-filters" role="toolbar" aria-label="Filters">
        <Segmented
          size="sm"
          label="Period"
          value={period}
          onChange={setPeriod}
          options={[
            { value: '7d', label: '7D' },
            { value: '30d', label: '30D' },
            { value: '90d', label: '90D' },
            { value: 'all', label: 'All' },
          ]}
        />
        <Segmented
          size="sm"
          label="Direction"
          value={side}
          onChange={setSide}
          options={[
            { value: 'all', label: 'Both' },
            { value: 'long', label: 'Long' },
            { value: 'short', label: 'Short' },
          ]}
        />
        <label className="pv-select">
          <span className="label">Instrument</span>
          <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
            <option value="all">All</option>
            {symbols.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <span className="pv-sp" />
        <span className="faint pv-scope">
          {account.name} · {stats.count} trade{stats.count === 1 ? '' : 's'}
        </span>
      </div>

      {stats.count === 0 ? (
        <div className="pv-empty">
          <Empty
            icon="performance"
            title={allRows.length ? 'No trades match these filters' : 'No closed trades yet'}
            body={allRows.length ? 'Widen the period or clear the filters.' : 'Win rate, profit factor, expectancy and drawdown appear after your first closed trade.'}
            action={!allRows.length ? <Button onClick={() => navigate('/trade')}>Go trade</Button> : undefined}
          />
        </div>
      ) : (
        <div className="pv-body">
          <section className="pv-kpis" aria-label="Key figures">
            <Kpi label="Net P&L" value={fmtMoney(stats.netPnl, { sign: true })} tone={toneOf(stats.netPnl)} sub={`fees ${fmtMoney(stats.fees)}`} testId="kpi-net" />
            <Kpi label="Win rate" value={fmtPct(stats.winRate * 100, { decimals: 1 })} sub={`${stats.wins} W · ${stats.losses} L${stats.breakeven ? ` · ${stats.breakeven} BE` : ''}`} testId="kpi-winrate" />
            <Kpi
              label="Profit factor"
              value={stats.profitFactor == null ? '—' : stats.profitFactor === Infinity ? '∞' : fmtNum(stats.profitFactor, 2)}
              sub="gross profit ÷ gross loss"
              testId="kpi-pf"
            />
            <Kpi label="Expectancy" value={fmtMoney(stats.expectancy, { sign: true })} tone={toneOf(stats.expectancy)} sub={stats.avgR != null ? `${fmtR(stats.avgR)} per trade` : 'per trade'} testId="kpi-expectancy" />
            <Kpi label="Avg win / loss" value={`${fmtMoney(stats.avgWin)} / ${fmtMoney(stats.avgLoss)}`} sub={stats.payoff != null ? `payoff ${fmtNum(stats.payoff, 2)}` : '—'} />
            <Kpi label="Max drawdown" value={fmtPct(dd.maxPct, { decimals: 2 })} sub={`${fmtMoney(-dd.maxAbs, { sign: true })} realized${markedDd.maxPct > 0 ? ` · ${fmtPct(markedDd.maxPct)} marked` : ''}`} tone={dd.maxPct > 0 ? 'down' : ''} />
            <Kpi label="Total R" value={stats.rCount ? fmtR(stats.totalR) : '—'} sub={`${stats.rCount} of ${stats.count} with a stop`} tone={toneOf(stats.totalR)} />
            <Kpi label="Avg hold" value={fmtDuration(stats.avgHoldMs)} sub={`streaks ${stats.maxConsecWins}W / ${stats.maxConsecLosses}L`} />
          </section>

          <section className="pv-card pv-card--wide" aria-label="Realized balance">
            <CardHead title={filtered ? 'Cumulative P&L of this slice' : 'Realized balance'} note="after each closed trade · USDT" />
            <CurveChart points={curve} kind="balance" />
          </section>
          <section className="pv-card pv-card--wide" aria-label="Drawdown">
            <CardHead title="Drawdown from peak" note="% below the running high of the curve above" />
            <CurveChart points={dd.series} kind="drawdown" />
          </section>

          <section className="pv-card" aria-label="R-multiple distribution">
            <CardHead title="R-multiple distribution" note={`${stats.rCount} trades with a defined 1R`} />
            <RHist rows={rows} />
          </section>
          <section className="pv-card" aria-label="Daily P&L">
            <CardHead title="Daily P&L" note="net, by UTC close date · last 26 weeks" />
            <Calendar rows={rows} />
          </section>

          <section className="pv-card" aria-label="By instrument">
            <CardHead title="By instrument" />
            <table className="pv-tbl">
              <thead>
                <tr>
                  <th>Instrument</th>
                  <th className="r">Trades</th>
                  <th className="r">Win rate</th>
                  <th className="r">Net</th>
                </tr>
              </thead>
              <tbody>
                {bySymbol(rows).map((b) => (
                  <tr key={b.symbol}>
                    <td>{b.symbol}</td>
                    <td className="r num">{b.count}</td>
                    <td className="r num">{fmtPct(b.winRate * 100, { decimals: 0 })}</td>
                    <td className={cx('r num', toneOf(b.net))}>{fmtMoney(b.net, { sign: true })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="pv-card" aria-label="By direction and exit">
            <CardHead title="Direction & exits" />
            <table className="pv-tbl">
              <tbody>
                <tr>
                  <td>Long</td>
                  <td className="r num">{stats.long.count}</td>
                  <td className="r num">{fmtPct(stats.long.winRate * 100, { decimals: 0 })}</td>
                  <td className={cx('r num', toneOf(stats.long.net))}>{fmtMoney(stats.long.net, { sign: true })}</td>
                </tr>
                <tr>
                  <td>Short</td>
                  <td className="r num">{stats.short.count}</td>
                  <td className="r num">{fmtPct(stats.short.winRate * 100, { decimals: 0 })}</td>
                  <td className={cx('r num', toneOf(stats.short.net))}>{fmtMoney(stats.short.net, { sign: true })}</td>
                </tr>
                {exitBreakdown(rows).map(([k, n, net]) => (
                  <tr key={k}>
                    <td className="faint">{k}</td>
                    <td className="r num">{n}</td>
                    <td />
                    <td className={cx('r num', toneOf(net))}>{fmtMoney(net, { sign: true })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <p className="pv-foot faint">
            Live account: equity {metrics ? fmtMoney(metrics.equity) : '—'} · Figures use net P&L after fees. Win = net &gt; 0. Profit factor = Σ wins ÷ |Σ losses|. Expectancy = net ÷ trades. 1R = loss at the first stop placed.
          </p>
        </div>
      )}
    </div>
  );
}

const EXIT_LABEL: Record<string, string> = { manual: 'Manual exits', sl: 'Stopped out', tp: 'Target hit', trail: 'Trailing stop', liquidation: 'Liquidations', risk: 'Risk lock' };
function exitBreakdown(rows: TradeRow[]): [string, number, number][] {
  const m = new Map<string, [number, number]>();
  for (const r of rows) {
    const k = EXIT_LABEL[r.closeReason ?? 'manual'];
    const cur = m.get(k) ?? [0, 0];
    m.set(k, [cur[0] + 1, cur[1] + r.net]);
  }
  return [...m.entries()].map(([k, [n, net]]) => [k, n, net]);
}

function Kpi({ label, value, sub, tone, testId }: { label: string; value: string; sub?: string; tone?: string; testId?: string }) {
  return (
    <div className="pv-kpi">
      <span className="label">{label}</span>
      <span className={cx('pv-kpi-v', tone)} data-testid={testId}>
        {value}
      </span>
      {sub && <span className="pv-kpi-sub num">{sub}</span>}
    </div>
  );
}

function CardHead({ title, note }: { title: string; note?: string }) {
  return (
    <header className="pv-card-h">
      <h2>{title}</h2>
      {note && <span className="faint">{note}</span>}
    </header>
  );
}

function CurveChart({ points, kind }: { points: CurvePoint[]; kind: 'balance' | 'drawdown' }) {
  const host = useRef<HTMLDivElement>(null);
  const t = useChartTheme();
  const chart = useRef<{ c: IChartApi; s: ISeriesApi<'Area'> } | null>(null);
  const [hover, setHover] = useState<{ ts: number; v: number } | null>(null);

  useEffect(() => {
    const c = createChart(host.current!, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: t.fg2, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: t.grid } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderColor: t.line, timeVisible: true },
      crosshair: { mode: CrosshairMode.Magnet, vertLine: { color: t.fg3, style: LineStyle.Solid, labelVisible: false }, horzLine: { visible: false, labelVisible: false } },
      handleScroll: false,
      handleScale: false,
      localization: { locale: safeLocale() },
    });
    const s = c.addSeries(AreaSeries, { lineWidth: 2, priceLineVisible: false, lastValueVisible: true, crosshairMarkerRadius: 4 });
    chart.current = { c, s };
    c.subscribeCrosshairMove((p) => {
      const d = p.seriesData.get(s) as { value?: number } | undefined;
      setHover(p.time != null && d?.value != null ? { ts: (p.time as number) * 1000, v: d.value } : null);
    });
    return () => {
      disposeChart(c);
      chart.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const x = chart.current;
    if (!x) return;
    paint(x.c, x.s, t, kind);
    // Lightweight Charts needs strictly increasing times: keep the last value per second.
    const bySec = new Map<number, number>();
    for (const p of points) bySec.set(Math.floor(p.ts / 1000), kind === 'drawdown' ? -p.value : p.value);
    const data = [...bySec.entries()].sort((a, b) => a[0] - b[0]).map(([time, value]) => ({ time: time as UTCTimestamp, value }));
    x.s.setData(data);
    x.c.timeScale().fitContent();
  }, [points, t, kind]);

  return (
    <div className="pv-chart">
      <div ref={host} className="pv-chart-host" />
      <div className="pv-tip num" aria-live="off">
        {hover ? (
          <>
            {fmtDate(hover.ts)} · <b>{kind === 'drawdown' ? fmtPct(hover.v) : fmtMoney(hover.v)}</b>
          </>
        ) : points.length ? (
          <>
            Latest · <b>{kind === 'drawdown' ? fmtPct(-points[points.length - 1].value) : fmtMoney(points[points.length - 1].value)}</b>
          </>
        ) : null}
      </div>
    </div>
  );
}

function paint(c: IChartApi, s: ISeriesApi<'Area'>, t: ChartTheme, kind: 'balance' | 'drawdown') {
  c.applyOptions({
    layout: { textColor: t.fg2 },
    grid: { horzLines: { color: t.grid } },
    timeScale: { borderColor: t.line },
    crosshair: { vertLine: { color: t.fg3 } },
  });
  const col = kind === 'drawdown' ? t.down : t.fg0;
  s.applyOptions({
    lineColor: col,
    topColor: kind === 'drawdown' ? rgba(t.down, 0.04) : rgba(t.fg0.startsWith('#') ? t.fg0 : '#ece7dc', 0.12),
    bottomColor: kind === 'drawdown' ? rgba(t.down, 0.22) : rgba(t.fg0.startsWith('#') ? t.fg0 : '#ece7dc', 0),
    invertFilledArea: kind === 'drawdown',
    priceFormat: kind === 'drawdown' ? { type: 'custom', formatter: (v: number) => `${v.toFixed(2)}%` } : { type: 'price', precision: 2, minMove: 0.01 },
  });
}

/** Diverging histogram: losses left of zero in the down colour, wins right in the up colour. */
function RHist({ rows }: { rows: TradeRow[] }) {
  const buckets = useMemo(() => rHistogram(rows, 0.5, 4), [rows]);
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const W = 100 / buckets.length;
  if (!rows.some((r) => r.r != null)) return <Empty title="No R data" body="Trades need a stop-loss at entry to define 1R." />;
  return (
    <figure className="rh" aria-label="Histogram of R-multiples">
      <div className="rh-plot">
        {buckets.map((b, i) => {
          const h = (b.count / max) * 100;
          const pos = b.from >= 0;
          return (
            <button
              key={i}
              className="rh-hit"
              style={{ left: `${i * W}%`, width: `${W}%` }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              aria-label={`${b.from} to ${b.to} R: ${b.count} trades`}
            >
              <span className={cx('rh-bar', pos ? 'is-up' : 'is-down', hover === i && 'is-hover')} style={{ height: b.count ? `max(${h}%, 3px)` : 0 }} />
            </button>
          );
        })}
        <span className="rh-zero" style={{ left: '50%' }} />
        {hover != null && (
          <div className="rh-tip num" style={{ left: `${(hover + 0.5) * W}%` }}>
            {buckets[hover].from === -4 ? '≤ ' : ''}
            {buckets[hover].from}R … {buckets[hover].to}R{buckets[hover].to === 4 ? '+' : ''} · <b>{buckets[hover].count}</b>
          </div>
        )}
      </div>
      <div className="rh-axis num" aria-hidden="true">
        {[-4, -3, -2, -1, 0, 1, 2, 3, 4].map((x) => (
          <span key={x} style={{ left: `${((x + 4) / 8) * 100}%` }}>
            {x > 0 ? `+${x}` : x}R
          </span>
        ))}
      </div>
    </figure>
  );
}

function Calendar({ rows }: { rows: TradeRow[] }) {
  const daily = useMemo(() => dailyPnl(rows), [rows]);
  const [hover, setHover] = useState<string | null>(null);
  const weeks = 26;
  const today = new Date();
  const end = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const dow = (new Date(end).getUTCDay() + 6) % 7; // Monday = 0
  const start = end - (dow + (weeks - 1) * 7) * 864e5;
  const maxAbs = Math.max(1, ...[...daily.values()].map((d) => Math.abs(d.net)));
  const cells: { key: string; ts: number; d?: { net: number; count: number } }[] = [];
  for (let ts = start; ts <= end; ts += 864e5) {
    const key = utcDayKey(ts);
    cells.push({ key, ts, d: daily.get(key) });
  }
  const h = hover ? cells.find((c) => c.key === hover) : null;
  return (
    <figure className="cal" aria-label="Daily net P&L calendar">
      <div className="cal-days label" aria-hidden="true">
        {['M', '', 'W', '', 'F', '', 'S'].map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      <div className="cal-grid">
        {cells.map((c) => {
          const v = c.d?.net ?? 0;
          const k = c.d ? Math.min(1, Math.abs(v) / maxAbs) : 0;
          return (
            <button
              key={c.key}
              className={cx('cal-cell', c.d && (v > 0 ? 'is-up' : v < 0 ? 'is-down' : 'is-flat'))}
              style={{ ['--k' as string]: String(0.18 + 0.82 * k) }}
              onMouseEnter={() => setHover(c.key)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(c.key)}
              onBlur={() => setHover(null)}
              aria-label={`${c.key}: ${c.d ? `${fmtMoney(v, { sign: true })}, ${c.d.count} trades` : 'no trades'}`}
            />
          );
        })}
      </div>
      <figcaption className="cal-cap num">
        {h ? (
          <>
            {fmtDate(h.ts)} · {h.d ? <b className={toneOf(h.d.net)}>{fmtMoney(h.d.net, { sign: true })}</b> : 'no trades'}
            {h.d ? ` · ${h.d.count} trade${h.d.count > 1 ? 's' : ''}` : ''}
          </>
        ) : (
          <span className="cal-legend">
            <i className="cal-cell is-down" style={{ ['--k' as string]: '1' }} /> loss
            <i className="cal-cell" /> none
            <i className="cal-cell is-up" style={{ ['--k' as string]: '1' }} /> gain · intensity = size
          </span>
        )}
      </figcaption>
    </figure>
  );
}

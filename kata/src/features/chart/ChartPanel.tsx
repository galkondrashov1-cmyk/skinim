import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { netRealized, rMultiple } from '@/engine/margin';
import { INDICATORS } from '@/indicators/indicators';
import { INTERVAL_LABEL, INTERVALS, type Interval } from '@/market/types';
import { useInstrument, useQuote, useTicker } from '@/store/market';
import { useUI, useView } from '@/store/ui';
import { fmtCompact, fmtDateTime, fmtDuration, fmtMoney, fmtPct, fmtPrice, fmtR, toneOf } from '@/lib/format';
import { Icon } from '@/ui/icons';
import { Button, cx, IconButton, Menu, MenuItem, MenuSep, Ticking } from '@/ui/primitives';
import { navigate, useRoute } from '@/app/router';
import { useIsMobile, useSourceOf } from '@/app/hooks';
import { SourceTag } from '@/app/SourceTag';
import { ChartCanvas, intervalForDuration } from './ChartCanvas';
import { useEffect } from 'react';
import './chart.css';

export function ChartPanel() {
  const route = useRoute();
  const inspectId = route.view === 'trade' ? route.query.get('inspect') : null;
  const inspect = useLiveQuery(() => (inspectId ? db.positions.get(inspectId) : undefined), [inspectId]);
  const uiSymbol = useUI((s) => s.symbol);
  const interval = useUI((s) => s.interval);
  const symbol = inspect?.symbol ?? uiSymbol;

  // Frame an inspected trade at a sensible resolution.
  useEffect(() => {
    if (!inspect || inspect.closedAt == null) return;
    useUI.setState({ symbol: inspect.symbol, interval: intervalForDuration(inspect.closedAt - inspect.openedAt) });
  }, [inspect?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="cp" aria-label="Chart">
      <ChartHeader symbol={symbol} interval={interval} />
      {inspect && inspect.status === 'closed' && (
        <div className="cp-inspect" role="status" data-testid="inspect-banner">
          <span className="label">Inspecting</span>
          <span className="cp-inspect-trade">
            #{inspect.no} {inspect.symbol} {inspect.side}
          </span>
          <span className={cx('num', toneOf(netRealized(inspect)))}>{fmtMoney(netRealized(inspect), { sign: true })}</span>
          {rMultiple(inspect) != null && <span className={cx('num', toneOf(rMultiple(inspect)))}>{fmtR(rMultiple(inspect))}</span>}
          <span className="faint num">
            {fmtDateTime(inspect.openedAt)} → {fmtDateTime(inspect.closedAt)} · {fmtDuration((inspect.closedAt ?? 0) - inspect.openedAt)}
          </span>
          <span className="cp-inspect-sp" />
          <Button size="sm" variant="ghost" icon="journal" onClick={() => navigate(`/journal/${inspect.id}`)}>
            Journal
          </Button>
          <Button size="sm" variant="secondary" icon="close" onClick={() => navigate('/trade')} data-testid="inspect-exit">
            Back to live
          </Button>
        </div>
      )}
      <div className="cp-body">
        <ChartCanvas key={symbol} symbol={symbol} interval={interval} inspect={inspect && inspect.status === 'closed' ? inspect : null} />
      </div>
    </section>
  );
}

function ChartHeader({ symbol, interval }: { symbol: string; interval: Interval }) {
  const spec = useInstrument(symbol);
  const q = useQuote(symbol);
  const tk = useTicker(symbol);
  const src = useSourceOf(symbol);
  const indicators = useUI((s) => s.indicators);
  const isMobile = useIsMobile();
  const last = q?.last ?? tk?.last;
  const chg = tk?.changePct;

  return (
    <div className="ch">
      <button className="ch-symbol" onClick={() => useView.setState({ dialog: { kind: 'search' } })} data-testid="symbol-button">
        <span className="ch-sym">{spec.venue === 'sim' ? spec.symbol.replace('.SIM', '') : spec.base}</span>
        <span className="ch-quote faint">{spec.venue === 'sim' ? '·SIM' : `/${spec.quote}`}</span>
        <Icon name="chevronDown" size={12} />
      </button>
      <SourceTag source={src.kind} detail={src.detail} compact={isMobile} />
      <div className="ch-price">
        <Ticking value={last} className={cx('num ch-last', toneOf(chg))}>
          {fmtPrice(last, spec.tickSize)}
        </Ticking>
        {chg != null && <span className={cx('num ch-chg', toneOf(chg))}>{fmtPct(chg, { sign: true })}</span>}
      </div>
      {!isMobile && tk && (
        <div className="ch-stats">
          <span>
            <i className="label">24h high</i>
            <b className="num">{fmtPrice(tk.high24h, spec.tickSize)}</b>
          </span>
          <span>
            <i className="label">24h low</i>
            <b className="num">{fmtPrice(tk.low24h, spec.tickSize)}</b>
          </span>
          <span>
            <i className="label">24h vol</i>
            <b className="num">{fmtCompact(tk.quoteVolume)}</b>
          </span>
          {q && (
            <span>
              <i className="label">Spread</i>
              <b className="num">{fmtPrice(q.ask - q.bid, spec.tickSize)}</b>
            </span>
          )}
        </div>
      )}
      <div className="ch-sp" />
      <div className="ch-tf" role="radiogroup" aria-label="Timeframe">
        {INTERVALS.map((i) => (
          <button key={i} role="radio" aria-checked={i === interval} className={cx('ch-tf-i', i === interval && 'is-on')} onClick={() => useUI.setState({ interval: i })}>
            {INTERVAL_LABEL[i]}
          </button>
        ))}
      </div>
      <Menu
        align="end"
        width={240}
        trigger={(p) => <IconButton icon="layers" label="Indicators" {...p} ref={p.ref} active={p['aria-expanded']} data-testid="indicators-button" />}
      >
        {() => (
          <>
            <MenuSep label="Overlays" />
            {INDICATORS.filter((d) => d.pane === 'price').map((d) => (
              <MenuItem key={d.id} checked={indicators.includes(d.id)} hint={d.short} onSelect={() => toggle(d.id)}>
                {d.label}
              </MenuItem>
            ))}
            <MenuSep label="Panes" />
            {INDICATORS.filter((d) => d.pane === 'lower').map((d) => (
              <MenuItem key={d.id} checked={indicators.includes(d.id)} hint={d.short} onSelect={() => toggle(d.id)}>
                {d.label}
              </MenuItem>
            ))}
          </>
        )}
      </Menu>
    </div>
  );
}

function toggle(id: (typeof INDICATORS)[number]['id']) {
  const cur = useUI.getState().indicators;
  useUI.setState({ indicators: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
}

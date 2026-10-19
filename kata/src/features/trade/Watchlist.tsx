import { useEffect, useMemo, useState } from 'react';
import { hub } from '@/market/hub';
import { isSimSymbol } from '@/market/sim';
import { useActiveEngine } from '@/store/app';
import { useInstrument, useMarket } from '@/store/market';
import { useUI, useView } from '@/store/ui';
import { fmtPct, fmtPrice, toneOf } from '@/lib/format';
import { Icon } from '@/ui/icons';
import { cx, Dialog, Empty, IconButton, Ticking } from '@/ui/primitives';
import { SourceTag, type TagKind } from '@/app/SourceTag';
import { useIsMobile } from '@/app/hooks';
import { SIM_INSTRUMENTS } from '@/market/sim';
import './trade.css';

export function Watchlist() {
  const watchlist = useUI((s) => s.watchlist);
  const symbol = useUI((s) => s.symbol);
  const engine = useActiveEngine();
  const isMobile = useIsMobile();
  const feed = useMarket((s) => s.status.binance.state);
  const feedKind = feed === 'live' ? 'live' : feed === 'delayed' ? 'delayed' : feed === 'connecting' ? 'connecting' : 'offline';
  useEffect(() => hub.watchTickers(watchlist), [watchlist]);
  const held = useMemo(() => new Set(engine?.positions.map((p) => p.symbol) ?? []), [engine]);
  const working = useMemo(() => new Set(engine?.orders.map((o) => o.symbol) ?? []), [engine]);
  const real = watchlist.filter((s) => !isSimSymbol(s));
  const sim = watchlist.filter(isSimSymbol);

  const select = (s: string) => {
    useUI.setState({ symbol: s });
    if (location.hash.includes('inspect=')) location.hash = '#/trade';
    if (isMobile) useView.setState({ mobilePane: 'chart' });
  };

  return (
    <section className="wl" aria-label="Watchlist">
      <header className="panel-h">
        <span className="label">Markets</span>
        <IconButton icon="search" label="Search instruments" size="sm" onClick={() => useView.setState({ dialog: { kind: 'search' } })} data-testid="wl-search" />
      </header>
      <div className="wl-cols label" aria-hidden="true">
        <span>Instrument</span>
        <span>Last</span>
        <span>24h</span>
      </div>
      <div className="wl-scroll">
        <Group title="Binance spot" source={feedKind} />
        {real.map((s) => (
          <Row key={s} symbol={s} active={s === symbol} held={held.has(s)} working={working.has(s)} onSelect={select} />
        ))}
        {real.length === 0 && <Empty icon="star" title="No crypto pairs" body="Search to add instruments to your watchlist." />}
        {sim.length > 0 && <Group title="Kata Sim · synthetic" source="simulated" />}
        {sim.map((s) => (
          <Row key={s} symbol={s} active={s === symbol} held={held.has(s)} working={working.has(s)} onSelect={select} />
        ))}
      </div>
    </section>
  );
}

function Group({ title, source }: { title: string; source: TagKind }) {
  return (
    <div className="wl-group">
      <span className="label">{title}</span>
      <SourceTag source={source} compact />
    </div>
  );
}

function Row({ symbol, active, held, working, onSelect }: { symbol: string; active: boolean; held: boolean; working: boolean; onSelect: (s: string) => void }) {
  const spec = useInstrument(symbol);
  const t = useMarket((s) => s.tickers[symbol]);
  const q = useMarket((s) => s.quotes[symbol]);
  const last = q?.last ?? t?.last;
  return (
    <div className={cx('wl-row', active && 'is-active')}>
      <button className="wl-main" onClick={() => onSelect(symbol)} aria-current={active ? 'true' : undefined} data-testid={`wl-${symbol}`}>
        <span className="wl-name">
          <span className="wl-sym">
            {spec.base}
            {(held || working) && <span className={cx('wl-dot', held ? 'is-held' : 'is-working')} title={held ? 'Open position' : 'Working order'} />}
          </span>
          <span className="wl-full">{spec.name}</span>
        </span>
        <Ticking value={last} className="num wl-last">
          {last != null ? fmtPrice(last, spec.tickSize) : '—'}
        </Ticking>
        <span className={cx('num wl-chg', toneOf(t?.changePct))}>{t ? fmtPct(t.changePct, { sign: true }) : '—'}</span>
      </button>
      <button
        className="wl-rm"
        aria-label={`Remove ${symbol} from watchlist`}
        title="Remove from watchlist"
        onClick={() => useUI.setState((s) => ({ watchlist: s.watchlist.filter((x) => x !== symbol) }))}
      >
        <Icon name="close" size={11} />
      </button>
    </div>
  );
}

export function SymbolSearch({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [all, setAll] = useState<string[] | null>(null);
  const [failed, setFailed] = useState(false);
  const watchlist = useUI((s) => s.watchlist);
  const isMobile = useIsMobile();
  useEffect(() => {
    let alive = true;
    hub
      .searchSymbols()
      .then((s) => alive && setAll(s))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);
  const universe = useMemo(() => {
    const set = new Set<string>([...SIM_INSTRUMENTS.map((i) => i.symbol), ...watchlist, ...(all ?? [])]);
    return [...set];
  }, [all, watchlist]);
  const needle = q.trim().toUpperCase();
  const results = useMemo(() => {
    const r = needle ? universe.filter((s) => s.includes(needle) || hub.instrument(s).name.toUpperCase().includes(needle)) : universe;
    return r
      .sort((a, b) => {
        const sa = a.startsWith(needle) ? 0 : 1;
        const sb = b.startsWith(needle) ? 0 : 1;
        return sa - sb || Number(isSimSymbol(a)) - Number(isSimSymbol(b)) || a.localeCompare(b);
      })
      .slice(0, 80);
  }, [universe, needle]);

  const pick = (s: string) => {
    useUI.setState((st) => ({ symbol: s, watchlist: st.watchlist.includes(s) ? st.watchlist : [...st.watchlist, s] }));
    if (location.hash.includes('inspect=')) location.hash = '#/trade';
    if (isMobile) useView.setState({ mobilePane: 'chart' });
    onClose();
  };
  const toggle = (s: string) => useUI.setState((st) => ({ watchlist: st.watchlist.includes(s) ? st.watchlist.filter((x) => x !== s) : [...st.watchlist, s] }));

  return (
    <Dialog open onClose={onClose} title="Instruments" width={460}>
      <div className="ss">
        <div className="ss-input">
          <Icon name="search" />
          <input
            data-autofocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search BTC, ETH, SOL… or SIM"
            aria-label="Search instruments"
            onKeyDown={(e) => e.key === 'Enter' && results[0] && pick(results[0])}
            data-testid="ss-input"
          />
        </div>
        {failed && <p className="ss-note">Couldn’t load the full Binance symbol list. Showing your watchlist and Kata Sim instruments.</p>}
        {!all && !failed && <p className="ss-note">Loading Binance symbols…</p>}
        <ul className="ss-list" role="listbox" aria-label="Results">
          {results.map((s) => {
            const sim = isSimSymbol(s);
            const inst = hub.instrument(s);
            const on = watchlist.includes(s);
            return (
              <li key={s} className="ss-item">
                <button className="ss-pick" onClick={() => pick(s)} role="option" aria-selected={false}>
                  <span className="ss-sym">{sim ? s.replace('.SIM', '') : inst.base}</span>
                  <span className="ss-name">{sim ? 'Synthetic · Kata Sim' : `${inst.name} · ${inst.quote}`}</span>
                  <SourceTag source={sim ? 'simulated' : 'live'} compact />
                </button>
                <IconButton icon="star" label={on ? 'Remove from watchlist' : 'Add to watchlist'} size="sm" active={on} onClick={() => toggle(s)} />
              </li>
            );
          })}
        </ul>
      </div>
    </Dialog>
  );
}

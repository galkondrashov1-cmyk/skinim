import { lazy, Suspense, useEffect } from 'react';
import { Loader, Lockup, Mark } from '@/brand/Brand';
import { dismissToast, useActiveAccount, useApp } from '@/store/app';
import { actions } from '@/store/runtime';
import { useMarket } from '@/store/market';
import { useView } from '@/store/ui';
import { Icon, type IconName } from '@/ui/icons';
import { Button, cx, Dialog, IconButton, Menu, MenuItem, MenuSep } from '@/ui/primitives';
import { fmtDateTime, fmtMoney, fmtPct, toneOf } from '@/lib/format';
import { navigate, useRoute, type View } from './router';
import { useIsMobile, useMetrics } from './hooks';
import { SourceTag } from './SourceTag';
import { InstallDialog } from './InstallDialog';
import { useInstallState } from './install';
import { useServiceWorker } from './sw';
import { TradeView } from '@/features/trade/TradeView';
import './shell.css';

const JournalView = lazy(() => import('@/features/journal/JournalView'));
const PerformanceView = lazy(() => import('@/features/performance/PerformanceView'));
const SettingsView = lazy(() => import('@/features/settings/SettingsView'));

const NAV: { view: View; label: string; icon: IconName }[] = [
  { view: 'trade', label: 'Trade', icon: 'chart' },
  { view: 'journal', label: 'Journal', icon: 'journal' },
  { view: 'performance', label: 'Performance', icon: 'performance' },
  { view: 'settings', label: 'Settings', icon: 'settings' },
];

export function Shell() {
  const route = useRoute();
  const isMobile = useIsMobile();
  useServiceWorker();
  useEffect(() => {
    document.title = `${NAV.find((n) => n.view === route.view)?.label ?? 'Trade'} · Kata`;
  }, [route.view]);

  return (
    <div className={cx('shell', isMobile && 'shell--mobile')}>
      <Header view={route.view} />
      <LockBanner />
      <main className="shell-main" id="main">
        {route.view === 'trade' ? (
          <TradeView />
        ) : (
          <Suspense
            fallback={
              <div className="shell-loading">
                <Loader />
              </div>
            }
          >
            {route.view === 'journal' && <JournalView />}
            {route.view === 'performance' && <PerformanceView />}
            {route.view === 'settings' && <SettingsView />}
          </Suspense>
        )}
      </main>
      {isMobile && <MobileNav view={route.view} />}
      <Toasts />
      <AwayDialog />
      <GlobalDialogs />
    </div>
  );
}

function Header({ view }: { view: View }) {
  const isMobile = useIsMobile();
  const m = useMetrics();
  const install = useInstallState();
  return (
    <header className="hdr">
      <a className="hdr-brand" href="#/trade" aria-label="Kata — Trade">
        {isMobile ? <Mark size={22} /> : <Lockup size={22} />}
      </a>
      {!isMobile && (
        <nav className="hdr-nav" aria-label="Primary">
          {NAV.map((n) => (
            <a key={n.view} href={`#/${n.view}`} className={cx('hdr-link', view === n.view && 'is-on')} aria-current={view === n.view ? 'page' : undefined}>
              {n.label}
            </a>
          ))}
        </nav>
      )}
      <div className="hdr-spacer" />
      <AccountSwitcher />
      {m && (
        <div className="hdr-metrics">
          <HdrStat label="Equity" value={fmtMoney(m.equity)} testId="hdr-equity" />
          {!isMobile && (
            <>
              <HdrStat label="Day P&L" value={fmtMoney(m.dayPnl, { sign: true })} sub={fmtPct(m.dayPnlPct, { sign: true })} tone={toneOf(m.dayPnl)} />
              <HdrStat label="Unrealized" value={fmtMoney(m.unrealizedPnl, { sign: true })} tone={toneOf(m.unrealizedPnl)} />
              <HdrStat label="Available" value={fmtMoney(Math.max(0, m.available))} testId="hdr-available" />
              <HdrStat label="Margin" value={fmtMoney(m.positionMargin + m.orderMargin)} />
            </>
          )}
        </div>
      )}
      <FeedStatus />
      {install === 'prompt' || install === 'ios' ? (
        isMobile ? (
          <IconButton icon="install" label="Install Kata" onClick={() => useView.setState({ dialog: { kind: 'install' } })} />
        ) : (
          <Button size="sm" variant="ghost" icon="install" onClick={() => useView.setState({ dialog: { kind: 'install' } })}>
            Install
          </Button>
        )
      ) : null}
      {isMobile && <IconButton icon="settings" label="Settings" onClick={() => navigate('/settings')} />}
    </header>
  );
}

function HdrStat({ label, value, sub, tone, testId }: { label: string; value: string; sub?: string; tone?: string; testId?: string }) {
  return (
    <div className="hdr-stat">
      <span className="label">{label}</span>
      <span className={cx('num hdr-stat-v', tone)} data-testid={testId}>
        {value}
        {sub && <span className="hdr-stat-sub">{sub}</span>}
      </span>
    </div>
  );
}

function AccountSwitcher() {
  const account = useActiveAccount();
  const accounts = useApp((s) => s.accounts);
  if (!account) return null;
  return (
    <Menu
      align="end"
      width={260}
      trigger={(p) => (
        <button className="hdr-account" {...p} ref={p.ref} data-testid="account-switcher">
          <span className="hdr-account-paper label">Paper</span>
          <span className="hdr-account-name">{account.name}</span>
          <Icon name="chevronDown" size={12} />
        </button>
      )}
    >
      {(close) => (
        <>
          <MenuSep label="Paper accounts" />
          {accounts.map((a) => (
            <MenuItem
              key={a.id}
              checked={a.id === account.id}
              hint={<span className="num">{fmtMoney(a.balance)}</span>}
              onSelect={() => {
                void actions.switchAccount(a.id);
                close();
              }}
            >
              {a.name}
            </MenuItem>
          ))}
          <div className="k-menu-rule" />
          <MenuItem
            icon="plus"
            onSelect={() => {
              navigate('/settings/accounts?new=1');
              close();
            }}
          >
            New paper account
          </MenuItem>
          <MenuItem
            icon="settings"
            onSelect={() => {
              navigate('/settings/accounts');
              close();
            }}
          >
            Manage accounts
          </MenuItem>
        </>
      )}
    </Menu>
  );
}

function FeedStatus() {
  const st = useMarket((s) => s.status.binance);
  const isMobile = useIsMobile();
  const kind = st.state === 'live' ? 'live' : st.state === 'delayed' ? 'delayed' : st.state === 'connecting' ? 'connecting' : 'offline';
  return (
    <Menu
      align="end"
      width={300}
      trigger={(p) => (
        <button className="hdr-feed" {...p} ref={p.ref} aria-label={`Market data: ${kind}`} data-testid="feed-status">
          <SourceTag source={kind} compact={isMobile} />
        </button>
      )}
    >
      {() => (
        <div className="feed-pop">
          <div className="feed-pop-row">
            <span className="label">Binance spot</span>
            <SourceTag source={kind} />
          </div>
          <p>{st.detail ?? 'Streaming best bid/ask, trades and candles in real time.'}</p>
          {st.host && <p className="faint num">via {st.host}</p>}
          <div className="feed-pop-row">
            <span className="label">Kata Sim</span>
            <SourceTag source="simulated" />
          </div>
          <p>Synthetic instruments (·SIM) generated on this device. Never market data.</p>
          <p className="faint">Orders fill against the bid/ask shown. When data is stale, market orders are paused; nothing is filled on made-up prices.</p>
        </div>
      )}
    </Menu>
  );
}

function LockBanner() {
  const account = useActiveAccount();
  const catchup = useApp((s) => s.catchup);
  if (account?.locked) {
    return (
      <div className="banner banner--down" role="alert">
        <Icon name="lock" size={14} />
        <span>{account.locked.message}</span>
        {account.locked.reason === 'drawdown' && (
          <Button size="sm" variant="ghost" onClick={() => navigate('/settings/risk')}>
            Review
          </Button>
        )}
      </div>
    );
  }
  if (catchup.state !== 'idle') {
    return (
      <div className={cx('banner', catchup.state === 'failed' ? 'banner--warn' : 'banner--info')} role="status">
        <Icon name={catchup.state === 'failed' ? 'warning' : 'refresh'} size={14} />
        <span>{catchup.state === 'running' ? `Reconciling orders with real market history · ${catchup.detail}` : catchup.detail}</span>
      </div>
    );
  }
  return null;
}

function MobileNav({ view }: { view: View }) {
  const pane = useView((s) => s.mobilePane);
  const items: { key: string; label: string; icon: IconName; on: boolean; go: () => void }[] = [
    { key: 'chart', label: 'Chart', icon: 'chart', on: view === 'trade' && pane === 'chart', go: () => (navigate('/trade'), useView.setState({ mobilePane: 'chart' })) },
    { key: 'markets', label: 'Markets', icon: 'markets', on: view === 'trade' && pane === 'markets', go: () => (navigate('/trade'), useView.setState({ mobilePane: 'markets' })) },
    { key: 'positions', label: 'Positions', icon: 'list', on: view === 'trade' && pane === 'positions', go: () => (navigate('/trade'), useView.setState({ mobilePane: 'positions' })) },
    { key: 'journal', label: 'Journal', icon: 'journal', on: view === 'journal', go: () => navigate('/journal') },
    { key: 'performance', label: 'Stats', icon: 'performance', on: view === 'performance', go: () => navigate('/performance') },
  ];
  return (
    <nav className="mnav" aria-label="Primary">
      {items.map((i) => (
        <button key={i.key} className={cx('mnav-item', i.on && 'is-on')} onClick={i.go} aria-current={i.on ? 'page' : undefined}>
          <Icon name={i.icon} size={18} />
          <span>{i.label}</span>
        </button>
      ))}
    </nav>
  );
}

function Toasts() {
  const toasts = useApp((s) => s.toasts);
  useEffect(() => {
    if (!toasts.length) return;
    const timers = toasts.map((t) => setTimeout(() => dismissToast(t.id), t.level === 'error' ? 7000 : 4500));
    return () => timers.forEach(clearTimeout);
  }, [toasts]);
  return (
    <div className="toasts" aria-live="polite" aria-relevant="additions">
      {toasts.map((t) => (
        <div key={t.id} className={cx('toast', `toast--${t.level}`)} role={t.level === 'error' ? 'alert' : 'status'}>
          <span className="toast-rule" />
          <div className="toast-body">
            <div className="toast-title">{t.title}</div>
            {t.body && <div className="toast-text num">{t.body}</div>}
          </div>
          <IconButton icon="close" label="Dismiss" size="sm" onClick={() => dismissToast(t.id)} />
        </div>
      ))}
    </div>
  );
}

function AwayDialog() {
  const away = useApp((s) => s.away);
  const active = useApp((s) => s.activeId);
  if (!away || away.accountId !== active) return null;
  return (
    <Dialog
      open
      onClose={actions.dismissAway}
      title="While you were away"
      footer={
        <Button variant="primary" onClick={actions.dismissAway} data-autofocus>
          Got it
        </Button>
      }
    >
      <p className="away-lede">
        Kata replayed real {away.interval} candles from {fmtDateTime(away.from)} to {fmtDateTime(away.to)} and executed what your orders would have done.
      </p>
      <ul className="away-list">
        {away.notices.map((n, i) => (
          <li key={i} className={`away-item away-item--${n.level}`}>
            <span className="away-title">{n.title}</span>
            {n.body && <span className="away-body num">{n.body}</span>}
          </li>
        ))}
      </ul>
      <p className="faint away-note">Intrabar order is unknown in candle data: bullish candles are assumed to visit their low first, bearish candles their high.</p>
    </Dialog>
  );
}

function GlobalDialogs() {
  const dialog = useView((s) => s.dialog);
  const close = () => useView.setState({ dialog: null });
  if (dialog?.kind === 'install') return <InstallDialog onClose={close} />;
  return null;
}

import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db } from '@/db/db';
import { exitPriceOf, initialRisk, liquidationPriceFor, netRealized, rMultiple, unrealizedPnl, avgExitPrice } from '@/engine/margin';
import type { Order, Position } from '@/engine/types';
import { hub } from '@/market/hub';
import { useActiveEngine, useApp } from '@/store/app';
import { useInstrument, useMarket } from '@/store/market';
import { actions } from '@/store/runtime';
import { useUI, useView } from '@/store/ui';
import { fmtAgo, fmtDateTime, fmtDuration, fmtMoney, fmtPct, fmtPrice, fmtQty, fmtR, toneOf } from '@/lib/format';
import { Button, cx, Dialog, Empty, IconButton, Tabs } from '@/ui/primitives';
import { Icon } from '@/ui/icons';
import { inspectHref, navigate } from '@/app/router';
import { SourceTag } from '@/app/SourceTag';

type Tab = 'positions' | 'orders' | 'history' | 'fills';

export function BottomPanel() {
  const tab = useUI((s) => s.bottomTab);
  const engine = useActiveEngine();
  const nPos = engine?.positions.length ?? 0;
  const nOrd = engine?.orders.length ?? 0;
  const [confirmClose, setConfirmClose] = useState(false);
  return (
    <section className="bp" aria-label="Positions and orders">
      <header className="bp-h">
        <Tabs<Tab>
          label="Portfolio"
          value={tab}
          onChange={(bottomTab) => useUI.setState({ bottomTab })}
          tabs={[
            { value: 'positions', label: 'Positions', count: nPos },
            { value: 'orders', label: 'Orders', count: nOrd },
            { value: 'history', label: 'Closed trades' },
            { value: 'fills', label: 'Order history' },
          ]}
        />
        <span className="bp-sp" />
        {tab === 'positions' && nPos > 1 && (
          <Button size="sm" variant="ghost" onClick={() => setConfirmClose(true)}>
            Close all
          </Button>
        )}
        {tab === 'orders' && nOrd > 1 && (
          <Button size="sm" variant="ghost" onClick={() => actions.cancelAll()}>
            Cancel all
          </Button>
        )}
      </header>
      <div className="bp-body">
        {tab === 'positions' && <PositionsTable positions={engine?.positions ?? []} />}
        {tab === 'orders' && <OrdersTable orders={engine?.orders ?? []} />}
        {tab === 'history' && <HistoryTable />}
        {tab === 'fills' && <OrderLog />}
      </div>
      <Dialog
        open={confirmClose}
        onClose={() => setConfirmClose(false)}
        title="Close all positions?"
        width={360}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmClose(false)}>
              Keep them
            </Button>
            <Button
              variant="danger"
              data-autofocus
              onClick={() => {
                setConfirmClose(false);
                actions.closeAll();
              }}
            >
              Close {nPos} at market
            </Button>
          </>
        }
      >
        <p className="dlg-p">Every open position in this account is closed at the current bid/ask, with taker fees.</p>
      </Dialog>
    </section>
  );
}

// ─────────────────────────────────────────────────────────── positions ──

export function PositionsTable({ positions }: { positions: Position[] }) {
  if (!positions.length)
    return <Empty icon="chart" title="No open positions" body="Place an order from the ticket. Stops and targets appear on the chart, where you can drag them." />;
  return (
    <div className="tbl-wrap">
      <table className="tbl" data-testid="positions-table">
        <thead>
          <tr>
            <th>Instrument</th>
            <th className="r">Size</th>
            <th className="r">Entry</th>
            <th className="r">Mark</th>
            <th className="r">Liq.</th>
            <th className="r">Margin</th>
            <th className="r">Unrealized</th>
            <th className="r">R</th>
            <th>Stop · Target</th>
            <th className="r">Open</th>
            <th className="r" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {[...positions]
            .sort((a, b) => b.openedAt - a.openedAt)
            .map((p) => (
              <PositionRow key={p.id} p={p} />
            ))}
        </tbody>
      </table>
    </div>
  );
}

function PositionRow({ p }: { p: Position }) {
  const spec = useInstrument(p.symbol);
  const q = useMarket((s) => s.quotes[p.symbol]);
  const clock = useMarket((s) => s.clock);
  const engine = useActiveEngine();
  const mmr = engine?.account.config.maintenanceMargin ?? 0.005;
  const u = q ? unrealizedPnl(p, q) : null;
  const r1 = initialRisk(p);
  const liq = liquidationPriceFor(p, mmr);
  const isCurrent = useUI((s) => s.symbol) === p.symbol;
  return (
    <tr className={cx(isCurrent && 'is-current')} data-testid="position-row">
      <td data-label="Instrument">
        <button className="tbl-sym" onClick={() => useUI.setState({ symbol: p.symbol })}>
          <span className={cx('tbl-side', p.side)}>{p.side === 'long' ? 'L' : 'S'}</span>
          <span>{p.symbol.replace('USDT', '')}</span>
          <span className="faint num">{p.leverage}×</span>
        </button>
      </td>
      <td data-label="Size" className="r num">{fmtQty(p.qty, spec.stepSize)}</td>
      <td data-label="Entry" className="r num">{fmtPrice(p.entryPrice, spec.tickSize)}</td>
      <td data-label="Mark" className="r num">{q ? fmtPrice(exitPriceOf(p.side, q), spec.tickSize) : '—'}</td>
      <td data-label="Liq." className="r num liq-c">{liq != null ? fmtPrice(liq, spec.tickSize) : '—'}</td>
      <td data-label="Margin" className="r num">{fmtMoney(p.margin)}</td>
      <td data-label="Unrealized" className={cx('r num', toneOf(u))} data-testid="position-upnl">
        {u != null ? fmtMoney(u, { sign: true }) : '—'}
        {u != null && <span className="tbl-sub">{fmtPct((u / p.margin) * 100, { sign: true, decimals: 1 })}</span>}
      </td>
      <td data-label="R" className={cx('r num', toneOf(u))}>{u != null && r1 ? fmtR(u / r1) : '—'}</td>
      <td data-label="Stop · Target" className="num">
        <button className="tbl-prot" onClick={() => useView.setState({ dialog: { kind: 'edit-position', positionId: p.id } })} title="Edit stop-loss / take-profit">
          <span className={p.sl != null ? 'down' : 'faint'}>{p.sl != null ? fmtPrice(p.sl, spec.tickSize) : 'no stop'}</span>
          <span className="faint">·</span>
          <span className={p.tp != null ? 'up' : 'faint'}>{p.tp != null ? fmtPrice(p.tp, spec.tickSize) : 'no target'}</span>
          {p.trail && <span className="tbl-tag">trail</span>}
        </button>
      </td>
      <td data-label="Open" className="r faint num">{fmtAgo(clock - p.openedAt)}</td>
      <td className="r">
        <div className="tbl-acts">
          <Button size="sm" variant="ghost" onClick={() => actions.closePosition(p.id, p.qty / 2)} title="Close half at market">
            ½
          </Button>
          <Button size="sm" variant="secondary" onClick={() => actions.closePosition(p.id, 'all')} data-testid="position-close">
            Close
          </Button>
          <IconButton icon="edit" label="Manage position" size="sm" onClick={() => useView.setState({ dialog: { kind: 'edit-position', positionId: p.id } })} data-testid="position-edit" />
        </div>
      </td>
    </tr>
  );
}

// ────────────────────────────────────────────────────────────── orders ──

export function OrdersTable({ orders }: { orders: Order[] }) {
  if (!orders.length) return <Empty icon="clock" title="No working orders" body="Limit and stop orders wait here until the market reaches them." />;
  return (
    <div className="tbl-wrap">
      <table className="tbl" data-testid="orders-table">
        <thead>
          <tr>
            <th>Instrument</th>
            <th>Order</th>
            <th className="r">Size</th>
            <th className="r">Price</th>
            <th className="r">Distance</th>
            <th>Stop · Target</th>
            <th className="r">Reserved</th>
            <th className="r">Placed</th>
            <th className="r" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {[...orders]
            .sort((a, b) => b.createdAt - a.createdAt)
            .map((o) => (
              <OrderRow key={o.id} o={o} />
            ))}
        </tbody>
      </table>
    </div>
  );
}

function OrderRow({ o }: { o: Order }) {
  const spec = useInstrument(o.symbol);
  const q = useMarket((s) => s.quotes[o.symbol]);
  const clock = useMarket((s) => s.clock);
  const touch = q ? (o.side === 'buy' ? q.ask : q.bid) : null;
  const dist = touch && o.price ? ((o.price - touch) / touch) * 100 : null;
  return (
    <tr data-testid="order-row">
      <td data-label="Instrument">
        <button className="tbl-sym" onClick={() => useUI.setState({ symbol: o.symbol })}>
          <span className={cx('tbl-side', o.side === 'buy' ? 'long' : 'short')}>{o.side === 'buy' ? 'B' : 'S'}</span>
          <span>{o.symbol.replace('USDT', '')}</span>
          <span className="faint num">{o.leverage}×</span>
        </button>
      </td>
      <td data-label="Order" className="cap">
        {o.side} {o.type} <span className="faint num">#{o.no}</span>
      </td>
      <td data-label="Size" className="r num">{fmtQty(o.qty, spec.stepSize)}</td>
      <td data-label="Price" className="r num order-c">{fmtPrice(o.price, spec.tickSize)}</td>
      <td data-label="Distance" className="r num faint">{dist != null ? fmtPct(dist, { sign: true }) : '—'}</td>
      <td data-label="Stop · Target" className="num">
        <span className={o.sl != null ? 'down' : 'faint'}>{o.sl != null ? fmtPrice(o.sl, spec.tickSize) : '—'}</span>
        <span className="faint"> · </span>
        <span className={o.tp != null ? 'up' : 'faint'}>{o.tp != null ? fmtPrice(o.tp, spec.tickSize) : '—'}</span>
      </td>
      <td data-label="Reserved" className="r num">{fmtMoney(o.reserved)}</td>
      <td data-label="Placed" className="r faint num">{fmtAgo(clock - o.createdAt)}</td>
      <td className="r">
        <div className="tbl-acts">
          <IconButton icon="edit" label="Edit order" size="sm" onClick={() => useView.setState({ dialog: { kind: 'edit-order', orderId: o.id } })} />
          <Button size="sm" variant="secondary" onClick={() => actions.cancelOrder(o.id)} data-testid="order-cancel">
            Cancel
          </Button>
        </div>
      </td>
    </tr>
  );
}

// ───────────────────────────────────────────────────────────── history ──

const REASON: Record<string, string> = { manual: 'Manual', sl: 'Stop-loss', tp: 'Take-profit', trail: 'Trailing stop', liquidation: 'Liquidated', risk: 'Risk lock' };

export function HistoryTable({ limit = 200 }: { limit?: number }) {
  const activeId = useApp((s) => s.activeId);
  const [n, setN] = useState(limit);
  const rows = useLiveQuery(
    () => (activeId ? db.positions.where('[accountId+closedAt]').between([activeId, 0], [activeId, Infinity]).reverse().limit(n).toArray() : []),
    [activeId, n],
  );
  const notes = useLiveQuery(() => (activeId ? db.journal.where('accountId').equals(activeId).primaryKeys() : []), [activeId]);
  if (!rows) return null;
  if (!rows.length) return <Empty icon="list" title="No closed trades yet" body="Every closed position lands here with its fees, R-multiple and exit reason." />;
  const noted = new Set(notes ?? []);
  return (
    <div className="tbl-wrap">
      <table className="tbl tbl--click" data-testid="history-table">
        <thead>
          <tr>
            <th>Closed</th>
            <th>Instrument</th>
            <th className="r">Size</th>
            <th className="r">Entry</th>
            <th className="r">Exit</th>
            <th className="r">Net P&L</th>
            <th className="r">R</th>
            <th className="r">Held</th>
            <th>Reason</th>
            <th>Data</th>
            <th aria-label="Journal" />
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const spec = hub.instrument(p.symbol);
            const net = netRealized(p);
            const r = rMultiple(p);
            return (
              <tr key={p.id} onClick={() => navigate(inspectHref(p.id))} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && navigate(inspectHref(p.id))} title="Inspect on chart" data-testid="history-row">
                <td data-label="Closed" className="faint num">{fmtDateTime(p.closedAt)}</td>
                <td data-label="Instrument">
                  <span className="tbl-sym">
                    <span className={cx('tbl-side', p.side)}>{p.side === 'long' ? 'L' : 'S'}</span>
                    {p.symbol.replace('USDT', '')}
                    <span className="faint num">{p.leverage}×</span>
                  </span>
                </td>
                <td data-label="Size" className="r num">{fmtQty(p.initialQty, spec.stepSize)}</td>
                <td data-label="Entry" className="r num">{fmtPrice(p.entryPrice, spec.tickSize)}</td>
                <td data-label="Exit" className="r num">{fmtPrice(avgExitPrice(p), spec.tickSize)}</td>
                <td data-label="Net P&L" className={cx('r num', toneOf(net))}>{fmtMoney(net, { sign: true })}</td>
                <td data-label="R" className={cx('r num', toneOf(r))}>{fmtR(r)}</td>
                <td data-label="Held" className="r num faint">{fmtDuration((p.closedAt ?? 0) - p.openedAt)}</td>
                <td data-label="Reason" className={cx(p.closeReason === 'liquidation' && 'down')}>{REASON[p.closeReason ?? 'manual']}</td>
                <td data-label="Data">
                  <SourceTag source={p.entrySource} compact />
                </td>
                <td className="r">
                  <button
                    className={cx('tbl-note', noted.has(p.id) && 'is-on')}
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/journal/${p.id}`);
                    }}
                    aria-label="Open journal entry"
                    title={noted.has(p.id) ? 'Journal entry' : 'Write a journal entry'}
                  >
                    <Icon name="journal" size={14} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length >= n && (
        <div className="tbl-more">
          <Button size="sm" variant="ghost" onClick={() => setN(n + 200)}>
            Show more
          </Button>
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────── order log ──

export function OrderLog() {
  const activeId = useApp((s) => s.activeId);
  const [n, setN] = useState(300);
  const rows = useLiveQuery(
    () => (activeId ? db.orders.where('[accountId+createdAt]').between([activeId, 0], [activeId, Infinity]).reverse().limit(n).toArray() : []),
    [activeId, n],
  );
  if (!rows) return null;
  if (!rows.length) return <Empty icon="list" title="No orders yet" body="Every order — filled, cancelled or rejected — is recorded here." />;
  return (
    <div className="tbl-wrap">
      <table className="tbl" data-testid="order-log">
        <thead>
          <tr>
            <th>Time</th>
            <th>#</th>
            <th>Instrument</th>
            <th>Action</th>
            <th>Type</th>
            <th className="r">Size</th>
            <th className="r">Price</th>
            <th className="r">Fill</th>
            <th className="r">Fee</th>
            <th>Status</th>
            <th>Data</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => {
            const spec = hub.instrument(o.symbol);
            return (
              <tr key={o.id}>
                <td className="faint num">{fmtDateTime(o.createdAt)}</td>
                <td className="faint num">{o.no}</td>
                <td>{o.symbol.replace('USDT', '')}</td>
                <td className={cx('cap', o.side === 'buy' ? 'up' : 'down')}>
                  {o.side} · {o.intent === 'open' ? 'open' : 'close'}
                </td>
                <td className="cap">{o.closeReason && o.intent === 'close' ? REASON[o.closeReason] : o.type}</td>
                <td className="r num">{fmtQty(o.qty, spec.stepSize)}</td>
                <td className="r num">{o.price != null ? fmtPrice(o.price, spec.tickSize) : 'Market'}</td>
                <td className="r num">{o.fillPrice != null ? fmtPrice(o.fillPrice, spec.tickSize) : '—'}</td>
                <td className="r num faint">{o.fee != null ? fmtMoney(o.fee, { decimals: 4 }) : '—'}</td>
                <td>
                  <span className={cx('tbl-status', `is-${o.status}`)} title={o.rejectReason ?? o.cancelReason ?? undefined}>
                    {o.status}
                  </span>
                  {(o.rejectReason || o.cancelReason) && <span className="tbl-sub faint">{o.rejectReason ?? o.cancelReason}</span>}
                </td>
                <td>{o.source ? <SourceTag source={o.source} compact /> : <span className="faint">—</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length >= n && (
        <div className="tbl-more">
          <Button size="sm" variant="ghost" onClick={() => setN(n + 300)}>
            Show more
          </Button>
        </div>
      )}
    </div>
  );
}

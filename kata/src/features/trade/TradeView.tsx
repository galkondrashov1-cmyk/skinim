import { useEffect } from 'react';
import { useActiveEngine } from '@/store/app';
import { useTicket, useUI, useView } from '@/store/ui';
import { Button, Dialog } from '@/ui/primitives';
import { useIsMobile } from '@/app/hooks';
import { ChartPanel } from '../chart/ChartPanel';
import { Ticket } from '../ticket/Ticket';
import { AccountPanel } from './AccountPanel';
import { BottomPanel, OrdersTable, PositionsTable, HistoryTable } from './BottomPanel';
import { TradeDialogs } from './Dialogs';
import { Watchlist } from './Watchlist';
import { Tabs } from '@/ui/primitives';
import './trade.css';

export function TradeView() {
  const isMobile = useIsMobile();
  useKeyboardShortcuts();
  return (
    <>
      {isMobile ? <MobileTrade /> : <DesktopTrade />}
      <TradeDialogs />
    </>
  );
}

function DesktopTrade() {
  return (
    <div className="tv">
      <aside className="tv-left">
        <Watchlist />
      </aside>
      <div className="tv-center">
        <ChartPanel />
        <BottomPanel />
      </div>
      <aside className="tv-right" aria-label="Order entry">
        <header className="panel-h">
          <span className="label">New order</span>
          <span className="label faint">Paper</span>
        </header>
        <Ticket />
        <AccountPanel />
      </aside>
    </div>
  );
}

function MobileTrade() {
  const pane = useView((s) => s.mobilePane);
  const ticketOpen = useView((s) => s.ticketOpen);
  const engine = useActiveEngine();
  const tab = useUI((s) => s.bottomTab);
  const open = (side: 'long' | 'short') => {
    useTicket.getState().set({ side });
    useView.setState({ ticketOpen: true });
  };
  return (
    <div className="tvm">
      {pane === 'markets' && <Watchlist />}
      {pane === 'chart' && (
        <div className="tvm-chart">
          <ChartPanel />
          <div className="tvm-actions">
            <Button variant="long" size="lg" onClick={() => open('long')} data-testid="m-buy">
              Buy · Long
            </Button>
            <Button variant="short" size="lg" onClick={() => open('short')} data-testid="m-sell">
              Sell · Short
            </Button>
          </div>
        </div>
      )}
      {pane === 'positions' && (
        <div className="tvm-pos">
          <AccountPanel />
          <Tabs
            label="Portfolio"
            className="tvm-tabs"
            value={tab}
            onChange={(bottomTab) => useUI.setState({ bottomTab })}
            tabs={[
              { value: 'positions', label: 'Positions', count: engine?.positions.length },
              { value: 'orders', label: 'Orders', count: engine?.orders.length },
              { value: 'history', label: 'Closed' },
            ]}
          />
          {tab === 'orders' ? <OrdersTable orders={engine?.orders ?? []} /> : tab === 'history' || tab === 'fills' ? <HistoryTable limit={100} /> : <PositionsTable positions={engine?.positions ?? []} />}
        </div>
      )}
      <Dialog open={ticketOpen} onClose={() => useView.setState({ ticketOpen: false })} title="New paper order" width={420}>
        <Ticket onPlaced={() => useView.setState({ ticketOpen: false })} />
      </Dialog>
    </div>
  );
}

/** B / S switch side, M/L/T order type, / opens search. Ignored while typing. */
function useKeyboardShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || t.closest('input, textarea, select, [contenteditable], [role="dialog"]')) return;
      const tk = useTicket.getState();
      switch (e.key.toLowerCase()) {
        case 'b':
          tk.set({ side: 'long' });
          break;
        case 's':
          tk.set({ side: 'short' });
          break;
        case 'm':
          tk.set({ type: 'market' });
          break;
        case 'l':
          tk.set({ type: 'limit' });
          break;
        case 't':
          tk.set({ type: 'stop' });
          break;
        case '/':
          e.preventDefault();
          useView.setState({ dialog: { kind: 'search' } });
          break;
        default:
          return;
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
}

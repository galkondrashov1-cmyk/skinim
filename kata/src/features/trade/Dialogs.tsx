import { useMemo, useState } from 'react';
import { validateProtection } from '@/engine/engine';
import { exitPriceOf, grossPnl, initialRisk } from '@/engine/margin';
import { floorToStep, stepDecimals } from '@/engine/num';
import type { Order, Position } from '@/engine/types';
import { useActiveEngine } from '@/store/app';
import { useInstrument, useQuote } from '@/store/market';
import { actions } from '@/store/runtime';
import { useView } from '@/store/ui';
import { fmtMoney, fmtPrice, fmtQty, fmtR, parseNum, toneOf } from '@/lib/format';
import { Button, cx, Dialog, Field, NumberInput, Segmented, Switch } from '@/ui/primitives';
import { SymbolSearch } from './Watchlist';

export function TradeDialogs() {
  const dialog = useView((s) => s.dialog);
  const engine = useActiveEngine();
  const close = () => useView.setState({ dialog: null });
  if (!dialog) return null;
  if (dialog.kind === 'search') return <SymbolSearch onClose={close} />;
  if (dialog.kind === 'edit-position') {
    const p = engine?.positions.find((x) => x.id === dialog.positionId);
    return p ? <ManagePosition p={p} onClose={close} /> : null;
  }
  if (dialog.kind === 'edit-order') {
    const o = engine?.orders.find((x) => x.id === dialog.orderId);
    return o ? <EditOrder o={o} onClose={close} /> : null;
  }
  return null;
}

function ManagePosition({ p, onClose }: { p: Position; onClose: () => void }) {
  const spec = useInstrument(p.symbol);
  const q = useQuote(p.symbol);
  const engine = useActiveEngine();
  const cfg = engine!.account.config;
  const d = stepDecimals(spec.tickSize);
  const [tab, setTab] = useState<'protect' | 'close'>('protect');
  const [slOn, setSlOn] = useState(p.sl != null);
  const [sl, setSl] = useState(p.sl != null ? p.sl.toFixed(d) : '');
  const [tpOn, setTpOn] = useState(p.tp != null);
  const [tp, setTp] = useState(p.tp != null ? p.tp.toFixed(d) : '');
  const [trailOn, setTrailOn] = useState(p.trail != null);
  const [trail, setTrail] = useState(String(p.trail?.value ?? 1));
  const [frac, setFrac] = useState(0.5);
  const [qtyStr, setQtyStr] = useState(fmtQty(floorToStep(p.qty * 0.5, spec.stepSize), spec.stepSize).replace(/,/g, ''));

  const slV = slOn ? parseNum(sl) : null;
  const tpV = tpOn ? parseNum(tp) : null;
  const err = validateProtection(p, { sl: slV, tp: tpV }, q);
  const r1 = initialRisk(p);
  const exit = q ? exitPriceOf(p.side, q) : null;
  const closeQty = Math.min(p.qty, floorToStep(parseNum(qtyStr) || 0, spec.stepSize));
  const estPnl = exit != null && closeQty > 0 ? grossPnl(p.side, closeQty, p.entryPrice, exit) - closeQty * exit * cfg.takerFee : null;

  const preview = useMemo(() => {
    const at = (x: number | null) => (x != null && Number.isFinite(x) ? grossPnl(p.side, p.qty, p.entryPrice, x) : null);
    return { sl: at(slV), tp: at(tpV) };
  }, [p, slV, tpV]);

  return (
    <Dialog
      open
      onClose={onClose}
      title={
        <>
          {p.symbol} {p.side} <span className="faint num">#{p.no}</span>
        </>
      }
      width={420}
      footer={
        tab === 'protect' ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!!err}
              data-testid="protect-save"
              onClick={() => {
                const r = actions.setProtection(p.id, {
                  sl: slOn ? slV : null,
                  tp: tpOn ? tpV : null,
                  trail: trailOn ? { mode: 'percent', value: parseNum(trail) || 1 } : null,
                });
                if (!r.error) onClose();
              }}
            >
              Save protection
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant={p.side === 'long' ? 'short' : 'long'}
              disabled={!(closeQty > 0)}
              data-testid="partial-close"
              onClick={() => {
                const r = actions.closePosition(p.id, closeQty >= p.qty ? 'all' : closeQty);
                if (!r.error) onClose();
              }}
            >
              Close {fmtQty(closeQty, spec.stepSize)} at market
            </Button>
          </>
        )
      }
    >
      <div className="dlg-grid">
        <Segmented
          label="Action"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'protect', label: 'Stops & targets' },
            { value: 'close', label: 'Close / reduce' },
          ]}
        />
        <dl className="dlg-facts">
          <div>
            <dt className="label">Size</dt>
            <dd className="num">{fmtQty(p.qty, spec.stepSize)}</dd>
          </div>
          <div>
            <dt className="label">Entry</dt>
            <dd className="num">{fmtPrice(p.entryPrice, spec.tickSize)}</dd>
          </div>
          <div>
            <dt className="label">Mark</dt>
            <dd className="num">{fmtPrice(exit, spec.tickSize)}</dd>
          </div>
        </dl>
        {tab === 'protect' ? (
          <>
            <div className="dlg-row">
              <Switch checked={slOn} onChange={setSlOn} label="Stop-loss" id="mp-sl" />
              <label htmlFor="mp-sl" className="label">
                Stop-loss
              </label>
              {slOn && preview.sl != null && (
                <span className={cx('num dlg-hint', toneOf(preview.sl))}>
                  {fmtMoney(preview.sl, { sign: true })}
                  {r1 ? ` · ${fmtR(preview.sl / r1)}` : ''}
                </span>
              )}
            </div>
            {slOn && <NumberInput value={sl} onChange={setSl} step={spec.tickSize} suffix={spec.quote} ariaLabel="Stop-loss price" data-testid="mp-sl-input" />}
            <div className="dlg-row">
              <Switch checked={tpOn} onChange={setTpOn} label="Take-profit" id="mp-tp" />
              <label htmlFor="mp-tp" className="label">
                Take-profit
              </label>
              {tpOn && preview.tp != null && (
                <span className={cx('num dlg-hint', toneOf(preview.tp))}>
                  {fmtMoney(preview.tp, { sign: true })}
                  {r1 ? ` · ${fmtR(preview.tp / r1)}` : ''}
                </span>
              )}
            </div>
            {tpOn && <NumberInput value={tp} onChange={setTp} step={spec.tickSize} suffix={spec.quote} ariaLabel="Take-profit price" data-testid="mp-tp-input" />}
            <div className="dlg-row">
              <Switch checked={trailOn} onChange={setTrailOn} label="Trailing stop" id="mp-trail" />
              <label htmlFor="mp-trail" className="label">
                Trailing stop
              </label>
            </div>
            {trailOn && <NumberInput value={trail} onChange={setTrail} step={0.1} suffix="% trail" ariaLabel="Trailing distance percent" />}
            <div className="dlg-row">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSlOn(true);
                  setSl(p.entryPrice.toFixed(d));
                }}
              >
                Stop to breakeven
              </Button>
            </div>
            {err && <div className="tk-err">{err}</div>}
          </>
        ) : (
          <>
            <div className="dlg-fracs" role="radiogroup" aria-label="Portion to close">
              {[0.25, 0.5, 0.75, 1].map((f) => (
                <button
                  key={f}
                  type="button"
                  role="radio"
                  aria-checked={frac === f}
                  className={cx('tk-lev-i num', frac === f && 'is-on')}
                  onClick={() => {
                    setFrac(f);
                    setQtyStr(fmtQty(f === 1 ? p.qty : floorToStep(p.qty * f, spec.stepSize), spec.stepSize).replace(/,/g, ''));
                  }}
                >
                  {f * 100}%
                </button>
              ))}
            </div>
            <Field label={`Quantity · ${spec.base}`}>
              <NumberInput value={qtyStr} onChange={setQtyStr} step={spec.stepSize} suffix={spec.base} ariaLabel="Quantity to close" data-testid="mp-close-qty" />
            </Field>
            <dl className="tk-sum">
              <div className="tk-row">
                <dt>Est. realized (after fee)</dt>
                <dd className={cx('num', toneOf(estPnl))}>{estPnl != null ? fmtMoney(estPnl, { sign: true }) : '—'}</dd>
              </div>
              <div className="tk-row">
                <dt>Remaining</dt>
                <dd className="num">{fmtQty(Math.max(0, p.qty - closeQty), spec.stepSize)}</dd>
              </div>
            </dl>
          </>
        )}
      </div>
    </Dialog>
  );
}

function EditOrder({ o, onClose }: { o: Order; onClose: () => void }) {
  const spec = useInstrument(o.symbol);
  const d = stepDecimals(spec.tickSize);
  const [price, setPrice] = useState(o.price != null ? o.price.toFixed(d) : '');
  const [qty, setQty] = useState(String(o.qty));
  const [slOn, setSlOn] = useState(o.sl != null);
  const [sl, setSl] = useState(o.sl != null ? o.sl.toFixed(d) : '');
  const [tpOn, setTpOn] = useState(o.tp != null);
  const [tp, setTp] = useState(o.tp != null ? o.tp.toFixed(d) : '');
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      open
      onClose={onClose}
      title={
        <>
          Edit {o.side} {o.type} <span className="faint num">#{o.no}</span>
        </>
      }
      width={380}
      footer={
        <>
          <Button
            variant="danger"
            onClick={() => {
              actions.cancelOrder(o.id);
              onClose();
            }}
          >
            Cancel order
          </Button>
          <span style={{ flex: 1 }} />
          <Button
            variant="primary"
            onClick={() => {
              const r = actions.modifyOrder(o.id, {
                price: parseNum(price),
                qty: floorToStep(parseNum(qty), spec.stepSize),
                sl: slOn ? parseNum(sl) : null,
                tp: tpOn ? parseNum(tp) : null,
              });
              if (r.error) setError(r.error);
              else onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="dlg-grid">
        <Field label={o.type === 'limit' ? 'Limit price' : 'Stop trigger'}>
          <NumberInput value={price} onChange={setPrice} step={spec.tickSize} suffix={spec.quote} ariaLabel="Price" />
        </Field>
        <Field label={`Quantity · ${spec.base}`}>
          <NumberInput value={qty} onChange={setQty} step={spec.stepSize} suffix={spec.base} ariaLabel="Quantity" />
        </Field>
        <div className="dlg-row">
          <Switch checked={slOn} onChange={setSlOn} label="Stop-loss" id="eo-sl" />
          <label htmlFor="eo-sl" className="label">
            Stop-loss on fill
          </label>
        </div>
        {slOn && <NumberInput value={sl} onChange={setSl} step={spec.tickSize} suffix={spec.quote} ariaLabel="Stop-loss" />}
        <div className="dlg-row">
          <Switch checked={tpOn} onChange={setTpOn} label="Take-profit" id="eo-tp" />
          <label htmlFor="eo-tp" className="label">
            Take-profit on fill
          </label>
        </div>
        {tpOn && <NumberInput value={tp} onChange={setTp} step={spec.tickSize} suffix={spec.quote} ariaLabel="Take-profit" />}
        {error && <div className="tk-err">{error}</div>}
      </div>
    </Dialog>
  );
}

import { useMemo, useState } from 'react';
import { stepDecimals } from '@/engine/num';
import { offsetPrice, targetForR } from '@/engine/sizing';
import { useActiveEngine } from '@/store/app';
import { useInstrument, useQuote } from '@/store/market';
import { actions, engineContext } from '@/store/runtime';
import { useTicket, useUI, type SizeMode } from '@/store/ui';
import { fmtMoney, fmtNum, fmtPct, fmtPrice, fmtQty } from '@/lib/format';
import { Button, cx, Dialog, Field, NumberField, NumberInput, Segmented, Switch } from '@/ui/primitives';
import { useMetrics, useSourceOf } from '@/app/hooks';
import { SourceTag } from '@/app/SourceTag';
import { resolveTicket } from './resolve';
import './ticket.css';

const LEVERAGE_STEPS = [1, 2, 3, 5, 10, 20, 50, 100];

export function Ticket({ onPlaced }: { onPlaced?: () => void }) {
  const symbol = useUI((s) => s.symbol);
  const confirmOrders = useUI((s) => s.confirmOrders);
  const spec = useInstrument(symbol);
  const quote = useQuote(symbol);
  const engine = useActiveEngine();
  const metrics = useMetrics();
  const d = useTicket();
  const src = useSourceOf(symbol);
  const [confirming, setConfirming] = useState(false);
  const cfg = engine?.account.config;
  const maxLev = cfg?.maxLeverage ?? 50;

  const r = useMemo(() => resolveTicket(d, { symbol, spec, quote, metrics, engine, ctx: engineContext() }), [d, symbol, spec, quote, metrics, engine]);
  const isLong = d.side === 'long';
  const px = (x: number) => x.toFixed(stepDecimals(spec.tickSize));
  const anchor = r.ref ?? quote?.last ?? null;
  const err = r.issue ?? (r.validation && !r.validation.ok ? r.validation.reason : null);
  const ready = !!r.req && r.validation?.ok === true && !r.issue;

  const submit = () => {
    if (!r.req) return;
    const out = actions.placeOrder(r.req);
    if (!out.error) {
      useTicket.getState().reset();
      onPlaced?.();
    }
  };

  const setSL = (pct: number) => anchor && d.set({ slOn: true, sl: px(offsetPrice(d.side, anchor, pct, 'stop')) });
  const setTP = (rMult: number) => {
    if (!anchor) return;
    if (r.sl != null) d.set({ tpOn: true, tp: px(targetForR(d.side, anchor, r.sl, rMult)) });
    else d.set({ tpOn: true, tp: px(offsetPrice(d.side, anchor, rMult, 'target')) });
  };
  const sizeFraction = (f: number) => {
    if (!metrics || !anchor || !cfg) return;
    const amount = Math.max(0, metrics.available) * f;
    const notional = (amount / (1 / d.leverage + cfg.takerFee)) * 0.999;
    if (d.sizeMode === 'notional') d.set({ size: notional.toFixed(2) });
    else d.set({ sizeMode: 'qty', size: fmtQty(Math.floor(notional / anchor / spec.stepSize) * spec.stepSize, spec.stepSize).replace(/,/g, '') });
  };

  const sizeSuffix = d.sizeMode === 'qty' ? spec.base : d.sizeMode === 'notional' ? spec.quote : '% eq';

  return (
    <form
      className="tk"
      aria-label="Order ticket"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        if (confirmOrders) setConfirming(true);
        else submit();
      }}
    >
      <Segmented
        label="Direction"
        size="lg"
        value={d.side}
        onChange={(side) => d.set({ side })}
        options={[
          { value: 'long', label: 'Buy · Long', tone: 'up' },
          { value: 'short', label: 'Sell · Short', tone: 'down' },
        ]}
      />
      <div className="tk-bidask">
        <button type="button" className="tk-ba" onClick={() => quote && d.set({ type: 'limit', price: px(quote.bid) })} title="Use bid as limit price">
          <span className="label">Bid</span>
          <span className="num down">{fmtPrice(quote?.bid, spec.tickSize)}</span>
        </button>
        <SourceTag source={src.kind} detail={src.detail} />
        <button type="button" className="tk-ba tk-ba--r" onClick={() => quote && d.set({ type: 'limit', price: px(quote.ask) })} title="Use ask as limit price">
          <span className="label">Ask</span>
          <span className="num up">{fmtPrice(quote?.ask, spec.tickSize)}</span>
        </button>
      </div>

      <Segmented
        label="Order type"
        value={d.type}
        onChange={(type) => {
          const patch: Partial<typeof d> = { type };
          if (type !== 'market' && !d.price && quote) patch.price = px(quote.last);
          d.set(patch);
        }}
        options={[
          { value: 'market', label: 'Market' },
          { value: 'limit', label: 'Limit' },
          { value: 'stop', label: 'Stop' },
        ]}
      />

      {d.type !== 'market' && (
        <Field label={d.type === 'limit' ? 'Limit price' : 'Stop trigger'} htmlFor="tk-price" hint={d.type === 'stop' ? 'Fills at market once traded through' : 'Fills at this price or better'}>
          <NumberInput id="tk-price" value={d.price} onChange={(price) => d.set({ price })} step={spec.tickSize} suffix={spec.quote} data-testid="tk-price" />
        </Field>
      )}

      <Field
        label="Size"
        htmlFor="tk-size"
        aside={
          <Segmented<SizeMode>
            label="Size unit"
            size="sm"
            value={d.sizeMode}
            onChange={(sizeMode) => d.set({ sizeMode, size: '' })}
            options={[
              { value: 'qty', label: spec.base, title: 'Quantity in base asset' },
              { value: 'notional', label: spec.quote, title: 'Order value in quote currency' },
              { value: 'risk', label: 'Risk %', title: 'Size from % of equity lost at the stop' },
            ]}
          />
        }
      >
        <NumberInput
          id="tk-size"
          value={d.size}
          onChange={(size) => d.set({ size })}
          step={d.sizeMode === 'qty' ? spec.stepSize : d.sizeMode === 'notional' ? 10 : 0.25}
          suffix={sizeSuffix}
          placeholder={d.sizeMode === 'risk' ? '1.00' : '0'}
          data-testid="tk-size"
        />
        {d.sizeMode !== 'risk' ? (
          <div className="tk-chips">
            {[0.1, 0.25, 0.5, 1].map((f) => (
              <button key={f} type="button" className="tk-chip num" onClick={() => sizeFraction(f)}>
                {f * 100}%
              </button>
            ))}
          </div>
        ) : (
          <div className="tk-chips">
            {[0.25, 0.5, 1, 2].map((p) => (
              <button key={p} type="button" className="tk-chip num" onClick={() => d.set({ size: String(p), slOn: true })}>
                {p}%
              </button>
            ))}
          </div>
        )}
      </Field>

      <Field label={<>Leverage</>} aside={<span className="num tk-lev-v">{d.leverage}×</span>}>
        <div className="tk-lev" role="radiogroup" aria-label="Leverage">
          {LEVERAGE_STEPS.filter((l) => l <= maxLev).map((l) => (
            <button key={l} type="button" role="radio" aria-checked={d.leverage === l} className={cx('tk-lev-i num', d.leverage === l && 'is-on')} onClick={() => d.set({ leverage: l })}>
              {l}×
            </button>
          ))}
        </div>
      </Field>

      <div className="tk-prot">
        <div className="tk-prot-row">
          <Switch checked={d.slOn} onChange={(slOn) => d.set(slOn && !d.sl && anchor ? { slOn, sl: px(offsetPrice(d.side, anchor, 1, 'stop')) } : { slOn })} label="Stop-loss" id="tk-sl-on" />
          <label className="label" htmlFor="tk-sl-on">
            Stop-loss
          </label>
          <span className="tk-prot-sp" />
          {d.slOn && (
            <span className="tk-mini">
              {[0.5, 1, 2].map((p) => (
                <button key={p} type="button" className="tk-chip num" onClick={() => setSL(p)} title={`${p}% from entry`}>
                  −{p}%
                </button>
              ))}
            </span>
          )}
        </div>
        {d.slOn && (
          <NumberInput value={d.sl} onChange={(sl) => d.set({ sl })} step={spec.tickSize} suffix={spec.quote} ariaLabel="Stop-loss price" invalid={!!err && /stop-loss/i.test(err)} data-testid="tk-sl" />
        )}
        <div className="tk-prot-row">
          <Switch checked={d.tpOn} onChange={(tpOn) => (tpOn && !d.tp && anchor ? setTP(2) : d.set({ tpOn }))} label="Take-profit" id="tk-tp-on" />
          <label className="label" htmlFor="tk-tp-on">
            Take-profit
          </label>
          <span className="tk-prot-sp" />
          {d.tpOn && (
            <span className="tk-mini">
              {[1, 2, 3].map((m) => (
                <button key={m} type="button" className="tk-chip num" onClick={() => setTP(m)} title={r.sl != null ? `${m}× the stop distance` : `${m}% from entry`}>
                  {r.sl != null ? `${m}R` : `+${m}%`}
                </button>
              ))}
            </span>
          )}
        </div>
        {d.tpOn && (
          <NumberInput
            value={d.tp}
            onChange={(tp) => d.set({ tp })}
            step={spec.tickSize}
            suffix={spec.quote}
            ariaLabel="Take-profit price"
            invalid={!!err && /take-profit/i.test(err)}
            data-testid="tk-tp"
          />
        )}
        <div className="tk-prot-row">
          <Switch checked={d.trailOn} onChange={(trailOn) => d.set({ trailOn })} label="Trailing stop" id="tk-trail-on" />
          <label className="label" htmlFor="tk-trail-on">
            Trailing stop
          </label>
        </div>
        {d.trailOn && (
          <NumberField
            value={d.trail.value}
            onChange={(v) => d.set({ trail: { mode: 'percent', value: v ?? 0 } })}
            step={0.1}
            suffix="% trail"
            ariaLabel="Trailing distance in percent"
          />
        )}
      </div>

      <dl className="tk-sum">
        <Row k="Est. entry" v={fmtPrice(r.ref, spec.tickSize)} />
        <Row k="Quantity" v={r.qty ? `${fmtQty(r.qty, spec.stepSize)} ${spec.base}` : '—'} />
        <Row k="Order value" v={r.qty ? fmtMoney(r.notional) : '—'} />
        <Row k="Margin" v={r.qty ? fmtMoney(r.margin) : '—'} />
        <Row k="Est. fee" v={r.qty ? fmtMoney(r.fee, { decimals: 4 }) : '—'} hint={cfg ? `${fmtPct(cfg.takerFee * 100, { decimals: 3 })} taker` : undefined} />
        <Row k="Liquidation" v={r.qty ? (r.liq != null ? fmtPrice(r.liq, spec.tickSize) : 'None') : '—'} tone="liq" />
        <Row k="Risk at stop" v={r.risk != null ? `${fmtMoney(-r.risk, { sign: true })}` : '—'} sub={r.riskPct != null ? fmtPct(r.riskPct) : undefined} tone={r.risk != null ? 'down' : ''} />
        <Row k="Reward at target" v={r.reward != null ? fmtMoney(r.reward, { sign: true }) : '—'} tone={r.reward != null ? 'up' : ''} />
        <Row k="Reward : risk" v={r.rr != null ? `${fmtNum(r.rr, 2)} : 1` : '—'} />
      </dl>

      {err && (r.req !== null || r.issue) && (
        <div className="tk-err" role="alert" data-testid="tk-error">
          {err}
        </div>
      )}

      <Button type="submit" variant={isLong ? 'long' : 'short'} size="lg" block disabled={!ready} data-testid="tk-submit">
        {isLong ? 'Buy' : 'Sell'} {r.qty ? `${fmtQty(r.qty, spec.stepSize)} ${spec.base}` : spec.base} · {d.type === 'market' ? 'Market' : d.type === 'limit' ? 'Limit' : 'Stop'}
      </Button>
      <p className="tk-fine">
        Paper order · fills against the {isLong ? 'ask' : 'bid'}
        {cfg && cfg.slippageBps > 0 ? ` + ${cfg.slippageBps}bp slippage` : ''}. Alt-click the chart to set a price.
      </p>

      {confirming && r.req && (
        <Dialog
          open
          onClose={() => setConfirming(false)}
          title="Confirm paper order"
          width={360}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button
                variant={isLong ? 'long' : 'short'}
                data-autofocus
                onClick={() => {
                  setConfirming(false);
                  submit();
                }}
              >
                Place order
              </Button>
            </>
          }
        >
          <dl className="tk-sum">
            <Row k="Instrument" v={symbol} />
            <Row k="Side" v={`${isLong ? 'Buy · Long' : 'Sell · Short'}`} />
            <Row k="Type" v={d.type} />
            {r.price != null && <Row k="Price" v={fmtPrice(r.price, spec.tickSize)} />}
            <Row k="Quantity" v={`${fmtQty(r.qty, spec.stepSize)} ${spec.base}`} />
            <Row k="Leverage" v={`${d.leverage}×`} />
            <Row k="Stop / Target" v={`${fmtPrice(r.sl, spec.tickSize)} / ${fmtPrice(r.tp, spec.tickSize)}`} />
          </dl>
        </Dialog>
      )}
    </form>
  );
}

function Row({ k, v, sub, tone, hint }: { k: string; v: string; sub?: string; tone?: string; hint?: string }) {
  return (
    <div className="tk-row" title={hint}>
      <dt>{k}</dt>
      <dd className={cx('num', tone)}>
        {v}
        {sub && <span className="tk-row-sub">{sub}</span>}
      </dd>
    </div>
  );
}


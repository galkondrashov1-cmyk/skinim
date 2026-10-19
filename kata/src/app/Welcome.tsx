import { useState } from 'react';
import { Mark, Wordmark } from '@/brand/Brand';
import { actions } from '@/store/runtime';
import { Button, cx, Field, TextInput } from '@/ui/primitives';
import { parseNum } from '@/lib/format';
import { SourceTag } from './SourceTag';
import './welcome.css';

const PRESETS = [10_000, 25_000, 100_000, 1_000_000];

export function Welcome() {
  const [name, setName] = useState('Main');
  const [capital, setCapital] = useState(100_000);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const amount = custom ? parseNum(custom) : capital;
  const valid = Number.isFinite(amount) && amount >= 100 && amount <= 1e9 && name.trim().length > 0;

  return (
    <div className="welcome">
      <div className="welcome-inner">
        <section className="welcome-intro">
          <div className="welcome-lockup">
            <Mark size={40} />
            <Wordmark height={16} />
          </div>
          <h1>Rehearse every trade.</h1>
          <p>
            Kata is a paper-trading terminal on real market prices. Size positions, set stops and targets on the chart,
            use leverage, and review every result. The money is simulated, and nothing is ever sent to an exchange.
          </p>
          <dl className="welcome-legend">
            <div>
              <dt>
                <SourceTag source="live" />
              </dt>
              <dd>Real-time prices streamed from Binance.</dd>
            </div>
            <div>
              <dt>
                <SourceTag source="delayed" />
              </dt>
              <dd>Real prices that are arriving late or by polling. The delay is always shown.</dd>
            </div>
            <div>
              <dt>
                <SourceTag source="simulated" />
              </dt>
              <dd>Synthetic Kata Sim instruments for offline practice. These are never market data.</dd>
            </div>
          </dl>
        </section>

        <form
          className="welcome-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!valid || busy) return;
            setBusy(true);
            await actions.createAccount(name.trim(), amount);
          }}
        >
          <div className="label">Open a paper account</div>
          <Field label="Account name" htmlFor="acct-name">
            <TextInput id="acct-name" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Starting capital · USDT" hint="You can reset or open more accounts at any time.">
            <div className="welcome-presets" role="radiogroup" aria-label="Starting capital">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={!custom && capital === p}
                  className={cx('welcome-preset num', !custom && capital === p && 'is-on')}
                  onClick={() => {
                    setCustom('');
                    setCapital(p);
                  }}
                >
                  {p >= 1_000_000 ? `${p / 1_000_000}M` : `${p / 1000}K`}
                </button>
              ))}
              <TextInput
                className="num welcome-custom"
                placeholder="Custom"
                inputMode="decimal"
                aria-label="Custom capital"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
              />
            </div>
          </Field>
          <Button type="submit" variant="primary" size="lg" block disabled={!valid || busy} data-testid="open-account">
            {busy ? 'Opening…' : 'Open paper account'}
          </Button>
          <p className="welcome-fine">Simulation only. No real-money orders, no brokerage connection, not investment advice.</p>
        </form>
      </div>
    </div>
  );
}

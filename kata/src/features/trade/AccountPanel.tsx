import { useActiveAccount } from '@/store/app';
import { fmtMoney, fmtNum, fmtPct, toneOf } from '@/lib/format';
import { cx } from '@/ui/primitives';
import { useMetrics } from '@/app/hooks';

export function AccountPanel() {
  const m = useMetrics();
  const a = useActiveAccount();
  if (!m || !a) return null;
  const rules = a.config.risk;
  const dailyLimit = rules.dailyLossLimitPct != null ? (rules.dailyLossLimitPct / 100) * a.dayStartEquity : null;
  const dailyUse = dailyLimit ? Math.max(0, -m.dayPnl) / dailyLimit : 0;
  const ddUse = rules.maxDrawdownPct ? m.drawdownPct / rules.maxDrawdownPct : 0;

  return (
    <section className="ap" aria-label="Account">
      <header className="panel-h">
        <span className="label">Account · {a.name}</span>
        <span className="label faint">USDT</span>
      </header>
      <div className="ap-body">
        <div className="ap-eq">
          <span className="label">Equity</span>
          <span className="num ap-eq-v" data-testid="ap-equity">
            {fmtMoney(m.equity)}
          </span>
          <span className={cx('num ap-eq-sub', toneOf(m.equity - a.initialBalance))}>
            {fmtMoney(m.equity - a.initialBalance, { sign: true })} · {fmtPct(((m.equity - a.initialBalance) / a.initialBalance) * 100, { sign: true })} all time
          </span>
        </div>
        <dl className="ap-grid">
          <Cell k="Balance" v={fmtMoney(m.balance)} testId="ap-balance" />
          <Cell k="Unrealized" v={fmtMoney(m.unrealizedPnl, { sign: true })} tone={toneOf(m.unrealizedPnl)} />
          <Cell k="Available" v={fmtMoney(Math.max(0, m.available))} />
          <Cell k="Margin used" v={fmtMoney(m.positionMargin + m.orderMargin)} />
          <Cell k="Exposure" v={fmtMoney(m.grossExposure)} hint="Gross notional of open positions" />
          <Cell k="Net exposure" v={fmtMoney(m.netExposure, { sign: true })} hint="Long minus short notional" />
          <Cell k="Eff. leverage" v={`${fmtNum(m.effectiveLeverage, 2)}×`} hint="Gross exposure ÷ equity" />
          <Cell k="Open risk" v={fmtMoney(m.openRisk)} hint="Loss vs entry if every stop is hit; unprotected positions count their full margin" />
        </dl>
        <Meter
          label="Daily loss"
          value={`${fmtMoney(Math.min(0, m.dayPnl))}`}
          limit={dailyLimit != null ? `limit ${fmtMoney(-dailyLimit)}` : 'no limit'}
          use={dailyUse}
        />
        <Meter label="Drawdown" value={fmtPct(m.drawdownPct)} limit={rules.maxDrawdownPct != null ? `max ${rules.maxDrawdownPct}%` : 'no limit'} use={ddUse} />
      </div>
    </section>
  );
}

function Cell({ k, v, tone, hint, testId }: { k: string; v: string; tone?: string; hint?: string; testId?: string }) {
  return (
    <div className="ap-cell" title={hint}>
      <dt className="label">{k}</dt>
      <dd className={cx('num', tone)} data-testid={testId}>
        {v}
      </dd>
    </div>
  );
}

function Meter({ label, value, limit, use }: { label: string; value: string; limit: string; use: number }) {
  const pct = Math.min(1, Math.max(0, use));
  return (
    <div className="ap-meter">
      <div className="ap-meter-h">
        <span className="label">{label}</span>
        <span className="num">
          {value} <span className="faint">/ {limit}</span>
        </span>
      </div>
      <div className="ap-meter-bar" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 100)}>
        <i style={{ width: `${pct * 100}%` }} className={cx(pct > 0.8 && 'is-hot', pct > 0.5 && pct <= 0.8 && 'is-warm')} />
        <span className="ap-meter-tick" style={{ left: '50%' }} />
        <span className="ap-meter-tick" style={{ left: '80%' }} />
      </div>
    </div>
  );
}

import { useEffect, useState, type ReactNode } from 'react';
import { Lockup } from '@/brand/Brand';
import { db, exportAccount } from '@/db/db';
import { DEFAULT_CONFIG } from '@/engine/engine';
import type { Account, AccountConfig } from '@/engine/types';
import { REST_HOSTS, WS_HOSTS } from '@/market/binance';
import { useActiveAccount, useApp } from '@/store/app';
import { actions } from '@/store/runtime';
import { useUI, type Palette, type Theme } from '@/store/ui';
import { fmtDateTime, fmtMoney, parseNum } from '@/lib/format';
import { Button, cx, Dialog, Field, NumberField, NumberInput, Segmented, Switch, TextInput } from '@/ui/primitives';
import { navigate, useRoute } from '@/app/router';
import { InstallDialog } from '@/app/InstallDialog';
import { useInstallState } from '@/app/install';
import { applyUpdate } from '@/app/sw';
import { SourceTag } from '@/app/SourceTag';
import { useIsMobile } from '@/app/hooks';
import './settings.css';

const SECTIONS = [
  { id: 'accounts', label: 'Accounts' },
  { id: 'risk', label: 'Risk rules' },
  { id: 'costs', label: 'Costs & execution' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'data', label: 'Market data & storage' },
  { id: 'about', label: 'About Kata' },
] as const;

export default function SettingsView() {
  const route = useRoute();
  const section = SECTIONS.find((s) => s.id === route.param)?.id ?? 'accounts';
  const isMobile = useIsMobile();
  return (
    <div className="sv">
      <nav className="sv-nav" aria-label="Settings sections">
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#/settings/${s.id}`} className={cx('sv-link', section === s.id && 'is-on')} aria-current={section === s.id ? 'page' : undefined}>
            {s.label}
          </a>
        ))}
      </nav>
      <div className="sv-body">
        {isMobile && <h1 className="sv-title">{SECTIONS.find((s) => s.id === section)?.label}</h1>}
        {section === 'accounts' && <Accounts openNew={route.query.get('new') === '1'} />}
        {section === 'risk' && <Risk />}
        {section === 'costs' && <Costs />}
        {section === 'appearance' && <Appearance />}
        {section === 'data' && <DataSection />}
        {section === 'about' && <About />}
      </div>
    </div>
  );
}

function Block({ title, desc, children }: { title: string; desc?: ReactNode; children: ReactNode }) {
  return (
    <section className="sv-block">
      <header>
        <h2>{title}</h2>
        {desc && <p>{desc}</p>}
      </header>
      <div className="sv-block-body">{children}</div>
    </section>
  );
}

function Row({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="sv-row">
      <div className="sv-row-l">
        <label htmlFor={htmlFor}>{label}</label>
        {hint && <span>{hint}</span>}
      </div>
      <div className="sv-row-c">{children}</div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────── accounts ──

function Accounts({ openNew }: { openNew: boolean }) {
  const accounts = useApp((s) => s.accounts);
  const activeId = useApp((s) => s.activeId);
  const [creating, setCreating] = useState(openNew);
  const [confirm, setConfirm] = useState<null | { kind: 'reset' | 'delete'; a: Account }>(null);
  const [renaming, setRenaming] = useState<Account | null>(null);
  useEffect(() => setCreating(openNew), [openNew]);
  return (
    <>
      <Block title="Paper accounts" desc="Each account has its own capital, risk rules, history and journal. Everything is stored on this device.">
        <ul className="sv-accts">
          {accounts.map((a) => (
            <li key={a.id} className={cx('sv-acct', a.id === activeId && 'is-on')}>
              <div className="sv-acct-main">
                <span className="sv-acct-name">
                  {a.name}
                  {a.id === activeId && <span className="label">Active</span>}
                </span>
                <span className="faint num">
                  Balance {fmtMoney(a.balance)} · started {fmtMoney(a.initialBalance)} · opened {fmtDateTime(a.createdAt)}
                </span>
              </div>
              <div className="sv-acct-acts">
                {a.id !== activeId && (
                  <Button size="sm" variant="secondary" onClick={() => actions.switchAccount(a.id)}>
                    Switch
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setRenaming(a)}>
                  Rename
                </Button>
                <Button size="sm" variant="ghost" icon="download" onClick={() => download(a)}>
                  Export
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirm({ kind: 'reset', a })}>
                  Reset
                </Button>
                <Button size="sm" variant="danger" onClick={() => setConfirm({ kind: 'delete', a })}>
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
        <Button icon="plus" onClick={() => setCreating(true)} data-testid="new-account">
          New paper account
        </Button>
      </Block>
      {creating && (
        <NewAccount
          onClose={() => {
            setCreating(false);
            if (openNew) navigate('/settings/accounts', { replace: true });
          }}
        />
      )}
      {renaming && <Rename a={renaming} onClose={() => setRenaming(null)} />}
      {confirm && (
        <Dialog
          open
          onClose={() => setConfirm(null)}
          title={confirm.kind === 'reset' ? `Reset ${confirm.a.name}?` : `Delete ${confirm.a.name}?`}
          width={380}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                data-testid="confirm-danger"
                onClick={async () => {
                  const c = confirm;
                  setConfirm(null);
                  if (c.kind === 'reset') await actions.resetAccount(c.a.id);
                  else await actions.deleteAccount(c.a.id);
                }}
              >
                {confirm.kind === 'reset' ? 'Reset account' : 'Delete forever'}
              </Button>
            </>
          }
        >
          <p className="dlg-p">
            {confirm.kind === 'reset'
              ? `All positions, orders, trades and journal entries are erased and the balance returns to ${fmtMoney(confirm.a.initialBalance)} USDT. Settings are kept.`
              : 'The account and its entire history are erased from this device. Export first if you want a copy.'}
          </p>
        </Dialog>
      )}
    </>
  );
}

async function download(a: Account) {
  const data = await exportAccount(a.id);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `kata-${a.name.toLowerCase().replace(/\W+/g, '-')}-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function NewAccount({ onClose }: { onClose: () => void }) {
  const active = useActiveAccount();
  const [name, setName] = useState('');
  const [cap, setCap] = useState('10000');
  const amount = parseNum(cap);
  const ok = name.trim() && amount >= 100 && amount <= 1e9;
  return (
    <Dialog
      open
      onClose={onClose}
      title="New paper account"
      width={380}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!ok}
            onClick={async () => {
              await actions.createAccount(name.trim(), amount, structuredClone(active?.config ?? DEFAULT_CONFIG));
              onClose();
            }}
            data-testid="create-account"
          >
            Create
          </Button>
        </>
      }
    >
      <div className="dlg-grid">
        <Field label="Name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Scalping" maxLength={32} data-autofocus />
        </Field>
        <Field label="Starting capital · USDT" hint="Between 100 and 1,000,000,000">
          <NumberInput value={cap} onChange={setCap} step={1000} suffix="USDT" ariaLabel="Starting capital" />
        </Field>
      </div>
    </Dialog>
  );
}

function Rename({ a, onClose }: { a: Account; onClose: () => void }) {
  const [name, setName] = useState(a.name);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Rename account"
      width={360}
      footer={
        <Button
          variant="primary"
          disabled={!name.trim()}
          onClick={() => {
            void actions.renameAccount(a.id, name.trim());
            onClose();
          }}
        >
          Save
        </Button>
      }
    >
      <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={32} aria-label="Account name" data-autofocus />
    </Dialog>
  );
}

// ───────────────────────────────────────────────────── config editors ──

function useConfigEditor() {
  const a = useActiveAccount();
  const [cfg, setCfg] = useState<AccountConfig | null>(a?.config ?? null);
  useEffect(() => setCfg(a?.config ?? null), [a?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = !!a && !!cfg && JSON.stringify(cfg) !== JSON.stringify(a.config);
  const save = () => a && cfg && actions.updateConfig(a.id, cfg);
  return { a, cfg, setCfg, dirty, save };
}

function SaveBar({ dirty, onSave, onReset }: { dirty: boolean; onSave: () => void; onReset: () => void }) {
  return (
    <div className="sv-save">
      <Button variant="ghost" disabled={!dirty} onClick={onReset}>
        Discard
      </Button>
      <Button variant="primary" disabled={!dirty} onClick={onSave} data-testid="settings-save">
        Save changes
      </Button>
    </div>
  );
}

function Risk() {
  const { a, cfg, setCfg, dirty, save } = useConfigEditor();
  if (!a || !cfg) return null;
  const r = cfg.risk;
  const set = (patch: Partial<AccountConfig['risk']>) => setCfg({ ...cfg, risk: { ...r, ...patch } });
  const pos = (x: number | null) => (x != null && x > 0 ? x : null);
  return (
    <>
      {a.locked && (
        <Block title="Account locked" desc={a.locked.message}>
          {a.locked.reason === 'drawdown' ? (
            <Button variant="primary" onClick={() => actions.unlock()}>
              I’ve reviewed it — unlock and restart drawdown tracking
            </Button>
          ) : (
            <p className="faint">The daily lock lifts automatically at 00:00 UTC.</p>
          )}
        </Block>
      )}
      <Block title="Discipline rules" desc={`Rules apply to ${a.name}. Leave a limit empty to switch it off.`}>
        <Row label="Daily loss limit" hint="Locks new entries for the rest of the UTC day once equity falls this far below the day’s start.">
          <NumberField allowEmpty value={r.dailyLossLimitPct} onChange={(v) => set({ dailyLossLimitPct: pos(v) })} step={0.5} suffix="% of equity" ariaLabel="Daily loss limit" placeholder="Off" />
        </Row>
        <Row label="Max drawdown" hint="Locks the account when equity falls this far below its peak, until you review it.">
          <NumberField allowEmpty value={r.maxDrawdownPct} onChange={(v) => set({ maxDrawdownPct: pos(v) })} step={1} suffix="% from peak" ariaLabel="Max drawdown" placeholder="Off" />
        </Row>
        <Row label="Max risk per trade" hint="Rejects entries whose loss at the stop (or margin, without a stop) exceeds this share of equity.">
          <NumberField allowEmpty value={r.maxRiskPerTradePct} onChange={(v) => set({ maxRiskPerTradePct: pos(v) })} step={0.25} suffix="% of equity" ariaLabel="Max risk per trade" placeholder="Off" />
        </Row>
        <Row label="Max open positions" hint="Positions plus working entry orders.">
          <NumberField allowEmpty value={r.maxOpenPositions} onChange={(v) => set({ maxOpenPositions: pos(v) == null ? null : Math.max(1, Math.round(v!)) })} step={1} ariaLabel="Max open positions" placeholder="Off" />
        </Row>
        <Row label="Require a stop-loss" hint="Every entry must carry a stop.">
          <Switch checked={r.requireStopLoss} onChange={(v) => set({ requireStopLoss: v })} label="Require a stop-loss" />
        </Row>
        <Row label="Flatten on lock" hint="When a lock engages, close all positions at market instead of only blocking new entries.">
          <Switch checked={r.flattenOnDailyLimit} onChange={(v) => set({ flattenOnDailyLimit: v })} label="Flatten on lock" />
        </Row>
      </Block>
      <SaveBar dirty={dirty} onSave={save} onReset={() => setCfg(a.config)} />
    </>
  );
}

function Costs() {
  const { a, cfg, setCfg, dirty, save } = useConfigEditor();
  if (!a || !cfg) return null;
  const num = (x: number | null) => (x != null && Number.isFinite(x) && x >= 0 ? x : 0);
  return (
    <>
      <Block
        title="Cost model"
        desc="Defaults mirror a typical crypto derivatives venue’s entry tier. Market and stop orders pay taker; resting limits and take-profits pay maker. Funding and borrow costs are not modelled."
      >
        <Row label="Taker fee">
          <NumberField value={+(cfg.takerFee * 100).toFixed(4)} onChange={(v) => setCfg({ ...cfg, takerFee: num(v) / 100 })} step={0.005} suffix="%" ariaLabel="Taker fee percent" />
        </Row>
        <Row label="Maker fee">
          <NumberField value={+(cfg.makerFee * 100).toFixed(4)} onChange={(v) => setCfg({ ...cfg, makerFee: num(v) / 100 })} step={0.005} suffix="%" ariaLabel="Maker fee percent" />
        </Row>
        <Row label="Slippage" hint="Applied against you on market and stop fills, on top of the real bid/ask spread.">
          <NumberField value={cfg.slippageBps} onChange={(v) => setCfg({ ...cfg, slippageBps: num(v) })} step={0.5} suffix="bp" ariaLabel="Slippage in basis points" />
        </Row>
      </Block>
      <Block title="Margin" desc="Isolated margin per position. Liquidation forfeits that position’s margin, never more.">
        <Row label="Maintenance margin" hint="Liquidation triggers when margin + unrealized P&L falls to this share of notional.">
          <NumberField
            value={+(cfg.maintenanceMargin * 100).toFixed(3)}
            onChange={(v) => setCfg({ ...cfg, maintenanceMargin: Math.min(0.5, num(v) / 100) })}
            step={0.1}
            suffix="%"
            ariaLabel="Maintenance margin percent"
          />
        </Row>
        <Row label="Maximum leverage">
          <NumberField value={cfg.maxLeverage} onChange={(v) => setCfg({ ...cfg, maxLeverage: Math.max(1, Math.min(125, Math.round(num(v) || 1))) })} step={1} suffix="×" ariaLabel="Maximum leverage" />
        </Row>
      </Block>
      <SaveBar dirty={dirty} onSave={save} onReset={() => setCfg(a.config)} />
    </>
  );
}

function Appearance() {
  const theme = useUI((s) => s.theme);
  const palette = useUI((s) => s.palette);
  const confirmOrders = useUI((s) => s.confirmOrders);
  const lev = useUI((s) => s.defaultLeverage);
  return (
    <Block title="Appearance & behaviour">
      <Row label="Theme">
        <Segmented<Theme>
          label="Theme"
          value={theme}
          onChange={(t) => useUI.setState({ theme: t })}
          options={[
            { value: 'system', label: 'System' },
            { value: 'dark', label: 'Ink' },
            { value: 'light', label: 'Paper' },
          ]}
        />
      </Row>
      <Row label="Direction colours" hint="Blue/orange replaces green/red everywhere, including charts.">
        <Segmented<Palette>
          label="Direction colours"
          value={palette}
          onChange={(p) => useUI.setState({ palette: p })}
          options={[
            { value: 'standard', label: 'Green / red' },
            { value: 'colorblind', label: 'Blue / orange' },
          ]}
        />
      </Row>
      <Row label="Confirm orders" hint="Show a summary before every order is placed.">
        <Switch checked={confirmOrders} onChange={(v) => useUI.setState({ confirmOrders: v })} label="Confirm orders" />
      </Row>
      <Row label="Default leverage">
        <NumberField value={lev} onChange={(v) => useUI.setState({ defaultLeverage: Math.max(1, Math.min(125, Math.round(v ?? 1) || 1)) })} step={1} suffix="×" ariaLabel="Default leverage" />
      </Row>
      <Row label="Keyboard" hint="B / S side · M / L / T order type · / search instruments · ↑↓ nudge a focused chart level, Enter to commit">
        <span />
      </Row>
    </Block>
  );
}

function DataSection() {
  const status = useApp((s) => s.catchup);
  const [est, setEst] = useState<{ usage?: number; quota?: number; persisted?: boolean } | null>(null);
  useEffect(() => {
    void (async () => {
      const e = await navigator.storage?.estimate?.();
      const persisted = await navigator.storage?.persisted?.();
      setEst({ usage: e?.usage, quota: e?.quota, persisted });
    })();
  }, []);
  return (
    <>
      <Block title="Where prices come from" desc="Kata labels every price with its provenance, everywhere it appears.">
        <dl className="sv-src">
          <div>
            <dt>
              <SourceTag source="live" />
            </dt>
            <dd>
              Binance public spot market data, streamed over WebSocket: best bid/ask, candles and 24h statistics. No account or key is used, and no order ever
              leaves your device. Hosts tried in order: <code>{WS_HOSTS.map((h) => new URL(h.replace('wss', 'https')).host).join(', ')}</code> (stream) and{' '}
              <code>{REST_HOSTS.map((h) => new URL(h).host).join(', ')}</code> (REST).
            </dd>
          </div>
          <div>
            <dt>
              <SourceTag source="delayed" />
            </dt>
            <dd>Real Binance data that is not streaming: the WebSocket is down and Kata is polling every 3 s, or updates are older than 5 s. The age is shown.</dd>
          </div>
          <div>
            <dt>
              <SourceTag source="offline" />
            </dt>
            <dd>No usable price for 30 s. Market orders and manual closes are paused, because nothing is filled against a made-up price.</dd>
          </div>
          <div>
            <dt>
              <SourceTag source="simulated" />
            </dt>
            <dd>Kata Sim instruments (·SIM). A deterministic synthetic price process generated on this device for offline practice. Never market data.</dd>
          </div>
          <div>
            <dt>
              <SourceTag source="replay" />
            </dt>
            <dd>
              Fills reconstructed from real historical candles for the time Kata was closed, so stops, targets and limits behave as if you had stayed online.
              {status.state !== 'idle' && <span className="faint"> Now: {status.detail}</span>}
            </dd>
          </div>
        </dl>
      </Block>
      <Block title="Storage" desc="Accounts, orders, fills, the ledger and the journal live in this browser’s IndexedDB. Clearing site data erases them.">
        <Row label="Used" hint={est?.quota ? `of ${(est.quota / 1e9).toFixed(1)} GB available to this site` : undefined}>
          <span className="num">{est?.usage != null ? `${(est.usage / 1e6).toFixed(2)} MB` : '—'}</span>
        </Row>
        <Row label="Protected from eviction" hint="Ask the browser not to clear Kata’s data under storage pressure.">
          {est?.persisted ? (
            <span className="up">Yes</span>
          ) : (
            <Button
              size="sm"
              onClick={async () => {
                const ok = await navigator.storage?.persist?.();
                setEst((e) => ({ ...e, persisted: !!ok }));
              }}
            >
              Request protection
            </Button>
          )}
        </Row>
        <Row label="Erase everything" hint="Deletes every account and preference on this device.">
          <EraseAll />
        </Row>
      </Block>
    </>
  );
}

function EraseAll() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="danger" onClick={() => setOpen(true)}>
        Erase all data
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Erase all Kata data?"
        width={380}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                await db.delete();
                try {
                  localStorage.removeItem('kata.ui.v1');
                } catch {
                  /* ignore */
                }
                location.replace('/');
              }}
            >
              Erase and restart
            </Button>
          </>
        }
      >
        <p className="dlg-p">Every account, trade, journal entry and setting on this device is permanently deleted.</p>
      </Dialog>
    </>
  );
}

function About() {
  const install = useInstallState();
  const [showInstall, setShowInstall] = useState(false);
  const [update, setUpdate] = useState(false);
  useEffect(() => {
    const on = () => setUpdate(true);
    addEventListener('kata:update', on);
    return () => removeEventListener('kata:update', on);
  }, []);
  return (
    <>
      <Block title="Kata">
        <div className="sv-about">
          <Lockup size={28} />
          <p>
            <b>Rehearse every trade.</b> Kata is a paper-trading terminal: real market prices, simulated money, honest results. It is a training tool, not a
            brokerage, and not investment advice. No real orders are ever placed.
          </p>
          <p className="faint num">Version {__APP_VERSION__}</p>
          <div className="sv-about-acts">
            {install !== 'installed' && install !== 'unsupported' && (
              <Button icon="install" onClick={() => setShowInstall(true)}>
                Install Kata
              </Button>
            )}
            {install === 'installed' && <span className="faint">Installed on this device</span>}
            {update && (
              <Button variant="primary" icon="refresh" onClick={applyUpdate}>
                Reload into the new version
              </Button>
            )}
          </div>
        </div>
      </Block>
      <Block title="Credits">
        <p className="sv-credit">
          Charts are drawn with{' '}
          <a href="https://www.tradingview.com/lightweight-charts/" target="_blank" rel="noreferrer">
            TradingView Lightweight Charts™
          </a>{' '}
          (Apache 2.0) · Market data from Binance’s public API · Typefaces: Barlow, IBM Plex Mono (SIL OFL).
        </p>
      </Block>
      {showInstall && <InstallDialog onClose={() => setShowInstall(false)} />}
    </>
  );
}

import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { db, enqueue, type Emotion, type JournalEntry } from '@/db/db';
import { avgExitPrice, initialRisk, netRealized, rMultiple } from '@/engine/margin';
import type { Position } from '@/engine/types';
import { hub } from '@/market/hub';
import { useApp } from '@/store/app';
import { fmtDateTime, fmtDuration, fmtMoney, fmtPct, fmtPrice, fmtQty, fmtR, toneOf } from '@/lib/format';
import { Button, cx, Empty, Segmented, TextInput } from '@/ui/primitives';
import { Icon } from '@/ui/icons';
import { inspectHref, navigate, useRoute } from '@/app/router';
import { useIsMobile } from '@/app/hooks';
import { SourceTag } from '@/app/SourceTag';
import { ChartCanvas, intervalForDuration } from '../chart/ChartCanvas';
import '../chart/chart.css';
import './journal.css';

type Filter = 'all' | 'wins' | 'losses' | 'open-notes';

const EMOTIONS: Emotion[] = ['calm', 'confident', 'hesitant', 'anxious', 'fomo', 'revenge', 'bored'];
const MISTAKES = ['Chased entry', 'Oversized', 'No stop', 'Moved stop wider', 'Exited early', 'Held a loser', 'Revenge trade', 'Ignored plan'];
const REASON: Record<string, string> = { manual: 'Manual close', sl: 'Stop-loss', tp: 'Take-profit', trail: 'Trailing stop', liquidation: 'Liquidation', risk: 'Risk lock' };

export default function JournalView() {
  const route = useRoute();
  const activeId = useApp((s) => s.activeId);
  const isMobile = useIsMobile();
  const [filter, setFilter] = useState<Filter>('all');
  const [tag, setTag] = useState<string | null>(null);
  const trades = useLiveQuery(
    () => (activeId ? db.positions.where('[accountId+closedAt]').between([activeId, 0], [activeId, Infinity]).reverse().limit(1000).toArray() : []),
    [activeId],
  );
  const entries = useLiveQuery(() => (activeId ? db.journal.where('accountId').equals(activeId).toArray() : []), [activeId]);
  const byId = useMemo(() => new Map((entries ?? []).map((e) => [e.positionId, e])), [entries]);
  const tags = useMemo(() => [...new Set((entries ?? []).flatMap((e) => e.tags))].sort(), [entries]);
  const selectedId = route.param;

  const list = useMemo(() => {
    let xs = trades ?? [];
    if (filter === 'wins') xs = xs.filter((p) => netRealized(p) > 0);
    if (filter === 'losses') xs = xs.filter((p) => netRealized(p) < 0);
    if (filter === 'open-notes') xs = xs.filter((p) => !byId.has(p.id));
    if (tag) xs = xs.filter((p) => byId.get(p.id)?.tags.includes(tag));
    return xs;
  }, [trades, filter, tag, byId]);

  useEffect(() => {
    if (!selectedId && !isMobile && list.length) navigate(`/journal/${list[0].id}`, { replace: true });
  }, [selectedId, isMobile, list]);

  const selected = trades?.find((t) => t.id === selectedId) ?? null;
  // Wait for both queries: the editor seeds its draft from the saved entry exactly once.
  if (!trades || !entries) return null;

  if (!trades.length)
    return (
      <div className="jv-empty">
        <Empty icon="journal" title="Your journal fills itself" body="Every closed trade appears here with its numbers. Add the setup, how you felt, and what you’d do differently." action={<Button onClick={() => navigate('/trade')}>Go trade</Button>} />
      </div>
    );

  const showList = !isMobile || !selected;
  const showDetail = !isMobile || !!selected;

  return (
    <div className="jv">
      {showList && (
        <aside className="jv-list" aria-label="Closed trades">
          <header className="jv-list-h">
            <Segmented
              size="sm"
              label="Filter"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'wins', label: 'Wins' },
                { value: 'losses', label: 'Losses' },
                { value: 'open-notes', label: 'Unwritten' },
              ]}
            />
            {tags.length > 0 && (
              <div className="jv-tags">
                {tags.map((t) => (
                  <button key={t} className={cx('jv-tag', tag === t && 'is-on')} onClick={() => setTag(tag === t ? null : t)}>
                    {t}
                  </button>
                ))}
              </div>
            )}
          </header>
          <ul className="jv-items">
            {list.map((p) => {
              const net = netRealized(p);
              const r = rMultiple(p);
              const e = byId.get(p.id);
              return (
                <li key={p.id}>
                  <a href={`#/journal/${p.id}`} className={cx('jv-item', p.id === selectedId && 'is-on')} data-testid="journal-item">
                    <span className="jv-item-top">
                      <span className="jv-item-sym">
                        <span className={cx('tbl-side', p.side)}>{p.side === 'long' ? 'L' : 'S'}</span>
                        {p.symbol.replace('USDT', '')}
                      </span>
                      <span className={cx('num', toneOf(net))}>{fmtMoney(net, { sign: true })}</span>
                    </span>
                    <span className="jv-item-bot">
                      <span className="faint num">{fmtDateTime(p.closedAt)}</span>
                      <span className={cx('num', toneOf(r))}>{fmtR(r)}</span>
                    </span>
                    {e && (e.setup || e.tags.length > 0) && (
                      <span className="jv-item-note">
                        {e.setup && <b>{e.setup}</b>}
                        {e.tags.map((t) => (
                          <i key={t}>{t}</i>
                        ))}
                      </span>
                    )}
                  </a>
                </li>
              );
            })}
            {list.length === 0 && <Empty title="Nothing matches" body="Try another filter." />}
          </ul>
        </aside>
      )}
      {showDetail && (
        <main className="jv-detail">
          {selected ? <TradeEntry key={selected.id} p={selected} entry={byId.get(selected.id)} setups={[...new Set((entries ?? []).map((e) => e.setup).filter(Boolean))]} /> : <Empty icon="journal" title="Select a trade" />}
        </main>
      )}
    </div>
  );
}

function TradeEntry({ p, entry, setups }: { p: Position; entry: JournalEntry | undefined; setups: string[] }) {
  const spec = hub.instrument(p.symbol);
  const isMobile = useIsMobile();
  const net = netRealized(p);
  const r = rMultiple(p);
  const r1 = initialRisk(p);
  const exit = avgExitPrice(p);
  const [draft, setDraft] = useState<JournalEntry>(
    () =>
      entry ?? {
        positionId: p.id,
        accountId: p.accountId,
        setup: '',
        tags: [],
        notes: '',
        rating: 0,
        emotion: null,
        mistakes: [],
        followedPlan: null,
        updatedAt: 0,
      },
  );
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved'>(entry ? 'saved' : 'idle');
  const first = useRef(true);
  const [tagInput, setTagInput] = useState('');

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setSaved('saving');
    const t = setTimeout(() => {
      const row = { ...draft, updatedAt: Date.now() };
      void enqueue(() => db.journal.put(row)).then(() => setSaved('saved'));
    }, 450);
    return () => clearTimeout(t);
  }, [draft]);

  const set = (patch: Partial<JournalEntry>) => setDraft((d) => ({ ...d, ...patch }));
  const addTag = () => {
    const t = tagInput.trim().toLowerCase().replace(/\s+/g, '-');
    if (t && !draft.tags.includes(t)) set({ tags: [...draft.tags, t] });
    setTagInput('');
  };
  const mfeR = r1 ? (p.mfe * p.initialQty) / r1 : null;
  const maeR = r1 ? -(p.mae * p.initialQty) / r1 : null;

  return (
    <article className="je" aria-label={`Trade #${p.no}`}>
      <header className="je-h">
        {isMobile && (
          <Button size="sm" variant="ghost" icon="back" onClick={() => navigate('/journal')}>
            Trades
          </Button>
        )}
        <div className="je-title">
          <span className={cx('tbl-side', p.side)}>{p.side === 'long' ? 'L' : 'S'}</span>
          <h1>
            {p.symbol} <span className="faint">{p.side}</span> <span className="faint num">#{p.no}</span>
          </h1>
          <SourceTag source={p.entrySource} />
        </div>
        <div className="je-result">
          <span className={cx('num je-net', toneOf(net))}>{fmtMoney(net, { sign: true })}</span>
          <span className={cx('num', toneOf(r))}>{fmtR(r)}</span>
        </div>
        <Button size="sm" variant="secondary" icon="chart" onClick={() => navigate(inspectHref(p.id))} data-testid="journal-inspect">
          Open on chart
        </Button>
      </header>

      <div className="je-chart">
        <ChartCanvas symbol={p.symbol} interval={intervalForDuration((p.closedAt ?? p.openedAt) - p.openedAt)} inspect={p} />
      </div>

      <dl className="je-facts">
        <Fact k="Entry" v={fmtPrice(p.entryPrice, spec.tickSize)} />
        <Fact k="Exit (avg)" v={fmtPrice(exit, spec.tickSize)} />
        <Fact k="Size" v={`${fmtQty(p.initialQty, spec.stepSize)} ${spec.base}`} />
        <Fact k="Leverage" v={`${p.leverage}×`} />
        <Fact k="Gross P&L" v={fmtMoney(p.realizedPnl, { sign: true })} tone={toneOf(p.realizedPnl)} />
        <Fact k="Fees" v={fmtMoney(-(p.entryFee + p.exitFees), { sign: true })} />
        <Fact k="Initial stop" v={fmtPrice(p.initialSl, spec.tickSize)} />
        <Fact k="1R risk" v={r1 ? fmtMoney(r1) : '—'} />
        <Fact k="Best (MFE)" v={mfeR != null ? fmtR(mfeR) : fmtPrice(p.mfe, spec.tickSize)} tone="up" />
        <Fact k="Worst (MAE)" v={maeR != null ? fmtR(maeR) : fmtPrice(p.mae, spec.tickSize)} tone="down" />
        <Fact k="Held" v={fmtDuration((p.closedAt ?? 0) - p.openedAt)} />
        <Fact k="Exit" v={REASON[p.closeReason ?? 'manual']} />
        <Fact k="Opened" v={fmtDateTime(p.openedAt)} />
        <Fact k="Closed" v={fmtDateTime(p.closedAt)} />
        <Fact k="Return on margin" v={fmtPct((net / Math.max(1e-9, (p.initialQty * p.entryPrice) / p.leverage)) * 100, { sign: true })} tone={toneOf(net)} />
        <Fact
          k="Captured of best"
          v={p.mfe * p.initialQty > p.entryFee + p.exitFees ? fmtPct(Math.max(-100, (p.realizedPnl / (p.mfe * p.initialQty)) * 100), { decimals: 0 }) : '—'}
        />
      </dl>

      <section className="je-form" aria-label="Journal entry">
        <div className="je-form-h">
          <span className="label">Journal</span>
          <span className="faint je-saved" aria-live="polite">
            {saved === 'saving' ? 'Saving…' : saved === 'saved' ? 'Saved on this device' : ''}
          </span>
        </div>
        <div className="je-grid">
          <label className="je-f">
            <span className="label">Setup</span>
            <TextInput value={draft.setup} onChange={(e) => set({ setup: e.target.value })} placeholder="e.g. Breakout retest" list="je-setups" data-testid="journal-setup" />
            <datalist id="je-setups">
              {setups.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </label>
          <div className="je-f">
            <span className="label">Tags</span>
            <div className="je-tagbox">
              {draft.tags.map((t) => (
                <button key={t} className="jv-tag is-on" onClick={() => set({ tags: draft.tags.filter((x) => x !== t) })} aria-label={`Remove tag ${t}`}>
                  {t} <Icon name="close" size={10} />
                </button>
              ))}
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    addTag();
                  }
                }}
                onBlur={addTag}
                placeholder={draft.tags.length ? '' : 'Add tag ↵'}
                aria-label="Add tag"
              />
            </div>
          </div>
          <div className="je-f">
            <span className="label">Execution</span>
            <div className="je-rating" role="radiogroup" aria-label="Execution quality">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} role="radio" aria-checked={draft.rating === n} className={cx('je-rate num', draft.rating >= n && 'is-on')} onClick={() => set({ rating: draft.rating === n ? 0 : n })}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div className="je-f">
            <span className="label">Followed the plan</span>
            <Segmented
              size="sm"
              label="Followed the plan"
              value={draft.followedPlan == null ? 'unset' : draft.followedPlan ? 'yes' : 'no'}
              onChange={(v) => set({ followedPlan: v === 'unset' ? null : v === 'yes' })}
              options={[
                { value: 'yes', label: 'Yes' },
                { value: 'no', label: 'No' },
                { value: 'unset', label: '—' },
              ]}
            />
          </div>
          <div className="je-f je-f--wide">
            <span className="label">State of mind</span>
            <div className="je-chips">
              {EMOTIONS.map((e) => (
                <button key={e} className={cx('jv-tag', draft.emotion === e && 'is-on')} onClick={() => set({ emotion: draft.emotion === e ? null : e })}>
                  {e}
                </button>
              ))}
            </div>
          </div>
          <div className="je-f je-f--wide">
            <span className="label">Mistakes</span>
            <div className="je-chips">
              {MISTAKES.map((m) => (
                <button
                  key={m}
                  className={cx('jv-tag', draft.mistakes.includes(m) && 'is-on is-bad')}
                  aria-pressed={draft.mistakes.includes(m)}
                  onClick={() => set({ mistakes: draft.mistakes.includes(m) ? draft.mistakes.filter((x) => x !== m) : [...draft.mistakes, m] })}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          <label className="je-f je-f--wide">
            <span className="label">Notes</span>
            <textarea
              className="k-text"
              rows={6}
              value={draft.notes}
              onChange={(e) => set({ notes: e.target.value })}
              placeholder="Why did you take it? What did the chart show? What would you repeat or change?"
              data-testid="journal-notes"
            />
          </label>
        </div>
      </section>
    </article>
  );
}

function Fact({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="je-fact">
      <dt className="label">{k}</dt>
      <dd className={cx('num', tone)}>{v}</dd>
    </div>
  );
}

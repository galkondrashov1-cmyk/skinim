import Dexie, { type Table } from 'dexie';
import type { Account, EngineEvent, Fill, LedgerEntry, Order, Position } from '@/engine/types';

export interface EquityPoint {
  accountId: string;
  ts: number;
  equity: number;
  balance: number;
}

export type Emotion = 'calm' | 'confident' | 'hesitant' | 'anxious' | 'fomo' | 'revenge' | 'bored';

export interface JournalEntry {
  positionId: string;
  accountId: string;
  setup: string;
  tags: string[];
  notes: string;
  /** Execution quality 0 (unrated) – 5. */
  rating: number;
  emotion: Emotion | null;
  mistakes: string[];
  /** Whether the trade followed the written plan. */
  followedPlan: boolean | null;
  updatedAt: number;
}

export interface KV {
  key: string;
  value: unknown;
}

class KataDB extends Dexie {
  accounts!: Table<Account, string>;
  orders!: Table<Order, string>;
  positions!: Table<Position, string>;
  fills!: Table<Fill, string>;
  ledger!: Table<LedgerEntry, string>;
  equity!: Table<EquityPoint, [string, number]>;
  journal!: Table<JournalEntry, string>;
  kv!: Table<KV, string>;

  constructor(name = 'kata') {
    super(name);
    this.version(1).stores({
      accounts: 'id, createdAt',
      orders: 'id, accountId, [accountId+status], [accountId+createdAt], positionId',
      positions: 'id, accountId, [accountId+status], [accountId+closedAt], [accountId+openedAt]',
      fills: 'id, accountId, positionId, [accountId+ts]',
      ledger: 'id, accountId, [accountId+ts]',
      equity: '[accountId+ts], accountId',
      journal: 'positionId, accountId, *tags, updatedAt',
      kv: 'key',
    });
  }
}

export const db = new KataDB();

let queue: Promise<unknown> = Promise.resolve();

/** Serialise all writes so engine events land in the order they happened. */
export function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch((e) => {
    console.error('[kata] write failed', e);
  });
  return next;
}

export function flushWrites(): Promise<unknown> {
  return queue;
}

export function persistEvents(events: readonly EngineEvent[]): Promise<void> {
  const durable = events.filter((e) => e.type !== 'notice');
  if (!durable.length) return Promise.resolve();
  return enqueue(() =>
    db.transaction('rw', [db.accounts, db.orders, db.positions, db.fills, db.ledger], async () => {
      for (const e of durable) {
        switch (e.type) {
          case 'account':
            await db.accounts.put(e.account);
            break;
          case 'order':
            await db.orders.put(e.order);
            break;
          case 'position':
            await db.positions.put(e.position);
            break;
          case 'fill':
            await db.fills.put(e.fill);
            break;
          case 'ledger':
            await db.ledger.put(e.entry);
            break;
        }
      }
    }),
  );
}

export async function kvGet<T>(key: string, fallback: T): Promise<T> {
  try {
    const row = await db.kv.get(key);
    return row ? (row.value as T) : fallback;
  } catch {
    return fallback;
  }
}

export function kvSet(key: string, value: unknown): Promise<unknown> {
  return enqueue(() => db.kv.put({ key, value }));
}

export async function deleteAccountData(accountId: string) {
  await enqueue(() =>
    db.transaction('rw', [db.accounts, db.orders, db.positions, db.fills, db.ledger, db.equity, db.journal], async () => {
      await db.orders.where('accountId').equals(accountId).delete();
      await db.positions.where('accountId').equals(accountId).delete();
      await db.fills.where('accountId').equals(accountId).delete();
      await db.ledger.where('accountId').equals(accountId).delete();
      await db.equity.where('accountId').equals(accountId).delete();
      await db.journal.where('accountId').equals(accountId).delete();
      await db.accounts.delete(accountId);
    }),
  );
}

/** Full export of an account for backup. */
export async function exportAccount(accountId: string) {
  const [account, orders, positions, fills, ledger, equity, journal] = await Promise.all([
    db.accounts.get(accountId),
    db.orders.where('accountId').equals(accountId).toArray(),
    db.positions.where('accountId').equals(accountId).toArray(),
    db.fills.where('accountId').equals(accountId).toArray(),
    db.ledger.where('accountId').equals(accountId).toArray(),
    db.equity.where('accountId').equals(accountId).toArray(),
    db.journal.where('accountId').equals(accountId).toArray(),
  ]);
  return { format: 'kata-account', version: 1, exportedAt: Date.now(), account, orders, positions, fills, ledger, equity, journal };
}

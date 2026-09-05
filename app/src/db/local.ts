/**
 * db/local — IndexedDB 저장소
 *
 * 계정 없이도 앱 전체가 동작해야 한다. Phase 0의 사용성 테스트("5개 등록 3분")는
 * 서버 없이 이 저장소만으로 돌린다.
 */
import { openDB, type IDBPDatabase } from 'idb';
import type { Item, ItemEvent, UserSettings, ISODate } from '../core/types';
import { DEFAULT_SETTINGS } from '../core/types';
import type { Meta, Patch, Repository, Snapshot } from './types';
import { emptyMeta } from './types';

const DB_NAME = 'jettae';
const DB_VERSION = 1;
const ITEMS = 'items';
const EVENTS = 'events';
const KV = 'kv';

interface Schema {
  [ITEMS]: Item;
  [EVENTS]: ItemEvent;
  [KV]: unknown;
}

async function open(): Promise<IDBPDatabase<Schema>> {
  return openDB<Schema>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(ITEMS)) {
        db.createObjectStore(ITEMS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(EVENTS)) {
        const store = db.createObjectStore(EVENTS, { keyPath: 'id' });
        store.createIndex('byItem', 'itemId');
      }
      if (!db.objectStoreNames.contains(KV)) {
        db.createObjectStore(KV);
      }
    },
  });
}

export class LocalRepository implements Repository {
  readonly kind = 'local' as const;
  private db: IDBPDatabase<Schema> | null = null;

  constructor(private readonly today: ISODate) {}

  private async handle(): Promise<IDBPDatabase<Schema>> {
    this.db ??= await open();
    return this.db;
  }

  isOnline(): boolean {
    return true;
  }

  async load(): Promise<Snapshot> {
    const db = await this.handle();
    const [items, events, settings, meta] = await Promise.all([
      db.getAll(ITEMS),
      db.getAll(EVENTS),
      db.get(KV, 'settings') as Promise<UserSettings | undefined>,
      db.get(KV, 'meta') as Promise<Meta | undefined>,
    ]);

    return {
      items: items as Item[],
      events: (events as ItemEvent[]).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)),
      settings: { ...DEFAULT_SETTINGS, ...(settings ?? {}) },
      meta: { ...emptyMeta(this.today), ...(meta ?? {}) },
    };
  }

  async persist(patch: Patch): Promise<void> {
    const db = await this.handle();

    if (patch.items?.length) {
      const tx = db.transaction(ITEMS, 'readwrite');
      await Promise.all(patch.items.map((item) => tx.store.put(item)));
      await tx.done;
    }

    if (patch.removedItemIds?.length) {
      const tx = db.transaction([ITEMS, EVENTS], 'readwrite');
      const events = tx.objectStore(EVENTS);
      const index = events.index('byItem');
      for (const id of patch.removedItemIds) {
        await tx.objectStore(ITEMS).delete(id);
        let cursor = await index.openCursor(id);
        while (cursor) {
          await cursor.delete();
          cursor = await cursor.continue();
        }
      }
      await tx.done;
    }

    if (patch.events?.length) {
      const tx = db.transaction(EVENTS, 'readwrite');
      await Promise.all(patch.events.map((e) => tx.store.put(e)));
      await tx.done;
    }

    if (patch.settings) await db.put(KV, patch.settings, 'settings');

    if (patch.meta) {
      const current = ((await db.get(KV, 'meta')) as Meta | undefined) ?? emptyMeta(this.today);
      await db.put(KV, { ...current, ...patch.meta }, 'meta');
    }
  }

  /** 설정의 '내보내기'. 사용자의 데이터는 언제든 통째로 꺼낼 수 있어야 한다. */
  async exportJSON(): Promise<string> {
    const snapshot = await this.load();
    return JSON.stringify({ app: 'jettae', version: 1, exportedAt: new Date().toISOString(), ...snapshot }, null, 2);
  }

  async clear(): Promise<void> {
    const db = await this.handle();
    const tx = db.transaction([ITEMS, EVENTS, KV], 'readwrite');
    await Promise.all([
      tx.objectStore(ITEMS).clear(),
      tx.objectStore(EVENTS).clear(),
      tx.objectStore(KV).clear(),
    ]);
    await tx.done;
  }
}

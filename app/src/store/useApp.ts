/**
 * store/useApp — 화면과 core를 잇는 유일한 지점
 *
 * core는 순수 함수만 내놓고, 저장소는 저장만 한다. 시각을 읽고, 결과를 저장하고,
 * 이력을 남기는 조립은 전부 여기서 한다.
 */
import { create } from 'zustand';
import {
  applyArchived,
  applyIgnored,
  applyMuted,
  applyRenewed,
  applyReplaced,
  applySnoozed,
  applyStillGood,
  applyUnarchived,
  applyUnmuted,
  createItem,
  nextDueOf,
  withBaseDate,
  withCycleDays,
} from '../core/cycle';
import { addDays, todayIn } from '../core/date';
import {
  applySeasonNotYet,
  applySeasonPause,
  applySeasonResume,
  seasonAction,
} from '../core/season';
import { applyDormantShift, endDormant, markDigestSent, startDormant } from '../core/notify';
import { applyMoveHouse, bulkResetToToday } from '../core/overdue';
import { collectSuggestions, type CycleSuggestion } from '../core/selfCorrect';
import { DEFAULT_SETTINGS } from '../core/types';
import type {
  CatalogItem,
  EventType,
  ISODate,
  Item,
  ItemEvent,
  UserSettings,
  Zone,
} from '../core/types';
import { getRepository, type Meta, type Patch, type Repository } from '../db';
import { emptyMeta } from '../db/types';
import { catalogOf } from './catalog';

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export interface AppState {
  ready: boolean;
  /** 저장소를 읽는 데 실패했다 — 화면은 "저장이 안 됐어요"를 띄운다 */
  loadError: string | null;
  saveError: string | null;
  online: boolean;

  items: Item[];
  events: ItemEvent[];
  settings: UserSettings;
  meta: Meta;
  /** 이 세션이 보는 '오늘'. 자정을 넘기면 갱신된다 */
  today: ISODate;

  init: () => Promise<void>;
  refreshToday: () => void;

  addItems: (
    picks: ReadonlyArray<{ catalog: CatalogItem; cycleDaysOverride?: number; baseDate?: ISODate }>,
  ) => Promise<Item[]>;
  addCustomItem: (input: { name: string; zone: Zone; cycleDays: number }) => Promise<Item | null>;

  markReplaced: (itemId: string, on?: ISODate) => Promise<void>;
  markReplacedMany: (itemIds: readonly string[], on?: ISODate) => Promise<void>;
  markStillGood: (itemId: string) => Promise<void>;
  markSnoozed: (itemId: string) => Promise<void>;
  markIgnored: (itemIds: readonly string[]) => Promise<void>;

  renewItem: (itemId: string) => Promise<void>;
  archiveItem: (itemId: string) => Promise<void>;
  unarchiveItem: (itemId: string) => Promise<void>;
  muteItem: (itemId: string) => Promise<void>;
  unmuteItem: (itemId: string) => Promise<void>;
  removeItem: (itemId: string) => Promise<void>;

  editCycleDays: (itemId: string, cycleDays: number) => Promise<void>;
  editBaseDate: (itemId: string, baseDate: ISODate) => Promise<void>;
  renameItem: (itemId: string, name: string) => Promise<void>;

  resumeSeason: (itemId: string, using: boolean) => Promise<void>;
  sweepSeasons: () => Promise<void>;

  resetOverdue: () => Promise<void>;
  moveHouse: (keptIds: ReadonlySet<string>) => Promise<void>;

  setNotifyAt: (hhmm: string) => Promise<void>;
  setTimezone: (tz: string) => Promise<void>;
  beginDormant: (until: ISODate) => Promise<void>;
  finishDormant: (shift: boolean) => Promise<void>;
  completeOnboarding: () => Promise<void>;
  noteDigestSent: () => Promise<void>;

  suggestions: () => CycleSuggestion[];
  acceptSuggestion: (s: CycleSuggestion) => Promise<void>;
  dismissSuggestion: (itemId: string) => Promise<void>;

  eventsOf: (itemId: string) => ItemEvent[];
  activeItems: () => Item[];
}

let repo: Repository | null = null;
function repository(): Repository {
  repo ??= getRepository();
  return repo;
}

export const useApp = create<AppState>((set, get) => {
  /** 변경을 상태와 저장소에 함께 반영한다. 저장 실패는 화면에 드러낸다. */
  const commit = async (patch: Patch, nextState: Partial<AppState>): Promise<void> => {
    set({ ...nextState, saveError: null });
    try {
      await repository().persist(patch);
      set({ online: repository().isOnline() });
    } catch (e) {
      set({
        saveError: e instanceof Error ? e.message : '저장이 안 됐어요',
        online: false,
      });
    }
  };

  const upsert = (items: Item[], changed: Item[]): Item[] => {
    const map = new Map(items.map((i) => [i.id, i]));
    for (const item of changed) map.set(item.id, item);
    return [...map.values()];
  };

  const touch = (item: Item): Item => ({ ...item, updatedAt: new Date().toISOString() });

  const makeEvent = (itemId: string, type: EventType, on: ISODate): ItemEvent => ({
    id: uuid(),
    itemId,
    type,
    on,
    at: new Date().toISOString(),
  });

  /** 한 품목에 변형을 적용하고 이력을 남기는 공통 경로. */
  const mutate = async (
    itemId: string,
    fn: (item: Item, today: ISODate) => Item,
    eventType: EventType | null,
    eventOn?: ISODate,
  ): Promise<void> => {
    const { items, events, today } = get();
    const target = items.find((i) => i.id === itemId);
    if (!target) return;
    const next = touch(fn(target, today));
    const newEvents = eventType ? [makeEvent(itemId, eventType, eventOn ?? today)] : [];
    await commit(
      { items: [next], events: newEvents },
      { items: upsert(items, [next]), events: [...events, ...newEvents] },
    );
  };

  return {
    ready: false,
    loadError: null,
    saveError: null,
    online: true,
    items: [],
    events: [],
    settings: DEFAULT_SETTINGS,
    meta: emptyMeta(todayIn(DEFAULT_SETTINGS.timezone, new Date())),
    today: todayIn(DEFAULT_SETTINGS.timezone, new Date()),

    async init() {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_SETTINGS.timezone;
      const today = todayIn(tz, new Date());
      try {
        const snapshot = await repository().load();
        set({
          ...snapshot,
          settings: { ...snapshot.settings, timezone: snapshot.settings.timezone || tz },
          today,
          ready: true,
          loadError: null,
          online: repository().isOnline(),
        });
      } catch (e) {
        // 저장소를 못 읽어도 앱은 뜬다. 빈 상태로 시작하고 사실을 알린다.
        set({
          ready: true,
          today,
          loadError: e instanceof Error ? e.message : '저장된 내용을 불러오지 못했어요',
        });
      }
      await get().sweepSeasons();
    },

    refreshToday() {
      const { settings, today } = get();
      const now = todayIn(settings.timezone, new Date());
      if (now !== today) {
        set({ today: now });
        void get().sweepSeasons();
      }
    },

    async addItems(picks) {
      const { items, today } = get();
      const created: Item[] = [];
      // 등록 자체는 이력에 남기지 않는다. item.createdAt이 이미 그 사실이다.
      // 같은 구역의 이름을 누적해가며 번호를 붙인다 — 한 번에 여러 개 담아도 어긋나지 않는다
      const names = new Map<Zone, string[]>();
      for (const item of items) {
        const list = names.get(item.zone) ?? [];
        list.push(item.name);
        names.set(item.zone, list);
      }

      for (const pick of picks) {
        const zoneNames = names.get(pick.catalog.zone) ?? [];
        const item = createItem({
          id: uuid(),
          catalog: pick.catalog,
          baseDate: pick.baseDate ?? today,
          cycleDaysOverride: pick.cycleDaysOverride,
          existingNames: zoneNames,
          now: new Date().toISOString(),
        });
        zoneNames.push(item.name);
        names.set(pick.catalog.zone, zoneNames);
        created.push(item);
      }

      if (created.length === 0) return [];
      await commit({ items: created }, { items: [...items, ...created] });
      return created;
    },

    async addCustomItem(input) {
      const { items, today } = get();
      const zoneNames = items.filter((i) => i.zone === input.zone).map((i) => i.name);
      try {
        const item = createItem({
          id: uuid(),
          catalog: null,
          custom: input,
          baseDate: today,
          existingNames: zoneNames,
          now: new Date().toISOString(),
        });
        await commit({ items: [item] }, { items: [...items, item] });
        return item;
      } catch (e) {
        set({ saveError: e instanceof Error ? e.message : '추가하지 못했어요' });
        return null;
      }
    },

    markReplaced(itemId, on) {
      const today = get().today;
      return mutate(itemId, (item) => applyReplaced(item, on ?? today), 'replaced', on ?? today);
    },

    async markReplacedMany(itemIds, on) {
      const { items, events, today } = get();
      const when = on ?? today;
      const ids = new Set(itemIds);
      const changed = items.filter((i) => ids.has(i.id)).map((i) => touch(applyReplaced(i, when)));
      if (changed.length === 0) return;
      const newEvents = changed.map((i) => makeEvent(i.id, 'replaced', when));
      await commit(
        { items: changed, events: newEvents },
        { items: upsert(items, changed), events: [...events, ...newEvents] },
      );
    },

    markStillGood(itemId) {
      return mutate(itemId, (item, today) => applyStillGood(item, today), 'still_good');
    },

    markSnoozed(itemId) {
      return mutate(itemId, (item) => applySnoozed(item), 'snoozed');
    },

    async markIgnored(itemIds) {
      const { items, events, today } = get();
      const ids = new Set(itemIds);
      const changed = items.filter((i) => ids.has(i.id)).map((i) => touch(applyIgnored(i)));
      if (changed.length === 0) return;
      const newEvents = changed.map((i) => makeEvent(i.id, 'ignored', today));
      await commit(
        { items: changed, events: newEvents },
        { items: upsert(items, changed), events: [...events, ...newEvents] },
      );
    },

    renewItem(itemId) {
      return mutate(
        itemId,
        (item, today) => applyRenewed(item, today, catalogOf(item.catalogCode)?.cycle_days ?? null),
        'renewed',
      );
    },

    archiveItem(itemId) {
      return mutate(itemId, (item) => applyArchived(item), null);
    },

    unarchiveItem(itemId) {
      return mutate(itemId, (item, today) => applyUnarchived(item, today), null);
    },

    muteItem(itemId) {
      return mutate(itemId, (item, today) => applyMuted(item, today), null);
    },

    unmuteItem(itemId) {
      return mutate(itemId, (item, today) => applyUnmuted(item, today), null);
    },

    async removeItem(itemId) {
      const { items, events } = get();
      await commit(
        { removedItemIds: [itemId] },
        {
          items: items.filter((i) => i.id !== itemId),
          events: events.filter((e) => e.itemId !== itemId),
        },
      );
    },

    editCycleDays(itemId, cycleDays) {
      return mutate(itemId, (item) => withCycleDays(item, cycleDays), 'cycle_changed');
    },

    editBaseDate(itemId, baseDate) {
      return mutate(itemId, (item) => withBaseDate(item, baseDate), null);
    },

    renameItem(itemId, name) {
      const trimmed = name.trim();
      if (!trimmed) return Promise.resolve();
      return mutate(itemId, (item) => ({ ...item, name: trimmed }), null);
    },

    resumeSeason(itemId, using) {
      return using
        ? mutate(itemId, (item, today) => applySeasonResume(item, today), 'season_start')
        : mutate(itemId, (item, today) => applySeasonNotYet(item, today), null);
    },

    /**
     * 시즌이 끝난 품목을 멈춘다. 앱을 열 때마다 한 번씩 돌린다.
     * 재개는 사용자가 답해야 하므로 여기서 하지 않는다.
     */
    async sweepSeasons() {
      const { items, today, meta } = get();
      if (meta.seasonSweptOn === today) return;
      const changed = items
        .filter((i) => seasonAction(i, today) === 'pause')
        .map((i) => touch(applySeasonPause(i, today)));
      const nextMeta = { ...meta, seasonSweptOn: today };
      if (changed.length === 0) {
        await commit({ meta: { seasonSweptOn: today } }, { meta: nextMeta });
        return;
      }
      await commit(
        { items: changed, meta: { seasonSweptOn: today } },
        { items: upsert(items, changed), meta: nextMeta },
      );
    },

    async resetOverdue() {
      const { items, events, today } = get();
      const before = new Map(items.map((i) => [i.id, i]));
      const after = bulkResetToToday(items, today);
      const changed = after.filter((i) => before.get(i.id) !== i).map(touch);
      if (changed.length === 0) return;
      const newEvents = changed.map((i) => makeEvent(i.id, 'reset', today));
      await commit(
        { items: changed, events: newEvents },
        { items: upsert(items, changed), events: [...events, ...newEvents] },
      );
    },

    async moveHouse(keptIds) {
      const { items, today } = get();
      const after = applyMoveHouse(items, keptIds, today);
      const changed = after.filter((i, idx) => i !== items[idx]);
      if (changed.length === 0) return;
      await commit({ items: changed }, { items: after });
    },

    async setNotifyAt(hhmm) {
      const settings = { ...get().settings, notifyAt: hhmm };
      await commit({ settings }, { settings });
    },

    async setTimezone(tz) {
      const settings = { ...get().settings, timezone: tz };
      await commit({ settings }, { settings, today: todayIn(tz, new Date()) });
    },

    async beginDormant(until) {
      const { settings, today } = get();
      try {
        const next = startDormant(settings, today, until);
        await commit({ settings: next }, { settings: next });
      } catch (e) {
        set({ saveError: e instanceof Error ? e.message : '휴면을 설정하지 못했어요' });
      }
    },

    /** 복귀 — "자리 비운 만큼 미룰까요?" */
    async finishDormant(shift) {
      const { settings, items, today } = get();
      const from = settings.dormantFrom;
      const next = endDormant(settings);
      if (!shift || !from) {
        await commit({ settings: next }, { settings: next });
        return;
      }
      const shifted = applyDormantShift(items, from, today).map(touch);
      await commit({ settings: next, items: shifted }, { settings: next, items: shifted });
    },

    async completeOnboarding() {
      const settings = { ...get().settings, onboardedAt: new Date().toISOString() };
      await commit({ settings }, { settings });
    },

    async noteDigestSent() {
      const settings = markDigestSent(get().settings, get().today);
      await commit({ settings }, { settings });
    },

    suggestions() {
      const { items, events, meta } = get();
      const byItem = new Map<string, ItemEvent[]>();
      for (const e of events) {
        const list = byItem.get(e.itemId) ?? [];
        list.push(e);
        byItem.set(e.itemId, list);
      }
      const dismissed = new Set(meta.dismissedSuggestions);
      return collectSuggestions(items, byItem).filter((s) => !dismissed.has(s.itemId));
    },

    async acceptSuggestion(s) {
      await get().editCycleDays(s.itemId, s.suggestedCycleDays);
      const { items, meta } = get();
      const item = items.find((i) => i.id === s.itemId);
      if (item) {
        const marked = touch({ ...item, cycleSource: 'auto' as const });
        const nextMeta = {
          ...meta,
          dismissedSuggestions: [...new Set([...meta.dismissedSuggestions, s.itemId])],
        };
        await commit(
          { items: [marked], meta: { dismissedSuggestions: nextMeta.dismissedSuggestions } },
          { items: upsert(items, [marked]), meta: nextMeta },
        );
      }
    },

    async dismissSuggestion(itemId) {
      const { meta } = get();
      const dismissedSuggestions = [...new Set([...meta.dismissedSuggestions, itemId])];
      await commit(
        { meta: { dismissedSuggestions } },
        { meta: { ...meta, dismissedSuggestions } },
      );
    },

    eventsOf(itemId) {
      return get()
        .events.filter((e) => e.itemId === itemId)
        .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    },

    activeItems() {
      return get().items.filter((i) => i.status !== 'archived');
    },
  };
});

/** "쓰던 거예요" — 대략 얼마나 썼는지에서 기준일을 만든다. */
export function baseDateFromUsedSince(today: ISODate, days: number | null): ISODate {
  return days == null ? today : addDays(today, -days);
}

/** 다음 예정일을 화면에서 쓰기 좋게. */
export { nextDueOf };

import type { CatalogItem, Item, ItemEvent, EventType, ISODate, Zone } from '../src/core/types';
import { createItem } from '../src/core/cycle';

export const NOW = '2026-09-05T00:00:00.000Z';

let seq = 0;
export function nextId(prefix = 'id'): string {
  seq += 1;
  return `${prefix}_${seq}`;
}

export function catalogItem(over: Partial<CatalogItem> = {}): CatalogItem {
  return {
    code: 'kit_sponge',
    name: '수세미',
    zone: '주방',
    input_type: 'list',
    metric: 'time',
    cycle_days: 30,
    season: 'all',
    safety_locked: false,
    onboarding_pick: true,
    ...over,
  };
}

/** 기준일과 주기를 바로 지정해 만드는 테스트용 품목. */
export function makeItem(over: Partial<Item> = {}): Item {
  const base = createItem({
    id: over.id ?? nextId('item'),
    catalog: catalogItem(),
    baseDate: '2026-08-06',
    now: NOW,
  });
  return { ...base, ...over };
}

export function event(itemId: string, type: EventType, on: ISODate): ItemEvent {
  return { id: nextId('ev'), itemId, type, on, at: `${on}T12:00:00.000Z` };
}

export const ZONE_KITCHEN: Zone = '주방';

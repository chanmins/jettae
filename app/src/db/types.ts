/**
 * db — 저장 계층의 경계
 *
 * 앱은 저장소가 로컬인지 Supabase인지 알 필요가 없다.
 * 계정 없이 로컬만으로도 앱 전체가 동작하고, Supabase가 붙으면 동기화와 푸시가 켜진다.
 */
import type { ISODate, Item, ItemEvent, UserSettings } from '../core/types';

export interface Meta {
  /** 가입일. 등록 유도 알림의 기준이 된다 */
  joinedOn: ISODate;
  /** 이 기기에서 마지막으로 시즌 전환을 정리한 날 */
  seasonSweptOn: ISODate | null;
  /** 사용자가 수락하거나 물리친 자기교정 제안의 품목 id */
  dismissedSuggestions: string[];
}

export interface Snapshot {
  items: Item[];
  events: ItemEvent[];
  settings: UserSettings;
  meta: Meta;
}

/** 한 번의 변경. 부분 갱신이므로 없는 필드는 건드리지 않는다. */
export interface Patch {
  /** 새로 만들거나 고친 품목 (upsert) */
  items?: Item[];
  /** 영구 삭제할 품목 id. 보관(archived)과는 다르다 */
  removedItemIds?: string[];
  /** 덧붙일 이력 */
  events?: ItemEvent[];
  settings?: UserSettings;
  meta?: Partial<Meta>;
}

export interface Repository {
  readonly kind: 'local' | 'supabase';
  load(): Promise<Snapshot>;
  persist(patch: Patch): Promise<void>;
  /** 이 저장소가 지금 서버와 통하고 있는가. 로컬은 언제나 true */
  isOnline(): boolean;
}

export function emptyMeta(today: ISODate): Meta {
  return { joinedOn: today, seasonSweptOn: null, dismissedSuggestions: [] };
}

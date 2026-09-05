// 이 파일은 생성물이다. 고치지 말 것.
// 원본: app/src/core — `node scripts/sync-core.mjs`로 다시 만든다.
/**
 * core/types — 제때 도메인 타입
 *
 * 이 폴더(core/)의 모든 함수는 부수효과가 없는 순수 함수다.
 * Date.now() · localStorage · fetch · DOM 을 절대 쓰지 않는다.
 * 현재 시각이 필요하면 항상 인자로 받는다(`today: ISODate`).
 *
 * Phase 3에서 Swift · Kotlin으로 이식할 때 tests/ 의 케이스가 그대로 이식 명세가 된다.
 */

/** `YYYY-MM-DD` 형식의 달력 날짜. 시각·시간대 정보를 담지 않는다. */
export type ISODate = string;
/** `YYYY-MM-DDTHH:mm:ss.sssZ` 형식의 UTC 타임스탬프. */
export type ISODateTime = string;

export type Zone = '욕실' | '주방' | '거실' | '침실' | '미용' | '건강' | '세탁' | '전자' | '안전';

export const ZONES: readonly Zone[] = [
  '욕실', '주방', '거실', '침실', '세탁', '미용', '건강', '전자', '안전',
] as const;

/** 온보딩 '집 구역 선택'에 노출하는 구역. 나머지는 전체 목록에서만 만난다. */
export const ONBOARDING_ZONES: readonly Zone[] = ['욕실', '주방', '거실', '침실', '세탁'] as const;

/** `list` = 목록에서 탭 한 번(127종) · `pao` = 개봉일 기준, Period After Opening(32종) */
export type InputType = 'list' | 'pao';

/** `time` = 날짜로 센다 · `usage` = 사용량으로 센다(주행거리 등, Phase 4) */
export type Metric = 'time' | 'usage';

export type Season = 'all' | 'summer' | 'winter';

export interface CatalogItem {
  code: string;
  name: string;
  zone: Zone;
  input_type: InputType;
  metric: Metric;
  cycle_days: number;
  cycle_usage?: number;
  unit?: string;
  season: Season;
  safety_locked: boolean;
  onboarding_pick: boolean;
  note?: string;
}

/**
 * `active`   — 세는 중
 * `paused`   — 시즌 밖이거나 휴면 중. 카운트가 얼어붙는다
 * `archived` — 이제 안 씀. 목록에서 내려간다
 */
export type ItemStatus = 'active' | 'paused' | 'archived';

export type PauseReason = 'season' | 'muted' | null;

/** 주기값의 출처. `auto`는 자기교정 제안을 사용자가 수락한 경우다. */
export type CycleSource = 'catalog' | 'user' | 'auto';

export interface Item {
  id: string;
  /** 카탈로그 품목이면 code, 사용자가 직접 추가한 품목이면 null */
  catalogCode: string | null;
  /** 표시 이름. 같은 구역에 중복 등록되면 `칫솔 2`처럼 번호가 붙는다 */
  name: string;
  zone: Zone;
  inputType: InputType;
  metric: Metric;
  season: Season;
  safetyLocked: boolean;

  /** 현재 적용 중인 주기(일) */
  cycleDays: number;
  cycleSource: CycleSource;
  /** 사용량 기준 품목의 주기(예: 700km) */
  cycleUsage: number | null;
  unit: string | null;

  /** 이 주기가 시작된 날. '바꿨어요'를 누르면 그날로 재설정된다 */
  baseDate: ISODate;
  /** 사용량 기준 품목의 기준 사용량(예: 등록 시 주행거리) */
  baseUsage: number | null;
  /**
   * '아직 멀쩡해요'로 누적 연기된 일수. 기준일은 건드리지 않는다.
   * 다음 예정일 = baseDate + cycleDays + deferDays
   */
  deferDays: number;

  /** 함께 바꾸는 묶음의 개수(가족 칫솔 4개 등) */
  groupCount: number;
  status: ItemStatus;
  pauseReason: PauseReason;
  /** 시즌 밖 진입으로 멈춘 날. 이 날짜 기준으로 D-day를 얼려서 보여준다 */
  pausedAt: ISODate | null;
  /** 시즌 재개를 마지막으로 물어본 날. 아직이요를 누르면 잠시 뒤 다시 묻는다 */
  seasonAskedAt: ISODate | null;

  /** 연속 무시 횟수. 3회가 되면 '계속 알려드릴까요?'를 한 번 묻는다 */
  ignoreStreak: number;
  /** 마지막으로 보낸 알림 단계. 같은 단계를 두 번 보내지 않기 위한 값 */
  lastStage: NotifyStage | null;
  /** lastStage를 기록한 주기의 예정일. 주기가 바뀌면 단계가 초기화된다 */
  lastStageDue: ISODate | null;

  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export type EventType =
  | 'replaced'    // 바꿨어요
  | 'snoozed'     // 아직이요
  | 'still_good'  // 아직 멀쩡해요
  | 'ignored'     // 알림에 응답하지 않음
  | 'season_start'// 시즌 재개 — 쓰기 시작한 날
  | 'reset'       // 밀린 항목 일괄 '지금부터 다시 셀게요'
  | 'renewed'     // 새것으로 바꿨어요 — 이력을 새로 시작
  | 'cycle_changed';

export interface ItemEvent {
  id: string;
  itemId: string;
  type: EventType;
  /** 사건이 일어난 날(달력 기준). 소급 입력이 가능하므로 발생 시각과 다를 수 있다 */
  on: ISODate;
  at: ISODateTime;
  meta?: Record<string, unknown>;
}

/** D-7 · D-DAY · D+3 · D+10 */
export type NotifyStage = 'pre' | 'due' | 'followup' | 'final';

export interface UserSettings {
  /** 알림 발송 시각 `HH:mm`. 기본 저녁 8시 */
  notifyAt: string;
  timezone: string;
  /** 휴면(장기 부재) 종료일. 이 날까지 알림을 보내지 않는다 */
  dormantUntil: ISODate | null;
  /** 휴면 시작일. 복귀 시 '안 쓴 만큼 미룰까요?'의 계산 근거 */
  dormantFrom: ISODate | null;
  /** 온보딩 완료 여부 */
  onboardedAt: ISODateTime | null;
  /** 마지막으로 알림을 보낸 날. 하루 한 건을 지키기 위한 값 */
  lastDigestOn: ISODate | null;
}

export const DEFAULT_SETTINGS: UserSettings = {
  notifyAt: '20:00',
  timezone: 'Asia/Seoul',
  dormantUntil: null,
  dormantFrom: null,
  onboardedAt: null,
  lastDigestOn: null,
};

/** 홈 목록의 상태 3색 */
export type ItemState = 'ok' | 'soon' | 'overdue' | 'paused';

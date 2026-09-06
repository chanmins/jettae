/**
 * core/humanize — 숫자를 사람 말로
 *
 * 문구 원칙: 숫자를 먼저, 어려운 말 안 쓰기.
 * "교체 주기가 도래했습니다"가 아니라 "한 달 됐어요".
 */
import type { ISODate } from './types';
import { diffDays } from './date';

/**
 * 카탈로그에는 두 종류가 섞여 있다. '칫솔'처럼 사서 바꾸는 물건과 '냉장고 청소'
 * 처럼 해야 하는 일이다. 159종 가운데 40종이 후자다.
 *
 * 이 앱의 어휘는 처음부터 교체를 전제했다. 그래서 알림이 "냉장고 청소 바꿀
 * 때예요"로 나갔다 — 뜻이 통하지 않는다. 종류를 갈라 서술어만 달리 쓴다.
 *
 * 카탈로그에 필드를 더하지 않고 이름으로 판정한다. 사용자가 직접 추가한
 * '욕실 환풍기 청소'에도 같은 규칙이 그대로 걸려야 하기 때문이다.
 */
export type ItemKind = 'product' | 'task';

const TASK_SUFFIX = /(청소|세척|점검|제거|테스트|회전|변경|백업|물주기|분갈이)$/;

export function itemKind(name: string): ItemKind {
  return TASK_SUFFIX.test(name.trim()) ? 'task' : 'product';
}

/** "칫솔 바꿀 때예요" · "냉장고 청소 할 때예요" */
export function dueVerb(name: string): string {
  return itemKind(name) === 'task' ? '할 때예요' : '바꿀 때예요';
}

/** 미리 알림의 서술어. */
export function preVerb(name: string): string {
  return itemKind(name) === 'task' ? '할 때가 다가와요' : '바꿀 때가 다가와요';
}

/** 완료 버튼·알림 액션 문구. */
export function doneLabel(name: string): string {
  return itemKind(name) === 'task' ? '했어요' : '바꿨어요';
}

/**
 * 주기(일)를 화면·알림에 쓰는 말로. `30 → 한 달`, `14 → 2주`, `540 → 1.5년`
 *
 * 1년이 넘으면 개월 대신 연 단위로 말한다 — "18개월"보다 "1.5년"이 읽힌다.
 */
export function cycleLabel(days: number): string {
  if (days <= 1) return '매일';
  if (days === 7) return '일주일';
  if (days === 30 || days === 31) return '한 달';

  if (days >= 365) {
    const years = Math.round((days / 365) * 10) / 10;
    return `${years}년`;
  }
  if (days % 30 === 0) return `${days / 30}개월`;
  if (days % 7 === 0) return `${days / 7}주`;
  if (days > 45) return `${Math.round(days / 30)}개월`;
  return `${days}일`;
}

/** 목록 줄에 붙는 "한 달 주기". */
export function cycleSuffix(days: number): string {
  return `${cycleLabel(days)} 주기`;
}

/** 얼마나 지났는지 — "3주 지났어요" · "한 달 됐어요" */
export function elapsedLabel(days: number): string {
  if (days <= 0) return '오늘이에요';
  if (days === 1) return '하루 지났어요';
  if (days < 7) return `${days}일 지났어요`;
  if (days < 30) {
    const w = Math.floor(days / 7);
    return `${w}주 지났어요`;
  }
  if (days < 365) {
    const m = Math.floor(days / 30);
    return `${m}달 지났어요`;
  }
  const y = Math.floor(days / 365);
  return `${y}년 지났어요`;
}

/** 알림 본문의 "한 달 됐어요" — 마지막 교체로부터 흐른 시간을 주기 말로 옮긴다. */
export function sinceLabel(baseDate: ISODate, today: ISODate): string {
  const days = Math.max(0, diffDays(baseDate, today));
  if (days === 0) return '오늘부터예요';
  return `${cycleLabel(days)} 됐어요`;
}

/** 남은 일수를 사람 말로 — "5일 뒤예요" */
export function remainingLabel(days: number): string {
  if (days === 0) return '오늘이에요';
  if (days === 1) return '내일이에요';
  if (days > 0) return `${days}일 뒤예요`;
  return elapsedLabel(-days);
}

/** 여러 이름을 알림 본문 한 줄로 — "수세미, 행주, 침구 세탁" (넘치면 외 n개) */
export function joinNames(names: readonly string[], max = 3): string {
  if (names.length === 0) return '';
  if (names.length <= max) return names.join(', ');
  return `${names.slice(0, max).join(', ')} 외 ${names.length - max}개`;
}

/**
 * 개봉일 기준 품목의 사용기한 버튼 문구 — `365 → 12개월`
 *
 * 제품 뒷면 표기가 `6M · 12M`처럼 개월 단위이므로 여기서는 개월로 말한다.
 * 2년을 넘어가면 개월 수가 읽히지 않아 그때만 연 단위로 바꾼다.
 */
export function paoLabel(days: number): string {
  const months = Math.round(days / 30);
  if (months > 24) return `${Math.round((days / 365) * 10) / 10}년`;
  return `${months}개월`;
}

/**
 * core/humanize — 숫자를 사람 말로
 *
 * 문구 원칙: 숫자를 먼저, 어려운 말 안 쓰기.
 * "교체 주기가 도래했습니다"가 아니라 "한 달 됐어요".
 */
import type { ISODate } from './types';
import { diffDays } from './date';

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

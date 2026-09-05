// 이 파일은 생성물이다. 고치지 말 것.
// 원본: app/src/core — `node scripts/sync-core.mjs`로 다시 만든다.
/**
 * core/date — 달력 날짜 연산
 *
 * 모든 계산을 `YYYY-MM-DD` 문자열 위에서 한다. 시각을 섞지 않으므로
 * 서머타임·시간대 경계에서 하루가 밀리는 사고가 구조적으로 일어나지 않는다.
 * 유일하게 시간대를 아는 함수는 `todayIn()` 하나이며, 그것도 Date를 인자로 받는다.
 */
import type { ISODate } from './types.ts';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isISODate(v: unknown): v is ISODate {
  if (typeof v !== 'string' || !ISO_DATE.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth(y, m);
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

function assertISO(v: ISODate, label = 'date'): void {
  if (!isISODate(v)) throw new RangeError(`${label}: '${v}'는 YYYY-MM-DD 형식이 아니에요`);
}

/** ISO 날짜 → UTC 자정 기준 epoch 밀리초. 내부 계산용. */
function toUTC(iso: ISODate): number {
  assertISO(iso);
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUTC(ms: number): ISODate {
  const dt = new Date(ms);
  const y = String(dt.getUTCFullYear()).padStart(4, '0');
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const DAY_MS = 86_400_000;

/** iso로부터 n일 뒤(음수면 앞). */
export function addDays(iso: ISODate, n: number): ISODate {
  if (!Number.isFinite(n)) throw new RangeError(`addDays: n이 유한수가 아니에요 (${n})`);
  return fromUTC(toUTC(iso) + Math.trunc(n) * DAY_MS);
}

/** to - from (일). 같은 날이면 0, to가 미래면 양수. */
export function diffDays(from: ISODate, to: ISODate): number {
  return Math.round((toUTC(to) - toUTC(from)) / DAY_MS);
}

export function minDate(a: ISODate, b: ISODate): ISODate {
  return toUTC(a) <= toUTC(b) ? a : b;
}

export function maxDate(a: ISODate, b: ISODate): ISODate {
  return toUTC(a) >= toUTC(b) ? a : b;
}

export function compareDate(a: ISODate, b: ISODate): number {
  const d = toUTC(a) - toUTC(b);
  return d === 0 ? 0 : d < 0 ? -1 : 1;
}

/** 1 = 1월. */
export function monthOf(iso: ISODate): number {
  assertISO(iso);
  return Number(iso.slice(5, 7));
}

export function yearOf(iso: ISODate): number {
  assertISO(iso);
  return Number(iso.slice(0, 4));
}

/**
 * 지정한 시간대에서의 '오늘'. core 안에서 현재 시각을 만지는 유일한 지점이고,
 * 그마저도 Date를 인자로 받으므로 순수하다.
 */
export function todayIn(timeZone: string, now: Date): ISODate {
  // en-CA 로케일은 YYYY-MM-DD를 그대로 내준다.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(now);
}

/** 지정한 시간대에서의 현재 `HH:mm`. 알림 발송 슬롯 판정에 쓴다. */
export function clockIn(timeZone: string, now: Date): string {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return fmt.format(now);
}

/** `HH:mm` → 자정으로부터의 분. 형식이 틀리면 null. */
export function minutesOfClock(hhmm: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** `2026.09.08` — 화면에 쓰는 형식. */
export function formatDot(iso: ISODate): string {
  assertISO(iso);
  return iso.replace(/-/g, '.');
}

/** `09.08` — 교체 이력 줄에 쓰는 짧은 형식. */
export function formatShort(iso: ISODate): string {
  assertISO(iso);
  return iso.slice(5).replace('-', '.');
}

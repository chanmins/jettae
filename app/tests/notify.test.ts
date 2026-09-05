import { describe, it, expect } from 'vitest';
import {
  stageFor,
  markStageSent,
  buildDailyDigest,
  nextUpcoming,
  isDispatchSlot,
  applyDormantShift,
  startDormant,
  markDigestSent,
  stageSchedule,
  PRE_MIN_CYCLE_DAYS,
  OVERDUE_COLLAPSE,
} from '../src/core/notify';
import { applySeasonPause } from '../src/core/season';
import { daysRemaining } from '../src/core/cycle';
import { DEFAULT_SETTINGS, type Item, type UserSettings } from '../src/core/types';
import { makeItem } from './helpers';

const settings = (over: Partial<UserSettings> = {}): UserSettings => ({
  ...DEFAULT_SETTINGS,
  ...over,
});

/** 예정일이 정확히 `due`가 되는 품목. */
const dueOn = (due: string, over: Partial<Item> = {}): Item => {
  const cycleDays = over.cycleDays ?? 30;
  const base = makeItem({ cycleDays, deferDays: 0, ...over });
  // baseDate = due - cycleDays
  const d = new Date(`${due}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - cycleDays);
  return { ...base, baseDate: d.toISOString().slice(0, 10) };
};

describe('stageFor', () => {
  const item = dueOn('2026-09-05', { cycleDays: 90 });

  it('D-7 · D-DAY · D+3 · D+10', () => {
    expect(stageFor(item, '2026-08-28')).toBeNull(); // D-8
    expect(stageFor(item, '2026-08-29')).toBe('pre'); // D-7
    expect(stageFor(item, '2026-09-05')).toBe('due');
    expect(stageFor(item, '2026-09-08')).toBe('followup'); // D+3
    expect(stageFor(item, '2026-09-15')).toBe('final'); // D+10
  });

  it('주기가 1개월 미만이면 미리 알림을 건너뛴다 — 2주짜리 D-7 예고는 잔소리다', () => {
    const short = dueOn('2026-09-05', { cycleDays: 14 });
    expect(stageFor(short, '2026-08-29')).toBeNull();
    expect(stageFor(short, '2026-09-05')).toBe('due');
    expect(PRE_MIN_CYCLE_DAYS).toBe(30);
  });

  it('같은 단계를 두 번 보내지 않는다', () => {
    const sent = markStageSent(item, 'due');
    expect(stageFor(sent, '2026-09-05')).toBeNull();
    expect(stageFor(sent, '2026-09-06')).toBeNull();
    expect(stageFor(sent, '2026-09-08')).toBe('followup'); // 다음 단계는 간다
  });

  it('예정일이 바뀌면 단계 기록이 무효가 된다', () => {
    const sent = markStageSent(item, 'due');
    const pushed = { ...sent, deferDays: 9 };
    expect(stageFor(pushed, '2026-09-14')).toBe('due');
  });

  it('마지막 단계 이후로는 조용하다', () => {
    const sent = markStageSent(item, 'final');
    expect(stageFor(sent, '2026-10-05')).toBeNull();
  });

  it('멈췄거나 보관한 품목은 알림 대상이 아니다', () => {
    expect(stageFor({ ...item, status: 'paused' }, '2026-09-05')).toBeNull();
    expect(stageFor({ ...item, status: 'archived' }, '2026-09-05')).toBeNull();
  });
});

describe('buildDailyDigest', () => {
  const ctx = (items: Item[], over: Partial<UserSettings> = {}, today = '2026-09-05') => ({
    items,
    settings: settings(over),
    today,
    joinedOn: '2026-08-01',
  });

  it('단일 D-DAY', () => {
    const sponge = dueOn('2026-09-05', { name: '수세미', cycleDays: 30 });
    const d = buildDailyDigest(ctx([sponge]))!;
    expect(d.kind).toBe('due_single');
    expect(d.title).toBe('수세미 바꿀 때예요');
    expect(d.body).toBe('한 달 됐어요');
    expect(d.actions.map((a) => a.title)).toEqual(['바꿨어요', '아직이요']);
  });

  it('여러 품목은 하나로 묶는다 — 하루 한 건', () => {
    const items = [
      dueOn('2026-09-05', { name: '수세미', cycleDays: 30 }),
      dueOn('2026-09-05', { name: '행주', cycleDays: 30 }),
      dueOn('2026-09-05', { name: '침구 세탁', cycleDays: 14 }),
    ];
    const d = buildDailyDigest(ctx(items))!;
    expect(d.kind).toBe('due_bundle');
    expect(d.title).toBe('오늘 바꿀 것 3개');
    expect(d.body).toBe('수세미, 행주, 침구 세탁');
    expect(d.actions.map((a) => a.title)).toEqual(['다 바꿨어요', '앱에서 볼게요']);
    expect(d.itemIds).toHaveLength(3);
  });

  it('D+3 재알림은 질문을 바꾼다', () => {
    const sponge = markStageSent(dueOn('2026-09-05', { name: '수세미' }), 'due');
    const d = buildDailyDigest(ctx([sponge], {}, '2026-09-08'))!;
    expect(d.kind).toBe('followup');
    expect(d.title).toBe('수세미, 아직 멀쩡한가요?');
    expect(d.actions.map((a) => a.title)).toEqual(['멀쩡해요', '곧 바꿀게요']);
  });

  it('안전 품목은 어투가 다르고 멀쩡해요를 주지 않는다', () => {
    const alarm = dueOn('2026-09-05', {
      name: '화재감지기 건전지',
      cycleDays: 365,
      safetyLocked: true,
    });
    const d = buildDailyDigest(ctx([alarm]))!;
    expect(d.kind).toBe('safety');
    expect(d.title).toBe('화재감지기 건전지, 1년 됐어요');
    expect(d.body).toBe('안전 항목이라 미루지 않는 게 좋아요');

    const followed = markStageSent(alarm, 'due');
    const f = buildDailyDigest(ctx([followed], {}, '2026-09-08'))!;
    expect(f.actions.map((a) => a.title)).toEqual(['바꿨어요', '아직이요']);
  });

  it('미리 알림 — 사러 갈 시간을 준다', () => {
    const pillow = dueOn('2026-09-12', { name: '베개', cycleDays: 365 });
    const d = buildDailyDigest(ctx([pillow]))!;
    expect(d.kind).toBe('pre');
    expect(d.title).toBe('베개 바꿀 때가 다가와요');
  });

  it('밀린 게 폭탄이면 목록 대신 정리 제안 하나', () => {
    const items = Array.from({ length: 12 }, (_, i) =>
      dueOn('2026-08-01', { id: `i${i}`, name: `품목${i}`, cycleDays: 30 }),
    );
    const d = buildDailyDigest(ctx(items, {}, '2026-09-05'))!;
    expect(d.kind).toBe('overdue_many');
    expect(d.title).toBe('밀린 게 12개 있어요');
    expect(d.body).toBe('한 번에 정리해드릴까요?');
    expect(OVERDUE_COLLAPSE).toBe(5);
  });

  it('시즌 재개는 무엇보다 먼저 묻는다', () => {
    const fan = applySeasonPause(
      makeItem({ name: '선풍기 청소', season: 'summer' }),
      '2026-10-01',
    );
    const sponge = dueOn('2027-05-05', { name: '수세미' });
    const d = buildDailyDigest(ctx([fan, sponge], {}, '2027-05-05'))!;
    expect(d.kind).toBe('season_start');
    expect(d.title).toBe('선풍기 청소 꺼내셨어요?');
    expect(d.actions.map((a) => a.title)).toEqual(['쓰고 있어요', '아직이요']);
  });

  it('휴면 중에는 아무것도 보내지 않는다', () => {
    const sponge = dueOn('2026-09-05');
    expect(buildDailyDigest(ctx([sponge], { dormantUntil: '2026-09-20' }))).toBeNull();
    expect(buildDailyDigest(ctx([sponge], { dormantUntil: '2026-09-04' }))).not.toBeNull();
  });

  it('오늘 이미 보냈으면 또 보내지 않는다', () => {
    const sponge = dueOn('2026-09-05');
    expect(buildDailyDigest(ctx([sponge], { lastDigestOn: '2026-09-05' }))).toBeNull();
  });

  it('보낼 게 없으면 null', () => {
    const far = dueOn('2026-12-01', { cycleDays: 365 });
    expect(buildDailyDigest(ctx([far]))).toBeNull();
    expect(buildDailyDigest(ctx([]))).toBeNull();
  });

  it('등록이 적으면 가입 이틀 뒤 한 번 권한다', () => {
    const far = dueOn('2027-01-01', { cycleDays: 365 });
    const d = buildDailyDigest({
      items: [far],
      settings: settings(),
      today: '2026-08-03',
      joinedOn: '2026-08-01',
    })!;
    expect(d.kind).toBe('add_more');
    expect(d.title).toBe('두 개만 더 담아볼까요?');
    expect(d.body).toBe('지금은 1개라 알림이 뜸해요');
  });

  it('등록 0개면 권할 것도 없다 — 그 사용자와의 접점은 빈 홈 화면뿐이다', () => {
    expect(
      buildDailyDigest({
        items: [],
        settings: settings(),
        today: '2026-08-03',
        joinedOn: '2026-08-01',
      }),
    ).toBeNull();
  });
});

describe('발송 슬롯', () => {
  it('사용자가 정한 시각이 지난 5분 격자 안이면 보낸다', () => {
    expect(isDispatchSlot('20:00', '20:00')).toBe(true);
    expect(isDispatchSlot('20:00', '20:04')).toBe(true);
    expect(isDispatchSlot('20:00', '20:05')).toBe(false);
    expect(isDispatchSlot('20:00', '19:59')).toBe(false);
    expect(isDispatchSlot('bad', '20:00')).toBe(false);
  });
});

describe('휴면', () => {
  it('안 쓴 만큼 미룬다', () => {
    const a = dueOn('2026-09-05', { id: 'a' });
    const paused = { ...dueOn('2026-09-05', { id: 'b' }), status: 'paused' as const };
    const [shiftedA, shiftedB] = applyDormantShift([a, paused], '2026-09-01', '2026-09-15');
    expect(daysRemaining(shiftedA, '2026-09-15')).toBe(4); // 예정일이 14일 밀렸다
    expect(shiftedB.deferDays).toBe(0); // 멈춘 것은 건드리지 않는다
  });

  it('종료일이 시작일보다 앞이면 던진다', () => {
    expect(() => startDormant(settings(), '2026-09-10', '2026-09-01')).toThrow(RangeError);
  });

  it('발송 기록', () => {
    expect(markDigestSent(settings(), '2026-09-05').lastDigestOn).toBe('2026-09-05');
  });
});

describe('nextUpcoming / stageSchedule', () => {
  it('가장 가까운 것 — "5일 뒤예요"', () => {
    const a = dueOn('2026-09-10', { id: 'a', name: '침구 세탁' });
    const b = dueOn('2026-12-01', { id: 'b', name: '칫솔' });
    const up = nextUpcoming([a, b], '2026-09-05')!;
    expect(up.item.name).toBe('침구 세탁');
    expect(up.days).toBe(5);
    expect(nextUpcoming([], '2026-09-05')).toBeNull();
  });

  it('단계 일정표', () => {
    const item = dueOn('2026-09-05', { cycleDays: 90 });
    expect(stageSchedule(item)).toEqual([
      { stage: 'pre', on: '2026-08-29' },
      { stage: 'due', on: '2026-09-05' },
      { stage: 'followup', on: '2026-09-08' },
      { stage: 'final', on: '2026-09-15' },
    ]);
    expect(stageSchedule(dueOn('2026-09-05', { cycleDays: 14 }))).toHaveLength(3);
  });
});

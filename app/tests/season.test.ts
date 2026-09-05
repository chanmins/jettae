import { describe, it, expect } from 'vitest';
import {
  isInSeason,
  seasonAction,
  applySeasonPause,
  applySeasonResume,
  applySeasonNotYet,
  itemsAwaitingSeasonStart,
  nextSeasonStart,
  SEASON_REASK_DAYS,
} from '../src/core/season';
import { daysRemaining, nextDueOf } from '../src/core/cycle';
import { makeItem } from './helpers';

describe('isInSeason', () => {
  it('여름은 5~9월, 겨울은 11~3월', () => {
    expect(isInSeason('summer', '2026-05-01')).toBe(true);
    expect(isInSeason('summer', '2026-09-30')).toBe(true);
    expect(isInSeason('summer', '2026-10-01')).toBe(false);
    expect(isInSeason('winter', '2026-12-15')).toBe(true);
    expect(isInSeason('winter', '2027-01-15')).toBe(true);
    expect(isInSeason('winter', '2027-03-31')).toBe(true);
    expect(isInSeason('winter', '2027-04-01')).toBe(false);
    expect(isInSeason('all', '2026-12-15')).toBe(true);
  });
});

describe('시즌 전환', () => {
  const fan = () =>
    makeItem({ name: '선풍기 청소', season: 'summer', cycleDays: 30, baseDate: '2026-09-01' });

  it('시즌이 끝나면 멈춘다', () => {
    expect(seasonAction(fan(), '2026-09-20')).toBe('none');
    expect(seasonAction(fan(), '2026-10-01')).toBe('pause');
  });

  it('12월에는 선풍기 알림이 뜨지 않는다 — 이 앱이 지켜야 하는 선', () => {
    const paused = applySeasonPause(fan(), '2026-10-01');
    expect(paused.status).toBe('paused');
    expect(paused.pauseReason).toBe('season');
    expect(seasonAction(paused, '2026-12-15')).toBe('none');
  });

  it('멈춰 있는 동안 남은 일수가 얼어붙는다', () => {
    const paused = applySeasonPause(fan(), '2026-10-01');
    const frozen = daysRemaining(paused, '2026-10-01');
    expect(daysRemaining(paused, '2027-02-01')).toBe(frozen);
  });

  it('시즌이 시작되면 한 번만 묻는다', () => {
    const paused = applySeasonPause(fan(), '2026-10-01');
    expect(seasonAction(paused, '2027-05-01')).toBe('ask_resume');
  });

  it('네, 쓰고 있어요 — 누른 날이 새 기준일이 된다', () => {
    const paused = applySeasonPause(fan(), '2026-10-01');
    const resumed = applySeasonResume(paused, '2027-05-10');
    expect(resumed.status).toBe('active');
    expect(resumed.baseDate).toBe('2027-05-10');
    expect(nextDueOf(resumed)).toBe('2027-06-09');
    expect(seasonAction(resumed, '2027-05-10')).toBe('none');
  });

  it('아직이요 — 2주 뒤에 다시 묻는다', () => {
    const paused = applySeasonPause(fan(), '2026-10-01');
    const asked = applySeasonNotYet(paused, '2027-05-01');
    expect(seasonAction(asked, '2027-05-10')).toBe('none');
    expect(seasonAction(asked, `2027-05-15`)).toBe('ask_resume');
    expect(SEASON_REASK_DAYS).toBe(14);
  });

  it('사용자가 직접 조용히 보관한 것은 시즌이 건드리지 않는다', () => {
    const muted = makeItem({
      season: 'summer',
      status: 'paused',
      pauseReason: 'muted',
      pausedAt: '2026-09-01',
    });
    expect(seasonAction(muted, '2026-10-01')).toBe('none');
    expect(seasonAction(muted, '2027-05-01')).toBe('none');
  });

  it('사철 품목은 아무 일도 하지 않는다', () => {
    expect(seasonAction(makeItem({ season: 'all' }), '2026-12-15')).toBe('none');
  });

  it('보관한 품목은 대상이 아니다', () => {
    const archived = makeItem({ season: 'summer', status: 'archived' });
    expect(seasonAction(archived, '2026-10-01')).toBe('none');
  });
});

describe('itemsAwaitingSeasonStart / nextSeasonStart', () => {
  it('오늘 물어야 하는 것만 골라낸다', () => {
    const fan = applySeasonPause(
      makeItem({ id: 'fan', name: '선풍기 청소', season: 'summer' }),
      '2026-10-01',
    );
    const mat = applySeasonPause(
      makeItem({ id: 'mat', name: '전기장판 점검', season: 'winter' }),
      '2026-05-01',
    );
    const ids = itemsAwaitingSeasonStart([fan, mat, makeItem({ id: 'sponge' })], '2027-05-05').map(
      (i) => i.id,
    );
    expect(ids).toEqual(['fan']);
  });

  it('다음 시즌 시작일', () => {
    expect(nextSeasonStart('summer', '2026-10-01')).toBe('2027-05-01');
    expect(nextSeasonStart('winter', '2026-06-01')).toBe('2026-11-01');
    expect(nextSeasonStart('summer', '2026-07-01')).toBe('2026-07-01'); // 이미 시즌 안
    expect(nextSeasonStart('all', '2026-07-01')).toBeNull();
  });
});

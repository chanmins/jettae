import { describe, it, expect } from 'vitest';
import raw from '../src/data/catalog.json';
import {
  buildCatalogIndex,
  byGroupThenCycle,
  groupKeyOf,
} from '../src/core/catalog';
import { doneLabel, dueVerb, itemKind, preVerb } from '../src/core/humanize';
import { buildDailyDigest } from '../src/core/notify';
import { DEFAULT_SETTINGS, type CatalogItem, type Item } from '../src/core/types';
import { makeItem } from './helpers';

const items = raw.items as CatalogItem[];
const index = buildCatalogIndex(items);

describe('품목 종류', () => {
  it('이름 끝이 청소·세척·점검이면 할 일이다', () => {
    for (const name of [
      '키친타월 홀더 청소',
      '냉장고 청소',
      '샤워기 헤드 세척',
      '소화기 압력 점검',
      '건조기 먼지 제거',
      '누전차단기 테스트',
      '매트리스 회전',
      '주요 비밀번호 변경',
      '데이터 백업 점검',
      '화분 물주기',
    ]) {
      expect(itemKind(name), name).toBe('task');
    }
  });

  it('사서 바꾸는 물건은 제품이다', () => {
    for (const name of ['칫솔', '수세미', '콘택트렌즈 (원데이)', '렌즈 케이스', '양말']) {
      expect(itemKind(name), name).toBe('product');
    }
  });

  it('직접 추가한 품목도 같은 규칙을 탄다', () => {
    expect(itemKind('욕실 환풍기 청소')).toBe('task');
    expect(itemKind('현관 매트')).toBe('product');
  });

  it('서술어가 종류에 맞게 갈린다', () => {
    expect(dueVerb('칫솔')).toBe('바꿀 때예요');
    expect(dueVerb('냉장고 청소')).toBe('할 때예요');
    expect(preVerb('칫솔')).toBe('바꿀 때가 다가와요');
    expect(preVerb('냉장고 청소')).toBe('할 때가 다가와요');
    expect(doneLabel('칫솔')).toBe('바꿨어요');
    expect(doneLabel('냉장고 청소')).toBe('했어요');
  });
});

describe('알림 문구가 할 일에 맞게 나간다', () => {
  /** 예정일이 정확히 today가 되는 품목. */
  const dueToday = (name: string, cycleDays = 90): Item => {
    const base = makeItem({ name, cycleDays, deferDays: 0 });
    const d = new Date('2026-09-06T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - cycleDays);
    return { ...base, baseDate: d.toISOString().slice(0, 10) };
  };

  const digest = (list: Item[]) =>
    buildDailyDigest({
      items: list,
      settings: DEFAULT_SETTINGS,
      today: '2026-09-06',
      joinedOn: '2026-01-01',
    });

  it('할 일 하나면 "할 때예요"라고 한다', () => {
    const out = digest([dueToday('냉장고 청소')]);
    expect(out?.title).toBe('냉장고 청소 할 때예요');
    expect(out?.actions.map((a) => a.title)).toContain('했어요');
  });

  it('제품 하나면 예전 문구 그대로다', () => {
    const out = digest([dueToday('칫솔')]);
    expect(out?.title).toBe('칫솔 바꿀 때예요');
    expect(out?.actions.map((a) => a.title)).toContain('바꿨어요');
  });

  it('제품만 여러 개면 "오늘 바꿀 것"이다', () => {
    const out = digest([dueToday('칫솔'), dueToday('수세미', 30)]);
    expect(out?.title).toBe('오늘 바꿀 것 2개');
  });

  it('할 일이 섞이면 "오늘 챙길 것"으로 바꾼다', () => {
    const out = digest([dueToday('칫솔'), dueToday('냉장고 청소', 30)]);
    expect(out?.title).toBe('오늘 챙길 것 2개');
    expect(out?.actions.map((a) => a.title)).toContain('다 챙겼어요');
  });
});

describe('묶음 정렬', () => {
  it('같은 묶음은 code 접두어 두 단계가 같다', () => {
    expect(groupKeyOf({ code: 'per_lens_case' } as CatalogItem)).toBe('per_lens');
    expect(groupKeyOf({ code: 'bath_toothbrush' } as CatalogItem)).toBe('bath_toothbrush');
  });

  it('렌즈 묶음이 미용 목록에서 흩어지지 않고 붙어 있다', () => {
    const beauty = index.byZone.get('미용') ?? [];
    const at = beauty
      .map((item, i) => ({ i, key: groupKeyOf(item) }))
      .filter((x) => x.key === 'per_lens')
      .map((x) => x.i);
    expect(at.length).toBe(5);
    // 자리번호가 연속이어야 한다
    expect(at[at.length - 1] - at[0]).toBe(at.length - 1);
  });

  it('모든 구역에서 묶음이 연속으로 붙는다', () => {
    for (const [zone, bucket] of index.byZone) {
      const seen = new Set<string>();
      let prev = '';
      for (const item of bucket) {
        const key = groupKeyOf(item);
        if (key !== prev) {
          // 한 번 끝난 묶음이 다시 나오면 흩어진 것이다
          expect(seen.has(key), `${zone} · ${key}`).toBe(false);
          seen.add(key);
          prev = key;
        }
      }
    }
  });

  it('묶음 안에서는 짧은 주기가 위로 온다', () => {
    const lens = (index.byZone.get('미용') ?? []).filter((i) => groupKeyOf(i) === 'per_lens');
    const cycles = lens.map((i) => i.cycle_days);
    expect([...cycles].sort((a, b) => a - b)).toEqual(cycles);
  });

  it('빈 목록에도 안전하다', () => {
    expect(byGroupThenCycle([])).toEqual([]);
  });
});

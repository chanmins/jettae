import { describe, it, expect } from 'vitest';
import raw from '../src/data/catalog.json';
import { iconByName, itemIcon } from '../src/ui/itemIcon';
import { ZONES, type CatalogItem, type Zone } from '../src/core/types';
import { baseDateForWear, WEAR_OPTIONS } from '../src/core/catalog';

const items = raw.items as CatalogItem[];

describe('품목 그림', () => {
  it('모든 카탈로그 품목이 그림을 받는다', () => {
    for (const item of items) {
      const icon = itemIcon(item);
      expect(icon, item.name).toBeTruthy();
      // 예전 기본값이던 상자는 더 이상 나오지 않는다
      expect(icon, item.name).not.toBe('📦');
    }
  });

  it('모든 품목이 이름 규칙에 걸린다 — 구역 기본값으로 떨어지지 않는다', () => {
    // itemIcon의 결과만 보면 침구가 🛏️를 받은 것과 침실 기본값이 🛏️인 것을
    // 구분할 수 없다. 그래서 이름 규칙 단계를 직접 본다.
    const unmatched = items.filter((i) => iconByName(i.name) === null).map((i) => i.name);
    expect(unmatched).toEqual([]);
  });

  it('그림이 충분히 갈린다 — 목록에서 훑을 때 구별돼야 한다', () => {
    const distinct = new Set(items.map((i) => itemIcon(i)));
    expect(distinct.size).toBeGreaterThanOrEqual(40);
  });

  it('모든 구역에 기본 그림이 있다', () => {
    for (const zone of ZONES) {
      expect(itemIcon({ name: '알 수 없는 물건', zone }), zone).toBeTruthy();
    }
  });

  it('대표 품목이 뜻에 맞는 그림을 받는다', () => {
    const cases: ReadonlyArray<[string, Zone, string]> = [
      ['칫솔', '욕실', '🪥'],
      ['혀클리너', '욕실', '🪥'],
      ['변기솔', '욕실', '🚽'],
      ['비누 거품망', '욕실', '🧼'],
      ['고무장갑', '주방', '🧤'],
      ['냉장고 탈취제', '주방', '🧊'],
      ['양말', '세탁', '🧦'],
      ['우산 점검', '세탁', '🌂'],
      ['이어폰 이어팁', '전자', '🎧'],
      ['충전 케이블', '전자', '🔌'],
      ['소화기', '안전', '🧯'],
      // 좁은 규칙이 넓은 규칙보다 먼저 걸린다
      ['청소포', '거실', '🧻'],
      ['목욕 스펀지', '욕실', '🧽'],
      ['퍼프·스펀지', '미용', '💄'],
      ['샤워커튼 세탁', '욕실', '🚿'],
      ['운동화 세탁', '세탁', '👟'],
      ['청소기 먼지봉투', '거실', '🧹'],
    ];
    for (const [name, zone, expected] of cases) {
      expect(itemIcon({ name, zone }), name).toBe(expected);
    }
  });
});

describe('이미 쓰던 제품의 기준일', () => {
  it('새 것은 오늘부터 센다', () => {
    expect(baseDateForWear('2026-09-06', 90, 'new')).toBe('2026-09-06');
  });

  it('주기의 절반·80%만큼 과거로 물린다', () => {
    expect(baseDateForWear('2026-09-06', 90, 'half')).toBe('2026-07-23'); // -45
    expect(baseDateForWear('2026-09-06', 90, 'most')).toBe('2026-06-26'); // -72
  });

  it('주기가 짧은 품목도 밀린 상태로 등록되지 않는다', () => {
    for (const cycle of [7, 14, 30, 90, 180, 365]) {
      for (const opt of WEAR_OPTIONS) {
        const base = baseDateForWear('2026-09-06', cycle, opt.value);
        const elapsed = (Date.parse('2026-09-06') - Date.parse(base)) / 86400000;
        expect(elapsed, `${cycle}일 · ${opt.value}`).toBeLessThan(cycle);
        expect(elapsed, `${cycle}일 · ${opt.value}`).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

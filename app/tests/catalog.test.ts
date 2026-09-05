import { describe, it, expect } from 'vitest';
import raw from '../src/data/catalog.json';
import {
  buildCatalogIndex,
  onboardingPicks,
  searchCatalog,
  paoOptions,
  SHORT_CYCLE_DAYS,
} from '../src/core/catalog';
import { paoLabel } from '../src/core/humanize';
import { ZONES, type CatalogItem } from '../src/core/types';

const items = raw.items as CatalogItem[];
const index = buildCatalogIndex(items);

describe('카탈로그 시드', () => {
  it('159종이 온전히 들어 있다', () => {
    expect(items).toHaveLength(159);
    expect(raw.count).toBe(159);
  });

  it('code가 중복되지 않는다', () => {
    expect(new Set(items.map((i) => i.code)).size).toBe(159);
  });

  it('모든 품목이 필수 필드를 갖추고 값이 말이 된다', () => {
    for (const item of items) {
      expect(item.code, item.name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(item.name.trim(), item.code).not.toBe('');
      expect(ZONES, item.code).toContain(item.zone);
      expect(['list', 'pao'], item.code).toContain(item.input_type);
      expect(['time', 'usage'], item.code).toContain(item.metric);
      expect(['all', 'summer', 'winter'], item.code).toContain(item.season);
      expect(Number.isInteger(item.cycle_days), item.code).toBe(true);
      expect(item.cycle_days, item.code).toBeGreaterThan(0);
      expect(item.cycle_days, item.code).toBeLessThanOrEqual(3650);
      expect(typeof item.safety_locked, item.code).toBe('boolean');
      expect(typeof item.onboarding_pick, item.code).toBe('boolean');
    }
  });

  it('사용량 기준 품목은 주기와 단위를 함께 갖는다', () => {
    for (const item of items.filter((i) => i.metric === 'usage')) {
      expect(item.cycle_usage, item.code).toBeGreaterThan(0);
      expect(item.unit, item.code).toBeTruthy();
    }
  });

  it('기획서가 말한 분포와 맞는다 — list 127 · pao 32', () => {
    expect(items.filter((i) => i.input_type === 'list')).toHaveLength(127);
    expect(items.filter((i) => i.input_type === 'pao')).toHaveLength(32);
  });

  it('계절 품목과 안전 품목이 실제로 표시돼 있다', () => {
    expect(items.filter((i) => i.season !== 'all').length).toBeGreaterThan(0);
    expect(items.filter((i) => i.safety_locked).length).toBeGreaterThan(0);
    // 안전 품목은 자기교정에서 빠지므로 표시가 곧 정책이다
    const alarm = index.byCode.get('saf_smoke_battery');
    expect(alarm?.safety_locked).toBe(true);
  });
});

describe('buildCatalogIndex', () => {
  it('구역별로 짧은 주기가 위로 온다', () => {
    const kitchen = index.byZone.get('주방')!;
    expect(kitchen.length).toBeGreaterThan(0);
    for (let i = 1; i < kitchen.length; i++) {
      expect(kitchen[i].cycle_days).toBeGreaterThanOrEqual(kitchen[i - 1].cycle_days);
    }
  });

  it('중복 code를 넣으면 던진다', () => {
    expect(() => buildCatalogIndex([items[0], items[0]])).toThrow();
  });
});

describe('onboardingPicks', () => {
  it('고른 구역 밖의 품목은 절대 섞이지 않는다', () => {
    const picks = onboardingPicks(index, ['주방', '욕실']);
    expect(picks.length).toBeGreaterThan(0);
    expect(picks.every((p) => p.zone === '주방' || p.zone === '욕실')).toBe(true);
    // 짧은 주기 보강분(맨 앞 한 개)을 빼면 나머지는 모두 추천 표시가 있는 품목이다
    expect(picks.filter((p) => !p.onboarding_pick).length).toBeLessThanOrEqual(1);
  });

  it('보강이 일어나도 상한 안에서는 다른 추천을 밀어내지 않는다', () => {
    // 주방+욕실에는 2주 이하 추천 품목이 없어 보강이 반드시 일어난다
    const withoutRoom = onboardingPicks(index, ['주방', '욕실'], 3);
    expect(withoutRoom).toHaveLength(3);
    const withRoom = onboardingPicks(index, ['주방', '욕실'], 20);
    const plain = index.all.filter(
      (c) => c.onboarding_pick && (c.zone === '주방' || c.zone === '욕실'),
    );
    expect(withRoom).toHaveLength(plain.length + 1);
  });

  it('짧은 주기가 위에 온다 — 첫 알림까지의 공백이 치명적 리스크다', () => {
    const picks = onboardingPicks(index, ['주방', '욕실', '침실']);
    for (let i = 1; i < picks.length; i++) {
      expect(picks[i].cycle_days).toBeGreaterThanOrEqual(picks[i - 1].cycle_days);
    }
  });

  it('어느 구역을 고르든 2주 이하 품목이 최소 하나는 들어간다', () => {
    for (const zone of ZONES) {
      const picks = onboardingPicks(index, [zone]);
      if (picks.length === 0) continue;
      const hasShort = picks.some((p) => p.cycle_days <= SHORT_CYCLE_DAYS);
      expect(hasShort, `${zone}에 짧은 주기 품목이 없다`).toBe(true);
    }
  });

  it('구역을 하나도 안 고르면 빈 목록', () => {
    expect(onboardingPicks(index, [])).toEqual([]);
  });

  it('개수 상한을 지킨다', () => {
    expect(onboardingPicks(index, [...ZONES], 5)).toHaveLength(5);
  });
});

describe('searchCatalog', () => {
  it('이름 일치가 부분 일치보다 위', () => {
    const found = searchCatalog(index, '칫솔');
    expect(found[0].name).toBe('칫솔');
    expect(found.length).toBeGreaterThan(1); // 전동칫솔 브러시헤드 · 치간칫솔
  });

  it('구역명으로도 찾는다', () => {
    expect(searchCatalog(index, '욕실').length).toBeGreaterThan(0);
  });

  it('없는 말은 빈 결과 — 화면은 "직접 추가하기"를 권한다', () => {
    expect(searchCatalog(index, '헬리콥터')).toEqual([]);
    expect(searchCatalog(index, '   ')).toEqual([]);
  });
});

describe('paoOptions', () => {
  it('카탈로그 기본값이 반드시 선택지에 있다', () => {
    expect(paoOptions(365)).toContain(365);
    expect(paoOptions(120)).toContain(120);
    expect(paoOptions(365)).toEqual([...paoOptions(365)].sort((a, b) => a - b));
  });

  it('모든 개봉일 품목의 기본값이 선택지에 나타난다', () => {
    for (const item of items.filter((i) => i.input_type === 'pao')) {
      expect(paoOptions(item.cycle_days), item.code).toContain(item.cycle_days);
    }
  });

  it('같은 문구가 두 번 나오지 않는다 — 화면에 ‘12개월’이 나란히 두 개 뜨면 안 된다', () => {
    for (const item of items.filter((i) => i.input_type === 'pao')) {
      const labels = paoOptions(item.cycle_days).map(paoLabel);
      expect(new Set(labels).size, `${item.code}: ${labels.join(', ')}`).toBe(labels.length);
    }
    // 기획서가 예시로 든 선크림 — 6개월 · 12개월 · 24개월이 그대로 나와야 한다
    const sunscreen = paoOptions(365).map(paoLabel);
    expect(sunscreen).toContain('6개월');
    expect(sunscreen).toContain('12개월');
    expect(sunscreen).toContain('24개월');
  });
});

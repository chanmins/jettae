import { Link } from 'react-router-dom';
import { daysRemaining, formatDday, stateOf } from '../core/cycle';
import { cycleSuffix, elapsedLabel } from '../core/humanize';
import type { ISODate, Item } from '../core/types';
import { SwipeToDone } from './primitives';

/** 품목 아이콘. 이모지는 품목 하나까지만 — 문구 원칙. */
export function iconOf(item: Item): string {
  const n = item.name;
  const table: ReadonlyArray<[RegExp, string]> = [
    [/칫솔|치약|치실|치간|가글|구강/, '🪥'],
    [/수세미|설거지|주방세제/, '🧽'],
    [/행주|걸레|물티슈|청소포/, '🧻'],
    [/침구|이불|베개|베갯잇|매트리스|잠옷/, '🛏️'],
    [/렌즈|안경/, '👓'],
    [/선크림|마스카라|화장|퍼프|스펀지|립|파운데이션|섀도/, '💄'],
    [/화재|소화기|가스|누전|안전|멀티탭/, '🧯'],
    [/세탁|건조기|드럼|섬유유연제/, '🧺'],
    [/선풍기|에어컨|제습|가습|공기/, '🌀'],
    [/면도/, '🪒'],
    [/수건|타월/, '🧖'],
    [/영양제|비타민|유산균|상비약|약|밴드|거즈/, '💊'],
    [/화분|식물/, '🪴'],
    [/신발|운동화|러닝화/, '👟'],
    [/배터리|건전지/, '🔋'],
    [/도마|칼|냄비|프라이팬|밀폐/, '🍳'],
    [/쓰레기|배수구|거름망/, '🗑️'],
    [/마스크/, '😷'],
  ];
  for (const [re, emoji] of table) if (re.test(n)) return emoji;
  return '📦';
}

export function DdayBadge({ item, today }: { item: Item; today: ISODate }) {
  const state = stateOf(item, today);
  const remaining = daysRemaining(item, today);
  return (
    <span className={`dday ${state}`}>
      {state === 'paused' ? '멈춤' : formatDday(remaining)}
    </span>
  );
}

function metaLine(item: Item, today: ISODate): string {
  const cycle = cycleSuffix(item.cycleDays);
  if (item.status === 'paused') {
    return item.pauseReason === 'season' ? `${cycle} · 시즌 밖이라 멈췄어요` : `${cycle} · 알림 꺼둠`;
  }
  const remaining = daysRemaining(item, today);
  if (remaining < 0) return `${cycle} · ${elapsedLabel(-remaining)}`;
  return cycle;
}

export function ItemRow({
  item,
  today,
  onDone,
}: {
  item: Item;
  today: ISODate;
  onDone?: (id: string) => void;
}) {
  const state = stateOf(item, today);
  const row = (
    <Link className={`row ${state}`} to={`/item/${item.id}`}>
      <span aria-hidden="true" style={{ fontSize: 20 }}>
        {iconOf(item)}
      </span>
      <span className="body">
        <span className="name">
          {item.name}
          {item.groupCount > 1 && (
            <span style={{ color: 'var(--ink-3)', fontWeight: 500 }}> ×{item.groupCount}</span>
          )}
        </span>
        <span className="meta">{metaLine(item, today)}</span>
      </span>
      <DdayBadge item={item} today={today} />
    </Link>
  );

  if (!onDone) return row;
  return (
    <SwipeToDone disabled={item.status !== 'active'} onDone={() => onDone(item.id)}>
      {row}
    </SwipeToDone>
  );
}

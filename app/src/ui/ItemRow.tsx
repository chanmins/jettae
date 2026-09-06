import { Link } from 'react-router-dom';
import { daysRemaining, formatDday, stateOf } from '../core/cycle';
import { cycleSuffix, elapsedLabel } from '../core/humanize';
import type { ISODate, Item } from '../core/types';
import { SwipeToDone } from './primitives';
import { itemIcon } from './itemIcon';

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
      <span className="ico-tile" aria-hidden="true">
        {itemIcon(item)}
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

// 이 파일은 생성물이다. 고치지 말 것.
// 원본: app/src/core — `node scripts/sync-core.mjs`로 다시 만든다.
/**
 * core/notify — 무엇을, 언제, 어떤 문구로 보낼 것인가
 *
 * 이 앱은 알림이 곧 제품이다. 알림이 안 오면 존재하지 않는 앱이고, 너무 오면 삭제당한다.
 * 그래서 하루 한 건, 묶어서, 사용자가 정한 시각에만 보낸다.
 *
 * 문구는 화면설계 문서의 확정 카피를 그대로 옮긴 것이다. 여기서 바꾸면 전부 바뀐다.
 */
import { addDays, compareDate, diffDays } from './date.ts';
import {
  daysRemaining,
  nextDueOf,
  isOverdue,
  shouldAskKeepNotifying,
  IGNORE_ASK_THRESHOLD,
} from './cycle.ts';
import { seasonAction } from './season.ts';
import { cycleLabel, doneLabel, dueVerb, itemKind, joinNames, preVerb, sinceLabel } from './humanize.ts';
import type { ISODate, Item, NotifyStage, UserSettings } from './types.ts';

/** 미리 알림을 보내는 시점. 주기 1개월 이상 품목만 받는다. */
export const PRE_DAYS = 7;
/** 미리 알림을 받을 최소 주기. 2주짜리에 D-7 예고는 잔소리다. */
export const PRE_MIN_CYCLE_DAYS = 30;
/** D-DAY에 응답이 없으면 다시 묻는 시점. */
export const FOLLOWUP_DAYS = 3;
/** 마지막 재알림. 이후로는 조용히 '밀림'으로 남는다. */
export const FINAL_DAYS = 10;

const STAGE_OFFSETS: ReadonlyArray<[NotifyStage, number]> = [
  ['final', FINAL_DAYS],
  ['followup', FOLLOWUP_DAYS],
  ['due', 0],
  ['pre', -PRE_DAYS],
];

const STAGE_ORDER: Record<NotifyStage, number> = { pre: 0, due: 1, followup: 2, final: 3 };

/**
 * 이 품목이 오늘 어느 단계에 걸리는가. 걸리지 않으면 null.
 *
 * 같은 주기에서 같은 단계를 두 번 보내지 않는다(lastStage). 주기나 예정일이
 * 바뀌면 lastStageDue가 어긋나므로 단계가 자연히 초기화된다.
 */
export function stageFor(item: Item, today: ISODate): NotifyStage | null {
  if (item.status !== 'active') return null;

  const due = nextDueOf(item);
  const elapsed = diffDays(due, today); // 음수면 예정일 전

  let candidate: NotifyStage | null = null;
  for (const [stage, offset] of STAGE_OFFSETS) {
    if (elapsed >= offset) {
      if (stage === 'pre' && item.cycleDays < PRE_MIN_CYCLE_DAYS) continue;
      candidate = stage;
      break;
    }
  }
  if (!candidate) return null;

  // 이미 보낸 단계이거나 그보다 앞선 단계면 보내지 않는다.
  if (item.lastStageDue === due && item.lastStage) {
    if (STAGE_ORDER[candidate] <= STAGE_ORDER[item.lastStage]) return null;
  }
  return candidate;
}

/** 단계를 보냈다고 기록한다. */
export function markStageSent(item: Item, stage: NotifyStage): Item {
  return { ...item, lastStage: stage, lastStageDue: nextDueOf(item) };
}

/* ─── 알림 문구 ─────────────────────────────────────────────────────── */

export type DigestKind =
  | 'due_single'
  | 'due_bundle'
  | 'pre'
  | 'followup'
  | 'overdue_many'
  | 'season_start'
  | 'safety'
  | 'keep_asking'
  | 'add_more';

export interface NotifyAction {
  /** 서비스워커가 서버로 되돌려 보내는 값 */
  id:
    | 'replaced'
    | 'snoozed'
    | 'still_good'
    | 'open'
    | 'ack'
    | 'season_yes'
    | 'season_no'
    | 'bulk_reset'
    /** 계속 무시된 품목의 알림만 끈다. 목록에는 남는다 */
    | 'mute';
  title: string;
}

export interface Digest {
  kind: DigestKind;
  /** 이 알림이 다루는 품목들 */
  itemIds: string[];
  /** 각 품목에 기록할 단계. 발송 후 markStageSent에 쓴다 */
  stage: NotifyStage | null;
  title: string;
  body: string;
  actions: NotifyAction[];

  /* ── 발송 시점에 남겨야 하는 흔적 ──────────────────────────────────────
   * stage가 null인 알림(시즌 질문, 밀림 정리 제안)은 아무 상태도 남기지 않아
   * 다음 날 같은 조건이 그대로 성립했고, 그래서 응답하지 않으면 매일 같은
   * 알림이 나갔다. 우선순위까지 높아 그동안 다른 알림은 전부 막혔다.
   * 보낸 쪽이 흔적을 남겨야 다시 묻는 간격이 생긴다. 발송에 성공했을 때만
   * 찍어야 하므로 판정(순수)과 기록(부수효과)을 이렇게 갈라 둔다.
   */
  /** 발송 시점에 seasonAskedAt을 오늘로 찍을 품목 */
  askedItemIds?: string[];
  /** 발송 시점에 settings.overdueNudgedOn을 오늘로 찍어야 하는가 */
  marksOverdueNudge?: boolean;
}

/** 밀린 항목이 이만큼 넘으면 목록 대신 배너 하나로 접는다. */
export const OVERDUE_COLLAPSE = 5;
/**
 * '밀린 게 N개 있어요'를 다시 보내기까지의 최소 간격.
 *
 * overdue.ts에 적어 둔 대로, 밀린 목록을 보면 사용자는 만회할 수 없다고
 * 느낀다. 그 문장을 매일 푸시로 보내는 것은 접어서 감추려던 것을 가장
 * 시끄러운 자리에 매일 꺼내 놓는 것과 같다.
 */
export const OVERDUE_NUDGE_INTERVAL_DAYS = 7;
/** 등록 수가 이만큼 아래면 '두 개만 더 담아볼까요?'를 권한다. */
export const ADD_MORE_BELOW = 5;
/** 가입 후 이만큼 지나면 등록 유도를 한 번 보낸다. */
export const ADD_MORE_AFTER_DAYS = 2;

const A = {
  replaced: { id: 'replaced', title: '바꿨어요' } as NotifyAction,
  replacedAll: { id: 'replaced', title: '다 바꿨어요' } as NotifyAction,
  /* 할 일이 섞인 묶음에는 '다 바꿨어요'가 맞지 않는다 */
  doneAll: { id: 'replaced', title: '다 챙겼어요' } as NotifyAction,
  snoozed: { id: 'snoozed', title: '아직이요' } as NotifyAction,
  open: { id: 'open', title: '앱에서 볼게요' } as NotifyAction,
  ack: { id: 'ack', title: '알겠어요' } as NotifyAction,
  stillGood: { id: 'still_good', title: '멀쩡해요' } as NotifyAction,
  soon: { id: 'snoozed', title: '곧 바꿀게요' } as NotifyAction,
  bulkReset: { id: 'bulk_reset', title: '정리하기' } as NotifyAction,
  seasonYes: { id: 'season_yes', title: '쓰고 있어요' } as NotifyAction,
  seasonNo: { id: 'season_no', title: '아직이요' } as NotifyAction,
  addMore: { id: 'open', title: '추천 보기' } as NotifyAction,
  keepNotifying: { id: 'ack', title: '계속 알려주세요' } as NotifyAction,
  mute: { id: 'mute', title: '그만 알릴게요' } as NotifyAction,
};

export interface DigestContext {
  items: readonly Item[];
  settings: UserSettings;
  today: ISODate;
  /** 가입일. 등록 유도 알림의 기준 */
  joinedOn: ISODate;
}

/**
 * 오늘 이 사용자에게 보낼 알림 하나. 없으면 null.
 *
 * 우선순위가 곧 설계다 — 밀린 게 폭탄이면 그것부터 치우게 하고,
 * 그다음이 오늘 할 일, 그다음이 재확인, 마지막이 예고다.
 */
export function buildDailyDigest(ctx: DigestContext): Digest | null {
  const { items, settings, today, joinedOn } = ctx;

  // 휴면 중에는 아무것도 보내지 않는다.
  if (settings.dormantUntil && compareDate(today, settings.dormantUntil) <= 0) return null;
  // 하루 한 건.
  if (settings.lastDigestOn === today) return null;

  const active = items.filter((i) => i.status === 'active');

  // 0) 시즌이 열렸다 — 다른 무엇보다 이걸 먼저 물어야 나머지 계산이 맞는다.
  const seasonal = items.filter((i) => seasonAction(i, today) === 'ask_resume');
  if (seasonal.length > 0) {
    const it = seasonal[0];
    return {
      kind: 'season_start',
      itemIds: [it.id],
      stage: null,
      title: `${it.name} 꺼내셨어요?`,
      body: '쓰기 시작하시면 그때부터 세어드릴게요',
      actions: [A.seasonYes, A.seasonNo],
      /* 물어본 사실 자체를 남긴다. 예전에는 '아직이요'를 눌러야만 이 값이
         찍혀서, 그냥 넘긴 사람에게는 seasonAction이 다음 날도 ask_resume을
         내놨다 — 시즌이 끝날 때까지 매일, 그리고 이 분기가 맨 위라 그동안
         칫솔도 수세미도 알림을 받지 못했다. 여기서 찍으면 SEASON_REASK_DAYS
         간격이 무응답에도 똑같이 걸린다. */
      askedItemIds: [it.id],
    };
  }

  // 오늘 단계에 걸리는 품목들을 모은다.
  const staged = active
    .map((i) => ({ item: i, stage: stageFor(i, today) }))
    .filter((x): x is { item: Item; stage: NotifyStage } => x.stage !== null);

  // 1) 밀린 것이 폭탄이면 목록 대신 정리 제안 하나.
  const overdue = active.filter((i) => isOverdue(i, today));
  const nudgedAgo =
    settings.overdueNudgedOn === null ? Infinity : diffDays(settings.overdueNudgedOn, today);
  if (overdue.length > OVERDUE_COLLAPSE && nudgedAgo >= OVERDUE_NUDGE_INTERVAL_DAYS) {
    return {
      kind: 'overdue_many',
      itemIds: overdue.map((i) => i.id),
      stage: null,
      title: `밀린 게 ${overdue.length}개 있어요`,
      body: '한 번에 정리해드릴까요?',
      actions: [A.bulkReset, A.open],
      marksOverdueNudge: true,
    };
  }
  /* 간격 안이라 정리 제안을 건너뛰었더라도 아래는 계속 본다. 예전에는 이
     분기가 무조건 return이라, 밀린 게 6개인 사람은 오늘 바꿔야 할 칫솔
     알림을 영영 받지 못했다. 정리를 권하는 것과 오늘 할 일을 알리는 것은
     서로를 막을 이유가 없다. */

  // 2) 오늘 바꿀 것 — 안전 품목은 어투가 다르므로 따로 집는다.
  const due = staged.filter((s) => s.stage === 'due').map((s) => s.item);
  if (due.length > 0) {
    const safety = due.find((i) => i.safetyLocked);
    if (due.length === 1 && safety) {
      return {
        kind: 'safety',
        itemIds: [safety.id],
        stage: 'due',
        title: `${safety.name}, ${cycleLabel(safety.cycleDays)} 됐어요`,
        body: '안전 항목이라 미루지 않는 게 좋아요',
        actions: [{ id: 'replaced', title: doneLabel(safety.name) }, A.snoozed],
      };
    }
    if (due.length === 1) {
      const it = due[0];
      return {
        kind: 'due_single',
        itemIds: [it.id],
        stage: 'due',
        title: `${it.name} ${dueVerb(it.name)}`,
        body: sinceLabel(it.baseDate, today),
        actions: [{ id: 'replaced', title: doneLabel(it.name) }, A.snoozed],
      };
    }
    return {
      kind: 'due_bundle',
      itemIds: due.map((i) => i.id),
      stage: 'due',
      // 전부 제품일 때만 '바꿀 것'이다. 할 일이 하나라도 섞이면 중립적으로 쓴다.
      title: due.every((i) => itemKind(i.name) === 'product')
        ? `오늘 바꿀 것 ${due.length}개`
        : `오늘 챙길 것 ${due.length}개`,
      body: joinNames(due.map((i) => i.name)),
      actions: [
        due.every((i) => itemKind(i.name) === 'product') ? A.replacedAll : A.doneAll,
        A.open,
      ],
    };
  }

  // 3) 재확인 — 두 번째 물음은 질문을 바꾼다.
  /* 단계가 섞이면 안 된다. 예전에는 followup과 final을 한 묶음으로 만든 뒤
     첫 항목의 단계를 묶음 전체에 찍었다. A가 followup, B가 final이면 B에도
     followup이 기록되고, B는 다음 날 final로 한 번 더 나갔다. 더 진행된
     단계가 있으면 그쪽만 묶는다 — 어차피 다음 날 나머지가 올라온다. */
  const finals = staged.filter((s) => s.stage === 'final').map((s) => s.item);
  const seconds = staged.filter((s) => s.stage === 'followup').map((s) => s.item);
  const stage: NotifyStage = finals.length > 0 ? 'final' : 'followup';
  const followup = finals.length > 0 ? finals : seconds;
  if (followup.length > 0) {
    if (followup.length === 1) {
      const it = followup[0];
      return {
        kind: 'followup',
        itemIds: [it.id],
        stage,
        title: `${it.name}, 아직 멀쩡한가요?`,
        body: '덜 쓰셨으면 좀 더 미뤄드릴게요',
        actions: it.safetyLocked
          ? [{ id: 'replaced', title: doneLabel(it.name) }, A.snoozed]
          : [A.stillGood, A.soon],
      };
    }
    return {
      kind: 'followup',
      itemIds: followup.map((i) => i.id),
      stage,
      title: followup.every((i) => itemKind(i.name) === 'product')
        ? `아직 안 바꾼 게 ${followup.length}개 있어요`
        : `아직 안 챙긴 게 ${followup.length}개 있어요`,
      body: joinNames(followup.map((i) => i.name)),
      actions: [
        followup.every((i) => itemKind(i.name) === 'product') ? A.replacedAll : A.doneAll,
        A.open,
      ],
    };
  }

  /* 3.5) 계속 무시당하는 품목 — 한 번 물어보고 물러난다.
     core에 판정(shouldAskKeepNotifying)은 처음부터 있었지만 부르는 곳이
     없어서 죽은 코드였다. 무시가 쌓여도 알림은 영원히 같은 자리로 계속
     갔다. 재확인 다음, 예고 앞에 둔다 — 오늘 할 일보다 급하지 않지만
     "사러 가세요"보다는 먼저 물어야 할 말이다. */
  const nagging = active.filter(shouldAskKeepNotifying);
  if (nagging.length > 0) {
    const it = nagging[0];
    return {
      kind: 'keep_asking',
      itemIds: [it.id],
      stage: null,
      title: `${it.name}, 계속 알려드릴까요?`,
      body: `${IGNORE_ASK_THRESHOLD}번 그냥 지나가셨어요. 안 쓰시는 거면 알림만 끌게요`,
      actions: [A.keepNotifying, A.mute],
    };
  }

  // 4) 미리 알림 — 사러 갈 시간을 준다.
  const pre = staged.filter((s) => s.stage === 'pre').map((s) => s.item);
  if (pre.length > 0) {
    const it = pre[0];
    return {
      kind: 'pre',
      itemIds: pre.map((i) => i.id),
      stage: 'pre',
      title: `${it.name} ${preVerb(it.name)}`,
      body: '일주일 뒤예요. 미리 봐두시면 좋아요',
      actions: [A.ack],
    };
  }

  // 5) 등록이 적어 알림이 뜸한 사용자에게 한 번만.
  if (
    active.length > 0 &&
    active.length < ADD_MORE_BELOW &&
    diffDays(joinedOn, today) === ADD_MORE_AFTER_DAYS
  ) {
    return {
      kind: 'add_more',
      itemIds: [],
      stage: null,
      title: '두 개만 더 담아볼까요?',
      body: `지금은 ${active.length}개라 알림이 뜸해요`,
      actions: [A.addMore],
    };
  }

  return null;
}

/** 다음에 알림이 갈 날 — "가장 가까운 건 침구 세탁, 5일 뒤예요"에 쓴다. */
export function nextUpcoming(items: readonly Item[], today: ISODate): { item: Item; days: number } | null {
  const active = items.filter((i) => i.status === 'active');
  if (active.length === 0) return null;
  let best: { item: Item; days: number } | null = null;
  for (const item of active) {
    const days = daysRemaining(item, today);
    if (!best || days < best.days) best = { item, days };
  }
  return best;
}

/** 사용자의 알림 시각이 지금 슬롯에 해당하는가. 배치가 5분 간격으로 돈다. */
export function isDispatchSlot(notifyAt: string, nowClock: string, slotMinutes = 5): boolean {
  const toMin = (s: string): number | null => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(s);
    if (!m) return null;
    const h = Number(m[1]);
    const mm = Number(m[2]);
    if (h > 23 || mm > 59) return null;
    return h * 60 + mm;
  };
  const a = toMin(notifyAt);
  const b = toMin(nowClock);
  if (a === null || b === null) return false;
  // 발송 시각이 지난 슬롯 안에 들어왔으면 보낸다. 5분 격자에 정확히 맞을 필요는 없다.
  const delta = b - a;
  return delta >= 0 && delta < slotMinutes;
}

/** 휴면 복귀 — "자리 비운 만큼 미뤄드릴까요?" */
export function applyDormantShift(items: readonly Item[], from: ISODate, to: ISODate): Item[] {
  const gap = diffDays(from, to);
  if (gap <= 0) return [...items];
  return items.map((i) =>
    i.status === 'active' ? { ...i, deferDays: i.deferDays + gap } : i,
  );
}

/** 휴면 시작 — 종료일까지 알림을 멈춘다. */
export function startDormant(settings: UserSettings, from: ISODate, until: ISODate): UserSettings {
  if (compareDate(until, from) < 0) {
    throw new RangeError('휴면 종료일이 시작일보다 앞이에요');
  }
  return { ...settings, dormantFrom: from, dormantUntil: until };
}

export function endDormant(settings: UserSettings): UserSettings {
  return { ...settings, dormantFrom: null, dormantUntil: null };
}

/** 오늘 알림을 보냈다고 기록. */
export function markDigestSent(settings: UserSettings, on: ISODate): UserSettings {
  return { ...settings, lastDigestOn: on };
}

/** 예정일까지 남은 날짜 목록 — 개발 중 알림 흐름을 눈으로 확인할 때 쓴다. */
export function stageSchedule(item: Item): Array<{ stage: NotifyStage; on: ISODate }> {
  const due = nextDueOf(item);
  const out: Array<{ stage: NotifyStage; on: ISODate }> = [];
  if (item.cycleDays >= PRE_MIN_CYCLE_DAYS) out.push({ stage: 'pre', on: addDays(due, -PRE_DAYS) });
  out.push({ stage: 'due', on: due });
  out.push({ stage: 'followup', on: addDays(due, FOLLOWUP_DAYS) });
  out.push({ stage: 'final', on: addDays(due, FINAL_DAYS) });
  return out;
}

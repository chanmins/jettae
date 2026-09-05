/**
 * 홈 — 한 화면에서 다 보인다
 *
 * 맨 위가 빠른 기록, 그 아래가 D-day 순 목록. 밀린 게 폭탄이면 접는다.
 * 밀린 항목이 12개여도 화면은 담담해야 한다 — 혼나는 기분이 들면 다시 열지 않는다.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { byDueDate, stateOf } from '../core/cycle';
import { cycleLabel, remainingLabel } from '../core/humanize';
import { nextUpcoming } from '../core/notify';
import { overdueItems, shouldCollapseOverdue } from '../core/overdue';
import { itemsAwaitingSeasonStart } from '../core/season';
import { onboardingPicks } from '../core/catalog';
import type { Zone } from '../core/types';
import { ZONES } from '../core/types';
import { CATALOG } from '../store/catalog';
import { useApp } from '../store/useApp';
import { ItemRow } from '../ui/ItemRow';
import { useToast } from '../ui/primitives';
import { enablePush, pushState, type PushState } from '../push/client';
import { getRepository } from '../db';

/** 구역 필터는 품목이 이만큼 넘을 때만 노출한다. */
const ZONE_FILTER_AFTER = 15;

export default function Home() {
  const navigate = useNavigate();
  const { show, node: toast } = useToast();

  const today = useApp((s) => s.today);
  const items = useApp((s) => s.items);
  const settings = useApp((s) => s.settings);
  const saveError = useApp((s) => s.saveError);
  const online = useApp((s) => s.online);
  const markReplaced = useApp((s) => s.markReplaced);
  const resumeSeason = useApp((s) => s.resumeSeason);
  const suggestions = useApp((s) => s.suggestions);
  const acceptSuggestion = useApp((s) => s.acceptSuggestion);
  const dismissSuggestion = useApp((s) => s.dismissSuggestion);
  const finishDormant = useApp((s) => s.finishDormant);

  const [zone, setZone] = useState<Zone | null>(null);
  const [push, setPush] = useState<PushState>('default');

  useEffect(() => {
    setPush(pushState());
  }, []);

  const active = useMemo(() => items.filter((i) => i.status !== 'archived'), [items]);
  const overdue = useMemo(() => overdueItems(active, today), [active, today]);
  const collapse = shouldCollapseOverdue(active, today);
  const seasonAsk = useMemo(() => itemsAwaitingSeasonStart(items, today), [items, today]);
  const suggestion = suggestions()[0] ?? null;

  const visible = useMemo(() => {
    const overdueIds = new Set(collapse ? overdue.map((i) => i.id) : []);
    return active
      .filter((i) => !overdueIds.has(i.id))
      .filter((i) => (zone ? i.zone === zone : true))
      .sort(byDueDate(today));
  }, [active, overdue, collapse, zone, today]);

  /** 임박 순 3개. 알림 없이 먼저 바꾼 경우를 여기서 잡는다. */
  const quick = useMemo(
    () =>
      active
        .filter((i) => i.status === 'active')
        .sort(byDueDate(today))
        .slice(0, 3),
    [active, today],
  );

  const zonesInUse = useMemo(() => {
    const set = new Set(active.map((i) => i.zone));
    return ZONES.filter((z) => set.has(z));
  }, [active]);

  const done = async (id: string, name: string) => {
    await markReplaced(id);
    show(`${name}, 오늘로 기록해뒀어요`);
  };

  const dormantOver =
    settings.dormantUntil !== null && settings.dormantUntil < today && settings.dormantFrom !== null;

  if (active.length === 0) return <EmptyHome />;

  const upcoming = nextUpcoming(active, today);
  const allClear = overdue.length === 0 && visible.every((i) => stateOf(i, today) === 'ok');

  return (
    <>
      <div className="hdr">
        <h1>우리 집 · {active.length}개</h1>
        <span className="sub">D-DAY 순</span>
      </div>

      {saveError && (
        <div className="banner warn">
          <span className="txt">
            <strong>저장이 안 됐어요</strong>
            <span>잠시 뒤 다시 시도해주세요</span>
          </span>
        </div>
      )}

      {!online && !saveError && (
        <div className="banner info">
          <span aria-hidden="true">📡</span>
          <span className="txt">
            <strong>지금은 연결이 안 돼요</strong>
            <span>기록은 저장해뒀다가 연결되면 보낼게요</span>
          </span>
        </div>
      )}

      {(push === 'denied' || push === 'default') && (
        <div className="prompt">
          <div className="emoji">🔕</div>
          <h3>알림이 꺼져 있어요</h3>
          <p>{'이 앱은 알림이 전부예요.\n꺼두면 아무것도 알려드릴 수 없어요.'}</p>
          {push === 'default' ? (
            <button
              className="btn primary lg block"
              onClick={async () => {
                const next = await enablePush(getRepository());
                setPush(next);
                if (next !== 'granted') show('브라우저 설정에서 알림을 허용해주세요');
              }}
            >
              알림 켜기
            </button>
          ) : (
            <p className="note" style={{ margin: 0 }}>
              브라우저 설정 → 사이트 권한 → 알림에서 다시 켜실 수 있어요
            </p>
          )}
        </div>
      )}

      {dormantOver && (
        <div className="prompt">
          <div className="emoji">🧳</div>
          <h3>다녀오셨네요</h3>
          <p>자리 비운 만큼 미뤄드릴까요?</p>
          <div className="btnrow">
            <button className="btn primary" onClick={() => finishDormant(true)}>
              미루기
            </button>
            <button className="btn" onClick={() => finishDormant(false)}>
              그대로 두기
            </button>
          </div>
        </div>
      )}

      {seasonAsk.length > 0 && (
        <div className="prompt">
          <div className="emoji">🌀</div>
          <h3>{seasonAsk[0].name} 꺼내셨어요?</h3>
          <p>{'쓰기 시작하시면 청소 시기를\n그때부터 세어드릴게요.'}</p>
          <div className="btnrow">
            <button className="btn primary" onClick={() => resumeSeason(seasonAsk[0].id, true)}>
              네, 쓰고 있어요
            </button>
            <button className="btn" onClick={() => resumeSeason(seasonAsk[0].id, false)}>
              아직이요
            </button>
          </div>
          <p className="note" style={{ margin: '12px 0 0' }}>
            계절 품목은 시즌 밖에 세지 않아요
          </p>
        </div>
      )}

      {suggestion && (
        <div className="prompt">
          <div className="emoji">📐</div>
          <h3>{items.find((i) => i.id === suggestion.itemId)?.name}</h3>
          <p>
            {suggestion.reason === 'history'
              ? `보통 ${cycleLabel(suggestion.suggestedCycleDays)}에 바꾸시네요. 주기를 바꿔드릴까요?`
              : `아직 멀쩡하다고 하신 게 여러 번이에요. 주기를 ${cycleLabel(
                  suggestion.suggestedCycleDays,
                )}로 늘려드릴까요?`}
          </p>
          <div className="btnrow">
            <button
              className="btn primary"
              onClick={async () => {
                await acceptSuggestion(suggestion);
                show(`주기를 ${cycleLabel(suggestion.suggestedCycleDays)}로 바꿨어요`);
              }}
            >
              바꿔주세요
            </button>
            <button className="btn" onClick={() => dismissSuggestion(suggestion.itemId)}>
              그대로 둘게요
            </button>
          </div>
        </div>
      )}

      {quick.length > 0 && (
        <div className="quick">
          <div className="t">방금 뭐 바꾸셨어요?</div>
          <div className="chips">
            {quick.map((item) => (
              <button key={item.id} className="chip" onClick={() => done(item.id, item.name)}>
                {item.name}
              </button>
            ))}
            <button className="chip plain" onClick={() => navigate('/add')}>
              + 다른 거
            </button>
          </div>
        </div>
      )}

      {collapse && (
        <Link className="banner warn" to="/overdue">
          <span aria-hidden="true">🗂️</span>
          <span className="txt">
            <strong>밀린 것 {overdue.length}개</strong>
            <span>한 번에 정리해드릴까요?</span>
          </span>
          <span aria-hidden="true">›</span>
        </Link>
      )}

      {zonesInUse.length > 1 && active.length > ZONE_FILTER_AFTER && (
        <div className="chips">
          <button className={`chip ${zone === null ? 'on' : ''}`} onClick={() => setZone(null)}>
            전체
          </button>
          {zonesInUse.map((z) => (
            <button
              key={z}
              className={`chip ${zone === z ? 'on' : ''}`}
              onClick={() => setZone(zone === z ? null : z)}
            >
              {z}
            </button>
          ))}
        </div>
      )}

      {allClear && upcoming && (
        <div className="empty">
          <h3>지금은 바꿀 게 없어요</h3>
          <p>
            가장 가까운 건 {upcoming.item.name}, {remainingLabel(upcoming.days)}
          </p>
        </div>
      )}

      <div className="list">
        {visible.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            today={today}
            onDone={() => done(item.id, item.name)}
          />
        ))}
      </div>

      {collapse && (
        <p className="note" style={{ marginBottom: 20 }}>
          밀린 항목은 목록에서 접어뒀어요
        </p>
      )}

      {toast}
    </>
  );
}

/**
 * 등록 0개 — 홈이 곧 추천 화면이다.
 * 이 사용자에게는 알림을 보낼 방법이 없어서, 이 화면이 유일한 접점이다.
 */
function EmptyHome() {
  const navigate = useNavigate();
  const addItems = useApp((s) => s.addItems);
  const { show, node: toast } = useToast();

  const picks = useMemo(() => onboardingPicks(CATALOG, ['욕실', '주방', '침실', '세탁'], 6), []);

  return (
    <>
      <div className="hdr">
        <h1>우리 집</h1>
      </div>

      <div className="quick">
        <div className="t">뭐부터 챙겨볼까요?</div>
        <p className="note" style={{ margin: '0 0 12px', color: 'var(--accent-2)' }}>
          탭하면 바로 등록돼요
        </p>
        <div className="checklist">
          {picks.map((item) => (
            <button
              key={item.code}
              className="checkline"
              onClick={async () => {
                await addItems([{ catalog: item }]);
                show(`${item.name}, ${cycleLabel(item.cycle_days)} 뒤에 알려드릴게요`);
              }}
            >
              <span className="box" aria-hidden="true">
                +
              </span>
              <span className="nm">{item.name}</span>
              <span className="cy">{cycleLabel(item.cycle_days)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="btnrow pad" style={{ marginBottom: 20 }}>
        <button className="btn" onClick={() => navigate('/add')}>
          전체 목록
        </button>
        <button className="btn" onClick={() => navigate('/add/custom')}>
          직접 추가
        </button>
      </div>

      {toast}
    </>
  );
}

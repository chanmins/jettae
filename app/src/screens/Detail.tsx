/**
 * 상세
 *
 * 화면 안에서는 세 선택지를 모두 노출한다 — 푸시 버튼은 두 개까지가 현실적이라
 * 알림에서는 둘만 보이지만, 여기서는 "아직 멀쩡해요"까지 함께 보여준다.
 */
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  daysRemaining,
  formatDday,
  nextDueOf,
  stateOf,
} from '../core/cycle';
import { formatDot, formatShort } from '../core/date';
import { cycleLabel, elapsedLabel, remainingLabel } from '../core/humanize';
import { replacementIntervals, median } from '../core/selfCorrect';
import { nextSeasonStart } from '../core/season';
import { CATALOG } from '../store/catalog';
import { useApp } from '../store/useApp';
import { Confirm, NavBar, Sheet, useToast } from '../ui/primitives';
import { iconOf } from '../ui/ItemRow';

const CYCLE_PRESETS = [7, 14, 21, 30, 60, 90, 180, 365, 730];

export default function Detail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { show, node: toast } = useToast();

  const today = useApp((s) => s.today);
  const item = useApp((s) => s.items.find((i) => i.id === id));
  const eventsOf = useApp((s) => s.eventsOf);
  const markReplaced = useApp((s) => s.markReplaced);
  const markStillGood = useApp((s) => s.markStillGood);
  const archiveItem = useApp((s) => s.archiveItem);
  const unarchiveItem = useApp((s) => s.unarchiveItem);
  const muteItem = useApp((s) => s.muteItem);
  const unmuteItem = useApp((s) => s.unmuteItem);
  const renewItem = useApp((s) => s.renewItem);
  const removeItem = useApp((s) => s.removeItem);
  const editCycleDays = useApp((s) => s.editCycleDays);
  const editBaseDate = useApp((s) => s.editBaseDate);
  const renameItem = useApp((s) => s.renameItem);

  const [menu, setMenu] = useState(false);
  const [editingCycle, setEditingCycle] = useState(false);
  const [editingBase, setEditingBase] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftCycle, setDraftCycle] = useState(30);
  const [draftBase, setDraftBase] = useState(today);

  const events = useMemo(() => (item ? eventsOf(item.id) : []), [item, eventsOf]);

  const replacedOn = useMemo(
    () => events.filter((e) => e.type === 'replaced' || e.type === 'renewed').map((e) => e.on),
    [events],
  );

  const averageGap = useMemo(() => {
    if (!item) return null;
    const intervals = replacementIntervals(item, [...events].reverse());
    return intervals.length >= 2 ? median(intervals) : null;
  }, [item, events]);

  if (!item) {
    return (
      <>
        <NavBar title="상세" onBack="auto" />
        <div className="empty">
          <h3>없는 항목이에요</h3>
          <p>목록에서 지워졌을 수 있어요</p>
        </div>
      </>
    );
  }

  const state = stateOf(item, today);
  const remaining = daysRemaining(item, today);
  const catalog = item.catalogCode ? CATALOG.byCode.get(item.catalogCode) : null;
  const seasonBack = item.status === 'paused' && item.pauseReason === 'season'
    ? nextSeasonStart(item.season, today)
    : null;

  return (
    <>
      <NavBar
        title={item.name}
        onBack="auto"
        right={
          <button className="iconbtn" aria-label="더보기" onClick={() => setMenu(true)}>
            ⋯
          </button>
        }
      />

      <div className="pad">
        <div className="card" style={{ padding: '24px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: 34 }} aria-hidden="true">
            {iconOf(item)}
          </div>
          <div
            className={`dday ${state}`}
            style={{ fontSize: 22, padding: '8px 16px', display: 'inline-block', marginTop: 8 }}
          >
            {state === 'paused' ? '멈춤' : formatDday(remaining)}
          </div>
          <p style={{ margin: '10px 0 0', color: 'var(--ink-3)', fontSize: 14 }}>
            {item.status === 'paused'
              ? item.pauseReason === 'season'
                ? `시즌 밖이라 세지 않아요${seasonBack ? ` · ${formatDot(seasonBack)}부터 다시` : ''}`
                : '알림을 꺼둔 항목이에요'
              : remaining < 0
                ? elapsedLabel(-remaining)
                : remainingLabel(remaining)}
          </p>
        </div>

        {item.status === 'active' && (
          <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
            <button
              className="btn primary lg block"
              onClick={async () => {
                await markReplaced(item.id);
                show('오늘로 기록해뒀어요');
              }}
            >
              바꿨어요
            </button>
            <div className="btnrow">
              <button
                className="btn"
                onClick={async () => {
                  await markStillGood(item.id);
                  show(
                    item.safetyLocked
                      ? '조금 미뤄뒀어요. 안전 항목이라 주기는 그대로예요'
                      : '조금 더 미뤄뒀어요',
                  );
                }}
              >
                아직 멀쩡해요
              </button>
              <button
                className="btn"
                onClick={async () => {
                  await archiveItem(item.id);
                  show('목록에서 내렸어요');
                  navigate('/');
                }}
              >
                이제 안 써요
              </button>
            </div>
          </div>
        )}

        {item.status === 'paused' && item.pauseReason === 'muted' && (
          <button
            className="btn primary lg block"
            style={{ marginTop: 14 }}
            onClick={() => unmuteItem(item.id)}
          >
            다시 알려주세요
          </button>
        )}

        {item.status === 'archived' && (
          <button
            className="btn primary lg block"
            style={{ marginTop: 14 }}
            onClick={() => unarchiveItem(item.id)}
          >
            다시 챙길게요
          </button>
        )}

        {item.safetyLocked && (
          <p className="note" style={{ marginLeft: 0, marginRight: 0 }}>
            안전 항목이라 주기를 자동으로 늘리지 않아요. 권장 주기는 참고값이며 제조사 표기가 있으면
            그쪽이 우선이에요.
          </p>
        )}
      </div>

      <div className="section">정보</div>
      <div className="fields">
        <button className="field" onClick={() => (setDraftCycle(item.cycleDays), setEditingCycle(true))}>
          <span className="k">주기</span>
          <span className="v">
            {item.cycleDays}일 · {cycleLabel(item.cycleDays)}
            {item.cycleSource === 'auto' && (
              <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}> · 맞춤</span>
            )}{' '}
            ›
          </span>
        </button>
        <button className="field" onClick={() => (setDraftBase(item.baseDate), setEditingBase(true))}>
          <span className="k">마지막 교체</span>
          <span className="v">{formatDot(item.baseDate)} ›</span>
        </button>
        <div className="field">
          <span className="k">다음 예정</span>
          <span className="v">{formatDot(nextDueOf(item))}</span>
        </div>
        {item.deferDays > 0 && (
          <div className="field">
            <span className="k">미뤄둔 날</span>
            <span className="v">{item.deferDays}일</span>
          </div>
        )}
        <div className="field">
          <span className="k">구역</span>
          <span className="v">{item.zone}</span>
        </div>
        {item.season !== 'all' && (
          <div className="field">
            <span className="k">계절</span>
            <span className="v">{item.season === 'summer' ? '여름에만' : '겨울에만'}</span>
          </div>
        )}
      </div>

      {catalog?.note && <p className="note">{catalog.note}</p>}

      <div className="section">교체 이력 · {replacedOn.length}회</div>
      <div className="pad">
        {replacedOn.length === 0 ? (
          <p className="note" style={{ margin: 0 }}>
            아직 기록이 없어요. 바꾸시면 여기에 쌓여요.
          </p>
        ) : (
          <>
            <div className="history">{replacedOn.slice(0, 12).map(formatShort).join(' · ')}</div>
            {averageGap !== null && (
              <p className="note" style={{ margin: '6px 0 0' }}>
                평균 {averageGap}일마다 바꾸셨어요
              </p>
            )}
          </>
        )}
      </div>

      <div style={{ height: 24 }} />

      {menu && (
        <Sheet title={item.name} onClose={() => setMenu(false)}>
          <div style={{ display: 'grid', gap: 8 }}>
            <button
              className="btn block"
              onClick={() => {
                setDraftName(item.name);
                setEditingName(true);
                setMenu(false);
              }}
            >
              이름 바꾸기
            </button>
            <button
              className="btn block"
              onClick={async () => {
                await renewItem(item.id);
                setMenu(false);
                show('새것으로 시작할게요');
              }}
            >
              새것으로 바꿨어요
            </button>
            {item.status === 'active' && (
              <button
                className="btn block"
                onClick={async () => {
                  await muteItem(item.id);
                  setMenu(false);
                  show('이 항목은 조용히 보관할게요');
                }}
              >
                알림만 끄기
              </button>
            )}
            <button
              className="btn danger block"
              onClick={() => {
                setMenu(false);
                setConfirmRemove(true);
              }}
            >
              완전히 지우기
            </button>
          </div>
        </Sheet>
      )}

      {editingCycle && (
        <Sheet
          title="얼마마다 바꾸세요?"
          lead={
            catalog
              ? `카탈로그 권장은 ${cycleLabel(catalog.cycle_days)}예요. 제조사 권장값이 있으면 그쪽이 우선이에요.`
              : undefined
          }
          onClose={() => setEditingCycle(false)}
        >
          <div className="optgrid" style={{ marginBottom: 12 }}>
            {CYCLE_PRESETS.map((days) => (
              <button
                key={days}
                className={`btn ${draftCycle === days ? 'primary' : ''}`}
                onClick={() => setDraftCycle(days)}
              >
                {cycleLabel(days)}
              </button>
            ))}
          </div>
          <input
            className="input"
            type="number"
            min={1}
            max={3650}
            value={draftCycle}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) setDraftCycle(Math.max(1, Math.min(3650, Math.round(n))));
            }}
            aria-label="주기(일)"
          />
          <button
            className="btn primary lg block"
            style={{ marginTop: 12 }}
            onClick={async () => {
              await editCycleDays(item.id, draftCycle);
              setEditingCycle(false);
            }}
          >
            저장
          </button>
        </Sheet>
      )}

      {editingBase && (
        <Sheet
          title="마지막으로 언제 바꾸셨어요?"
          lead="한참 전에 바꾸셨다면 여기서 고쳐주세요."
          onClose={() => setEditingBase(false)}
        >
          <input
            className="input"
            type="date"
            value={draftBase}
            max={today}
            onChange={(e) => setDraftBase(e.target.value || today)}
            aria-label="마지막 교체일"
          />
          <button
            className="btn primary lg block"
            style={{ marginTop: 12 }}
            onClick={async () => {
              await editBaseDate(item.id, draftBase);
              setEditingBase(false);
            }}
          >
            저장
          </button>
        </Sheet>
      )}

      {editingName && (
        <Sheet title="이름 바꾸기" onClose={() => setEditingName(false)}>
          <input
            className="input"
            value={draftName}
            maxLength={40}
            onChange={(e) => setDraftName(e.target.value)}
            aria-label="이름"
          />
          <button
            className="btn primary lg block"
            style={{ marginTop: 12 }}
            disabled={!draftName.trim()}
            onClick={async () => {
              await renameItem(item.id, draftName);
              setEditingName(false);
            }}
          >
            저장
          </button>
        </Sheet>
      )}

      {confirmRemove && (
        <Confirm
          title="완전히 지울까요?"
          lead="교체 이력까지 같이 사라져요. 잠깐 쉬는 거라면 '이제 안 써요'가 나아요."
          confirmLabel="지울게요"
          danger
          onConfirm={async () => {
            await removeItem(item.id);
            navigate('/', { replace: true });
          }}
          onClose={() => setConfirmRemove(false)}
        />
      )}

      {toast}
    </>
  );
}

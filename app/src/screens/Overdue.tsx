/**
 * 밀린 항목 일괄 정리
 *
 * 가장 큰 버튼은 "지금부터 다시 셀게요" — 과거를 캐묻지 않는다.
 * 자비로운 탈출구가 없으면 이탈한다.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { byDueDate, daysRemaining } from '../core/cycle';
import { cycleSuffix, elapsedLabel } from '../core/humanize';
import { overdueItems } from '../core/overdue';
import { useApp } from '../store/useApp';
import { NavBar, useToast } from '../ui/primitives';
import { itemIcon } from '../ui/itemIcon';

export default function Overdue() {
  const navigate = useNavigate();
  const { show, node: toast } = useToast();

  const today = useApp((s) => s.today);
  const items = useApp((s) => s.items);
  const resetOverdue = useApp((s) => s.resetOverdue);
  const markReplaced = useApp((s) => s.markReplaced);
  const archiveItem = useApp((s) => s.archiveItem);

  const [oneByOne, setOneByOne] = useState(false);
  const [busy, setBusy] = useState(false);

  const overdue = useMemo(
    () => overdueItems(items.filter((i) => i.status !== 'archived'), today).sort(byDueDate(today)),
    [items, today],
  );

  if (overdue.length === 0) {
    return (
      <>
        <NavBar title="밀린 항목" onBack="auto" />
        <div className="empty">
          <h3>밀린 게 없어요</h3>
          <p>전부 제때 챙기고 계세요</p>
          <button className="btn primary" style={{ marginTop: 14 }} onClick={() => navigate('/')}>
            홈으로
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <NavBar title={`밀린 것 ${overdue.length}개`} onBack="auto" />

      {!oneByOne && (
        <div className="prompt">
          <h3>한 번에 정리할까요?</h3>
          <p>{'언제 바꾸셨는지 안 물어볼게요.\n오늘부터 다시 세면 됩니다.'}</p>
          <div style={{ display: 'grid', gap: 8 }}>
            <button
              className="btn primary lg block"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await resetOverdue();
                navigate('/', { replace: true });
              }}
            >
              지금부터 다시 셀게요
            </button>
            <button className="btn ghost block" onClick={() => setOneByOne(true)}>
              하나씩 볼게요
            </button>
          </div>
        </div>
      )}

      <div className="list">
        {overdue.map((item) => (
          <div key={item.id} className="card" style={{ padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span aria-hidden="true" style={{ fontSize: 20 }}>
                {itemIcon(item)}
              </span>
              <span className="body" style={{ flex: 1, minWidth: 0 }}>
                <span className="name" style={{ fontWeight: 600 }}>
                  {item.name}
                </span>
                <span className="meta" style={{ display: 'block', fontSize: 13, color: 'var(--ink-3)' }}>
                  {cycleSuffix(item.cycleDays)} · {elapsedLabel(-daysRemaining(item, today))}
                </span>
              </span>
            </div>
            {oneByOne && (
              <div className="btnrow" style={{ marginTop: 12 }}>
                <button
                  className="btn primary"
                  onClick={async () => {
                    await markReplaced(item.id);
                    show(`${item.name}, 오늘로 기록해뒀어요`);
                  }}
                >
                  바꿨어요
                </button>
                <button
                  className="btn"
                  onClick={async () => {
                    await archiveItem(item.id);
                    show(`${item.name}, 목록에서 내렸어요`);
                  }}
                >
                  이제 안 써요
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {oneByOne && (
        <div className="pad" style={{ paddingBottom: 24 }}>
          <button
            className="btn block"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await resetOverdue();
              navigate('/', { replace: true });
            }}
          >
            남은 건 오늘부터 다시 셀게요
          </button>
        </div>
      )}

      {toast}
    </>
  );
}

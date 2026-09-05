/**
 * 이사 정리
 *
 * 이사하면 챙기던 물건의 절반이 바뀐다. 목록이 현실과 어긋나는 순간 앱을 믿지 않게 된다.
 * 이사는 오히려 재참여 기회다 — 어차피 그때 집 안 물건을 전부 만지기 때문이다.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { byDueDate } from '../core/cycle';
import { cycleSuffix } from '../core/humanize';
import { ZONES } from '../core/types';
import { useApp } from '../store/useApp';
import { Confirm, NavBar } from '../ui/primitives';

export default function MoveHouse() {
  const navigate = useNavigate();
  const today = useApp((s) => s.today);
  const items = useApp((s) => s.items);
  const moveHouse = useApp((s) => s.moveHouse);

  const active = useMemo(
    () => items.filter((i) => i.status !== 'archived').sort(byDueDate(today)),
    [items, today],
  );
  // 기본은 전부 가져오는 것. 두고 온 것만 체크를 푼다.
  const [kept, setKept] = useState<Set<string>>(() => new Set(active.map((i) => i.id)));
  const [confirm, setConfirm] = useState(false);

  const toggle = (id: string) =>
    setKept((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const left = active.length - kept.size;

  if (active.length === 0) {
    return (
      <>
        <NavBar title="이사 정리" onBack="auto" />
        <div className="empty">
          <h3>정리할 게 없어요</h3>
          <p>등록된 물건이 아직 없어요</p>
        </div>
      </>
    );
  }

  return (
    <>
      <NavBar title="이사 정리" onBack="auto" />

      <div className="prompt" style={{ textAlign: 'left' }}>
        <h3>어떤 걸 가져오셨어요?</h3>
        <p style={{ margin: 0 }}>
          체크를 푼 것은 목록에서 내려가요. 나중에 설정에서 다시 꺼낼 수 있어요.
        </p>
      </div>

      <div className="chips">
        <button className="chip plain" onClick={() => setKept(new Set(active.map((i) => i.id)))}>
          전부 가져왔어요
        </button>
        <button className="chip plain" onClick={() => setKept(new Set())}>
          전부 두고 왔어요
        </button>
      </div>

      {ZONES.map((zone) => {
        const group = active.filter((i) => i.zone === zone);
        if (group.length === 0) return null;
        return (
          <div key={zone}>
            <div className="section">{zone}</div>
            <div className="list" style={{ paddingTop: 0 }}>
              {group.map((item) => {
                const on = kept.has(item.id);
                return (
                  <button
                    key={item.id}
                    className={`checkline ${on ? 'on' : ''}`}
                    aria-pressed={on}
                    onClick={() => toggle(item.id)}
                  >
                    <span className="box" aria-hidden="true">
                      ✓
                    </span>
                    <span className="nm">{item.name}</span>
                    <span className="cy">{cycleSuffix(item.cycleDays)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      <div className="basketbar">
        <button className="btn primary lg block" onClick={() => setConfirm(true)}>
          {left > 0 ? `${left}개 내리고 정리하기` : '그대로 두기'}
        </button>
      </div>

      {confirm && (
        <Confirm
          title={left > 0 ? `${left}개를 목록에서 내릴까요?` : '변경 사항이 없어요'}
          lead={
            left > 0
              ? '교체 이력은 남아 있어요. 설정 → 보관한 항목에서 다시 꺼낼 수 있어요.'
              : undefined
          }
          confirmLabel="정리할게요"
          onConfirm={async () => {
            await moveHouse(kept);
            navigate('/', { replace: true });
          }}
          onClose={() => setConfirm(false)}
        />
      )}
    </>
  );
}

/** 보관한 항목 — '이제 안 써요'와 이사 정리로 내려간 것들. */
import { useMemo } from 'react';
import { cycleSuffix } from '../core/humanize';
import { useApp } from '../store/useApp';
import { NavBar, useToast } from '../ui/primitives';
import { itemIcon } from '../ui/itemIcon';

export default function Archived() {
  const { show, node: toast } = useToast();
  const items = useApp((s) => s.items);
  const unarchiveItem = useApp((s) => s.unarchiveItem);

  const archived = useMemo(
    () => items.filter((i) => i.status === 'archived').sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    [items],
  );

  return (
    <>
      <NavBar title="보관한 항목" onBack="auto" />
      {archived.length === 0 ? (
        <div className="empty">
          <h3>보관한 게 없어요</h3>
          <p>‘이제 안 써요’를 누른 물건이 여기로 와요</p>
        </div>
      ) : (
        <div className="list">
          {archived.map((item) => (
            <div key={item.id} className="row paused">
              <span aria-hidden="true" style={{ fontSize: 20 }}>
                {itemIcon(item)}
              </span>
              <span className="body">
                <span className="name">{item.name}</span>
                <span className="meta">
                  {item.zone} · {cycleSuffix(item.cycleDays)}
                </span>
              </span>
              <button
                className="chip"
                onClick={async () => {
                  await unarchiveItem(item.id);
                  show(`${item.name}, 오늘부터 다시 셀게요`);
                }}
              >
                다시 챙기기
              </button>
            </div>
          ))}
        </div>
      )}
      <p className="note" style={{ marginBottom: 24 }}>
        다시 챙기면 오늘이 새 기준일이 돼요
      </p>
      {toast}
    </>
  );
}

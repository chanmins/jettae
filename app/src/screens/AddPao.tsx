/**
 * 추가 — 개봉일 기준 품목 (32종)
 *
 * 산 날이 아니라 개봉한 날부터 세야 한다. 사진 촬영 대신 버튼 선택 —
 * "오늘 개봉" + "12개월" 두 번 탭이면 끝나서 카메라보다 빠르다.
 */
import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { OPENED_OPTIONS, paoOptions } from '../core/catalog';
import { addDays } from '../core/date';
import { paoLabel } from '../core/humanize';
import { CATALOG } from '../store/catalog';
import { useApp } from '../store/useApp';
import { NavBar } from '../ui/primitives';
import { enablePush, pushState } from '../push/client';
import { getRepository } from '../db';

export default function AddPao() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const fromOnboarding = params.get('from') === 'onboarding';

  const today = useApp((s) => s.today);
  const addItems = useApp((s) => s.addItems);
  const itemCount = useApp((s) => s.items.filter((i) => i.status !== 'archived').length);

  const catalog = CATALOG.byCode.get(code) ?? null;
  const [openedDays, setOpenedDays] = useState<number>(0);
  const [customDate, setCustomDate] = useState<string>(today);
  const [pickingDate, setPickingDate] = useState(false);
  const [cycleDays, setCycleDays] = useState<number>(catalog?.cycle_days ?? 365);
  const [busy, setBusy] = useState(false);

  if (!catalog) {
    return (
      <>
        <NavBar title="추가하기" onBack="auto" />
        <div className="empty">
          <h3>못 찾겠어요</h3>
          <p>목록에서 다시 골라주세요</p>
        </div>
      </>
    );
  }

  const baseDate = pickingDate ? customDate : addDays(today, -openedDays);

  const save = async () => {
    setBusy(true);
    const wasEmpty = itemCount === 0;
    await addItems([{ catalog, cycleDaysOverride: cycleDays, baseDate }]);
    if (wasEmpty && pushState() === 'default') {
      await enablePush(getRepository()).catch(() => undefined);
    }
    if (fromOnboarding) navigate(-1);
    else navigate('/', { replace: true });
  };

  return (
    <>
      <NavBar title={catalog.name} onBack="auto" />

      <div className="pad">
        <h3 style={{ margin: '10px 0 4px', fontSize: 18 }}>언제 개봉하셨어요?</h3>
        <p className="note" style={{ margin: '0 0 14px' }}>
          개봉한 날부터 세기 시작해요
        </p>

        <div style={{ display: 'grid', gap: 8 }}>
          {OPENED_OPTIONS.map((opt) => {
            const isCustom = opt.days === null;
            const on = isCustom ? pickingDate : !pickingDate && openedDays === opt.days;
            return (
              <button
                key={opt.label}
                className={`checkline ${on ? 'on' : ''}`}
                aria-pressed={on}
                onClick={() => {
                  if (isCustom) {
                    setPickingDate(true);
                  } else {
                    setPickingDate(false);
                    setOpenedDays(opt.days!);
                  }
                }}
              >
                <span className="box" aria-hidden="true">
                  ✓
                </span>
                <span className="nm">{opt.label}</span>
              </button>
            );
          })}
        </div>

        {pickingDate && (
          <input
            className="input"
            type="date"
            value={customDate}
            max={today}
            onChange={(e) => setCustomDate(e.target.value || today)}
            style={{ marginTop: 10 }}
            aria-label="개봉한 날"
          />
        )}

        <div className="divider" style={{ marginLeft: 0, marginRight: 0 }} />

        <h3 style={{ margin: '0 0 4px', fontSize: 18 }}>사용기한</h3>
        <p className="note" style={{ margin: '0 0 14px' }}>
          제품 뒤 <strong>6M · 12M</strong> 표시를 보고 골라주세요
        </p>

        <div className="optgrid">
          {paoOptions(catalog.cycle_days).map((days) => (
            <button
              key={days}
              className={`btn ${cycleDays === days ? 'primary' : ''}`}
              aria-pressed={cycleDays === days}
              onClick={() => setCycleDays(days)}
            >
              {paoLabel(days)}
            </button>
          ))}
        </div>

        {catalog.note && <p className="note" style={{ marginLeft: 0, marginRight: 0 }}>{catalog.note}</p>}

        {(catalog.zone === '건강' || catalog.safety_locked) && (
          <p className="note" style={{ marginLeft: 0, marginRight: 0 }}>
            제조사 표기가 있으면 그쪽이 우선이에요.
          </p>
        )}

        <button
          className="btn primary lg block"
          style={{ margin: '20px 0 24px' }}
          disabled={busy}
          onClick={save}
        >
          등록
        </button>
      </div>
    </>
  );
}

/**
 * 추가 — 직접 만들기 (Phase 2)
 *
 * 카탈로그 159종에 없는 것. 검색 결과가 없을 때의 출구이기도 하다.
 */
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { isFrequent } from '../core/cycle';
import { cycleLabel } from '../core/humanize';
import { ZONES, type Zone } from '../core/types';
import { useApp } from '../store/useApp';
import { NavBar, useToast } from '../ui/primitives';

const CYCLE_PRESETS = [7, 14, 30, 60, 90, 180, 365, 730];

export default function AddCustom() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const fromOnboarding = params.get('from') === 'onboarding';
  const { show, node: toast } = useToast();

  const addCustomItem = useApp((s) => s.addCustomItem);

  const [name, setName] = useState(params.get('name') ?? '');
  const [zone, setZone] = useState<Zone>('주방');
  const [cycleDays, setCycleDays] = useState(30);
  const [busy, setBusy] = useState(false);

  const valid = name.trim().length > 0 && cycleDays >= 1;

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    const created = await addCustomItem({ name, zone, cycleDays });
    if (!created) {
      setBusy(false);
      show('추가하지 못했어요. 다시 시도해주세요');
      return;
    }
    if (fromOnboarding) navigate(-1);
    else navigate('/', { replace: true });
  };

  return (
    <>
      <NavBar title="직접 추가" onBack="auto" />

      <div className="pad">
        <label className="section" style={{ padding: '10px 0 6px', display: 'block' }}>
          뭘 챙기시나요?
        </label>
        <input
          className="input"
          value={name}
          maxLength={40}
          placeholder="예) 자전거 체인 오일"
          onChange={(e) => setName(e.target.value)}
        />

        <div className="section" style={{ padding: '20px 0 8px' }}>
          어디에 있나요?
        </div>
        <div className="chips" style={{ padding: 0 }}>
          {ZONES.map((z) => (
            <button
              key={z}
              className={`chip ${zone === z ? 'on' : ''}`}
              aria-pressed={zone === z}
              onClick={() => setZone(z)}
            >
              {z}
            </button>
          ))}
        </div>

        <div className="section" style={{ padding: '20px 0 8px' }}>
          얼마마다 바꾸시나요?
        </div>
        <div className="optgrid">
          {CYCLE_PRESETS.map((days) => (
            <button
              key={days}
              className={`btn ${cycleDays === days ? 'primary' : ''}`}
              aria-pressed={cycleDays === days}
              onClick={() => setCycleDays(days)}
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
          value={cycleDays}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) setCycleDays(Math.max(1, Math.min(3650, Math.round(n))));
          }}
          style={{ marginTop: 10 }}
          aria-label="주기(일)"
        />
        <p className="note" style={{ marginLeft: 0, marginRight: 0 }}>
          며칠마다인지 직접 넣으셔도 돼요
          {isFrequent(cycleDays) && ' · 주기가 짧아 알림이 자주 갑니다'}
        </p>

        <button
          className="btn primary lg block"
          style={{ margin: '20px 0 24px' }}
          disabled={!valid || busy}
          onClick={save}
        >
          등록
        </button>
      </div>

      {toast}
    </>
  );
}

/**
 * 온보딩 — 4단계
 *
 * 달성해야 하는 것은 딱 둘이다: 등록 5개, 짧은 주기 품목 1개 이상.
 * 하지만 통과 조건은 없다. 하나도 고르지 않고 끝까지 넘어갈 수 있다 —
 * 관문을 넘으려고 아무거나 체크한 사용자는 첫 알림이 왔을 때 자기가 뭘 등록했는지도 모른다.
 *
 * PWA를 배포하지 않으므로 '홈 화면에 추가' 단계는 만들지 않는다.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { onboardingPicks, SHORT_CYCLE_DAYS } from '../core/catalog';
import { cycleLabel } from '../core/humanize';
import { ONBOARDING_ZONES, type CatalogItem, type Zone } from '../core/types';
import { CATALOG } from '../store/catalog';
import { useApp } from '../store/useApp';

const STEPS = 4;

export default function Onboarding() {
  const navigate = useNavigate();
  const addItems = useApp((s) => s.addItems);
  const completeOnboarding = useApp((s) => s.completeOnboarding);
  const setNotifyAt = useApp((s) => s.setNotifyAt);
  const settings = useApp((s) => s.settings);

  const [step, setStep] = useState(0);
  const [zones, setZones] = useState<Zone[]>(['욕실', '주방', '침실']);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  /** 사용자가 직접 손댄 품목. 손대지 않은 것은 기본 체크로 본다 */
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [notifyAt, setLocalNotifyAt] = useState(settings.notifyAt);
  const [busy, setBusy] = useState(false);

  const picks = useMemo(() => onboardingPicks(CATALOG, zones), [zones]);

  // 구역을 바꾸면 추천 목록도 바뀐다. 새로 보이는 것은 기본 체크된 상태로 나타난다.
  const effectiveChecked = useMemo(() => {
    const next = new Set<string>();
    for (const pick of picks) {
      if (!touched.has(pick.code) || checked.has(pick.code)) next.add(pick.code);
    }
    return next;
  }, [picks, checked, touched]);

  const toggleZone = (zone: Zone) =>
    setZones((prev) => (prev.includes(zone) ? prev.filter((z) => z !== zone) : [...prev, zone]));

  const toggleItem = (code: string) => {
    setTouched((prev) => new Set(prev).add(code));
    setChecked((prev) => {
      const next = new Set(prev);
      if (effectiveChecked.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const selected: CatalogItem[] = picks.filter((p) => effectiveChecked.has(p.code));
  const hasShort = selected.some((p) => p.cycle_days <= SHORT_CYCLE_DAYS);

  const finish = async () => {
    setBusy(true);
    if (selected.length > 0) {
      await addItems(selected.map((catalog) => ({ catalog })));
    }
    await setNotifyAt(notifyAt);
    await completeOnboarding();
    navigate('/', { replace: true });
  };

  return (
    <div className="app">
      <div className="ob">
        <div className="steps" aria-label={`${STEPS}단계 중 ${Math.min(step + 1, STEPS)}단계`}>
          {Array.from({ length: STEPS }, (_, i) => (
            <i key={i} className={i <= Math.min(step, STEPS - 1) ? 'on' : ''} />
          ))}
        </div>

        {step === 0 && (
          <>
            <div className="mid hero">
              <div className="emoji">🪥</div>
              <h2>{'바꿔야 할 때\n제가 알려드릴게요'}</h2>
              <p className="lead">{'칫솔 3개월, 수세미 한 달.\n알지만 아무도 세지 않죠.'}</p>
            </div>
            <div className="foot">
              <button className="btn primary lg block" onClick={() => setStep(1)}>
                다음
              </button>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <div className="mid hero">
              <div className="emoji">🔔</div>
              <h2>{'등록은 한 번\n그다음은 잊으셔도 돼요'}</h2>
              <p className="lead">{'때가 되면 알림이 갑니다.\n바꾸셨으면 탭 한 번이면 끝.'}</p>
            </div>
            <div className="foot">
              <button className="btn primary lg block" onClick={() => setStep(2)}>
                시작하기
              </button>
              <button className="btn ghost block" onClick={() => setStep(0)}>
                뒤로
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div className="mid">
              <h2>{'집에 어떤 공간이\n있나요?'}</h2>
              <p className="lead">고른 곳의 물건만 보여드릴게요</p>
              <div className="picker">
                {ONBOARDING_ZONES.map((zone) => (
                  <button
                    key={zone}
                    className={zones.includes(zone) ? 'on' : ''}
                    aria-pressed={zones.includes(zone)}
                    onClick={() => toggleZone(zone)}
                  >
                    {zone}
                    {zones.includes(zone) && <span aria-hidden="true">✓</span>}
                  </button>
                ))}
              </div>
            </div>
            <div className="foot">
              <button className="btn primary lg block" onClick={() => setStep(3)}>
                다음
              </button>
              <button className="btn ghost block" onClick={() => setStep(1)}>
                뒤로
              </button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <div className="mid">
              <h2>{'이런 것들,\n챙기고 계세요?'}</h2>
              <p className="lead">체크한 것부터 시작할게요</p>

              {picks.length === 0 ? (
                <p className="lead" style={{ marginTop: 20 }}>
                  고른 구역에 추천할 게 없네요. 전체 목록에서 찾아보실 수 있어요.
                </p>
              ) : (
                <div className="checklist">
                  {picks.map((item) => {
                    const on = effectiveChecked.has(item.code);
                    return (
                      <button
                        key={item.code}
                        className={`checkline ${on ? 'on' : ''}`}
                        aria-pressed={on}
                        onClick={() => toggleItem(item.code)}
                      >
                        <span className="box" aria-hidden="true">
                          ✓
                        </span>
                        <span className="nm">{item.name}</span>
                        <span className="cy">{cycleLabel(item.cycle_days)}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="btnrow" style={{ marginTop: 14 }}>
                <button className="btn" onClick={() => navigate('/add?from=onboarding')}>
                  다른 것 찾아보기
                </button>
                <button className="btn" onClick={() => navigate('/add/custom?from=onboarding')}>
                  직접 추가하기
                </button>
              </div>

              {selected.length > 0 && !hasShort && (
                <p className="note" style={{ margin: '14px 0 0' }}>
                  자주 바꾸는 것도 하나 넣어두시면 2주 안에 첫 알림을 받아보실 수 있어요.
                </p>
              )}
            </div>

            <div className="foot">
              <button className="btn primary lg block" disabled={busy} onClick={() => setStep(4)}>
                {selected.length > 0 ? `${selected.length}개로 시작하기` : '건너뛰기'}
              </button>
              <button className="btn ghost block" onClick={() => setStep(2)}>
                뒤로
              </button>
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <div className="mid">
              <h2>언제 알려드릴까요?</h2>
              <p className="lead">{'집에 있을 시간이 좋아요.\n바로 바꿀 수 있으니까요.'}</p>
              <input
                className="input"
                type="time"
                value={notifyAt}
                step={300}
                onChange={(e) => setLocalNotifyAt(e.target.value || '20:00')}
                style={{ marginTop: 24, fontSize: 28, textAlign: 'center', fontWeight: 700 }}
                aria-label="알림 시각"
              />
              <p className="note" style={{ margin: '12px 0 0', textAlign: 'center' }}>
                하루 한 번, 묶어서 보내드려요
              </p>
            </div>
            <div className="foot">
              <button className="btn primary lg block" disabled={busy} onClick={finish}>
                완료
              </button>
              <button className="btn ghost block" onClick={() => setStep(3)}>
                뒤로
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

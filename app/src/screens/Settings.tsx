/**
 * 설정 — 알림 시간, 휴면, 이사 정리, 계정, 가족 공유, 내보내기
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { addDays, formatDot } from '../core/date';
import { useApp } from '../store/useApp';
import { NavBar, Sheet, useToast } from '../ui/primitives';
import { disablePush, enablePush, pushState, type PushState } from '../push/client';
import { getRepository, isSupabaseRepository, LocalRepository } from '../db';

const DORMANT_OPTIONS = [
  { label: '3일', days: 3 },
  { label: '일주일', days: 7 },
  { label: '2주', days: 14 },
  { label: '한 달', days: 30 },
];

export default function Settings() {
  const { show, node: toast } = useToast();

  const today = useApp((s) => s.today);
  const settings = useApp((s) => s.settings);
  const items = useApp((s) => s.items);
  const setNotifyAt = useApp((s) => s.setNotifyAt);
  const beginDormant = useApp((s) => s.beginDormant);
  const finishDormant = useApp((s) => s.finishDormant);

  const [push, setPush] = useState<PushState>('default');
  const [dormantSheet, setDormantSheet] = useState(false);
  const [accountSheet, setAccountSheet] = useState(false);
  const [email, setEmail] = useState('');
  const [linkedEmail, setLinkedEmail] = useState<string | null>(null);

  const repo = getRepository();
  const synced = isSupabaseRepository(repo);
  const archived = items.filter((i) => i.status === 'archived').length;

  useEffect(() => {
    setPush(pushState());
    if (isSupabaseRepository(repo)) void repo.currentEmail().then(setLinkedEmail);
  }, [repo]);

  const exportData = async () => {
    const local = repo instanceof LocalRepository ? repo : new LocalRepository(today);
    const json = await local.exportJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jettae-${today}.json`;
    a.click();
    URL.revokeObjectURL(url);
    show('내보냈어요');
  };

  return (
    <>
      <NavBar title="설정" />

      <div className="section">알림</div>
      <div className="fields">
        <label className="field">
          <span className="k">알림 시각</span>
          <input
            type="time"
            step={300}
            value={settings.notifyAt}
            onChange={(e) => setNotifyAt(e.target.value || '20:00')}
            style={{
              border: 'none',
              background: 'transparent',
              fontWeight: 600,
              fontSize: 15,
              textAlign: 'right',
            }}
          />
        </label>
        <div className="field">
          <span className="k">권한</span>
          <span className="v">
            {push === 'granted' ? (
              <button
                className="btn ghost"
                style={{ padding: 0 }}
                onClick={async () => {
                  await disablePush(repo);
                  setPush(pushState());
                  show('알림을 껐어요');
                }}
              >
                켜져 있음 · 끄기
              </button>
            ) : push === 'unsupported' ? (
              '이 브라우저는 지원 안 해요'
            ) : push === 'no-key' ? (
              '개발 모드 (푸시 키 없음)'
            ) : push === 'denied' ? (
              '브라우저에서 차단됨'
            ) : (
              <button
                className="btn ghost"
                style={{ padding: 0, color: 'var(--accent)' }}
                onClick={async () => {
                  setPush(await enablePush(repo));
                }}
              >
                켜기
              </button>
            )}
          </span>
        </div>
      </div>
      <p className="note">하루 한 번, 여러 품목은 하나로 묶어서 보내드려요</p>

      <div className="section">휴면</div>
      <div className="fields">
        {settings.dormantUntil && settings.dormantUntil >= today ? (
          <button className="field" onClick={() => finishDormant(false)}>
            <span className="k">쉬는 중</span>
            <span className="v">{formatDot(settings.dormantUntil)}까지 · 지금 끝내기</span>
          </button>
        ) : (
          <button className="field" onClick={() => setDormantSheet(true)}>
            <span className="k">잠시 알림 멈추기</span>
            <span className="v">여행 · 장기 부재 ›</span>
          </button>
        )}
      </div>

      <div className="section">우리 집</div>
      <div className="fields">
        <Link className="field" to="/settings/move">
          <span className="k">이사했어요</span>
          <span className="v">가져온 것만 남기기 ›</span>
        </Link>
        {synced && (
          <Link className="field" to="/settings/family">
            <span className="k">가족과 함께 쓰기</span>
            <span className="v">초대 · 참여 ›</span>
          </Link>
        )}
        <Link className="field" to="/settings/archived">
          <span className="k">보관한 항목</span>
          <span className="v">{archived}개 ›</span>
        </Link>
      </div>

      <div className="section">계정 · 데이터</div>
      <div className="fields">
        {synced ? (
          <button className="field" onClick={() => setAccountSheet(true)}>
            <span className="k">계정</span>
            <span className="v">{linkedEmail ?? '이 기기에만 저장 중 ›'}</span>
          </button>
        ) : (
          <div className="field">
            <span className="k">저장 위치</span>
            <span className="v">이 기기</span>
          </div>
        )}
        <button className="field" onClick={exportData}>
          <span className="k">내보내기</span>
          <span className="v">JSON 파일 ›</span>
        </button>
      </div>
      <p className="note">
        {synced
          ? '이메일을 연결하면 기기를 바꿔도 그대로 이어져요.'
          : '이 기기 안에만 저장돼요. 서버로 나가는 것은 없어요.'}
      </p>

      <div className="section">제때</div>
      <p className="note" style={{ marginBottom: 24 }}>
        교체 주기는 일반적인 권장값이에요. 제품·사용 환경에 따라 다르고, 제조사 권장값이 있으면 그쪽이
        우선입니다. 안전 항목(화재감지기 · 소화기 · 가스)은 주기를 자동으로 늘리지 않아요.
      </p>

      {dormantSheet && (
        <Sheet
          title="얼마나 쉬실까요?"
          lead="그동안은 알림을 보내지 않아요. 돌아오시면 안 쓴 만큼 미룰지 여쭤볼게요."
          onClose={() => setDormantSheet(false)}
        >
          <div className="optgrid">
            {DORMANT_OPTIONS.map((opt) => (
              <button
                key={opt.days}
                className="btn"
                onClick={async () => {
                  await beginDormant(addDays(today, opt.days));
                  setDormantSheet(false);
                  show(`${opt.label} 동안 쉴게요`);
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </Sheet>
      )}

      {accountSheet && synced && (
        <Sheet
          title={linkedEmail ? '연결된 계정' : '이메일 연결'}
          lead={
            linkedEmail
              ? linkedEmail
              : '이메일을 연결하면 기기를 바꾸거나 앱을 지웠다 깔아도 그대로 이어져요.'
          }
          onClose={() => setAccountSheet(false)}
        >
          {!linkedEmail && (
            <>
              <input
                className="input"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-label="이메일"
              />
              <button
                className="btn primary lg block"
                style={{ marginTop: 12 }}
                disabled={!email.includes('@')}
                onClick={async () => {
                  if (!isSupabaseRepository(repo)) return;
                  const { error } = await repo.linkEmail(email.trim());
                  setAccountSheet(false);
                  show(error ? '연결이 안 됐어요. 잠시 뒤 다시 시도해주세요' : '메일함을 확인해주세요');
                }}
              >
                연결하기
              </button>
            </>
          )}
          {linkedEmail && (
            <button
              className="btn block"
              onClick={async () => {
                if (!isSupabaseRepository(repo)) return;
                await repo.signOut();
                setAccountSheet(false);
                show('로그아웃했어요');
              }}
            >
              로그아웃
            </button>
          )}
        </Sheet>
      )}

      {toast}
    </>
  );
}

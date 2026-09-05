/**
 * 가족 공유 (Phase 2) — 한 집을 여러 명이 관리
 *
 * "누가 언제 바꿨는지"를 서로 모르는 것이 신혼·맞벌이 가구의 문제였다.
 */
import { useEffect, useState } from 'react';
import { useApp } from '../store/useApp';
import { Confirm, NavBar, useToast } from '../ui/primitives';
import { getRepository, isSupabaseRepository, type SupabaseRepository } from '../db';

export default function Family() {
  const { show, node: toast } = useToast();
  const init = useApp((s) => s.init);

  const repo = getRepository();
  const supa: SupabaseRepository | null = isSupabaseRepository(repo) ? repo : null;

  const [members, setMembers] = useState<Array<{ userId: string; email: string | null; role: string }>>(
    [],
  );
  const [code, setCode] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  useEffect(() => {
    if (supa) void supa.householdMembers().then(setMembers);
  }, [supa]);

  if (!supa) {
    return (
      <>
        <NavBar title="가족과 함께 쓰기" onBack="auto" />
        <div className="empty">
          <h3>지금은 이 기기에만 저장돼요</h3>
          <p>함께 쓰려면 계정 연결이 필요해요</p>
        </div>
      </>
    );
  }

  return (
    <>
      <NavBar title="가족과 함께 쓰기" onBack="auto" />

      <div className="section">함께 쓰는 사람 · {members.length}명</div>
      <div className="fields">
        {members.length === 0 ? (
          <div className="field">
            <span className="k">아직 혼자예요</span>
          </div>
        ) : (
          members.map((m) => (
            <div className="field" key={m.userId}>
              <span className="k">{m.email ?? '이름 없는 사용자'}</span>
              <span className="v">{m.role === 'owner' ? '만든 사람' : '가족'}</span>
            </div>
          ))
        )}
      </div>

      <div className="section">초대하기</div>
      <div className="pad">
        {code ? (
          <>
            <div
              className="card"
              style={{
                padding: 20,
                textAlign: 'center',
                fontFamily: 'var(--f-mono)',
                fontSize: 26,
                fontWeight: 700,
                letterSpacing: '0.15em',
              }}
            >
              {code}
            </div>
            <p className="note" style={{ marginLeft: 0, marginRight: 0 }}>
              이 코드를 가족에게 알려주세요. 7일 뒤에 만료돼요.
            </p>
            <button
              className="btn block"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(code);
                  show('코드를 복사했어요');
                } catch {
                  show('복사가 안 됐어요. 코드를 직접 알려주세요');
                }
              }}
            >
              코드 복사
            </button>
          </>
        ) : (
          <button
            className="btn primary lg block"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const { code: made, error } = await supa.createInvite();
              setBusy(false);
              if (error || !made) show('코드를 못 만들었어요. 잠시 뒤 다시 시도해주세요');
              else setCode(made);
            }}
          >
            초대 코드 만들기
          </button>
        )}
      </div>

      <div className="section">초대받으셨나요?</div>
      <div className="pad" style={{ paddingBottom: 24 }}>
        <input
          className="input"
          value={joinCode}
          maxLength={12}
          placeholder="초대 코드"
          onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
          style={{ fontFamily: 'var(--f-mono)', letterSpacing: '0.1em' }}
          aria-label="초대 코드"
        />
        <p className="note" style={{ marginLeft: 0, marginRight: 0 }}>
          참여하면 지금 이 기기의 목록 대신 가족의 목록을 보게 돼요.
        </p>
        <button
          className="btn primary lg block"
          disabled={joinCode.trim().length < 4 || busy}
          onClick={async () => {
            setBusy(true);
            const { error } = await supa.joinHousehold(joinCode);
            setBusy(false);
            if (error) {
              show('코드가 맞지 않거나 만료됐어요');
              return;
            }
            await init();
            show('이제 함께 관리해요');
          }}
        >
          참여하기
        </button>

        {members.length > 1 && (
          <button
            className="btn danger block"
            style={{ marginTop: 20 }}
            onClick={() => setConfirmLeave(true)}
          >
            이 집에서 나가기
          </button>
        )}
      </div>

      {confirmLeave && (
        <Confirm
          title="이 집에서 나갈까요?"
          lead="공유하던 목록이 더는 보이지 않아요. 새로 시작하게 됩니다."
          confirmLabel="나갈게요"
          danger
          onConfirm={async () => {
            const { error } = await supa.leaveHousehold();
            if (error) show('나가지 못했어요. 잠시 뒤 다시 시도해주세요');
            else {
              await init();
              show('나왔어요');
            }
          }}
          onClose={() => setConfirmLeave(false)}
        />
      )}

      {toast}
    </>
  );
}

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

export function NavBar({
  title,
  onBack,
  right,
}: {
  title: string;
  onBack?: (() => void) | 'auto';
  right?: ReactNode;
}) {
  const navigate = useNavigate();
  const back = onBack === 'auto' ? () => navigate(-1) : onBack;
  return (
    <div className="navbar">
      {back && (
        <button className="iconbtn" onClick={back} aria-label="뒤로">
          ←
        </button>
      )}
      <h2>{title}</h2>
      {right}
    </div>
  );
}

export function Sheet({
  title,
  lead,
  onClose,
  children,
}: {
  title: string;
  lead?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      className="sheet-bg"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grip" />
        <h3>{title}</h3>
        {lead && <p className="lead">{lead}</p>}
        {children}
      </div>
    </div>
  );
}

/** 문구 원칙 — 사과하지 않는다. 무엇이 잘못됐고 어떻게 되돌리는지만 말한다. */
export function Toast({ text, onDone }: { text: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2200);
    return () => clearTimeout(t);
  }, [text, onDone]);
  return (
    <div className="toast" role="status">
      {text}
    </div>
  );
}

export function useToast() {
  const [text, setText] = useState<string | null>(null);
  const node = text ? <Toast text={text} onDone={() => setText(null)} /> : null;
  return { show: setText, node };
}

/**
 * 오른쪽으로 밀면 "바꿨어요". 상세 화면에 들어가지 않아도 된다.
 * 포인터 이벤트만 쓰므로 마우스·터치 모두에서 같게 동작한다.
 */
export function SwipeToDone({
  onDone,
  disabled,
  children,
}: {
  onDone: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const locked = useRef<'h' | 'v' | null>(null);
  const THRESHOLD = 96;

  if (disabled) return <>{children}</>;

  const end = () => {
    if (dx >= THRESHOLD) onDone();
    setDx(0);
    start.current = null;
    locked.current = null;
  };

  return (
    <div className="swipe">
      <div className="behind" aria-hidden="true">
        {dx >= THRESHOLD ? '바꿨어요 ✓' : '밀어서 바꿨어요'}
      </div>
      <div
        className="front"
        style={{ transform: `translateX(${dx}px)`, transition: dx ? 'none' : undefined }}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          start.current = { x: e.clientX, y: e.clientY };
          locked.current = null;
        }}
        onPointerMove={(e) => {
          if (!start.current) return;
          const mx = e.clientX - start.current.x;
          const my = e.clientY - start.current.y;
          // 세로로 먼저 움직였으면 스크롤이다. 가로 스와이프로 가로채지 않는다.
          locked.current ??=
            Math.abs(mx) > 10 || Math.abs(my) > 10
              ? Math.abs(mx) > Math.abs(my)
                ? 'h'
                : 'v'
              : null;
          if (locked.current !== 'h') return;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          setDx(Math.max(0, Math.min(mx, 140)));
        }}
        onPointerUp={end}
        onPointerCancel={end}
      >
        {children}
      </div>
    </div>
  );
}

/** 확인이 필요한 되돌릴 수 없는 동작 — 삭제 · 일괄 리셋 · 이사 정리. */
export function Confirm({
  title,
  lead,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  lead?: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet title={title} lead={lead} onClose={onClose}>
      <div style={{ display: 'grid', gap: 8 }}>
        <button
          className={`btn lg block ${danger ? 'danger' : 'primary'}`}
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {confirmLabel}
        </button>
        <button className="btn ghost block" onClick={onClose}>
          그만둘게요
        </button>
      </div>
    </Sheet>
  );
}

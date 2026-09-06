/**
 * 추가 — 목록 선택
 *
 * 진입점은 언제나 여기 하나다. 구역별로 묶인 프리셋을 탭하면 담기고,
 * 연속으로 여러 개 담을 수 있다. 등록 5개가 3분 안에 끝나야 한다.
 */
import { useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { searchCatalog } from '../core/catalog';
import { cycleLabel } from '../core/humanize';
import { isFrequent } from '../core/cycle';
import { ZONES, type CatalogItem, type Zone } from '../core/types';
import { CATALOG } from '../store/catalog';
import { useApp } from '../store/useApp';
import { NavBar, useToast } from '../ui/primitives';
import { enablePush, pushState } from '../push/client';
import { getRepository } from '../db';

export default function Add() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const fromOnboarding = params.get('from') === 'onboarding';
  const { show, node: toast } = useToast();

  const addItems = useApp((s) => s.addItems);
  const itemCount = useApp((s) => s.items.filter((i) => i.status !== 'archived').length);

  const [query, setQuery] = useState('');
  const [basket, setBasket] = useState<CatalogItem[]>([]);
  const [busy, setBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => (query.trim() ? searchCatalog(CATALOG, query) : null), [query]);

  const inBasket = useMemo(() => new Set(basket.map((b) => b.code)), [basket]);

  const toggle = (item: CatalogItem) => {
    // 개봉일 기준 품목은 사용기한을 골라야 하므로 전용 화면으로 보낸다
    if (item.input_type === 'pao') {
      navigate(`/add/pao/${item.code}${fromOnboarding ? '?from=onboarding' : ''}`);
      return;
    }
    setBasket((prev) =>
      prev.some((b) => b.code === item.code)
        ? prev.filter((b) => b.code !== item.code)
        : [...prev, item],
    );
  };

  const save = async () => {
    if (basket.length === 0) return;
    setBusy(true);
    const wasEmpty = itemCount === 0;
    await addItems(basket.map((catalog) => ({ catalog })));

    // 첫 등록 직후에만 OS 권한을 묻는다 — 이제 알림이 갈 일이 생겼다는 맥락에서.
    if (wasEmpty && pushState() === 'default') {
      await enablePush(getRepository()).catch(() => undefined);
    }

    const frequent = basket.filter((b) => isFrequent(b.cycle_days));
    if (fromOnboarding) navigate(-1);
    else navigate('/', { replace: true });
    if (frequent.length > 0) {
      show(`${frequent[0].name}는 주기가 짧아 알림이 자주 갑니다`);
    }
  };

  return (
    <>
      <NavBar
        title="추가하기"
        onBack="auto"
        right={
          <button
            className="iconbtn"
            aria-label="검색"
            onClick={() => searchRef.current?.focus()}
          >
            🔍
          </button>
        }
      />

      <div className="pad" style={{ paddingBottom: 12 }}>
        <input
          ref={searchRef}
          className="input"
          type="search"
          placeholder="품목 이름으로 찾기"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="품목 검색"
        />
      </div>

      {results ? (
        results.length === 0 ? (
          <div className="empty">
            <h3>‘{query.trim()}’는 아직 목록에 없어요</h3>
            <p>직접 만들어서 쓰실 수 있어요</p>
            <button
              className="btn primary"
              style={{ marginTop: 14 }}
              onClick={() =>
                navigate(
                  `/add/custom?name=${encodeURIComponent(query.trim())}${
                    fromOnboarding ? '&from=onboarding' : ''
                  }`,
                )
              }
            >
              직접 추가하기
            </button>
          </div>
        ) : (
          <div className="zonegroup">
            {results.map((item) => (
              <CatalogRow
                key={item.code}
                item={item}
                on={inBasket.has(item.code)}
                showZone
                onToggle={() => toggle(item)}
              />
            ))}
          </div>
        )
      ) : (
        ZONES.map((zone, i) => (
          <ZoneSection
            key={zone}
            zone={zone}
            defaultOpen={i === 0}
            inBasket={inBasket}
            onToggle={toggle}
          />
        ))
      )}

      {!results && (
        <div className="pad" style={{ paddingBottom: 20 }}>
          <button
            className="btn block"
            onClick={() => navigate(`/add/custom${fromOnboarding ? '?from=onboarding' : ''}`)}
          >
            목록에 없는 것 직접 추가하기
          </button>
        </div>
      )}

      {basket.length > 0 && (
        <div className="basketbar">
          <button className="btn primary lg block" disabled={busy} onClick={save}>
            {basket.length}개 담기
          </button>
        </div>
      )}

      {toast}
    </>
  );
}

function ZoneSection({
  zone,
  defaultOpen,
  inBasket,
  onToggle,
}: {
  zone: Zone;
  defaultOpen: boolean;
  inBasket: ReadonlySet<string>;
  onToggle: (item: CatalogItem) => void;
}) {
  const items = CATALOG.byZone.get(zone) ?? [];
  const [open, setOpen] = useState(defaultOpen);
  if (items.length === 0) return null;

  return (
    <>
      <button className="section toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span>
          {zone} · {items.length}
        </span>
        <span className="chev" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="zonegroup">
          {items.map((item) => (
            <CatalogRow
              key={item.code}
              item={item}
              on={inBasket.has(item.code)}
              onToggle={() => onToggle(item)}
            />
          ))}
        </div>
      )}
    </>
  );
}

function CatalogRow({
  item,
  on,
  showZone,
  onToggle,
}: {
  item: CatalogItem;
  on: boolean;
  showZone?: boolean;
  onToggle: () => void;
}) {
  return (
    <button className={`catrow ${on ? 'on' : ''}`} onClick={onToggle} aria-pressed={on}>
      <span className="nm">
        {item.name}
        {showZone && <span className="cy"> · {item.zone}</span>}
      </span>
      <span className="cy">{cycleLabel(item.cycle_days)}</span>
      <span className="add" aria-hidden="true">
        {on ? '✓' : item.input_type === 'pao' ? '›' : '+'}
      </span>
    </button>
  );
}

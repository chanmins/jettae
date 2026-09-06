import { useEffect } from 'react';
import {
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { useApp } from './store/useApp';
import Onboarding from './screens/Onboarding';
import Home from './screens/Home';
import Add from './screens/Add';
import AddPao from './screens/AddPao';
import AddCustom from './screens/AddCustom';
import Detail from './screens/Detail';
import Overdue from './screens/Overdue';
import Settings from './screens/Settings';
import MoveHouse from './screens/MoveHouse';
import Archived from './screens/Archived';
import Family from './screens/Family';

/** 탭 3개면 충분하다. 이 앱은 오래 머무는 앱이 아니다. */
function TabBar() {
  return (
    <nav className="tabbar">
      <NavLink to="/" end className={({ isActive }) => (isActive ? 'on' : '')}>
        <span className="ico" aria-hidden="true">
          🏠
        </span>
        홈
      </NavLink>
      <NavLink to="/add" className="fab" aria-label="추가하기">
        +
      </NavLink>
      <NavLink to="/settings" className={({ isActive }) => (isActive ? 'on' : '')}>
        <span className="ico" aria-hidden="true">
          ⚙️
        </span>
        설정
      </NavLink>
    </nav>
  );
}

const TAB_ROUTES = new Set(['/', '/settings']);

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();

  const ready = useApp((s) => s.ready);
  const loadError = useApp((s) => s.loadError);
  const onboardedAt = useApp((s) => s.settings.onboardedAt);
  const init = useApp((s) => s.init);
  const refreshToday = useApp((s) => s.refreshToday);

  useEffect(() => {
    void init();
  }, [init]);

  // 자정을 넘기거나 앱으로 돌아오면 '오늘'을 다시 읽는다.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshToday();
    };
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(refreshToday, 60_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, [refreshToday]);

  // 알림에서 앱을 열었을 때 서비스워커가 보내는 이동 지시.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'navigate' && typeof e.data.path === 'string') {
        navigate(e.data.path);
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [navigate]);

  if (!ready) {
    return (
      <div className="app">
        <div className="empty" style={{ marginTop: '40vh' }}>
          <p>불러오는 중이에요</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="app">
        <div className="empty" style={{ marginTop: '35vh' }}>
          <h3>저장된 내용을 못 읽었어요</h3>
          <p>브라우저를 새로 고치면 다시 시도해요</p>
          <button
            className="btn primary"
            style={{ marginTop: 14 }}
            onClick={() => window.location.reload()}
          >
            다시 시도
          </button>
        </div>
      </div>
    );
  }

  const onboarding = location.pathname === '/onboarding';
  /**
   * 온보딩의 '다른 것 찾아보기 / 직접 추가하기'는 /add로 나간다. 이 경로를 막으면
   * 가드가 /onboarding으로 되돌리고, 컴포넌트가 다시 마운트되어 첫 화면으로 떨어진다.
   * from=onboarding이 붙은 동안만 열어둔다 — 탭바 없이 그 화면만 보여준다.
   */
  const onboardingDetour =
    !onboardedAt && new URLSearchParams(location.search).get('from') === 'onboarding';
  if (!onboardedAt && !onboarding && !onboardingDetour)
    return <Navigate to="/onboarding" replace />;
  if (onboardedAt && onboarding) return <Navigate to="/" replace />;
  if (onboarding) return <Onboarding />;

  return (
    <div className="app">
      <div className="scroll">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/add" element={<Add />} />
          <Route path="/add/pao/:code" element={<AddPao />} />
          <Route path="/add/custom" element={<AddCustom />} />
          <Route path="/item/:id" element={<Detail />} />
          <Route path="/overdue" element={<Overdue />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/settings/move" element={<MoveHouse />} />
          <Route path="/settings/archived" element={<Archived />} />
          <Route path="/settings/family" element={<Family />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      {TAB_ROUTES.has(location.pathname) && <TabBar />}
    </div>
  );
}

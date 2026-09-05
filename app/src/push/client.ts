/**
 * push/client — 알림 권한과 구독
 *
 * 시간 설정과 OS 권한 요청은 분리한다. 온보딩의 "언제 알려드릴까요?"는 앱 안의
 * 설정일 뿐이고, 실제 권한 팝업은 첫 등록 직후에 띄운다 — 알릴 것도 없는데 요구하면
 * 거절률이 오르고, iOS는 한 번 거절하면 회복이 어렵다.
 */
import { isSupabaseRepository, type Repository } from '../db';

export type PushState =
  | 'unsupported' // 이 브라우저는 웹 푸시를 모른다
  | 'default' // 아직 묻지 않았다
  | 'granted'
  | 'denied'
  | 'no-key'; // VAPID 키가 없다 — 개발 중 로컬 전용 모드

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function pushState(): PushState {
  if (!pushSupported()) return 'unsupported';
  if (!import.meta.env.VITE_VAPID_PUBLIC_KEY) return 'no-key';
  return Notification.permission as PushState;
}

/** base64url VAPID 공개키 → Uint8Array */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function platformName(): string {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'web';
}

/**
 * 권한을 묻고 구독을 서버에 올린다.
 * 거절당해도 앱은 그대로 돌아간다 — 홈에 "알림이 꺼져 있어요"가 뜰 뿐이다.
 */
export async function enablePush(repo: Repository): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  const key = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (!key) return 'no-key';

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission as PushState;

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    }));

  if (isSupabaseRepository(repo)) {
    await repo.saveSubscription(subscription.toJSON(), platformName());
  }
  return 'granted';
}

export async function disablePush(repo: Repository): Promise<void> {
  if (!pushSupported()) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  if (isSupabaseRepository(repo)) await repo.removeSubscription(subscription.endpoint);
  await subscription.unsubscribe();
}

/** 구독이 살아 있는지 — 조용한 실패를 눈에 보이게 만드는 데 쓴다. */
export async function hasLiveSubscription(): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  const registration = await navigator.serviceWorker.ready;
  return (await registration.pushManager.getSubscription()) !== null;
}

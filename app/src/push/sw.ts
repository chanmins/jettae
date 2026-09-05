/// <reference lib="webworker" />
/**
 * 서비스워커 — 잠금화면에서 끝나야 한다
 *
 * 이 앱에서는 앱을 열어야만 하는 것이 실패다. 알림의 버튼을 누르면 여기서 바로
 * 서버에 응답을 보내고, 앱은 열지 않는다.
 *
 * 응답 인증은 푸시 페이로드에 실려 온 1회용 토큰으로 한다 — 서비스워커에는
 * 사용자 세션이 없기 때문이다.
 */
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { clientsClaim } from 'workbox-core';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
self.skipWaiting();
clientsClaim();

interface PushPayload {
  digestId: string;
  token: string;
  respondUrl: string;
  kind: string;
  title: string;
  body: string;
  actions: Array<{ id: string; title: string }>;
  itemIds: string[];
}

function parse(event: PushEvent): PushPayload | null {
  try {
    return event.data ? (event.data.json() as PushPayload) : null;
  } catch {
    return null;
  }
}

self.addEventListener('push', (event: PushEvent) => {
  const payload = parse(event);
  if (!payload) {
    // 페이로드가 깨져도 조용히 넘어가지 않는다. userVisibleOnly 약속을 지켜야 한다.
    event.waitUntil(
      self.registration.showNotification('제때', {
        body: '앱에서 확인해주세요',
        icon: '/icons/icon-192.png',
        tag: 'jettae-fallback',
      }),
    );
    return;
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-72.png',
      tag: `jettae-${payload.digestId}`,
      renotify: true,
      // 푸시 액션 버튼은 두 개까지가 현실적이다
      actions: payload.actions.slice(0, 2).map((a) => ({ action: a.id, title: a.title })),
      data: payload,
    } as NotificationOptions),
  );
});

async function respond(payload: PushPayload, response: string): Promise<void> {
  await fetch(payload.respondUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      digestId: payload.digestId,
      token: payload.token,
      response,
    }),
    // 서비스워커에는 세션이 없다. 토큰이 곧 인증이다.
    credentials: 'omit',
  });
}

async function openApp(path: string): Promise<void> {
  const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clientList) {
    if ('focus' in client) {
      await client.focus();
      client.postMessage({ type: 'navigate', path });
      return;
    }
  }
  await self.clients.openWindow(path);
}

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  const payload = event.notification.data as PushPayload | undefined;
  event.notification.close();
  if (!payload) {
    event.waitUntil(openApp('/'));
    return;
  }

  const action = event.action;

  // 앱을 열어야 하는 응답
  if (!action || action === 'open') {
    event.waitUntil(openApp(payload.kind === 'add_more' ? '/add' : '/'));
    return;
  }
  if (action === 'bulk_reset') {
    event.waitUntil(openApp('/overdue'));
    return;
  }

  // 잠금화면에서 끝나는 응답
  event.waitUntil(
    respond(payload, action).then(async () => {
      const said: Record<string, string> = {
        replaced: '기록해뒀어요',
        snoozed: '3일 뒤에 다시 알려드릴게요',
        still_good: '조금 더 미뤄뒀어요',
        season_yes: '오늘부터 세기 시작할게요',
        season_no: '나중에 다시 여쭤볼게요',
        ack: '',
      };
      const text = said[action];
      if (text) {
        await self.registration.showNotification('제때', {
          body: text,
          icon: '/icons/icon-192.png',
          tag: `jettae-ack-${payload.digestId}`,
          silent: true,
        });
      }
    }),
  );
});

/** 응답 없이 알림을 닫은 것도 신호다 — 연속 무시 감지에 쓴다. */
self.addEventListener('notificationclose', (event: NotificationEvent) => {
  const payload = event.notification.data as PushPayload | undefined;
  if (!payload || payload.kind === 'add_more') return;
  event.waitUntil(respond(payload, 'dismissed').catch(() => undefined));
});

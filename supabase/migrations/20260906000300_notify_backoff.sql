-- 알림이 무한히 반복되던 두 경로를 막기 위한 열 두 개.
--
-- 배경: buildDailyDigest가 돌려주는 digest 중 stage가 null인 것(시즌 질문,
-- 밀림 정리 제안)은 발송 후 아무 상태도 남기지 않았다. 다음 날 같은 조건이
-- 그대로 성립하므로 응답하지 않으면 매일 같은 알림이 나갔고, 두 알림 모두
-- 우선순위가 높아 그동안 다른 알림은 한 건도 나가지 못했다.
--
-- 시즌 질문은 items.season_asked_at 이 이미 있어서 발송 시점에 찍기만 하면
-- 되지만, 밀림 제안은 기록할 자리가 없었다. 그래서 여기서 만든다.

alter table user_settings
  add column if not exists overdue_nudged_on date;

comment on column user_settings.overdue_nudged_on is
  '마지막으로 ''밀린 게 N개 있어요''를 보낸 날. 재발송 간격의 기준.';

-- 무응답을 세기 위한 열.
--
-- ignore_streak 은 처음부터 있었지만 실제로 증가하는 경로는 서비스워커의
-- notificationclose('dismissed') 하나뿐이었다. 잠금화면에 그냥 놔둔 알림은
-- 그 이벤트를 발생시키지 않으므로, 진짜 무응답은 한 번도 집계되지 않았고
-- shouldAskKeepNotifying 은 영원히 false 였다.
--
-- 이제 발송 함수가 지난 알림 중 응답 없이 만료된 것을 쓸어 담아 세는데,
-- 같은 알림을 두 번 세면 안 되므로 처리 여부를 여기 남긴다.
alter table notifications
  add column if not exists ignore_counted_at timestamptz;

comment on column notifications.ignore_counted_at is
  '무응답으로 집계한 시각. null 이면 아직 세지 않았다.';

-- 만료된 미응답 알림을 찾는 쿼리를 위한 부분 인덱스.
create index if not exists notifications_uncounted_idx
  on notifications (user_id, sent_at)
  where responded_at is null and ignore_counted_at is null;

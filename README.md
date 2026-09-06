# 제때

집 안 소모품의 교체 시기를 대신 기억해주는 앱. 목록에서 탭 한 번으로 등록하고, 때가 되면
알림을 받고, 바꿨으면 탭 한 번으로 답한다. 그게 전부다.

기획서와 화면 설계는 [`docs/`](docs/)에 있다. 이 저장소는 그 문서의 Phase 0 ~ Phase 2를
구현한 것이다 — **Phase 3의 Swift · Kotlin 네이티브 재작성은 포함하지 않는다.**

## 지금 상태

| | |
|---|---|
| 카탈로그 | 159종 (목록 선택 127 · 개봉일 기준 32) |
| 테스트 | 133개 통과 (core 단위 + 수명주기 시나리오) |
| 운영비 | 월 $0 (Supabase · Cloudflare 무료 티어) |
| AI | 쓰지 않음 — 카탈로그 조회와 날짜 계산뿐 |

## 빠르게 돌려보기

계정도 서버도 필요 없다. 환경변수가 비어 있으면 앱은 IndexedDB만으로 완전히 동작한다.

```bash
npm install --prefix app
npm run dev
```

http://localhost:5173 — 온보딩부터 시작된다.

전부 검증하려면:

```bash
npm run verify
```

카탈로그 시드 생성 → core 동기화 → 타입 검사 → 테스트 → 프로덕션 빌드를 차례로 돌린다.

## 구조

```
app/src/core/     부수효과 없는 도메인 계층 ← 이식의 대상
app/src/db/       저장소 (로컬 IndexedDB / Supabase)
app/src/store/    core와 화면을 잇는 지점
app/src/screens/  온보딩 · 홈 · 추가 · 상세 · 설정
app/src/push/     알림 권한, 구독, 서비스워커
app/tests/        core 단위 테스트 + 수명주기 시나리오
supabase/         스키마 · RLS · RPC · 엣지 함수 · 크론
scripts/          카탈로그 시드, core 동기화, 아이콘, VAPID 키
data/             카탈로그 원본 (JSON · 스프레드시트)
docs/             기획서 · 화면 설계
```

### `core/`가 이 저장소의 중심이다

`core/`의 모든 함수는 순수하다. `Date.now()` · `fetch` · `localStorage` · DOM을 쓰지 않고,
현재 시각이 필요하면 언제나 인자로 받는다.

그래서 Phase 3에서 Swift · Kotlin으로 옮길 때 **`app/tests/`가 그대로 이식 명세가 된다.**
같은 입력에 같은 출력이 나오면 이식이 끝난 것이다. 특히
[`tests/scenario.test.ts`](app/tests/scenario.test.ts)는 등록부터 1년치 알림까지를
날짜로 돌려보므로, 이 파일이 통과하면 루프 전체가 옮겨진 것이다.

| 파일 | 하는 일 |
|---|---|
| `date.ts` | `YYYY-MM-DD` 문자열 위의 달력 연산. 시각을 섞지 않아 서머타임에 하루가 밀리지 않는다 |
| `cycle.ts` | 다음 예정일 · D-day · 상태 3색 · 알림 응답의 결과 |
| `notify.ts` | D-7 · D-DAY · D+3 · D+10 단계 판정, 하루 한 건 묶음, 확정 문구 |
| `season.ts` | 시즌 밖 카운트 정지, 시즌 시작 시 1회 확인 |
| `selfCorrect.ts` | 최근 3회 교체 간격의 중앙값으로 주기 제안 |
| `overdue.ts` | 밀린 항목 접기, 일괄 리셋, 이사 정리 |
| `catalog.ts` | 159종 조회 · 검색 · 온보딩 추천 |
| `usage.ts` | 사용량 기준 주기 (Phase 4 대비, 스키마만 미리) |

## 설계에서 가져온 규칙

문서의 판단이 코드에 어떻게 들어갔는지. 고치기 전에 이유부터 보면 된다.

- **하루 한 건.** 여러 품목이 같은 날 걸리면 알림 하나로 묶는다 (`buildDailyDigest`).
- **잠금화면에서 끝난다.** 알림 버튼이 앱을 열지 않고 서버에 바로 응답한다
  (`push/sw.ts` → `notify-respond`). 앱을 열어야만 하는 것이 실패다.
- **시즌 밖에서는 세지 않는다.** 12월에 "선풍기 청소할 때예요"가 뜨면 신뢰가 끝난다.
  멈춘 동안 D-day가 얼어붙고, 시즌이 열리면 한 번 묻는다. 누른 날이 새 기준일이 된다.
- **안전 품목은 주기가 늘지 않는다.** 화재감지기 · 소화기 · 가스는 `safety_locked`로
  자기교정에서 제외된다. 미룰 수는 있어도 권장 주기는 그대로다.
- **밀린 게 5개를 넘으면 접는다.** 붉은 항목 12개를 그대로 보여주면 앱을 지운다.
  가장 큰 버튼은 "지금부터 다시 셀게요"다.
- **몰래 바꾸지 않는다.** 자기교정은 제안만 한다. 그리고 교체 기록 4번(= 간격 3개)이
  쌓이기 전에는 제안하지 않는다 — 잘못된 제안이 늦은 제안보다 나쁘다.
- **통과 조건이 없다.** 온보딩은 하나도 고르지 않고 끝까지 넘어갈 수 있다. 대신 등록 0개면
  홈이 곧 추천 화면이 된다. 그 사용자에게 도달할 다른 경로가 없기 때문이다.
- **권한은 첫 등록 직후에 묻는다.** 온보딩의 "언제 알려드릴까요?"는 앱 안의 설정일 뿐이다.
  알릴 것도 없는 상태에서 OS 권한을 요구하면 거절률이 오른다.

## 카탈로그

[`data/jettae_catalog.json`](data/jettae_catalog.json)이 원본이다. 고친 뒤에는:

```bash
npm run seed
```

검증(코드 형식 · 구역 · 주기 범위 · 사용량 필드) 후 두 곳을 다시 만든다.

- `supabase/migrations/20260905000400_catalog_seed.sql`
- `app/src/data/catalog.json` (앱 번들 — 오프라인에서도 등록이 된다)

## Supabase 붙이기

없어도 앱은 돌아간다. 붙이면 계정 · 기기 간 동기화 · 가족 공유 · 푸시 알림이 켜진다.

```bash
supabase link --project-ref <ref>
supabase db push                  # 스키마 → RLS → RPC → 카탈로그 → 크론
supabase functions deploy notify-dispatch notify-respond push-health
```

VAPID 키를 만들고 양쪽에 넣는다:

```bash
npm run vapid
```

`app/.env`:

```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
VITE_VAPID_PUBLIC_KEY=<공개키>
```

`supabase/functions/.env` (예시는 `.env.example`):

```bash
supabase secrets set --env-file supabase/functions/.env
```

마지막으로 크론이 엣지 함수를 부를 수 있게 두 값을 Vault에 넣는다.
`cron_secret`은 `supabase/functions/.env`의 `CRON_SECRET`과 **같은 값**이어야 한다.
대시보드 SQL 편집기에서 한 번 — `<>` 괄호는 값에 포함하지 않는다:

```sql
select vault.create_secret('https://<ref>.supabase.co/functions/v1', 'functions_url');
select vault.create_secret('<CRON_SECRET과 같은 값>', 'cron_secret');
```

값을 갱신할 때는 `create_secret`이 아니라 `vault.update_secret`을 쓴다.

크론 인증에 `service_role` 키를 쓰지 않는 이유가 있다. 함수가 비교하는
`SUPABASE_SERVICE_ROLE_KEY`는 Supabase가 주입하는 값이고, 프로젝트의 API 키 체계에
따라 형식이 달라진다(레거시 JWT / `sb_secret_…`). 대시보드의 `service_role` 키를
정확히 넣어도 주입값과 달라 401이 난다. 그래서 맞춰 볼 비밀은 우리가 정한다.
Vault에 `cron_secret`이 없으면 예전대로 `service_role_key`를 보낸다.

호스팅 Supabase의 postgres 역할은 superuser가 아니라서
`alter database postgres set app.settings.*`는 42501로 막힌다 — 예전 방식이니 쓰지 않는다.

### 알림이 도는 방식

```
pg_cron (5분마다)
  └→ notify-dispatch
       ├ 지금이 발송 슬롯인 사용자를 고른다 (사용자마다 시간대가 다르다)
       ├ core/notify.buildDailyDigest 로 알림 하나를 만든다   ← 앱과 같은 코드
       ├ Web Push (VAPID) 로 보낸다
       └ notifications 행에 1회용 응답 토큰을 남긴다

서비스워커
  └→ 버튼 탭 → notify-respond (토큰으로 인증) → core 함수로 기준일 재설정
```

문구와 단계 판정을 서버에서 다시 구현하지 않는다. `npm run sync:core`가 `app/src/core`를
`supabase/functions/_shared/core`로 복사한다. **`_shared/core`는 생성물이므로 직접 고치지 않는다.**
core를 고치면 다시 돌린다.

전송 채널은 인터페이스 뒤에 있다 — Phase 3에서 FCM/APNs로 갈아끼울 지점은
`notify-dispatch/index.ts`의 `sendPush` 하나다.

## 배포 (Firebase Hosting)

fitlog과 같은 구조다 — `main`에 push하면 GitHub Actions가 빌드하고 Firebase Hosting에 올린다.
주소가 생기므로 폰에서도 열리고, 홈 화면에 추가하면 설치형 앱처럼 뜬다.

> 기획서는 원래 PWA를 배포하지 않기로 했다(배포본은 Phase 3 네이티브). 지금은 **어디서든
> 열어보기 위한 미리보기 배포**이고, 그 결정 자체를 뒤집은 것은 아니다.

### 한 번만 하는 설정

1. [Firebase 콘솔](https://console.firebase.google.com)에서 프로젝트를 만든다 (예: `jettae-1234`).
2. 이 저장소를 GitHub에 올린다.
3. Hosting → GitHub 연결(또는 `firebase init hosting:github`). Firebase가
   `FIREBASE_SERVICE_ACCOUNT` 시크릿을 저장소에 자동으로 넣어준다.
4. 저장소 Settings → Secrets and variables → Actions → **Variables**에
   `FIREBASE_PROJECT_ID`를 넣는다.
5. `.firebaserc`의 `REPLACE_WITH_FIREBASE_PROJECT_ID`를 같은 값으로 바꾼다
   (로컬에서 `firebase deploy`를 쓸 때만 필요하다).

그 뒤로는 push할 때마다 자동으로 올라간다. 워크플로는 배포 전에 **생성물 최신 여부 → 타입
검사 → 테스트 → 빌드**를 차례로 돌리므로, 깨진 상태가 배포되지 않는다.

### Supabase를 함께 붙일 때

같은 **Variables**에 세 개를 더 넣으면 계정 동기화와 푸시가 켜진다.

```
VITE_SUPABASE_URL · VITE_SUPABASE_ANON_KEY · VITE_VAPID_PUBLIC_KEY
```

비워두면 배포본도 IndexedDB만 쓰는 **로컬 모드**로 동작한다 — 앱은 온전히 돌아가지만
기기마다 데이터가 따로 놀고 푸시가 가지 않는다.

붙일 때는 Supabase 대시보드에서 배포 주소(`https://<project>.web.app`)를
**Authentication → URL Configuration**의 Site URL·Redirect URLs에 추가해야 이메일 연결이 된다.

### 빌드 결과를 로컬에서 확인하려면

```bash
npm run build
npm run preview --prefix app
```

`firebase.json`이 SPA 리라이트와 캐시 헤더를 담당한다 — `sw.js`·`index.html`·매니페스트는
no-cache, 해시가 붙은 `/assets/*`는 1년 캐시.

개발 중 알림 테스트는 Android 크롬으로 한다 — 설치 없이 Web Push가 동작한다.

## 알아둘 것

- **iOS Safari의 웹 푸시**는 홈 화면에 설치된 PWA에서만 동작한다. 배포 주소가 생겼으니
  아이폰에서 공유 → 홈 화면에 추가를 하면 알림까지 받을 수는 있지만, 온보딩에 그 안내
  단계는 두지 않았다(기획서 결정). 아이폰에서 그냥 사파리로 열면 알림만 오지 않는다.
- **번들 크기**는 gzip 141KB이고 대부분이 `@supabase/supabase-js`다. 로컬 전용으로만 쓸
  거라면 지연 로딩으로 줄일 여지가 있다.
- **교체 주기는 일반 권장값이다.** 제품·사용 환경에 따라 다르고, 제조사 권장값이 있으면
  그쪽이 우선이다. 앱 설정 화면에도 같은 문장이 들어가 있다.

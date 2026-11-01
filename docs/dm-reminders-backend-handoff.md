# 캘린더 DM 리마인드 구현 요청

작성일: 2026-11-01. 백엔드 팀원에게 전달할 구현 명세다. **아직 실제 예약 발송은 구현되지 않았다.** 이 문서 추가로 운영 Cron이나 데이터베이스를 변경하지 않았다.

## 목표와 현재 연결점

사용자가 캘린더에 등록한 일정의 알림 시각에 `@dimi_in`이 DM을 보낸다. 일정 저장 성공과 DM 전송 성공을 구분하고, 수정·삭제·계정 변경 뒤 잘못된 사람에게 보내지 않아야 한다.

| 현재 코드 | 구현할 내용 |
| --- | --- |
| `member-data.mjs`, `api/calendar.mjs` | 기존 본인 일정 CRUD에 알림 설정·상태 추가. 현재 GET은 `reminders_available: false` 반환 |
| `supabase/migrations/20261031180518_calendar_and_taste.sql` | 기존 `calendar_events`와 소유권/RLS 재사용. 새 마이그레이션으로 설정·발송 작업 추가 |
| `public/js/dashboard-calendar.js` | `serverEvent()`가 지금 `dm: false, rem: []`로 고정. 실제 설정과 발송 상태로 교체 |
| `frontend/calendar/Calendar.dc.html` | PC의 옵션·미리보기 원본. 생성물 `calendar-model.js`를 직접 수정하지 않기 |
| `frontend/mobile/MobileCalendar.fragment.html` | 모바일 옵션·일정 카드·미리보기. PC와 같은 서버 상태 사용 |
| `api/instagram.mjs`, `server.mjs` | 서명 검증한 사용자 DM 시각 저장, 기존 봇 토큰 로더·전송 패턴 재사용 |
| `cloud-auth.mjs` | 갱신된 봇 토큰은 기존 로더로 읽기. 환경변수의 오래된 토큰만 별도로 복사하지 않기 |
| `vercel.json` | 현재 Cron은 cleanup만 있음. 발송 작업자용 보호된 경로 추가 필요 |

기존 일정 조회·저장과 내 취향 동기화는 이미 동작한다. [기존 캘린더·취향 문서](calendar-taste-backend-handoff.md)의 초기 설계 설명보다 위 코드의 구현 상태를 우선한다.

## 발송 가능 범위를 먼저 확정

MVP는 **마지막 유효한 사용자 DM 이후 24시간 이내의 자동 메시지만 허용**하는 보수적인 기준으로 구현한다. 연결·동의만으로 며칠 뒤의 선제 자동 DM까지 허용된다고 간주하지 않는다. 앱별로 승인된 다른 발송 경로가 확인되기 전에는 창 밖 발송을 하지 않는다.

- 마지막 사용자 메시지 시각은 HMAC 검증과 봇 수신 대상 검증이 끝난 실제 inbound 메시지에서만 갱신한다. 봇 답장, 읽음 확인, echo, 웹 로그인, 캘린더 클릭은 창을 연장하지 않는다.
- 오래된 재전송은 저장된 시각을 뒤로 돌리지 않는다. 미래 타임스탬프로 창을 늘릴 수 없도록 검증하고 원본 시각과 서버 수신 시각을 구분한다.
- 예약 저장 시와 **실제 발송 직전** 모두 창을 확인한다. 창 밖이면 `skipped / window_closed`로 끝내고, DM을 보냈다고 표시하지 않는다.
- `HUMAN_AGENT`는 자동 리마인드 우회에 사용하지 않는다. 토큰 재발급·테스터 등록도 발송 시간 제한의 우회 수단으로 취급하지 않는다.
- 장기 일정 자체는 그대로 저장한다. 허용된 대체 채널은 이번 범위에서 새로 만들지 않으며, DM이 불가능해도 캘린더에서 일정을 볼 수 있다.

Meta 공식 문서는 이번 조회에서 429/접근 오류가 있어 최신 전문을 재확인하지 못했다. 담당자는 배포 전 아래 공식 Send API/정책 페이지와 실제 앱 권한을 확인해야 한다. 광범위한 테스트 대신 테스트 계정 한 건으로 제한한다.

## 사용자 설정과 API 계약

기존 `POST /api/calendar`, `PATCH /api/calendar/:id`에 다음 필드를 추가하는 안이다. 일정과 알림 설정 변경은 하나의 트랜잭션으로 확정한다.

```json
{
  "content_id": "fc42-2",
  "kind": "visit",
  "date": "2026-11-07",
  "time": "14:00",
  "timezone": "Asia/Seoul",
  "reminders": ["h1", "eve"]
}
```

- 생성의 `Idempotency-Key`, 수정의 `revision`, 기존 날짜·콘텐츠 규칙을 유지한다. 예시는 신규 필드 설명이며 PATCH에도 기존 `revision`이 필요하다.
- `reminders: []`는 알림 끄기다. PATCH에서 필드 생략은 기존 설정 유지로 처리한다. 생성에서 생략하면 꺼진 상태다.
- 허용된 옵션 키만 받고 중복 제거한다. 최대 네 개. 사용자가 보낸 수신자 ID·핸들·발송 시각·전송 상태는 받지 않는다.
- `user_id`는 검증된 세션에서 정하고, `fc42-2`의 하위 카드 번호까지 기존 소유권 검증을 그대로 사용한다.
- GET/저장 응답은 기존 일정 필드를 유지하면서 `reminders`와 실제 `reminder_jobs`를 추가한다. 사용자 응답에 토큰·내부 IGSID·실제 전송 본문 로그를 넣지 않는다.

응답 예시(추가 필드):

```json
{
  "reminders_available": true,
  "dm_eligibility": {
    "eligible_now": false,
    "reason": "window_closed",
    "window_ends_at": "2026-11-06T03:00:00Z"
  },
  "events": [{
    "id": "event-uuid",
    "content_id": "fc42-2",
    "kind": "visit",
    "date": "2026-11-07",
    "time": "14:00",
    "timezone": "Asia/Seoul",
    "revision": 2,
    "reminders": ["h1"],
    "reminder_jobs": [{
      "key": "h1",
      "scheduled_at": "2026-11-07T04:00:00Z",
      "status": "scheduled",
      "reason": null,
      "sent_at": null
    }]
  }]
}
```

`reminders_available`는 작업자·DB·필수 설정을 포함한 기능 준비 여부다. 특정 사용자의 지금 발송 가능 여부와 다르다. 예약 후에도 창 만료로 건너뛸 수 있다는 설명을 보여야 한다. 실패한 일정 저장은 기존 화면·초안을 유지한다.

## 예약 시각 계산

| 옵션 키 | KST 기준 계산 |
| --- | --- |
| `day9` | 일정 날짜 당일 09:00 |
| `h1` | 일정 날짜·시각의 1시간 전. `time: null`이면 허용하지 않음 |
| `eve` | 일정 날짜 전날 20:00 |
| `d3` | 일정 날짜 3일 전 09:00 |

계산은 서버에서 수행하고 UTC `timestamptz`로 저장한다. 종일 일정을 자정으로 바꾸지 않는다. 이미 지난 알림은 `skipped / past`로 표시하며 즉시 몰아서 보내지 않는다. `h1`이 전날로 넘어가는 경우도 지원한다.

## 저장과 작업자

백엔드 담당자가 기존 Supabase 마이그레이션 패턴으로 구현한다. 공개 클라이언트가 발송 상태를 바꾸는 구조는 금지한다.

1. 일정별 선택 옵션을 저장하고, 옵션마다 발송 작업을 만든다. 최소 필드는 `event_id`, `event_revision`, `reminder_key`, `scheduled_at`, `status`, `reason`, `attempts`, `claimed_at`, `request_started_at`, `sent_at`, `meta_message_id`다.
2. `(event_id, event_revision, reminder_key)`에 유일성 제약을 둔다. 작업 테이블은 일정 삭제와 함께 정리하고, 일반 사용자는 본인에게 공개할 상태만 읽을 수 있게 한다. worker 전용 쓰기와 사용자 설정 쓰기를 분리한다. 노출 스키마는 RLS와 필요한 GRANT를 함께 설정한다.
3. 봇+수신자별 마지막 inbound 시각을 저장한다. `ig_accounts.updated_at`이나 마지막 발신 시각을 대신 쓰지 않는다. 예약 때 연결된 수신자와 발송 직전 연결이 같은지도 검증한다.
4. `GET /api/reminders/run` 같은 서버 전용 작업자를 Vercel Cron에서 매분 호출한다. `CRON_SECRET` Bearer 인증을 검증하고, 미설정이면 거절한다. 비밀키는 서버 환경변수에만 둔다. 기존 cleanup Cron은 유지한다.
5. DB의 원자적 claim/잠금으로 한 번에 제한된 작업만 가져온다. 동시 실행·중복 Cron에서 같은 작업을 다시 보내지 않는다. 함수 시간 제한 전에 멈추고 다음 실행이 남은 작업을 처리하게 한다.
6. 발송 직전에 현재 일정 revision, 삭제·취소 여부, 원본 접근 가능 여부, Instagram 연결, 사용자 동의, 최신 발송 창을 다시 확인한다. 모두 유효할 때만 기존 봇 토큰 로더로 DM을 보낸다. Gemini 분석이나 원본 다운로드는 다시 실행하지 않는다.
7. Meta 성공 응답의 메시지 ID를 받았을 때만 `sent`로 기록한다. 의미는 API가 전송을 수락했다는 것이며 사용자가 읽었다는 뜻은 아니다.

Vercel Cron은 정확한 초 단위 알람이 아니다. MVP 목표는 보통 1분 이내 처리지만 이를 보장 문구로 쓰지 않는다. 기본적으로 5분 이상 늦은 작업은 `skipped / stale`로 끝내 알림 폭주를 막는다. 정밀한 시각 보장이 필요해지면 별도 작업 큐로 바꾼다.

### 중복·실패 처리

| 상태 | 처리 |
| --- | --- |
| `scheduled` | 발송 대기 |
| `sending` | worker가 claim한 상태. lease와 요청 시작 여부 기록 |
| `sent` | 성공 응답과 메시지 ID 저장. 재전송 금지 |
| `cancelled` | 사용자 해제·삭제·계정 변경·옛 revision. 재전송 금지 |
| `skipped` | 창 만료·지난 예약·지연·연결 해제 등. 사유 표시 |
| `failed` | 확정된 전송 거절. 토큰·권한 오류는 무한 재시도하지 않음 |
| `unknown` | 요청 후 timeout/응답 유실/전송 직후 장애. 자동 재전송 금지, 확인 필요 |

DB 유일 키만으로 외부 Meta 전송의 exactly-once를 보장할 수는 없다. 요청을 전혀 시작하지 않은 일시 장애만 제한적으로 재시도한다. 요청을 시작했는데 성공 여부를 모르면 lease가 만료돼도 `unknown`으로 남겨 중복 DM을 피한다. Meta 오류 문자열은 토큰·개인정보가 섞일 수 있어 코드·안전한 사유만 로그에 남긴다.

일정 수정은 revision을 올리고 이전 대기 작업을 취소한 뒤 새 작업을 만든다. 옵션 변경도 revision을 올린다. 연결 해제·다른 계정 재연결·회원 탈퇴·원본 접근 상실은 대기 작업을 무효화한다. 이미 외부 전송 요청이 시작된 DM은 취소를 보장할 수 없으므로 그 상태를 숨기지 않는다.

## DM 문구와 프론트 마감

예시:

```text
디미가 일정 알려드려요!
오늘 오후 2시, ‘서도호: 개인전’에 방문하기로 하셨어요.
정리한 내용: https://inthon.yeoziphab.com/items/fc42-2
```

서버가 저장한 일정과 원본 카드에서 문구를 만든다. 개인 결과 링크는 기존 로그인·소유권 검사를 유지하며 공개 공유 링크로 바꾸지 않는다. 예약 완료·지원 완료라고 표현하지 않는다.

- `serverEvent()`의 `dm/rem` 고정값을 실제 설정에서 매핑한다. 서버가 준비됐다는 응답을 줄 때만 PC·모바일의 스위치를 활성화한다.
- 현재 데모의 ‘시간이 지나면 보냄’ 계산은 운영에서 쓰지 않는다. `sent_at`과 실제 상태로 표시한다.
- 창 만료는 ‘메시지를 보낼 수 있는 시간이 지나 DM 알림을 보내지 못했어요’, `unknown`은 ‘전송 여부를 확인하고 있어요’로 구분한다.
- 설정 해제·저장 실패·중복 클릭·revision 충돌 처리와 모바일 미리보기를 함께 연결한다.

## 담당자 완료 기준

- [ ] 두 계정의 일정/작업/상태 조회·수정이 서로 격리됨
- [ ] 네 옵션의 KST→UTC, 종일 `h1` 거부, 자정 경계·과거 예약 테스트 통과
- [ ] 일정 수정·삭제·옵션 해제·연결 변경 후 이전 작업이 발송되지 않음
- [ ] 중복/동시 Cron, lease 만료, 요청 전 장애·응답 유실을 구분하고 중복 발송하지 않음
- [ ] webhook echo·재전송·미래 시각이 24시간 창을 잘못 늘리지 않음
- [ ] 창 밖에서는 Meta를 호출하지 않고 `skipped`를 표시함
- [ ] 서버 설정 누락·잘못된 Cron 인증·토큰 오류가 안전하게 실패함
- [ ] 프론트가 실제 `scheduled/sent/skipped/failed/unknown`을 PC·모바일에 동일하게 표시함
- [ ] 테스트 계정이 먼저 DM한 뒤 가까운 시각의 예약 한 건으로 실제 수신·메시지 ID·취소 한 건을 확인함

일반 사용자 대상 공개, 앱 Live 전환, 신규 발송 권한 신청, 이메일·푸시 채널 추가는 이 작업에 포함하지 않는다. 실제 발송이 검증되기 전에는 ‘동작 완료’로 보고하지 않는다.

## 공식 참고 자료

- [Meta Instagram Messaging API](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/) — 이번 조회는 429로 전문 확인 불가. 담당자가 현재 정책·앱별 지원 범위를 최종 확인
- [Meta Instagram Human Agent](https://developers.facebook.com/docs/messenger-platform/instagram/features/human-agent/) — 자동 리마인드 우회로 사용하지 않음
- [Vercel Cron 관리: 잠금·중복 실행·운영](https://vercel.com/docs/cron-jobs/manage-cron-jobs)
- [Vercel Cron 플랜별 주기·정밀도](https://vercel.com/docs/cron-jobs/usage-and-pricing)
- [Supabase RLS와 GRANT](https://supabase.com/docs/guides/database/postgres/row-level-security)

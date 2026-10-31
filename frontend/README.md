# 대시보드 디자인 원본과 연결 지점

사용자 제공 `dm-dashboard-codex-handoff.zip`의 원본 HTML·CSS·마스코트·샘플 데이터를 보관한다. 화면의 색·폰트·간격·SVG·인라인 스타일·상태 로직은 원본을 사용한다. 디자인 툴의 사설 이미지 경로만 `/assets/mascot.png`로 바꿨다.

## 빌드

```sh
npm ci
npm run build
```

Python 표준 라이브러리로 원본의 `sc-if`·`sc-for`·바인딩을 컴파일하고 작은 Preact 렌더러로 실행한다. Next.js 전환이나 별도 CSS 테마를 추가하지 않았다.

- 원본: `frontend/design/Main.dc.html`
- 화면 상태·샘플 데이터·이벤트: 원본 마지막 `class Component` → 생성된 `public/js/dashboard-model.js`
- 렌더러: `public/js/dashboard-runtime.js`
- 경로·뒤로가기·모달 포커스: `public/js/dashboard-app.js`
- 생성된 CSS: `public/css/dashboard.css` (원본 `<style>`과 동일)
- 데이터 참고: `frontend/data/sample-data.json`, `public/data/dashboard-sample.json`

`public/js/dashboard-model.js`, CSS와 template JSON은 빌드 생성물이다. 원본 로직/디자인을 바꿀 때 원본을 편집하고 다시 빌드한다. 백엔드 연결 시에는 모델의 `data()`/`allItems()` 및 이벤트 핸들러의 시뮬레이션 호출을 실제 데이터·API로 교체하면 된다. 렌더러·CSS를 재작성할 필요는 없다.

## 현재 범위

`/`, `/dashboard`, `/home`, `/library`, `/items/:id`, `/taste`, `/settings`에서 같은 앱이 열린다. 화면은 **데모**와 **내 실제 데이터** 두 모드로 동작한다. `/link`는 같은 디자인 CSS를 쓰는 계정 연결 페이지이고, `/api/*`, `/auth/*`, `/webhooks/instagram`과 DM 백엔드는 그대로다.

### 데모와 실제 데이터 모드

상단 드롭다운에서 데모 시나리오(연결 전·첫 콘텐츠 전·콘텐츠 쌓임)와 **내 실제 데이터**를 고른다. 배지는 데모일 때 `DEMO`, 실제 모드일 때 `내 데이터`로 바뀐다. 로그인한 사용자는 마지막에 데모 시나리오를 고르지 않았다면 처음부터 실제 데이터로 열린다.

- 디자인 원본에서 모드마다 달라지는 값은 바인딩으로 바꿨다: `email`, `modeBadge`, `modeNote`, `connectDesc`, `dmModeDesc`, `isDemo`/`isLive`, `linkGuideOn`, `copyLinkWord`, `checkLink`. 원본 로직은 데모 값을 그대로 돌려주므로 데모 화면은 이전과 같다. 실제 모드 값은 `public/js/dashboard-app.js`가 모델을 상속해 덮어쓴다. 원본을 고친 뒤에는 `npm run build`로 다시 만든다.
- `public/js/dashboard-live.js`는 Supabase 행을 디자인의 항목 형식으로 바꾸는 순수 함수다. `factchecks`는 `news` 유형 항목이 되고, 판정은 사실·거짓·오해의 소지·판단 유보로 매핑한다. `account_links`는 연결 계정이 된다.
- DM 발송 단계는 `factchecks.dm_status`를 따른다. 봇이 결과 메시지를 모두 보낸 뒤에만 `sent`가 되고, 10분이 지나도 `pending`이면 "DM 전달 미확인"으로 보인다.

### 실제 모드에서 따르는 워크플로

| 화면 | 실제 동작 |
| --- | --- |
| 설정 → 내 Instagram 연결 | 데모의 "연결 코드" 흐름 대신 실제 흐름 3단계: @inthon2team에 `연결` DM → 답장 링크(10분, 1회) → `/link`에서 같은 구글 계정으로 로그인. "연결 상태 새로고침"과 탭 복귀 시 자동으로 다시 불러온다 |
| 연결 전 홈 | 연결하면 **전에 보낸 콘텐츠도 함께 보인다**고 안내한다. 봇은 모든 발신자의 기록을 저장하기 때문이다 |
| 연결 해제 | 기록은 지우지 않고 대시보드에서만 숨긴다. 다시 연결하면 돌아온다 |
| 이름 저장 | Supabase 사용자 메타데이터 `display_name`에 저장한다 |
| 즐겨찾기·취향 모으기 | 테이블이 없어 사용자별로 이 브라우저에만 저장한다 |
| DM 결과 받는 방식 | 봇에 선택 기능이 없어 실제 모드에서는 선택지를 숨기고 현재 동작만 안내한다 |
| 공유·삭제·유형 다시 선택·의견·생활 조건 추가·탈퇴 | 백엔드가 없어 "준비 중" 안내만 띄운다 |
| 데모 전용 버튼 | DM 전송 시뮬레이션은 실제 모드에서 숨긴다. 데모의 지민 프로필·생활 조건은 실제 모드에 남지 않는다 |

아직 남은 데모 표기: 사이드바·공유 화면의 서비스 이름은 원본의 자리표시자 `서비스명`이다.

## 검증

- 원본 CSS·상태 로직·마스코트의 일치를 자동 검사한다.
- 홈에서 원본 로직의 정적 비교본과 이식 화면을 1440px·390px 프레임으로 비교했다. 양쪽 230개 표시 요소, 애니메이션 순간값을 제외한 위치·크기·폰트·색·간격 차이 0개.
- 브라우저에서 메뉴 이동·검색과 포커스 유지를 확인했다. 원본의 모든 샘플 상세가 파생값을 생성하는 것도 자동 검사했다.
- 브라우저 캡처 API 오류로 래스터 스크린샷 대조는 수행하지 못했다. 비교본도 원본 툴 런타임이 아니라 제공된 원본 로직·템플릿으로 만든 정적 기준이다.
- 전체 Node 테스트 80개, Python 테스트 16개, `npm run build` 통과.
- `dashboard-live.test.mjs`: 템플릿의 모든 바인딩이 데모·실제 모드 양쪽에서 값을 갖는지, 실제 항목이 원본 로직의 모든 화면·상세에서 렌더링되는지 검사한다.

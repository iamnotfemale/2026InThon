# 대시보드 디자인 원본과 연결 지점

사용자 제공 대시보드·랜딩·회원가입 ZIP의 원본 HTML·CSS·마스코트·샘플 데이터를 보관한다. 화면의 색·폰트·간격·상태 로직은 원본을 사용한다. 사용자가 요청한 디미 명칭·브랜드 구슬·Instagram 핸들과 실제 페이지 이동 경로만 빌드에서 적용한다.

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

`/`는 랜딩, `/register`는 채팅형 회원가입 온보딩, `/dashboard`는 대시보드다. `/home`, `/library`, `/items/:id`, `/taste`, `/settings`도 대시보드 화면으로 유지한다. 대시보드는 **데모**와 **내 실제 데이터** 두 모드로 동작한다(아래). 기존 `/link`, `/api/*`, `/auth/*`, `/webhooks/instagram` 경로와 DM 백엔드는 유지한다.

### 랜딩·회원가입과 디미 브랜딩

- 원본은 `frontend/landing/Landing.dc.html`, `frontend/register/Signup.dc.html`에 보존했다. 새 ZIP의 마스코트는 `frontend/assets/onboarding-mascot.png`다.
- 빌드는 세 페이지에 같은 렌더러를 사용한다. 페이지별 CSS는 원본과 동일하며, 링크만 `/`, `/register`, `/dashboard`로 매핑했다. 회원가입의 Enter 제출·나이 건너뛰기·다시 시작·채팅 스크롤과 타이핑 애니메이션을 유지한다.
- 사용자가 요청한 브랜딩은 빌드에서 적용한다. 화면·모델 문구 `서비스명` → `디미`, Instagram 안내 → `@dimi_in`. 브랜드 옆 아이콘은 기존 파란 계열 컬러 구슬을 재사용한 `public/css/brand.css`의 `.dimi-mark`다. 기존 마스코트·콘텐츠 구슬은 유지한다.
- 생성물은 `public/index.html`, `register.html`, `dashboard.html` 및 각 페이지 이름의 CSS·template JSON·model JS다. `landing-app.js`, `register-app.js`는 얇은 진입점이다.
- **회원가입은 제공 ZIP에 명시된 데모 시뮬레이션이다.** Google 버튼은 데모 대화를 진행하며 계정을 생성하지 않는다. 이름·나이도 서버에 저장하지 않는다. 이후 실제 가입 연결은 `RegisterModel`을 상속하는 진입점에서 구현한다. 대시보드의 기존 실제 Google 로그인·Supabase 데이터 모드는 그대로 동작한다.
- 대시보드 실제 모드의 DM 이동 URL은 `https://ig.me/m/dimi_in`다. Meta 앱 ID·Instagram 숫자 ID·운영 권한은 변경하지 않는다.
- `public/css/page-layout.css`는 추가 요청한 레이아웃만 덮어쓴다. 랜딩은 90% 표시, 회원가입은 `100dvh` 안에 헤더·마스코트·입력 영역을 배치하고 대화 목록만 내부 스크롤한다. 원본 CSS 파일은 그대로 유지한다.

### 데모와 실제 데이터 모드

상단 드롭다운에서 데모 시나리오(연결 전·첫 콘텐츠 전·콘텐츠 쌓임)와 **내 실제 데이터**를 고른다. 배지는 데모일 때 `DEMO`, 실제 모드일 때 `내 데이터`로 바뀐다. 로그인한 사용자는 마지막에 데모 시나리오를 고르지 않았다면 처음부터 실제 데이터로 열린다.

- 디자인 원본에서 모드마다 달라지는 값은 바인딩으로 바꿨다: `email`, `modeBadge`, `modeNote`, `connectDesc`, `dmModeDesc`, `isDemo`/`isLive`, `linkGuideOn`, `copyLinkWord`, `checkLink`. 원본 로직은 데모 값을 그대로 돌려주므로 데모 화면은 이전과 같다. 실제 모드 값은 `public/js/dashboard-app.js`가 모델을 상속해 덮어쓴다. 원본을 고친 뒤에는 `npm run build`로 다시 만든다.
- `public/js/dashboard-live.js`는 Supabase 행을 디자인의 항목 형식으로 바꾸는 순수 함수다. `factchecks`는 `news` 유형 항목이 되고, 판정은 사실·거짓·오해의 소지·판단 유보로 매핑한다. `account_links`는 연결 계정이 된다.
- DM 발송 단계는 `factchecks.dm_status`를 따른다. 봇이 결과 메시지를 모두 보낸 뒤에만 `sent`가 되고, 10분이 지나도 `pending`이면 "DM 전달 미확인"으로 보인다.

### 실제 모드에서 따르는 워크플로

| 화면 | 실제 동작 |
| --- | --- |
| 설정 → 내 Instagram 연결 | 데모의 "연결 코드" 흐름 대신 실제 흐름 3단계: @dimi_in에 `연결` DM → 답장 링크(10분, 1회) → `/link`에서 같은 구글 계정으로 로그인. "연결 상태 새로고침"과 탭 복귀 시 자동으로 다시 불러온다 |
| 연결 전 홈 | 연결하면 **전에 보낸 콘텐츠도 함께 보인다**고 안내한다. 봇은 모든 발신자의 기록을 저장하기 때문이다 |
| 연결 해제 | 기록은 지우지 않고 대시보드에서만 숨긴다. 다시 연결하면 돌아온다 |
| 이름 저장 | Supabase 사용자 메타데이터 `display_name`에 저장한다 |
| 즐겨찾기·취향 모으기 | 테이블이 없어 사용자별로 이 브라우저에만 저장한다 |
| DM 결과 받는 방식 | 봇에 선택 기능이 없어 실제 모드에서는 선택지를 숨기고 현재 동작만 안내한다 |
| 공유·삭제·유형 다시 선택·의견·생활 조건 추가·탈퇴 | 백엔드가 없어 "준비 중" 안내만 띄운다 |
| 데모 전용 버튼 | DM 전송 시뮬레이션은 실제 모드에서 숨긴다. 데모의 지민 프로필·생활 조건은 실제 모드에 남지 않는다 |

실제 모드 문구(`public/js/dashboard-live.js`)는 빌드를 거치지 않으므로 브랜드·핸들(`디미`, `@dimi_in`)을 직접 맞춘다.

## 검증

- 원본 CSS·상태 로직·마스코트의 일치를 자동 검사한다.
- 홈에서 원본 로직의 정적 비교본과 이식 화면을 1440px·390px 프레임으로 비교했다. 양쪽 230개 표시 요소, 애니메이션 순간값을 제외한 위치·크기·폰트·색·간격 차이 0개.
- 브라우저에서 메뉴 이동·검색과 포커스 유지를 확인했다. 원본의 모든 샘플 상세가 파생값을 생성하는 것도 자동 검사했다.
- 브라우저 캡처 API 오류로 래스터 스크린샷 대조는 수행하지 못했다. 비교본도 원본 툴 런타임이 아니라 제공된 원본 로직·템플릿으로 만든 정적 기준이다.
- 랜딩·회원가입 추가 후 Node 테스트 94개, Python 테스트 18개, `npm run build` 통과. 새 페이지의 원본 CSS와 명시적인 브랜딩 외 상태 로직 일치, 브랜드 아이콘 변경 시 인접 이름 보존, 회원가입 데모 입력·나이 검증·건너뛰기·초기화를 검사한다.
- `dashboard-live.test.mjs`: 모드별 바인딩이 데모·실제 모드 양쪽에서 값을 갖는지, 실제 모드가 데모 전용 동작을 성공한 척하지 않는지, 실제 항목이 원본 로직의 모든 화면·상세에서 렌더링되는지 검사한다.

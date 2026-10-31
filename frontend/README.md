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

`/`, `/dashboard`, `/home`, `/library`, `/items/:id`, `/taste`, `/settings`에서 디자인 데모가 열린다. 기본은 원본의 가상 계정·샘플 데이터이며 DEMO 상태 전환도 유지했다. 로그인·계정 연결·분석 결과·공유 링크는 이 프론트에 아직 실제 연동하지 않았다. 기존 `/link`, `/api/*`, `/auth/*`, `/webhooks/instagram` 경로와 DM 백엔드는 유지한다.

실제 계정 연결과 인증이 필요할 때 기존 `public/js/supabase.js`, `link.js`, `dashboard.js`, `index.js`를 참고할 수 있다. 새 메인 화면에서는 이 이전 UI 스크립트를 실행하지 않는다.

## 검증

- 원본 CSS·상태 로직·마스코트의 일치를 자동 검사한다.
- 홈에서 원본 로직의 정적 비교본과 이식 화면을 1440px·390px 프레임으로 비교했다. 양쪽 230개 표시 요소, 애니메이션 순간값을 제외한 위치·크기·폰트·색·간격 차이 0개.
- 브라우저에서 메뉴 이동·검색과 포커스 유지를 확인했다. 원본의 모든 샘플 상세가 파생값을 생성하는 것도 자동 검사했다.
- 브라우저 캡처 API 오류로 래스터 스크린샷 대조는 수행하지 못했다. 비교본도 원본 툴 런타임이 아니라 제공된 원본 로직·템플릿으로 만든 정적 기준이다.
- 전체 Node 테스트 80개, Python 테스트 16개, `npm run build` 통과.

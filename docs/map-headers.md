# 지도 SDK 연결용 응답 헤더

## 적용 범위

`vercel.json`에서 `/dashboard`, `/home`, `/library`, `/taste`, `/calendar`, `/settings`, `/items/:id` 문서에만 다음을 허용한다.

- `Referrer-Policy: strict-origin-when-cross-origin`: HTTPS 외부 요청에 페이지 경로·쿼리 대신 사이트 출처를 전달한다.
- `script-src`: 기존 허용 목록에 `https://dapi.kakao.com`, `https://t1.daumcdn.net`, `https://*.kakaocdn.net`을 추가한다.
- `img-src`: 기존 허용 목록에 `https://*.daumcdn.net`, `https://*.kakaocdn.net`을 추가한다.
- `connect-src`: 기존 허용 목록에 `https://dapi.kakao.com`, `https://*.kakaocdn.net`을 추가한다.

같은 문서에 예전 CSP와 지도용 CSP가 겹치지 않도록 헤더 경로를 분리했다. CSP가 두 개 적용되면 두 정책을 모두 만족해야 하므로 이전 정책이 지도 SDK를 계속 차단할 수 있다.

로그인·가입·Instagram 연결·정책 페이지는 기존 `no-referrer`와 기존 CSP를 유지한다. `/auth/*`, `/api/*`, 웹훅 응답도 이 변경에 포함하지 않는다. `unsafe-inline`/`unsafe-eval` 스크립트 허용, 모든 HTTPS 호스트 허용, 프레임 허용은 추가하지 않았다. 기존 인라인 **스타일 속성** 허용은 유지한다.

## 최신 카카오 CDN 반영

카카오맵은 2026-10-06부터 `*.kakaocdn.net`으로 리소스를 제공하고 있다. 공식 공지상 카카오맵의 `*.daumcdn.net` 리소스 지원은 2026-11-30까지만 유지되므로, 예전 Daum 도메인만 허용하면 현재/향후 SDK 리소스가 차단될 수 있다. 이전 스크린샷의 허용 목록에 새 카카오 CDN도 함께 반영했다.

- [공식 지도 Web API 가이드](https://apis.map.kakao.com/web/guide/)
- [공식 리소스 도메인 추가·CSP 안내](https://devtalk.kakao.com/t/csp/150541)
- [공식 Daum CDN 리소스 종료 안내](https://devtalk.kakao.com/t/api-daumcdn-net/152465)

## 프론트에서 함께 확인할 사항

1. 대시보드 문서의 `<meta name="referrer">`도 응답 헤더와 같은 `strict-origin-when-cross-origin`이어야 한다. 생성 HTML만 고치지 말고 `scripts/build-dashboard.py`의 dashboard 셸을 수정해야 한다. `/items/*`도 같은 문서를 쓴다. 로그인/가입/연결 문서의 `no-referrer`는 유지한다.
2. 카카오 개발자 앱의 JavaScript SDK 도메인에 실제 서비스 출처 `https://inthon.yeoziphab.com`이 등록돼 있어야 한다. Referrer 헤더만 바꿔도 도메인 등록이 자동으로 되는 것은 아니다.
3. SDK는 공식 `https://dapi.kakao.com/v2/maps/sdk.js?...` 진입점으로 불러온다. 내부 CDN 파일이나 타일 주소를 직접 구성·복제하지 않는다.
4. 현재 main에는 카카오/네이버 **외부 검색 링크**만 있고 지도 SDK는 아직 없다. 따라서 이번 검증은 설정/허용 범위 테스트이며 실제 지도 표시를 확인한 것은 아니다.
5. 팀원이 SDK를 연결하고 배포한 뒤 해당 지도 화면의 콘솔에서 CSP 위반과 도메인 오류가 없는지 한 번 확인한다. 허용 목록은 관찰한 실제 SDK 요청과 공식 문서에 근거해서 추가한다.

네이버 SDK 도메인은 아직 추가하지 않았다. 네이버 외부 검색 링크를 여는 것에는 SDK 호스트 허용이 필요하지 않으며, 별도 네이버 임베드를 선택하면 그 SDK의 공식 도메인·클라이언트 설정을 확인해 추가한다.

## 검증

`node --test map-security-headers.test.mjs`는 모든 대시보드 경로가 하나의 지도용 정책만 받는지, 인증/연결/정책 문서와 API가 영향받지 않는지, 기존 CSP 제한이 유지되는지 확인한다. 실제 배포 응답 헤더와 SDK 로드/콘솔 확인은 배포 담당자가 이어서 수행한다.

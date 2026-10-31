# 대시보드 카카오맵

전시·팝업, 맛집, 취향공간 상세(데스크톱·모바일 6곳)의 그림 지도 자리에 카카오맵을 띄우고 장소에 핀을 꽂는다. 키가 없거나 SDK·검색이 실패하면 기존 그림 지도가 그대로 남는다.

## 설정

1. `public/js/kakao-config.js`의 `KAKAO_JS_KEY`에 Kakao Developers의 **JavaScript 키**를 넣는다. 브라우저에 전달되는 공개 키이며, 보호는 Kakao Developers → 내 애플리케이션 → 플랫폼 → **Web 사이트 도메인**(`https://inthon.yeoziphab.com`, 필요 시 `https://inthon-pi.vercel.app`) 등록으로 한다. 카카오맵 서비스(지도·로컬)가 활성화돼 있어야 한다.
2. CSP(`vercel.json` 헤더)에 다음을 추가한다.
   - `script-src`: `https://dapi.kakao.com https://t1.daumcdn.net` (SDK, 지도 엔진, 주소·장소 검색 JSONP)
   - `img-src`: `https://*.daumcdn.net` (지도 타일 `map0~3.daumcdn.net`, 마커 이미지 `t1.daumcdn.net`)
   - `connect-src`: `https://dapi.kakao.com`
   브라우저 콘솔에 CSP 차단이 보이면 그 도메인을 같은 지시어에 추가한다.
3. 대시보드 페이지만 `<meta name="referrer" content="strict-origin-when-cross-origin">`이다(`scripts/build-dashboard.py`). 카카오가 JavaScript 키를 요청 사이트 도메인으로 확인하기 때문이다. 다른 사이트에는 경로 없이 `https://inthon.yeoziphab.com`만 전달된다. 다른 페이지는 계속 `no-referrer`다. HTTP 헤더 `Referrer-Policy`가 `no-referrer`여도 이 meta가 문서 정책을 덮어쓴다.

## 동작 (`public/js/kakao-map.js`)

- 템플릿의 빈 `<div class="kmap" data-kmap data-name data-address data-area data-kind>`를 `MutationObserver`로 찾아 붙인다. Preact가 자식을 그리지 않는 요소라 다시 그려도 지도가 지워지지 않는다. 이름·주소가 없는 자리(데모 항목)는 카카오에 접속하지 않는다. SDK는 장소가 있는 상세를 처음 열 때 한 번만 불러온다(`autoload=false&libraries=services`).
- 위치 찾기(정확도 우선):
  1. 원본에 적힌 주소(전시는 웹에서 확인한 주소 포함)가 있으면 주소 검색(Geocoder) 결과에 핀을 꽂는다.
  2. 주소가 없거나 검색되지 않으면 **이름 + 지역**(동네, 또는 주소 앞부분)으로 장소 검색(Places)한다. 이름이 일치하는 결과만 쓰고, 그중 지역이 주소에 들어 있고 유형에 맞는 분류(맛집 FD6·CE7, 전시 CT1·AT4, 취향공간 CE7·FD6·CT1·AT4·AD5)를 우선한다.
  3. 지역 정보 없이 이름만 있고 같은 이름이 여러 곳(체인)이면 핀을 꽂지 않고 안내한다.
  4. 전시는 전시명이 아니라 **장소명**으로 찾고, "2층", "B1층", "(본관)" 같은 꼬리는 빼고 검색한다.
- 지도 아래 안내: 이름으로 찾은 위치는 "방문 전에 지도 앱에서 확인", 여러 곳·못 찾음·불러오기 실패는 각각의 문구. 휠 확대는 끄고(페이지 스크롤 유지) 확대 버튼을 둔다. 이름 검색으로 찾은 핀을 누르면 카카오 장소 페이지가 열린다.
- 같은 장소 검색 결과는 페이지 안에서 다시 요청하지 않는다.

## 개인정보

장소가 있는 상세 화면을 열 때만 브라우저가 카카오에 접속하며 장소 이름·주소와 접속 정보가 전송된다. 개인정보처리방침 10항에 반영했다.

검증: `node --test kakao-map.test.mjs`. 실제 키·도메인으로 브라우저에서 띄워 보는 확인은 키 설정 후 진행한다.

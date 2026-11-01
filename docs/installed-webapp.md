# iPhone 홈 화면 웹앱

`public/manifest.webmanifest`의 `scope: /`로 홈·채팅·내 콘텐츠·내 취향·캘린더·지도·설정·결과 페이지를 같은 웹앱 범위에 둡니다. `display: standalone`, `start_url: /dashboard`를 사용합니다. 생성되는 화면은 `scripts/build-dashboard.py`, 나머지 정적 HTML은 같은 manifest와 Apple 홈 화면 메타 태그를 참조합니다.

내부 탭은 기존 `history.pushState` 이동을 유지합니다. 외부 Instagram·지도·Google 인증 화면은 앱 범위에 포함하지 않습니다. 서비스 워커나 오프라인 데이터 캐시는 추가하지 않았습니다.

기존 설치 아이콘은 이전 설정이 남을 수 있습니다. 완전히 닫았다가 열어도 내부 탭에 Safari 도구 모음이 나타나면, 기존 홈 화면 아이콘을 제거하고 Safari에서 `https://inthon.yeoziphab.com/dashboard`를 열어 공유 → 홈 화면에 추가 → 웹 앱으로 열기로 다시 추가합니다. 재로그인이 필요할 수 있으며 서버에 저장된 콘텐츠는 삭제되지 않습니다.

검증: `node --test webapp-manifest.test.mjs` 및 실제 배포 manifest/HTML 확인. 데스크톱 모바일 뷰에서 내부 탭 이동을 확인하되, iOS 설치 앱의 브라우저 UI 유지 여부는 실제 아이폰에서 별도 확인해야 합니다.

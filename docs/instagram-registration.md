# Google 로그인 후 Instagram DM 인증

`/register`는 Google → Instagram 계정 확인 → 이름 → 나이(선택)의 4단계다. Google 로그인은 실제 Supabase Auth를 사용한다. 연결이 끝나야 이름 단계로 진행하며, 가입 완료 후 실제 데이터 대시보드를 연다.

## 인증 흐름

1. 브라우저가 Google 세션의 access token으로 `POST /api/instagram-link`에 `{action:'issue', username}`를 보낸다.
2. 서버가 Supabase `/auth/v1/user`에서 사용자를 검증한다. 요청 본문의 사용자 ID는 받지 않는다.
3. 서버가 영문 대문자와 숫자가 반드시 섞인 무작위 6자리 코드를 발급한다. 코드는 10분간 유효하다. 핸들은 앞의 `@`와 대소문자를 정규화한다.
4. 사용자는 입력한 Instagram 계정으로 @dimi_in에 코드만 DM으로 보낸다. 코드는 Gemini에 보내지 않는다.
5. 서명 검증된 웹훅의 발신자 IGSID로 Meta 프로필을 조회한다. 프로필 API가 막히면 봇 대화의 참가자 목록에서 **같은 IGSID**의 실제 핸들을 확인한다. 브라우저·DM에 적힌 핸들이나 오래된 DB 핸들을 본인 확인 근거로 쓰지 않는다.
6. 입력한 핸들과 실제 핸들이 같아야 기존 `issueLinkToken`을 발급해 서버에 보관한다. 다르면 연결하지 않고 DM으로 안내한다.
7. 브라우저는 5초 간격 및 창 복귀·‘보냈어요’ 버튼으로 상태를 확인한다. 서버가 검증된 Google 사용자의 JWT로 기존 `link_instagram` RPC를 호출한다. 이 RPC가 토큰 사용과 `account_links` 연결을 원자적으로 처리한다.

## 보관·권한

- `instagram-link.mjs`: 코드 발급/검증/서버 상태 및 Meta 핸들 조회.
- `api/instagram-link.mjs`: Google 사용자 인증·같은 Origin 확인·실제 DB 연결. 연결용 64자리 토큰은 브라우저에 돌려주지 않는다.
- `public/js/registration.js`, `register-live.js`: 기존 로그인·프로필 저장 코드를 지연 로딩해 사용한다.
- 기존 `ig_accounts`, `link_tokens`, `account_links`와 RLS·RPC를 재사용한다. 새 테이블이나 DB 권한은 필요 없다. 기존 DM `연결` 링크 방식도 유지한다.
- 코드 파일명은 HMAC이고 사용자 경로는 SHA-256이다. 사용자 ID·코드·핸들·연결 토큰 본문은 private Blob에 암호화해서 보관한다. 로그나 URL에 코드를 넣지 않는다.
- 계정별 발급 속도 제한, 발신자별 확인 시도 제한, 코드별 원자적 예약을 사용한다. 새 코드를 만들면 그 사용자의 이전 코드는 사용할 수 없다. 다른 Google 사용자는 이 사용자의 인증 상태를 조회할 수 없다.
- 이름은 `user_metadata.display_name`, 나이는 입력한 경우만 `age`에 저장한다. 이 값은 화면 표시용이며 권한 판단에는 사용하지 않는다.

제약: Meta의 프로필 조회가 실패한 경우 대화 목록은 최대 500건까지만 확인한다. 실제 핸들을 확인할 수 없으면 연결을 거절한다. `dm/link-codes/`의 만료 자료는 장기 운영 전에 정기 청소를 추가해야 한다. 만료 이후에는 인증에 사용할 수 없다.

## 검증

Node 테스트는 핸들 불일치·조회 실패·만료·다른 로그인 사용자·중복/동시 사용·발급과 시도 제한·서버 재시작·저장 실패 재시도·RPC 중복 응답을 검사한다. 가입 화면은 실제 로그인 후 Instagram 확인을 통과해야 이름·나이로 넘어가는지, 선택 나이와 Google 이름 제안·Enter 제출이 유지되는지 확인한다.

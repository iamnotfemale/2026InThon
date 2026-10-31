# inthon2team Instagram DM 테스트

현재 다른 Instagram 계정에서 `@inthon2team`으로 새 DM을 보내면 **안녕?**으로 답장하는 흐름을 구현했습니다. 팀원은 [DM 테스트 인수인계](docs/dm-test-handoff.md)부터 읽으세요. 서버 주소는 `https://inthon.yeoziphab.com`, 상태 확인은 `/health`, 웹훅은 `/webhooks/instagram`입니다. 클라우드 구성은 기존 계정의 토큰을 사용하는 테스트이며 개인 계정 등록·대화/릴스 저장은 아직 없습니다.

팩트체크 확장 설계는 [Instagram DM 멀티모달 팩트체크 MVP 명세서](docs/instagram-factcheck-mvp-spec.md)에 정리했습니다. 이미지·영상·본문 분석, 근거 검색과 검증, DM 응답, 평가 기준을 다룹니다. 현재 실행 기능과 제안 기능을 구분해 읽으세요.

Continuum의 `DeepSeek-V4.1-Flash-B300` API 테스트 설정과 실행법은 이 PC의 `.local/continuum-setup.md`에 있습니다. 비밀값을 포함한 로컬 설정은 GitHub에 올리지 않습니다. 모델 목록·텍스트·함수 호출·이미지 입력을 검증했습니다. 현재 Codex CLI 연결은 서버의 `namespace` 도구 형식 미지원(HTTP 422)으로 제한됩니다. Instagram 자동 답장에는 아직 연결하지 않았습니다.

코드 검증에는 Node.js 22와 `npm ci`가 필요합니다. 아래 로컬 실행·토큰 재승인 도구는 Windows, PowerShell 7, 인증된 ngrok을 사용합니다. 배포된 봇의 DM 테스트만 한다면 로컬 서버를 켤 필요가 없습니다.

```powershell
cd D:\2026\2026InThon
.\start.ps1
# 종료
.\stop.ps1
# 검증
node --test
```

[로컬 설정 화면](http://127.0.0.1:8788/)에서 상태를 확인합니다. 서버와 ngrok은 숨김 프로세스로 실행됩니다. PC를 끄거나 프로세스를 종료하면 중단됩니다. 재시작 시 ngrok 주소가 바뀌면 Meta의 리디렉션 URL과 웹훅 URL을 모두 갱신하세요.

## 팩트체크 답장 (개발 중)

`factcheck.mjs`는 DM 콘텐츠에서 핵심 주장 하나를 뽑고, Bing 뉴스·웹, 위키백과, PubMed에서 근거를 찾아 **실제로 열리는 자료만** 인용해 `핵심 주장 → 판단 → 이유 → 근거 링크` 형식으로 답장합니다. 근거가 없으면 `확인 어려움`으로 답하며, 모델이 고른 근거 ID는 서버가 수집 결과와 대조해 지어낸 링크를 버립니다.

- 운영: Vercel Production에 `GEMINI_API_KEY`를 Sensitive로 넣으면 Gemini 하나로 이미지·텍스트 팩트체크와 영상 전사를 처리합니다. 콘텐츠 분석 기본 모델은 실제 호출을 확인한 `gemini-3.8-flash`이며 `GEMINI_MODEL`로 지정할 수 있습니다. 일반 채팅은 `gemini-3.5-flash-lite`를 사용하고 `GEMINI_CHAT_MODEL`로 지정할 수 있습니다. Gemini 키가 없으면 기존 `CONTINUUM_API_KEY`(선택 `CONTINUUM_BASE_URL`, `CONTINUUM_MODEL`)를 사용합니다. AI 키가 둘 다 없으면 고정 답장을 유지합니다. 함수 제한 시간은 300초입니다.
- 로컬 실DM 테스트: `node scripts/factcheck-local.mjs .env` (포트 3000, ngrok 연결). 실행 기록은 `factcheck-runs.jsonl`에 남습니다.
- 사례 묶음 평가: `node scripts/factcheck-eval.mjs cases.json .env`
- 공유 첨부 형식은 고정되어 있지 않습니다. 실제 테스트에서 `ig_reel`은 캡션·원본 릴스 URL, `ig_post`는 캡션·미디어 ID·JPEG 한 장의 CDN URL을 반환했습니다. [미디어 확보 테스트](docs/instagram-media-input-test.md)에 실제 범위와 제한을 기록했습니다. 운영 함수에는 원본 URL 확인 → Vercel Python/yt-dlp 다운로드 → 최대 10장 AI 입력 → AI 종료 후 비공개 임시파일 삭제를 연결했습니다. 원본 주소를 얻을 수 없는 공유 게시물은 링크를 요청합니다. `GEMINI_API_KEY`가 있으면 영상도 전사합니다. 팀원 연결 계약과 제한은 [미디어 파이프라인](docs/media-pipeline.md)을 참고하세요.

## 연결

Gemini 키가 있으면 일반 텍스트 DM은 자연어 대화로, Instagram 링크·미디어 첨부는 콘텐츠 분석으로 분기합니다. 최근 30분의 최대 6회 왕복을 맥락으로 사용하고 `대화 초기화`로 지울 수 있습니다. `연결` 명령은 기존대로 계정 연결 링크를 보냅니다. 구현·보관 방식·검증 범위는 [DM 일반 대화](docs/dm-chat.md)를 참고하세요.

이 앱은 **통합 로그인(Unified Login)** 을 사용합니다. 기존 Instagram Login 예제의 앱 ID, 권한 이름, 토큰 API를 혼용하면 안 됩니다.

- Meta 앱 ID: `2418018855613539`
- 로그인 구성 ID: `2085773485459248`
- 대상 Instagram: `@inthon2team` / `17841414630453998`
- Graph API: `https://graph.facebook.com/v26.0`
- 필요한 구성 권한: `instagram_basic`, `instagram_manage_messages`
- 로그인 콜백: 현재 ngrok 주소 + `/auth/instagram/callback`
- 웹훅 GET 검증 / POST 수신: 현재 ngrok 주소 + `/webhooks/instagram`

1. Meta의 통합 로그인 설정에서 로그인 콜백을 등록합니다. 구성의 광고·댓글·게시 권한과 광고 계정 자산은 해제합니다.
2. 로컬 설정 화면에 **Meta 앱 시크릿**을 저장합니다. 앱 시크릿은 OAuth 코드 교환과 웹훅 서명 검사에 사용됩니다.
3. Meta에서 웹훅 콜백 및 로컬 화면의 검증 토큰을 등록하고 `messages` 필드를 구독합니다.
4. 로컬 화면에서 Instagram 권한 승인을 시작합니다. 대상 계정만 선택하고 승인합니다. 서버가 코드를 시스템 사용자 액세스 토큰으로 교환하고, 지정된 Instagram 계정과 비즈니스 ID를 확인한 후 저장합니다.
5. 로컬 화면에서 `messages 구독하고 확인하기`를 실행합니다. 대시보드 필드 구독과 계정별 구독이 모두 필요합니다.
6. 다른 테스트 계정에서 실제 DM을 보내고 수신 상태를 새로고침합니다. Meta 샘플 이벤트 성공은 실제 DM 수신 완료와 별개입니다.

현재 앱에서 실제 조회된 토큰 권한은 `instagram_basic`, `instagram_manage_messages`, Facebook 로그인의 기본 권한인 `public_profile`입니다. `assigned_instagram_accounts`가 빈 목록을 반환하면 지정된 계정 ID를 직접 조회해 사용자 이름까지 확인합니다.

## 비밀값과 수신 기록

- `.local/credentials.dpapi`는 현재 Windows 사용자와 PC에 묶여 암호화됩니다. 로컬 화면은 127.0.0.1:8788에서만 열리며 ngrok은 8787만 전달합니다.
- `.local/`에는 현재 사용자와 SYSTEM만 접근하도록 설정합니다. 다른 PC로 파일을 복사해도 그대로 복호화할 수 없습니다.
- 시크릿, 토큰, OAuth 코드는 로그에 기록하지 않습니다. ngrok 요청 검사도 비활성화합니다.
- `.local/receipts.jsonl`에는 수신 시각, 메시지 수, entry 수만 저장합니다. DM 본문과 발신자 정보는 저장하지 않습니다.
- 로컬 화면의 횟수는 이번 실행 기준입니다. 재전송된 이벤트는 수신 횟수에 다시 집계될 수 있습니다.
- 토큰 만료·권한 철회 시 다시 연결합니다. 공개 서비스 배포나 앱 검수는 이 테스트의 범위에 포함하지 않습니다.

`Forbidden` 대신 출처/CSRF 오류가 보이면 로컬 화면을 새로 열어 다시 저장합니다. 앱 내 브라우저의 `Origin: null`도 CSRF 토큰이 맞을 때만 허용합니다.

## 자동 답장

서버가 켜져 있고 대상 계정의 토큰이 연결돼 있으면 새 DM마다 **안녕?**을 답장합니다. 본문과 발신자는 저장하지 않습니다. 에코·자기 메시지·다른 계정의 이벤트·24시간을 넘긴 메시지는 건너뜁니다.

`.local/replies.jsonl`에 메시지 ID의 SHA-256 해시와 전송 상태만 저장하여 재전송 이벤트와 재시작으로 인한 중복 답장을 막습니다. 이 파일을 지우면 중복 방지 기록도 사라집니다. 전송 실패·시간 초과는 로컬 화면에 표시하며 자동 재시도하지 않습니다. 로컬 테스트용이므로 장애 복구가 필요한 서비스로 확장할 때는 재시도와 대기열을 추가하세요.

공식 문서: [통합 로그인 시작하기](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/get-started), [인증 및 액세스 토큰](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/authentication), [웹훅 설정](https://developers.facebook.com/documentation/instagram-platform/webhooks/setup).

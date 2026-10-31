# Instagram DM 콘텐츠 선택 버튼

콘텐츠(릴스·게시물·첨부 이미지·Instagram 링크)를 공유하면 즉시 분석하는 대신 Quick Replies 세 개를 보냅니다.

| 버튼 | 동작 |
| --- | --- |
| 레시피 정리 | 모든 이미지·영상과 본문을 함께 Gemini에 전달해 구조화된 레시피 생성 |
| 팩트체크 | 해당 콘텐츠로 기존 미디어 확보 → Gemini 팩트체크 실행 |
| 일정 조회 | 선택을 확인하고 준비 중임을 안내. 전시·팝업 / 공모전·대외활동 프롬프트는 후속 작업 |

일반 텍스트 대화, 대화 초기화, `연결` 명령은 유지합니다. 선택 안내나 준비 중 응답은 완료 결과로 저장하지 않습니다. 실제 완료된 레시피·팩트체크만 기존 Supabase 저장 및 DM 발송 상태 갱신을 따릅니다. 기본 응답은 개인 결과 링크이며 설정에서 전체 DM을 선택할 수 있습니다.

## 연결 위치

- `content-choices.mjs`: 버튼 메시지, 원본 메시지 보관, 클릭 검증 및 분기.
- `dm-assistant.mjs`: 공유 → 선택 안내 / Quick Reply 클릭 → 해당 처리 / 나머지 → 일반 대화.
- `server.mjs`: 문자열 또는 Meta 메시지 객체를 Send API로 전달. 분석 시작 시 `acknowledge()`로 접수 안내 전송.
- `dm-assistant.mjs`에서 action에 따라 레시피·팩트체크 처리기로 직접 보냅니다. `schedule`은 후속 작업이며 `not_ready` 응답을 성공 결과처럼 저장하면 안 됩니다.

버튼 payload 형식은 `content:v1:<recipe|factcheck|schedule>:<32자리 무작위 티켓>`입니다. 들어오는 `message.quick_reply.payload`를 사용하며 표시 문구만으로 분기하지 않습니다. 사용자가 버튼 이름을 직접 타이핑하면 일반 대화로 처리합니다.

## 원본 연결과 보관

티켓은 발신자별 경로로 격리하며 원본 메시지·첨부 URL을 앱 시크릿으로 암호화해 private Blob에 저장합니다. payload에 메시지 본문·계정 ID·원본 URL은 넣지 않습니다. 여러 공유가 도착해도 각 버튼은 자신의 콘텐츠에 연결됩니다.

선택 유효기간은 20분이며, 타 계정 접근·만료·잘못된 payload는 거절합니다. Blob의 기존 `claimPath` 예약으로 동시 클릭도 한 번만 처리합니다. 선택 처리 성공·실패 후 해당 원본 메시지 Blob을 삭제합니다. 다운로드한 실제 이미지·영상의 AI 처리 후 삭제는 기존 미디어 파이프라인이 담당합니다.

제약: 선택하지 않은 티켓은 20분 후 사용할 수 없지만 Blob에서 즉시 물리 삭제되지는 않습니다. 만료 티켓 접근 시 삭제하며, 장기 운영 전 `dm/choices/`의 오래된 원본 JSON을 정기 삭제해야 합니다. 원본 없는 카드뉴스의 전체 이미지 확보 문제는 이 변경으로 해결되지 않습니다.

## 확인

`npm test`에 버튼 계약, 여러 콘텐츠 연결, 다른 발신자 차단, 만료·동시 클릭, 실패 후 삭제, 서명된 웹훅 → Send API 메시지 → 클릭 → 실제 분석 저장 흐름 테스트가 있습니다.

실기 확인은 Instagram 모바일 앱에서 공개 콘텐츠를 새로 공유하고 세 버튼을 확인한 다음 레시피 또는 팩트체크를 누릅니다. 일정은 현재 준비 중 안내가 정상입니다.

Meta 참고: [Instagram Quick Replies](https://developers.facebook.com/docs/messenger-platform/instagram/features/quick-replies/), [Meta 공식 Send API 예제](https://www.postman.com/meta/messenger-platform-api/documentation/iyp204x/messenger-platform-api?entity=request-22794852-c54925d1-6422-49cd-a2d2-e275e3f559c4).

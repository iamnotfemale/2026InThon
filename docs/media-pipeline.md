# Instagram 원본 확보와 AI 입력 계약

범위: 원본 주소 확보, 최대 10개 미디어 다운로드, 이미지 최대 10장 전달, AI 처리가 끝난 뒤 임시 파일 삭제. 팀원이 담당하는 AI 프롬프트·Google 로그인·Instagram 계정 연결·Supabase 스키마는 변경하지 않는다.

## 처리 흐름

1. Meta 서명을 검증하고 웹훅을 저장·ACK한다. 기존 메시지 ID 예약으로 중복 답장을 방지한다.
2. `instagram-source.mjs`가 원본 주소를 결정한다.
3. `api/media.py`가 yt-dlp로 게시물의 전체 항목을 다운로드한다. 비공개 Blob에 원본과 AI용 이미지를 저장한다.
4. `media-pipeline.mjs`가 저장된 미디어를 기존 `createFactChecker`에 전달한다. 업로드된 파일 경로를 사용하며, 외부 CDN에 재접속하지 않는다.
5. 주장 추출·검색·판단이 모두 끝나거나 오류가 확정되면 `finally`에서 해당 작업의 원본·AI용 파일을 삭제한다. 이후 기존 DM 전송·결과 저장 흐름이 이어진다.

운영 Vercel에는 Node 웹훅 함수와 Python 다운로드 함수를 함께 배포한다. 로컬 PC·ngrok·브라우저 로그인 세션을 실행 환경으로 사용하지 않는다.

## 원본 주소 확보 순서

| 입력 | 동작 |
| --- | --- |
| DM 본문의 Instagram `/p/`, `/reel/`, `/reels/`, `/tv/` 링크 | 정확한 도메인·HTTPS·경로를 확인하고 추적 쿼리를 제거 |
| 공유 첨부의 `payload.url` 또는 `payload.permalink`가 원본 링크 | 같은 방식으로 검증해 사용 |
| `ig_post_media_id` 또는 `reel_video_id`만 있음 | 기존 서버 토큰으로 Graph `/{id}?fields=permalink`를 한 번 조회. 응답도 동일 검증 |
| Graph 접근 실패·100/33·원본 주소 없음 | AI를 호출하지 않고 “링크 복사한 주소를 이 DM에 보내주세요” 안내 |
| 서로 다른 원본 링크 여러 개 또는 공유 첨부 여러 개 | 한 번에 하나씩 보내 달라고 안내 |
| 일반 텍스트·직접 보낸 이미지 | 기존 팩트체크 입력 경로 사용 |

- 원본 게시물 캡션에 적힌 링크는 다른 게시물일 수 있어 원본 후보로 사용하지 않는다.
- 웹훅의 숫자 ID를 Base64로 변환해 shortcode를 추측하지 않는다. 실제 테스트에서 잘못된 게시물 주소가 나왔다.
- `ig_post`의 CDN 이미지 한 장을 전체 게시물로 취급하지 않는다. 실제 10장 게시물에서는 두 번째 이미지가 왔다.
- 카드뉴스 공유만으로 원본 주소를 **항상** 자동 확보하는 공식 방법은 현재 확인되지 않았다. 이 경우 원본 링크 요청이 MVP의 명시적인 보완 경로다. 이후 사용자가 링크만 보내도 독립적으로 분석하므로 이전 메시지·계정 DB를 수정할 필요가 없다.
- `/share/...` 단축 주소·비공개 게시물·스토리는 이번 범위 밖이다. `/p/...` 또는 `/reel/...` 형식의 공개 원본 링크가 필요하다.

## 입력 제한과 순서

- 게시물 한 개, 미디어 총 10개까지. 사진만 있는 경우 이미지 최대 10장. 11개 이상이면 조용히 자르지 않고 다운로드를 중단한다.
- 게시물의 원래 순서를 유지한다. 사진·영상이 섞여 있으면 순서대로 파일 정보를 전달한다.
- 사진은 원본을 보관하면서 EXIF 방향을 적용하고, AI 입력용 JPEG를 별도로 만든다. 최대 긴 변 2048px, 한 장 1.5MiB 이하. 위치 등 EXIF는 입력용 JPEG에 복사하지 않는다.
- 기존 직접 이미지 입력도 5장 → 10장으로 늘렸다. 실제 바이트로 이미지 형식을 판별하므로 Meta가 JPEG를 WebP라고 표시해도 올바른 MIME을 사용한다.
- 영상은 MP4 한 파일을 받는다. 개당 20MiB 이하, 작업 원본 합계 80MiB 이하. 영상 포맷이 없으면 커버 이미지를 영상 다운로드 성공으로 보고하지 않는다.
- `GEMINI_API_KEY` 하나로 이미지 주장 추출·근거 판단·영상 전사를 모두 처리한다. 기본 모델은 실제 호출을 확인한 `gemini-3.8-flash`; `GEMINI_MODEL`로 변경할 수 있다. Gemini 키가 없고 Continuum 키만 있으면 기존 DeepSeek 이미지·텍스트 경로를 사용한다. 영상 모델이 없거나 일부 파일을 읽지 못하면 원본 확보 경로에서는 전체 분석을 중단한다.
- 한도 초과·다운로드 차단은 `no_input` 응답이다. 이를 팩트체크의 “거짓”이나 “확인됨” 판정으로 저장하지 않는다.

## 팀원 코드와 연결되는 인터페이스

운영 진입점 `api/instagram.mjs`는 다음처럼 기존 AI 함수를 감싼다.

```js
factCheck: mediaFactCheckerFromEnv(factCheckerFromEnv(), { loadAccessToken })
```

`GEMINI_API_KEY` 또는 `CONTINUUM_API_KEY`가 있으면 접수 안내와 실제 팩트체크로 전환된다. 둘 다 없으면 기존 고정 답장을 유지한다. 둘 다 있으면 Gemini를 사용한다. Gemini는 기존 시스템 프롬프트와 결과 계약을 그대로 사용하며, 순서가 있는 이미지·텍스트를 Gemini 입력 형식으로 바꿔 보낸다. 키는 Vercel Production의 Sensitive 환경변수에 저장하고 Git이나 로그에 넣지 않는다.

기존 `createFactChecker`의 첫 번째 인자는 그대로다. 원본 다운로드 경로만 두 번째 인자를 쓴다.

```js
await check(message, {
  fetchMedia: lease.fetchMedia, // 현재 작업 파일만 읽는 비공개 reader
  requireAllMedia: true        // 일부 실패를 캡션만 본 결과로 대체하지 않음
})
```

결과에 추가되는 `media` 예:

```json
{
  "status": "downloaded",
  "sourceUrl": "https://www.instagram.com/p/Example/",
  "sourceVia": "message",
  "totalItems": 10,
  "images": 10,
  "videos": 0
}
```

`media.status: downloaded`는 다운로드 범위다. AI 판정 성공 여부는 기존 결과 `status`와 `notes`를 확인한다. `sourceVia`는 `message` 또는 `graph`. 원본 부재는 `media.status: needs_source_url`, `needsSourceUrl: true`; 모호한 링크는 `ambiguous`; 다운로드 실패는 `download_failed`. 모두 기존 결과 상태 `no_input`을 사용한다. Supabase 스키마 변경은 없으며 현재 저장기는 이 추가 메타정보를 별도로 저장하지 않는다. 향후 대시보드 원본 링크를 저장하려면 팀원이 이 필드를 결과 저장기에 연결하면 된다.

별도 로컬 평가 도구 `scripts/factcheck-eval.mjs`와 로컬 ngrok 실험 도구는 기존 직접 파일·첨부 입력을 유지한다. 운영 미디어 확보를 검증할 때는 위 운영 wrapper를 사용해야 한다.

## 임시 보관과 삭제

- 비공개 경로: `dm/media-jobs/<무작위 UUID>/`. 공개 다운로드 URL을 사용자나 AI 프롬프트에 넣지 않는다. AI에는 서버에서 읽은 실제 바이트를 보낸다.
- Python 함수는 서버가 만든 HMAC·본문·시각을 검증한다. 앱 시크릿은 요청에 보내지 않는다. 원본 주소도 다시 검증한다.
- 업로드 원본과 JPEG 변환본 모두 AI 작업 종료까지 유지한다. Python 로컬 복사본은 비공개 저장소 이관 후 지운다.
- 성공·모델 오류·검색 오류·입력 오류 시 `finally`에서 현재 UUID 경로만 정리한다. DM 전송 실패가 원본 파일 보관을 연장하지 않는다.
- 다운로드 함수는 120초, 이후 AI 호출은 전체 150초 내 종료하도록 취소 신호를 전달해 Node 함수의 300초 제한 전에 정리할 시간을 남긴다. 팀원이 모델 호출을 교체할 때도 전달받은 `signal`을 fetch에 연결해야 한다.
- 업로드 도중 실패한 파일도 정리한다. 저장 응답이 유실된 파일까지 삭제 대상에 포함한다.
- 강제 종료·정리 실패로 남은 파일은 다음 다운로드 요청 때 1시간 이상 지난 작업을 재정리한다. **요청이 전혀 없으면 자동 정리 시점이 보장되지 않는다.** 상시 운영으로 확장할 때 주기적인 정리 작업을 붙여야 한다.
- 현재 Gemini 입력은 inline bytes여서 별도 Files API 업로드 파일이 없다. 팀원이 Files API로 바꾸면 그 원격 파일도 AI 종료 후 삭제해야 한다.
- 바탕화면에 요청해 보관한 테스트 원본은 임시 작업 경로 밖이며 삭제 대상이 아니다.

## 검증과 알려진 한계

- Node 회귀 테스트 64개: 원본 URL 검증, Graph 결과 검증과 실패 보완, 10장 순서·11장 거절, HMAC 요청, 작업 경로 격리, 성공·실패 후 정리, 모델 취소 신호, Gemini 단독 키·10장 입력·안전한 오류 처리.
- Python 회귀 테스트 13개: 요청 서명·만료, JPEG 변환, 10개 업로드 순서, 중복 작업 보호, 부분 실패 정리, 오래된 파일 복구, 기존 다운로드 회귀.
- 실제 10장 게시물: 로컬 및 **배포된 Vercel Python 함수**에서 yt-dlp 다운로드 → 비공개 원본·입력용 파일 20개 보관 → AI adapter에 10장 전달 → 잔여 0개 확인. 입력 JPEG 합계 약 3.34MB.
- 실제 릴스: 로컬 및 배포된 Vercel에서 MP4 10,854,918bytes 확보 → 영상 분석 adapter까지 전달 → 잔여 0개 확인. 모델·영상 전사는 테스트 함수로 대체했으며 외부 AI 호출은 하지 않았다. 샘플의 공개 원본 URL이나 캡션은 이 문서에 공개하지 않는다.
- 운영 확인: `/health` 200, Python 함수 GET 405·서명 없는 POST 403, 소스 파일·로컬 비밀 파일 경로 404. 비공개 다운로드 함수가 공개 파일 서버가 되지 않도록 확인했다.
- 공개 게시물도 Instagram이 데이터센터 IP를 제한하거나 로그인을 요구할 수 있다. 이는 토큰 재발급·테스터 추가만으로 해결된다고 가정하지 않는다. 실패 시 부분 파일로 분석하지 않는다.
- Gemini 키 인증과 `gemini-3.8-flash`의 실제 JSON 응답을 확인했다. 기존 `gemini-2.5-flash`는 해당 키의 모델 목록에 있어도 실제 생성 요청은 404여서 기본 모델을 변경했다.
- **실제 Gemini 미디어 검증**: Vercel에서 10장 게시물을 다운로드해 Gemini에 10장 모두 전달했고 `done`, 근거 링크 2개, 약 102초를 확인했다. 릴스는 영상 전사·주장 추출·판단까지 `done`, 약 60초를 확인했다. 두 검증 모두 실제 AI 요청 중 원본을 유지했고 종료 후 잔여 파일은 0개였다. 이때 DM은 발송하지 않았다. 링크 내용과 판정의 정확성을 사람이 평가한 결과는 아니다.
- 이번 변경은 프롬프트 정확도·팩트체크 품질을 평가하지 않는다. 서비스별 프롬프트 개선·판정 품질 평가·대시보드 계정 연결은 팀원 담당이다.

플랫폼 근거: [Vercel Python /api 함수](https://vercel.com/docs/functions/runtimes/python/api-directory), [비공개 Blob Python SDK](https://vercel.com/docs/vercel-blob/python-sdk-reference). SDK·미디어 라이브러리는 `requirements.txt`에 버전을 고정했다.

Gemini 입력 근거: [이미지 이해](https://ai.google.dev/gemini-api/docs/generate-content/image-understanding), [영상 이해](https://ai.google.dev/gemini-api/docs/generate-content/video-understanding), [JSON 응답](https://ai.google.dev/gemini-api/docs/generate-content/structured-output).

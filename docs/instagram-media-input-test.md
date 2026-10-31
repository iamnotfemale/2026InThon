# Instagram 공유 미디어 확보 테스트

실행일: 2026-10-31 KST. 실제 앱의 서명 검증된 웹훅과 사용자가 보낸 공개 릴스 1건·이미지 3장 게시물 1건으로 확인했다. 아래 결과는 이 두 샘플에 대한 관측이며 모든 게시물·계정에 대한 보장이 아니다.

## 1. 결과

| 구간 | 릴스 | 이미지 3장 게시물 |
| --- | --- | --- |
| 메시지 키 | `mid`, `attachments` | `mid`, `attachments` |
| 첨부 타입 | `ig_reel` | `ig_post` |
| payload 키 | `reel_video_id`, `title`, `url` | `ig_post_media_id`, `title`, `url` |
| `title` | 캡션 430자 | 캡션 90자 |
| 메시지 `text` | 없음 | 없음 |
| `url`의 실제 내용 | Instagram 원본 릴스 페이지, HTML | 서명된 Meta CDN의 JPEG 한 장 |
| 웹훅만으로 전체 파일 확보 | 영상 파일 없음 | 3장 중 한 장만 확보 |
| Graph 미디어 조회 | HTTP400, code100/subcode33 | HTTP400, code100/subcode33 |
| 공개 페이지 단순 HTTP 조회 | HTML과 OG 이미지 한 개, 영상 URL 없음 | HTML과 OG 이미지 한 개, 캐러셀 목록 없음 |
| yt-dlp 경로 | 웹훅 원본 URL로 MP4 확보 성공 | 사용자가 알려준 원본 게시물 URL로 세 이미지 모두 확보 성공 |

다운로드 결과:

- 릴스: MP4 10,854,918바이트, 720×1280, 약 122.004초, H.264 영상 + AAC 음성.
- 게시물: JPEG 3개. 2701×2701 한 장(1,213,144바이트), 3024×3024 두 장(2,574,577 / 2,288,769바이트).
- 서로 다른 이미지 3장인지 파일 해시로 확인했다. 이미지 디코딩, 영상·음성 스트림 검사와 전체 영상 디코딩도 통과했다.
- 파일과 캡션·메타데이터는 요청한 PC의 바탕화면 `Inthon_Media_Test_2026-10-31`에 정리한다. 원문·개인 캡션·실제 CDN 서명 URL은 Git에 올리지 않는다.

## 2. 관측한 페이로드 모양

아래 값은 익명화된 예시다. 실제 발신자·메시지 ID나 서명 URL은 포함하지 않는다.

```json
{
  "message": {
    "mid": "[message-id]",
    "attachments": [{
      "type": "ig_reel",
      "payload": {
        "reel_video_id": "[opaque-media-id]",
        "title": "[caption]",
        "url": "https://www.instagram.com/reel/[shortcode]/"
      }
    }]
  }
}
```

```json
{
  "message": {
    "mid": "[message-id]",
    "attachments": [{
      "type": "ig_post",
      "payload": {
        "ig_post_media_id": "[opaque-graph-media-id]",
        "title": "[caption]",
        "url": "https://lookaside.fbsbx.com/ig_messaging_cdn/[signed-preview-url]"
      }
    }]
  }
}
```

`payload.url`이 항상 MP4·JPEG 직접 다운로드 주소라는 가정은 틀린다. MIME·파일 시그니처를 확인하고 HTML 페이지, 대표 이미지, 실제 영상·전체 이미지 묶음을 구분해야 한다. Meta 문서도 여러 첨부 유형을 정의하므로 한 타입으로 고정하지 않는다. [Meta 웹훅 예시](https://developers.facebook.com/documentation/instagram-platform/webhooks/examples)

## 3. 게시물 원본 링크 확보의 남은 제약

- 이번 `ig_post`에는 원본 `instagram.com/p/...` URL이 없었다.
- `ig_post_media_id`를 네이티브 Instagram 숫자 PK처럼 Base64 변환하면 사용자가 확인한 원본 주소와 **다른 주소**가 나왔다. 이 변환을 자동 링크 복구로 사용하지 않는다.
- 토큰으로 `permalink`, `children`, `media_url`을 조회하는 요청은 이번 두 공유 미디어에 대해 권한 오류였다.
- 전체 3장 다운로드 성공은 **사용자가 원본 게시물 링크를 추가 제공한 상태**다. 웹훅만으로 캐러셀 전체 확보가 완료됐다는 뜻이 아니다.
- 첫 구현에서 원본 주소가 없으면 원본 링크를 요청하거나, 확인 가능한 대표 이미지·캡션만 처리하고 범위를 명시한다. 대표 이미지 한 장을 전체 카드뉴스로 검증하지 않는다.
- 릴스는 이번 샘플에서 원본 URL이 왔으므로 추가 링크 입력 없이 다운로드 단계로 이어질 수 있었다.

## 4. 토큰·역할·웹훅 주소 확인

### 직접 확인한 상태

- Meta 앱의 활성 Instagram 웹훅은 `https://inthon.yeoziphab.com/webhooks/instagram`, 필드는 `messages`, 버전은 v26.0이었다. 조사 시점에 ngrok으로 변경되어 있지 않았다.
- 계정별 `messages` 구독도 정상 조회됐다.
- 현재 토큰은 해당 앱의 유효한 SYSTEM_USER 토큰이며 `instagram_basic`, `instagram_manage_messages`, `public_profile`이 부여되어 있었다.
- 승인된 봇 계정의 프로필·미디어 목록은 HTTP200이었다. 봇 게시물은 0개이므로 소유한 실제 미디어의 상세 조회 비교는 못 했다.
- 다른 테스트 계정의 프로필과 두 외부 미디어의 상세 조회는 HTTP400 code100/subcode33이었다.
- 앱 역할 화면의 명시적인 Instagram 테스터 목록에는 봇 계정이 있었고 DM 발신 테스트 계정은 없었다. 그럼에도 이번 실제 DM 두 건은 수신됐다. 이 화면만으로 모든 발신자 허용 범위를 단정하지 않는다.

### 해석과 한계

1. 토큰 자체의 만료와 특정 자산 접근 실패는 구분해야 한다. 이번에는 봇·구독은 정상이고 외부 미디어 조회만 거부됐다.
2. 통합 로그인 토큰은 클라이언트가 선택한 비즈니스 포트폴리오와 공유 자산에 속한다. 공개 게시물을 DM으로 전달받았다고 작성자의 미디어 전체 조회 권한을 받은 것은 아니다. [Meta 인증·토큰 범위](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/authentication)
3. 테스터 역할은 개발 단계에서 앱을 시험할 자격과 관련되고, 실제 자산 연결·OAuth 승인과는 구분된다. 역할만 추가하면 타인의 모든 영상·이미지를 조회할 수 있다는 결론은 낼 수 없다. [Meta 권한·액세스 레벨](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/permissions)
4. 다른 계정에 새 테스터 역할을 부여하거나 그 계정의 토큰을 새로 발급하는 실험은 하지 않았다. 따라서 ‘테스터 등록 전후 동일 계정 비교’는 미검증이다.
5. 오류100/33 자체만으로 원인을 단정하지 않는다. 올바른 객체 식별자·API 호스트·권한·자산 범위를 함께 확인해야 한다.

이번 결과를 해결하려고 앱을 Live로 바꾸거나 광고·게시 권한을 추가하지 않았다.

## 5. 재사용할 로컬 다운로드 도구

`scripts/download-instagram-media.py`는 설치된 yt-dlp를 사용한다. 실제 검증 버전은 2026.07.04다. 브라우저 쿠키·Instagram 세션·Meta 토큰을 사용하지 않고 공개 콘텐츠 두 건을 다운로드했다. [yt-dlp 공식 프로젝트](https://github.com/yt-dlp/yt-dlp)

```powershell
# yt-dlp가 있는 Python 환경에서 실행. 필요할 때 해당 환경에 설치한다.
python -m pip install yt-dlp

# 원본 주소를 명시해서 다운로드
python scripts/download-instagram-media.py "https://www.instagram.com/reel/SHORTCODE/" "D:\Dev\Support\media-test\reel"
python scripts/download-instagram-media.py "https://www.instagram.com/p/SHORTCODE/" "D:\Dev\Support\media-test\post"

# 순수 보조 함수 테스트: yt-dlp 설치·네트워크 없이 실행 가능
python -m unittest discover -s scripts -p "*_test.py"
```

출력은 영상·이미지 파일, `caption.txt`, `metadata.json`이다. 메타데이터에는 원본 주소와 파일 목록이 들어가며 임시 CDN 서명 URL은 넣지 않는다.

- `--metadata-stdin`: 이미 추출한 yt-dlp JSON을 UTF-8 stdin으로 전달해 다운로드.
- `--attachment-stdin`: `-`를 URL 자리로 쓰고 첨부 JSON을 UTF-8 stdin으로 전달. 원본 Instagram URL이 있는 릴스 등에 사용 가능. CDN 미리보기 주소만 있는 게시물은 명확한 오류로 중단한다.
- `--ffmpeg PATH`: 필요 시 설치된 ffmpeg 디렉터리 지정.
- 공개 Instagram 게시물·릴스 주소만 입력으로 받고, 추적 쿼리를 제거한다.
- 이미지는 CDN 호스트·HTTPS·리디렉션·MIME·파일 시그니처를 검사하고 20MiB 제한을 둔다. 영상은 yt-dlp 다운로드에 150MiB 제한을 둔다.
- 이미지 전용 게시물의 ‘영상 형식 없음’은 다운로드 실패로 취급하지 않고 이미지 후보를 사용한다.
- 이미지 크기 정보가 없는 경우 후보 순서만 신뢰하지 않는다. CDN 주소의 리사이즈 표시를 확인해 축소 표시가 없는 후보를 우선하고, 나머지는 크기를 비교한다. 실제 파일 크기와 디코딩 결과도 별도로 검증한다.
- 서로 다른 기존 이미지 파일을 덮어쓰지 않는다. 같은 파일은 재실행 시 재사용한다.
- Windows stdin을 UTF-8로 명시해서 한국어 캡션이 깨지거나 surrogate 인코딩 오류가 나지 않게 했다.

## 6. 운영 파이프라인으로 넘길 경계

권장 연결 순서:

`서명 확인 → 첨부 타입·캡션·URL 확보 → 원본 URL 유효성 확인 → 다운로드 작업 → 실제 파일 검사 → AI 입력 → 확인 범위를 포함한 결과`

- 이번 도구는 **로컬 다운로드 검증 도구**다. 운영 Vercel 함수에 Python·yt-dlp 실행 환경이나 다운로드 작업 큐가 자동으로 생긴 것은 아니다.
- 현재 팩트체크 함수의 첨부 조회를 이 도구로 연결하거나 실제 영상·이미지를 AI에 전송하는 작업은 아직 하지 않았다.
- 파일을 받은 것과 영상의 음성·자막을 분석한 것은 다르다. AI 전송·모델 처리 한도·영상 전사는 별도 검증한다.
- 공개 다운로드도 로그인 요청·접근 제한·속도 제한·게시물 삭제로 실패할 수 있다. 실패 시 한 장의 미리보기만 보고 전체 내용을 검증했다고 답하지 않는다.
- 영상 150MiB 로컬 제한은 기존 모델 입력 한도와 같다는 뜻이 아니다. 실제 AI 경로에서 별도 크기·길이 검증이 필요하다.

## 7. 테스트 진단 기능

`media-probe.mjs`는 `MEDIA_PROBE_CODE`, `MEDIA_PROBE_UNTIL`이 모두 유효할 때만 켜지는 진단 기능이다.

- 30분 이내 만료, 코드 DM으로 명시적으로 참여한 발신자 한 명, 서명 확인된 대상 봇의 최신 메시지만 수집.
- 첨부·캡션은 비공개 Blob에 AES-GCM으로 암호화한다. 일반 DM 본문·원문 발신자 ID는 보관하지 않는다.
- 정상 응답과 독립적인 백그라운드 작업으로 실행한다. 수집 장애가 기존 답장을 막지 않는다.
- 진단 환경변수는 테스트 후 제거한다. 원문 진단 기록은 개인 로컬 암호화 보관 후 테스트용 클라우드 영역에서 정리한다.
- 앱 시크릿·접근 토큰·세션 쿠키를 테스트 문서·다운로드 메타데이터·Git에 넣지 않는다.

## 8. 추가 테스트: 게시물 두 건

두 건 모두 실제 웹훅에 `ig_post` 첨부 하나씩 도착했다. 로그인된 봇 계정의 Instagram 받은함에서 해당 공유 카드를 열어 원본 주소를 확인하고, 그 주소를 로컬 yt-dlp 도구에 넘겼다. 사용자가 원본 주소를 별도로 입력하지 않았지만, **서버가 웹훅만으로 주소를 자동 복원한 것은 아니다.**

| 관측 | 첫 번째 게시물 | 두 번째 게시물 |
| --- | --- | --- |
| 캡션 길이 | 603자 | 224자 |
| 웹훅 첨부 수 | 1 | 1 |
| 전체 조회·다운로드한 이미지 수 | 2 | 10 |
| 파일 형식·해상도 | WebP 1440×1920 두 장 | JPEG 약4096×2730 열 장 |
| Graph 미디어 조회 | 100/33 | 100/33 |

추가로 수정한 문제:

1. **후보 배열의 마지막 이미지가 항상 고해상도는 아니었다.** 첫 게시물에서 마지막 후보는 480×640 WebP였고, 축소 표시가 없는 후보는 1440×1920이었다. 주소의 리사이즈 표시를 반영해 고르는 방식으로 수정하고 회귀 테스트를 추가했다.
2. **HTTP MIME과 실제 파일 형식이 달랐다.** 첫 웹훅 이미지의 HTTP 헤더는 `image/webp`였지만 파일 바이트는 JPEG였다. AI 입력은 실제 JPEG·PNG·WebP·GIF 시그니처에 맞춰 MIME을 정하도록 수정했다. HTML을 이미지로 오인한 응답은 이미지 입력에서 제외한다.
3. **웹훅 이미지가 첫 장이라는 보장도 없었다.** 두 번째 웹훅 파일은 전체 다운로드 목록의 두 번째 이미지와 바이트·해시가 같았다. 따라서 ‘대표/첫 장만 읽었다’보다 ‘공유 첨부 이미지에서 확인한 범위’를 안내한다.

원본 캡션과 다운로드 캡션을 대조해 두 URL이 해당 수신 건에 대응하는지도 확인했다. 추가 파일은 기존 바탕화면 폴더의 `Round_02`에 분리한다. 모델에 실제 파일을 전송하거나 전체 열 장을 운영 팩트체크에 연결하는 작업은 이번 테스트에 포함하지 않는다. 현재 운영 입력의 `MAX_IMAGES=5` 등 모델 입력 제한은 다운로드 성공과 별개다.

# 미용 탭 백엔드 연결

2026-11-01 기준. `beauty-tab.zip`의 미용 분류·색·구슬·미용실/화장품 상세를 PC와 모바일에 적용했다. 내 콘텐츠·사이드바·유형 선택에 `beauty`를 추가했다. 내 취향 궤도와 캘린더에는 포함하지 않는다.

## 현재 완료된 범위

- 미용실은 시술·가격·장소·예약, 화장품은 제품·가격·작성자가 말한 사용법·구매처를 표시한다.
- 확인하지 않은 값은 미기재로 표시하고, 효과·사용감은 게시물 작성자의 설명으로 구분한다. 예약·구매는 외부 페이지에서 진행한다.
- 가상 샘플 두 개는 데모에서만 보인다. 실제 모드는 본인에게 접근 권한이 있는 `status: done`, `topic: beauty` 결과를 표시한다.
- 아래 저장 구조를 검증해서 표시할 수 있다. 잘못된 구조/위험한 링크는 거절한다. 미용을 뉴스 판정이나 자동 관심 추정으로 바꾸지 않는다.

**백엔드 연결 구현:** 공유 후 여섯 번째 **미용 정리**(`beauty`) 버튼 → 기존 원본 미디어 확보 → `beauty.mjs`의 Gemini 분석 → 구조 검증 → 결과 저장 → 기본 전체 DM 응답을 연결했다. 개인 링크 방식도 기존 사용자 설정을 따른다. Meta 권한·DB 스키마는 변경하지 않았다.

- `beauty.mjs`: 미용실/화장품을 구분하고 이미지·영상·본문을 한 번에 읽는 프롬프트, 처리기와 전체 DM 렌더링. 일반 대화·팩트체크는 기존 분기를 유지한다.
- `content-choices.mjs`, `dm-assistant.mjs`, `server.mjs`: 발신자별 암호화 티켓, beauty 라우터와 전용 접수 안내. 선택 전에는 분석하지 않는다. 분석 성공·실패 후 원본 미디어 삭제는 기존 미디어 파이프라인을 재사용한다.
- `public/js/beauty-data.js`: `normalizeBeauty()`가 저장용 v1 구조와 null을 보존하고, `validateBeauty()`는 표시용 미기재 문구를 적용한다. 원본 본문·메시지에 없는 링크는 분석 결과에서 제외하고 안내한다. 이미지 속 링크도 본문에서 확인하지 못하면 채택하지 않는다.
- `supabase-state.mjs`: 저장 직전 다시 검증해 `topic: beauty`, `verdict: null`, `reason: {beauty, sourceUrl, contentIndex}`로 저장한다. 실패·자료 없음·미용 아님은 저장하지 않는다. 기존 연결 계정 RLS·보관·탈퇴 시 삭제·DM 전송 확인 규칙을 그대로 따른다.
- 검색 색인은 같은 분석 응답에서 생성하며 beauty 유형을 유지한다. 수동 취향·자동 관심 추정·캘린더에서는 계속 제외한다.

## 결과 계약

기존 `factchecks.reason`에 JSON 봉투를 저장하는 방식이다. 한 행은 미용 결과 하나다. 아래는 가상 형식 예시다.

```json
{
  "beauty": {
    "version": 1,
    "sub": "salon",
    "title": "가상 헤어살롱 — 레이어드 컷",
    "intro": "게시물에서 소개한 시술 설명이에요.",
    "bFacts": [["시술", "레이어드 컷"], ["가격", "45,000원부터"]],
    "points": ["상담 때 평소 가르마 방향을 알려달라고 안내했어요."],
    "place": "가상 헤어살롱",
    "address": null,
    "hours": null,
    "links": [["예약 페이지", "https://example.com/salon/booking", true]],
    "sponsored": false,
    "caution": "가격은 게시물 기준이에요. 실제 요금은 매장에서 확인해 주세요.",
    "linkNote": "예약은 매장 페이지에서 진행돼요. 이 서비스에서 예약이 완료되지 않아요."
  },
  "sourceUrl": "https://www.instagram.com/p/Example/"
}
```

| 필드 | 기준 |
| --- | --- |
| `version`, `sub` | `1`; `salon` 또는 `product` |
| `title`, `intro` | 필수 문자열. 제목 최대 300자, 소개 최대 2,000자 |
| `bFacts` | `[라벨, 값]` 배열 최대 12개. 각 문자열 최대 1,000자. 없는 값은 빈 문자열/`미기재` |
| `points` | 작성자가 말한 내용의 문자열 배열, 최대 20개, 항목당 최대 1,000자 |
| `place`, `address`, `hours` | 문자열 또는 `null`, 각각 최대 2,000자. 주소·시간을 추측하지 않음 |
| `links` | `[라벨, HTTP(S) URL, 주 버튼 여부]`, 최대 8개. 실제 확인한 URL만 저장. 사용자명·비밀번호를 URL에 넣지 않음 |
| `sponsored` | 확인된 협찬/광고 표시가 있을 때만 `true`. 영업 중 여부를 임의로 만들지 않음 |
| `caution`, `linkNote` | 원본 정보의 한계와 외부 예약·구매 안내. 문자열 또는 `null` |

화장품은 `sub: product`, 장소가 없으면 `place: null`로 저장한다. 분석을 완료한 결과만 `status: done`, `topic: beauty`, `verdict: null`로 저장한다. `contentIndex`는 기존 색인 봉투에 함께 둔다. 신규 DB 마이그레이션은 필요 없다.

## 연결 파일·완료 기준

- `public/js/beauty-data.js`: 표시 계약 검증. 백엔드에서 재사용 가능.
- `public/js/dashboard-live.js`: `factcheckToItem()`에서 미용 행을 변환한다. 기존 사용자별 결과 접근 권한을 유지한다.
- `frontend/design/Beauty.fragment.html`: PC/모바일 공용 상세 마크업.
- `frontend/design/Main.dc.html`, `frontend/mobile/Mobile.dc.html`: 분류·개수·데모·파생값 원본. 변경 후 `npm run build`로 생성물을 갱신한다.
- `beauty.test.mjs`: 양쪽 상세·필터, 미기재 값, 위험한 링크 거절, 협찬 상태, 취향 제외 검증.

연결 후 미용 콘텐츠 공유 → 미용 처리 선택 → 실제 분석·저장 → 기본 전체 DM 응답 → 본인 대시보드의 미용 카드까지 한 건으로 검증한다. 실패 결과를 성공 카드로 저장하거나 다른 사용자에게 노출하면 안 된다.

## 검증 범위

`node --test beauty-backend.test.mjs beauty.test.mjs content-choices.test.mjs server.test.mjs`로 확인한다.

- 미용실/화장품의 이미지·영상·캡션 동시 입력, 없는 정보의 null 보존, 본문에 없는 링크 제외, 위험한 링크·잘못된 결과 거절, 작성자 주장과 외부 예약·구매 안내, 긴 DM 분할을 검사한다.
- 서명된 웹훅 → 미용 버튼 → 미디어 준비·분석·정리 → 저장 → 전체 DM → PC/모바일 상세를 외부 서비스 대역으로 연결해 검사한다. 다른 발신자·재전송·잘못된 분석, 개인 링크 설정, 발송 미확인 상태도 포함한다.
- 기존 DB 접근 권한을 재사용하며 권한을 추가하지 않았다. 실제 Instagram 앱·운영 Gemini·운영 DB를 이용한 새 콘텐츠 테스트는 별도로 남아 있다. 오프라인 통과를 실서비스 전달 확인으로 간주하지 않는다.

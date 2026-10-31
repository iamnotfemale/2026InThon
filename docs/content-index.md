# 콘텐츠 색인·검색·관심 패턴

Gemini가 기존 콘텐츠 분석 응답에 `content_index`를 함께 반환한다. 레시피·뉴스·공모전·전시 모두 적용한다. 색인을 만들기 위한 추가 미디어 분석 호출은 없다. 원본 미디어 삭제 시점은 기존 처리 완료 후 정리 흐름을 유지한다.

## 저장 계약

완료된 결과만 기존 `factchecks` 행에 저장한다. 새 테이블·권한·마이그레이션은 없다. 현재 결과의 `reason` JSON 봉투에 `contentIndex`를 함께 저장한다. 행의 RLS·보유 기간·회원 탈퇴 시 삭제도 그대로 적용된다.

```js
// recipe/contest/exhibit는 기존 봉투 유지. 뉴스도 새 색인이 있으면 JSON 봉투가 된다.
{ recipe, sourceUrl, contentIndex }
{ contest, sourceUrl, contentIndex }
{ exhibit, sourceUrl, contentIndex }
{ reason: '판단 이유', sourceUrl, contentIndex }
```

`contentIndex`: `version:1`, `category`, `title`, `description`, `tags:[{label,evidence}]`, `entities`, `attributes:[{name,value,evidence}]`, `coverage:{scope,notes}`, `searchText`, `origin`.

- `description`: 실제 확인한 화면·음성·본문 설명. 뉴스의 주장을 사실로 확정하지 않는다.
- 태그·속성은 근거가 있어야 한다. 시간·가격 등 미확인 값은 저장하지 않는다.
- 검색 텍스트는 위 필드에서 서버가 합성한다. 원본 DM·비밀번호·계정 프로필을 색인에 추가하지 않는다.
- 키가 연결되면 텍스트만 OpenAI `text-embedding-3-small`, 256차원으로 임베딩해 `embedding:{model,textHash,vector}`를 함께 저장한다. 텍스트 최대 3,000자를 사용한다. 임베딩 실패로 원래 결과 저장·DM 전송을 중단하지 않는다.
- 기존 행은 저장된 결과에서 기본 설명·개체를 구성한다. 원본 재다운로드·AI 재분석·자동 대량 임베딩 보충은 하지 않는다. 풍부한 태그와 벡터는 새 처리 결과부터 쌓인다.
- shortcut: 결과 봉투에 색인을 함께 저장한다. 공용 콘텐츠 테이블을 도입할 때 JSONB·검색/벡터 인덱스로 이전할 것. 원본 파일·사용자 연결과의 삭제 관계를 유지해야 한다.

## 검색 API

`POST /api/content-search`, 동일 출처 + `Authorization: Bearer <사용자 JWT>` 필수.

```json
{"action":"search","query":"전에 보낸 소고기 국물 요리"}
```

`action:"interests"`는 검색어 없이 관심 패턴과 다시 볼 후보를 반환한다.

- Auth 서버에서 사용자를 확인하고 그 JWT로 DB를 읽는다. 요청 본문의 사용자 ID·IGSID는 사용하지 않는다. 서버 비밀키로 사용자 검색을 우회하지 않는다.
- 대시보드와 동일하게 최근 완료 결과 200개 안에서 검색한다. 숨긴 행은 색인 집계·OpenAI 전송 전에 제외한다.
- 키워드와 저장된 벡터의 코사인 유사도로 최대 24개 후보를 고른다. 벡터가 있을 때 검색어 임베딩 1회, 이후 Decisions 요청 1회다.
- `POST https://api.openai.com/v1/decisions`, `gpt-6-luna`, 후보별 독립 `score` 질문을 한 요청에 넣는다. 수준은 0=관련 근거 부족, 1=부분 관련, 2=직접 관련. 유효한 응답의 1 이상 점수를 결과에 포함한다. 이 기준은 제품 평가에 따라 조정해야 하며 정확도 보증이 아니다.
- 거절·누락·잘못된 응답과 장애에서는 해당 후보의 키워드/벡터 근거로 돌아간다. 임의의 응답 ID는 무시한다. 검색 결과에 실제 소유 후보 외의 항목을 추가할 수 없다.
- 응답: `{ids, interests, rankedBy, degraded, query, scope:"latest_200"}`. 점수는 UI에서 선호 확률로 표시하지 않는다.
- 사용자가 '의미로 찾기' 또는 Enter를 누를 때만 요청한다. 입력 중에는 색인 텍스트로 검색한다. 동일 사용자·검색어·현재 소유 결과·숨김 상태의 요청을 프로세스 메모리에서 60초 재사용한다. 변경된 결과/숨김은 캐시를 무효화한다.

## 관심 추정

- 별도 취향 설문·생활 조건 입력은 없다. 기존 브라우저의 직접 모으기 표시는 그대로 독립적으로 남아 있다.
- 레시피·전시에서 서로 다른 원본 2개 이상에 반복된 근거 있는 태그를 집계한다. 같은 원본을 반복 공유해도 표본을 늘리지 않는다.
- 뉴스·공모전·처리 실패 결과는 취향 추정에서 제외한다. 개인의 성격·민감한 특성·선호 확률을 생성하지 않는다.
- `shared_interest`는 약한 관심 신호다. '관심 추정'과 근거 콘텐츠를 함께 보여준다. Decisions에는 같은 유형의 패턴과 후보만 평가하도록 지시한다.
- 관심 패턴은 별도 프로필 테이블에 영구 저장하지 않고 현재 소유 결과에서 요청 시 계산한다. 숨김·연결 변경·삭제는 다음 계산에 반영된다.
- 후보의 점수 판단과 설명 생성은 분리돼 있다. 카드 문구는 실제 반복 태그·건수로 구성하고, 원본 콘텐츠로 연결한다.

## 키·검증

- 서버 환경변수 `OPENAI_API_KEY`만 필요하다. 키는 브라우저 번들·Git·로그에 넣지 않는다.
- 로컬 입력 도구: `node scripts/configure-openai.mjs`. 표시된 로컬 URL에서 입력하면 `.local/openai-credentials.dpapi`에 Windows 사용자별 암호화 저장한다. 운영에는 Vercel Production Sensitive 변수로 설정한다.
- `node --test content-index.test.mjs`는 같은 분석 호출 내 색인 생성, 저장/표시 호환, 중복 원본·뉴스 제외, RLS JWT 전달, 숨김 제외, 캐시, 장애 폴백, Decisions 스키마·거절 응답을 네트워크 없이 확인한다.
- 2026-11-01: 실제 OpenAI 샘플 Decisions 1회·임베딩 1회 성공. 실제 신규 Instagram DM→운영 색인 저장은 이 변경에서 추가 재생하지 않았다.

공식 문서: [Decisions](https://developers.openai.com/api/docs/guides/decisions), [Embeddings](https://developers.openai.com/api/docs/guides/embeddings).

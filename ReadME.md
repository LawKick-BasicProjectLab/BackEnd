# Law-Kick Backend

생활법률 교육 게임 **Law-Kick**의 백엔드 레포입니다.
학습 기록 저장과, LLM(Gemini)을 이용한 **맞춤형 복습 문제 생성**을 담당합니다.

> 관련 레포
> - 프론트엔드: `lawkick-frontend`
> - 공유 문서(API 명세·회의록·아키텍처): `lawkick-docs` ← **엔드포인트를 바꾸기 전에 명세를 먼저 수정하세요.**

---

## 1. 기술 스택

| 구분 | 내용 |
|---|---|
| 런타임 | Node.js 18+ (내장 `fetch` 사용) |
| 구조 | 서버리스 함수 (Vercel 스타일 `api/` 디렉터리, `export default handler(req, res)`) |
| LLM | FactChat 게이트웨이(`factchat-cloud.mindlogic.ai`) 경유 Gemini (`generateContent`) |
| DB | 미연동 (Supabase / Firebase 등 후보, 아래 로드맵 참고) |

> `export default` 문법을 쓰므로 `package.json`에 `"type": "module"`이 필요합니다.

## 2. 폴더 구조

```
.
├── api/
│   └── quiz/
│       ├── submit.js     # POST  학습 결과(정오답) 저장
│       └── custom.js     # GET/POST  LLM 맞춤형 문제 생성
├── package.json
├── .env.example          # 환경변수 예시 (실제 값은 커밋 금지)
└── README.md
```

## 3. 실행 방법

```bash
npm install
cp .env.example .env.local     # 값 채우기
npx vercel dev                 # http://localhost:3000/api/quiz/...
```

## 4. 환경변수

| 이름 | 설명 |
|---|---|
| `FACTCHAT_API_KEY` | FactChat 게이트웨이 API 키 |
| `FACTCHAT_BASE_URL` | (선택) 기본값 `https://factchat-cloud.mindlogic.ai` |
| `LLM_MODEL` | (선택) 사용할 모델명 |

`.env.example` 예시:

```
FACTCHAT_API_KEY=
FACTCHAT_BASE_URL=https://factchat-cloud.mindlogic.ai
LLM_MODEL=
```

배포 환경(Vercel)에서는 프로젝트 Settings → Environment Variables에 등록합니다. `.env*` 파일은 `.gitignore`에 포함해야 합니다.

## 5. API 요약

> 요청/응답 JSON의 **공식 규격은 `lawkick-docs`의 API 명세**입니다. 여기에는 현재 구현 기준 요약만 둡니다.

공통 에러 응답: `{ "success": false, "error": "메시지" }`

### `POST /api/quiz/submit` — 학습 결과 저장

요청
```json
{
  "user_id": "user@example.com",
  "stage_id": "j1-1",
  "category": "전세 계약",
  "is_correct": true,
  "tries_count": 2
}
```

성공 응답 `200`
```json
{
  "success": true,
  "message": "정오답 데이터가 안전하게 저장되었습니다.",
  "data": {
    "user_id": "user@example.com",
    "stage_id": "j1-1",
    "is_correct": true,
    "recorded_at": "2026-11-02T00:00:00.000Z"
  }
}
```

| 상태 | 상황 |
|---|---|
| 400 | `user_id` 또는 `stage_id` 누락 |
| 405 | POST 이외의 메서드 |
| 500 | 서버 내부 오류 |

> 현재는 로그만 남기고 **DB에 저장하지 않습니다.** (7장 TODO 참고)

### `GET|POST /api/quiz/custom` — 맞춤형 문제 생성

요청 (POST body 또는 GET query)
```json
{ "user_id": "user@example.com", "weak_category": "전세 계약" }
```
`weak_category` 기본값은 `"전세 계약"`입니다.

성공 응답 `200`
```json
{
  "success": true,
  "quiz": {
    "id": "custom-1762041600000",
    "title": "전세 계약 맞춤형 복습 퀴즈",
    "q": "문제 지문",
    "opts": [
      ["정답 보기", 1, ""],
      ["오답 보기 1", 0, "오답 해설"],
      ["오답 보기 2", 0, "오답 해설"],
      ["오답 보기 3", 0, "오답 해설"]
    ],
    "explain": "정답 해설",
    "laws": [["법령 이름", "조항 내용"]]
  }
}
```

| 상태 | 상황 |
|---|---|
| 405 | GET/POST 이외의 메서드 |
| 500 | LLM 호출 실패 또는 응답 JSON 파싱 실패 |

동작 방식: 프롬프트로 순수 JSON만 출력하도록 지시 → 응답에서 마크다운 코드블록 제거 → `JSON.parse` → 반환.

## 6. 🚨 보안 체크리스트 (우선 처리)

1. **API 키가 코드에 하드코딩되어 있습니다** (`api/quiz/custom.js`). 이미 Git 히스토리/대화에 노출된 것으로 간주하고
   - 발급처에서 **키를 즉시 폐기(재발급)** 하세요.
   - 코드는 `process.env.FACTCHAT_API_KEY`를 읽도록 수정하세요.
   - 레포가 한 번이라도 푸시됐다면 히스토리에서도 제거(`git filter-repo` 등)하거나, 키를 폐기했으니 안전하다는 점을 확인하세요.
2. `weak_category`가 프롬프트에 그대로 들어갑니다(프롬프트 인젝션 가능). 허용 카테고리 화이트리스트(예: 전세 계약 / 알바·근로 계약 / 중고거래)로 검증하세요.
3. 인증이 없어 누구나 API를 호출할 수 있습니다. 요청 횟수 제한(rate limit)과 토큰 검증이 필요합니다.
4. `user_id`로 이메일을 사용 중입니다. DB 도입 시 이메일 대신 내부 사용자 ID(UUID)를 쓰고, 로그에 이메일을 남기지 마세요.
5. CORS 정책을 명시하세요(프론트 도메인만 허용).

## 7. 알려진 문제 / TODO

- [ ] `custom.js`: `llmData.candidates[0]` 접근 전에 응답 유효성 검사 (LLM 오류·안전 필터 차단 시 현재 500)
- [ ] `custom.js`: LLM HTTP 상태 코드(`llmResponse.ok`) 확인 및 타임아웃 설정
- [ ] `custom.js`: 생성된 퀴즈 스키마 검증 (보기 4개, 정답 1개, 필수 필드) 후 실패 시 재시도
- [ ] `custom.js`: 모델명을 환경변수로 분리하고 실제 사용 가능한 모델명인지 확인
- [ ] `submit.js`: DB 연동 (`QuizLogs` INSERT, `UserStates` 갱신)
- [ ] `submit.js`: `is_correct`, `tries_count` 타입 검증
- [ ] 입력 검증 라이브러리 도입 (예: zod)
- [ ] 취약 카테고리 산출 API (오답 이력 기반) — 프론트가 현재 카테고리를 고정값으로 전달 중
- [ ] AI 진행자 질문 / AI 피드백 / 랭킹 / 인증 API (현재 프론트가 플랫폼 주입 객체나 localStorage에 의존, 명세는 `lawkick-docs`에서 합의)

## 8. 협업 규칙

- **API 명세 변경 = 문서 PR 먼저.** `lawkick-docs`에서 프론트 팀 리뷰를 받은 뒤 구현합니다.
- 응답 형식은 항상 `{ success, ... }` 형태를 유지합니다. 호환이 깨지는 변경은 버전(`/api/v2/...`)을 올립니다.
- 브랜치: `main`(배포) ← `dev` ← `feature/기능명`
- 커밋 메시지: `feat:` / `fix:` / `refactor:` / `docs:` / `chore:` 접두사 사용
- 시크릿(API 키, DB 비밀번호)은 절대 커밋하지 않습니다. PR 전에 `git diff`로 확인하세요.

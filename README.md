# Law-Kick Backend

생활법률 교육 게임 **Law-Kick**의 백엔드 레포입니다.
**학습 기록 저장 · 랭킹 · 마이페이지**와, LLM(Gemini)을 이용한 **맞춤형 복습 문제 생성**을 담당합니다.

> 관련 레포
> - 프론트엔드: [`FrontEnd`](https://github.com/LawKick-BasicProjectLab/FrontEnd)
> - 공유 문서(API 명세·회의록·아키텍처): [`Docs`](https://github.com/LawKick-BasicProjectLab/Docs) ← **엔드포인트를 바꾸기 전에 명세를 먼저 수정하세요.**

| 담당 | 범위 |
|---|---|
| 백엔드 A | DB, 학습 기록 저장, 랭킹·마이페이지 API, 학습 이력 조회 함수 |
| 백엔드 B | LLM 연동, 맞춤형 문제 생성 |

---

## 1. 기술 스택

| 구분 | 내용 |
|---|---|
| 런타임 | Node.js 18+ |
| 구조 | Vercel 서버리스 함수 (`api/` 폴더의 파일 = API 주소) |
| DB | Supabase (PostgreSQL) |
| LLM | FactChat 게이트웨이 경유 Gemini |
| 테스트 | Node 내장 테스트 러너 (`npm test`) |

## 2. 폴더 구조

```
.
├── api/                      # 파일 하나 = API 하나
│   ├── quiz/
│   │   ├── submit.js         # POST /api/quiz/submit   학습 결과 저장 (A)
│   │   └── custom.js         # GET|POST /api/quiz/custom  맞춤형 문제 생성 (B)
│   ├── ranking.js            # GET  /api/ranking       랭킹 (A)
│   └── user/
│       └── me.js             # GET  /api/user/me       마이페이지 (A)
├── lib/                      # API들이 같이 쓰는 코드
│   ├── supabase.js           # DB 연결
│   ├── store.js              # DB 읽기/쓰기 함수 모음
│   ├── game.js               # 게임 규칙 (경험치·등급·카테고리)
│   ├── learning.js           # 취약 카테고리·최근 오답 조회 (B가 사용)
│   └── http.js               # 공통 응답 형식
├── supabase/
│   ├── schema.sql            # DB 테이블 생성 SQL
│   └── reset_v1.sql          # (일회성) v1 테이블 정리용
├── tests/                    # 자동 테스트
├── .env.example              # 환경변수 예시 (실제 값은 커밋 금지)
└── package.json
```

## 3. 처음 실행하기

### 3.1 DB 준비 (팀에서 한 번만)
Supabase → **SQL Editor** 에 `supabase/schema.sql` 내용을 붙여넣고 **Run**. 여러 번 실행해도 안전합니다.

### 3.2 내 컴퓨터에서 실행

```bash
npm install
copy .env.example .env.local      # Mac/Linux: cp .env.example .env.local
# .env.local 에 값 채우기 (4장 참고)
copy .env.local .env              # vercel dev 가 .env 를 읽기 때문
npm test                          # 자동 테스트 (DB 없이 동작)
npx vercel@latest dev             # http://localhost:3000
```

> - `npx vercel@latest login` 이 처음 한 번 필요합니다 (GitHub 로그인).
> - 예전 CLI(39)는 로그인 방식이 바뀌어 동작하지 않으니 `@latest` 를 붙여 주세요.

### 3.3 동작 확인 (Windows PowerShell)

```powershell
curl.exe http://localhost:3000/api/ranking
curl.exe -X POST http://localhost:3000/api/quiz/submit -H "Content-Type: application/json" -d '{\"user_id\":\"test@test.com\",\"stage_id\":\"j1-1\",\"is_correct\":true,\"tries_count\":1}'
```

> PowerShell 의 `Invoke-RestMethod` 는 `expect header not supported` 에러가 나므로 `curl.exe` 를 사용하세요.

### 3.4 배포 (Vercel)

1. Vercel 프로젝트 **Settings → Environments → Production → Environment Variables** 에 4장의 값을 등록
2. `npx vercel@latest --prod`

`.vercelignore` 가 `.env` 파일이 업로드되지 않도록 막습니다.

## 4. 환경변수

| 이름 | 필수 | 설명 |
|---|---|---|
| `SUPABASE_URL` | ✅ | `https://<프로젝트ID>.supabase.co` (뒤에 `/rest/v1` 붙이지 않기) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Supabase → Project Settings → API Keys 의 **secret** 키. 관리자 권한이라 절대 공유·커밋 금지 |
| `FACTCHAT_API_KEY` | ✅ | FactChat 게이트웨이 API 키 (맞춤 문제 생성) |
| `FACTCHAT_BASE_URL` | | 기본 `https://factchat-cloud.mindlogic.ai` |
| `LLM_MODEL` | | 사용할 모델명 |
| `CUSTOM_UNLOCK_THRESHOLD` | | 맞춤 문제 해금 풀이 수. 기본 10 |

`.env*` 파일은 `.gitignore` 에 포함되어 있습니다 (`.env.example` 만 예외).

## 5. API 요약

> 요청/응답의 **공식 규격은 Docs 레포의 API 명세**입니다. 여기는 요약만 둡니다.

공통 형식 — 성공 `{ "success": true, "message"?, "data" }` / 실패 `{ "success": false, "error": "메시지" }`

| 메서드 · 주소 | 하는 일 | 담당 |
|---|---|---|
| `POST /api/quiz/submit` | 풀이 결과 저장, 서버에서 경험치·등급 계산, 10회 풀면 맞춤 문제 해금 | A |
| `GET /api/ranking?limit=50` | 랭킹 공개 동의자의 경험치 순위 (이메일 미노출) | A |
| `GET /api/user/me?user_id=` | 레벨·경험치·며칠차·클리어 기록·최근 풀이 | A |
| `GET\|POST /api/quiz/custom` | LLM 맞춤형 복습 문제 생성 | B |

### `POST /api/quiz/submit` 요청 예

```json
{
  "user_id": "user@example.com",
  "stage_id": "j1-1",
  "category": "jeonse",
  "is_correct": true,
  "tries_count": 1,
  "selected_option": 0,
  "clues_found": 2,
  "questions_left": 6,
  "nickname": "법린이",
  "rank_public": true
}
```

필수는 `user_id`, `stage_id`, `is_correct`. 나머지는 선택이며, `clues_found`·`questions_left` 가 있어야 경험치가 화면과 똑같이 계산됩니다. `user_id: "guest"` 는 저장하지 않습니다.

### 학습 이력 조회 함수 (`lib/learning.js`, B 용)

```js
import { getWeakCategory, getRecentWrongAnswers } from '../../lib/learning.js';

await getWeakCategory('user@example.com');
// → { category: 'work', label: '근로 계약', wrong_rate: 0.6, attempts: 5 }  (오답 없으면 null)

await getRecentWrongAnswers('user@example.com', 5);
// → [{ stage_id, category, selected_option, tries_count, created_at }, ...]
```

## 6. DB 구조

| 테이블 | 내용 |
|---|---|
| `profiles` | 사용자 (`external_id` = 프론트의 user_id, 닉네임, 랭킹 공개 여부) |
| `user_progress` | 경험치, 코인, 총 풀이 수, 맞춤 문제 해금 여부 |
| `stage_clears` | 스테이지별 클리어 등급 |
| `quiz_logs` | 모든 풀이 이력 (오답 분석용) |
| `visits` | 학습한 날짜 ("며칠차") |
| `ranking` (뷰) | 랭킹 집계 |
| `user_category_stats` (뷰) | 코스별 오답률 |

모든 테이블은 RLS 가 켜져 있고 정책이 없어서, 브라우저에서는 접근할 수 없고 서버(secret 키)로만 읽고 씁니다.

## 7. 🚨 보안 체크리스트

1. **`api/quiz/custom.js` 에 API 키가 하드코딩되어 있습니다.** 레포가 public 이므로 키를 재발급하고 `process.env.FACTCHAT_API_KEY` 로 읽도록 수정해야 합니다.
2. `user_id` 로 이메일을 쓰고 있고 서버 인증이 없어, `user_id` 만 알면 마이페이지 조회가 가능합니다. 서버 로그인 도입 시 토큰 기반으로 바꿉니다.
3. `custom.js` 의 `weak_category` 는 프롬프트에 그대로 들어가므로 허용 값 검증이 필요합니다.
4. 요청 횟수 제한(rate limit)이 없습니다.

## 8. TODO

- [x] DB 연동 (Supabase), 학습 기록 저장
- [x] 서버 측 경험치·등급 계산
- [x] 랭킹 · 마이페이지 API
- [x] 취약 카테고리 산출 함수
- [ ] `custom.js` API 키 환경변수 이전 + 취약 카테고리 연동 (B)
- [ ] 프론트 `submitQuizResult` 에 `clues_found`, `questions_left`, `nickname` 전달 (프론트)
- [ ] 서버 로그인 (Supabase Auth) — `profiles.auth_user_id` 자리 마련됨
- [ ] 코인 서버 관리 (현재 프론트가 계산)
- [ ] AI 진행자 질문 / AI 피드백 API

## 9. 협업 규칙

- **API 명세 변경 = Docs PR 먼저.** 프론트 팀 리뷰 후 구현합니다.
- 응답은 항상 `{ success, ... }` 형식. 호환이 깨지는 변경은 `/api/v2/...` 로 올립니다.
- 브랜치: `main` ← `feature/기능명`. 쓰기 권한이 없으면 포크 후 PR.
- 커밋 메시지: `feat:` / `fix:` / `refactor:` / `docs:` / `chore:`
- 시크릿(API 키, DB 키)은 절대 커밋하지 않습니다. PR 전에 `git status` 로 `.env` 가 없는지 확인하세요.

// api/quiz/custom.js
// GET|POST /api/quiz/custom — LLM 맞춤형 문제 생성

import { getChapterWeakTopics, getWeakCategory } from '../../lib/learning.js';
import { isChapterId, CHAPTER_TITLES, CATEGORY_LABELS, categoryOfChapter, topicsOfChapter } from '../../lib/game.js';
import { store as defaultStore } from '../../lib/store.js';

export function createCustomHandler(store = defaultStore) {
  return async function handler(req, res) {
    if (req.method !== 'POST' && req.method !== 'GET') {
      res.setHeader('Allow', ['POST', 'GET']);
      return res.status(405).json({ success: false, error: `Method ${req.method} Not Allowed` });
    }

    try {
      const body = (req.method === 'POST' ? req.body : req.query) || {};
      const { user_id, chapter_id } = body;

      if (!user_id) {
        return res.status(400).json({ success: false, error: 'user_id 파라미터가 필요합니다.' });
      }
      const chapterMode = chapter_id !== undefined && chapter_id !== null && chapter_id !== '';
      if (chapterMode && !isChapterId(chapter_id)) {
        return res.status(400).json({ success: false, error: 'chapter_id 가 올바르지 않습니다.' });
      }

      // =========================================================================
      // 🛡️ 해금 검증: 해당 챕터의 1~3단계를 모두 클리어해야 맞춤 문제를 받을 수 있다
      // =========================================================================
      if (user_id !== 'guest') {
        const profile = await store.findProfile(user_id);
        // stage_clears 는 profiles.id(UUID) 기준으로 저장되므로 profile.id 로 조회한다
        const clears = profile ? await store.listClears(profile.id) : [];
        const clearedStages = new Set(clears.map(c => c.stage_id));

        console.log(`[해금 체크] user: ${user_id}, chapter: ${chapter_id}, 누적 clears 수:`, clearedStages.size);

        if (chapterMode) {
          const chapterStages = [`${chapter_id}-1`, `${chapter_id}-2`, `${chapter_id}-3`];
          const allStagesCleared = chapterStages.every(sid => clearedStages.has(sid));

          if (!allStagesCleared) {
            console.warn(`[해금 거부] 챕터 ${chapter_id} 1~3단계 미완료. (현재 clears:`, Array.from(clearedStages), `)`);
            return res.status(403).json({
              success: false,
              error: '맞춤형 복습 퀴즈가 아직 해금되지 않았습니다. 해당 챕터의 1, 2, 3단계를 모두 클리어해 주세요!'
            });
          }
        }
      }

      // 1. 학습 이력 조회 → 무엇을 복습시킬지(focus) 결정
      let focusText, quizTitle, meta;

      if (chapterMode) {
        const weak = await getChapterWeakTopics(user_id, chapter_id, store);
        console.log('🔍 [디버그] 챕터 취약 주제:', weak);

        if (weak && weak.topics.length > 0) {
          const list = weak.topics.map((t, i) => `${i + 1}. ${t.topic} (이 주제에서 ${t.wrong}번 틀림)`).join('\n');
          focusText = `
사용자가 "${weak.chapter_title}" 챕터에서 아래 주제를 특히 어려워해. 이 주제를 다시 연습할 수 있는 실생활 법률 퀴즈 1문제를 새로 만들어줘.

[어려워한 주제 — 위쪽이 우선순위]
${list}

출제 규칙:
- 1번 주제의 핵심 개념을 정확히 이해했는지 묻는 문제로 만들어. 2번 주제가 있으면 오답 보기나 해설에서 자연스럽게 연결해도 좋아.
- 교재에 나올 법한 뻔한 사례 대신 새로운 상황으로 만들어.
- 법령 이름과 조항은 실제로 존재하고 확실한 것만 laws에 넣어.`;
          quizTitle = `${weak.topics[0].topic} 맞춤 복습`;
          meta = {
            mode: 'weak',
            chapter_id: weak.chapter_id,
            weak_topics: weak.topics.map(t => t.topic),
            weak_category: weak.category,
            weak_label: weak.label,
            wrong_rate: weak.wrong_rate
          };
        } else {
          const all = topicsOfChapter(chapter_id);
          const pick = all[Math.floor(Math.random() * all.length)];
          const others = all.filter(t => t !== pick).map(t => t.topic).join(', ');
          const category = categoryOfChapter(chapter_id);
          focusText = `
사용자가 "${CHAPTER_TITLES[chapter_id]}" 챕터의 문제를 틀리지 않고 풀었어. 배운 내용을 응용해 볼 수 있는 심화 복습 퀴즈 1문제를 새로 만들어줘.

[이번에 다룰 주제] ${pick.topic}
[같은 챕터의 다른 주제] ${others}

출제 규칙:
- 이번 주제의 핵심 개념을 새로운 상황에 적용해야 풀 수 있는 문제로 만들어. 단순 암기 문제는 피해.
- 보기는 그럴듯하지만 흔히 하는 오해를 담은 오답으로 구성해.
- 법령 이름과 조항은 실제로 존재하고 확실한 것만 laws에 넣어.`;
          quizTitle = `${pick.topic} 심화 복습`;
          meta = {
            mode: 'review',
            chapter_id,
            weak_topics: [pick.topic],
            weak_category: category,
            weak_label: CATEGORY_LABELS[category],
            wrong_rate: 0
          };
        }
      } else {
        const weakData = await getWeakCategory(user_id, store);
        const categoryLabel = weakData?.label || '전세 계약';
        const categoryKey = weakData?.category || 'jeonse';
        const sanitizedLabel = String(categoryLabel).replace(/[\r\n"'`]/g, '');

        focusText = `사용자가 취약한 주제인 "${sanitizedLabel}"(카테고리 코드: ${categoryKey})과 관련된 실생활 법률 퀴즈 1문제를 새로 만들어줘.`;
        quizTitle = `${sanitizedLabel} 맞춤형 복습 퀴즈`;
        meta = { weak_category: categoryKey, weak_label: sanitizedLabel, wrong_rate: weakData?.wrong_rate || 0 };
      }

      // 2. 환경변수 및 모델명 설정
      const apiKey = process.env.FACTCHAT_API_KEY || process.env.BAZE_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ success: false, error: '서버 설정 오류: API 키가 설정되지 않았습니다.' });
      }

      const modelName = process.env.LLM_MODEL || 'gemini-3.5-flash';
      const baseURL = 'https://factchat-cloud.mindlogic.ai';
      const endpoint = `/v1/gateway/gemini/v1beta/models/${modelName}:generateContent`;
      const fullUrl = `${baseURL}${endpoint}`;

      const promptText = `
너는 생활법률 교육 게임 'Law-Kick'의 문제 출제 AI야.
${focusText}

반드시 아래의 JSON 형식 외에 다른 어떤 텍스트도 포함하지 말고, 순수 JSON 문자열만 출력해줘.

{
  "id": "custom-${Date.now()}",
  "title": "${quizTitle}",
  "q": "문제 지문 내용",
  "opts": [
    ["정답 보기 텍스트", 1, ""],
    ["오답 보기 텍스트 1", 0, "오답 해설"],
    ["오답 보기 텍스트 2", 0, "오답 해설"],
    ["오답 보기 텍스트 3", 0, "오답 해설"]
  ],
  "explain": "상세한 정답 및 개념 해설",
  "laws": [["관련 법령 이름", "법령 조항 내용"]]
}
`;

      // 3. 타임아웃 및 재시도 로직
      const MAX_RETRIES = 1;
      let attempt = 0;
      let quizData = null;
      let timeoutId = null;

      while (attempt <= MAX_RETRIES && !quizData) {
        attempt++;
        const controller = new AbortController();
        timeoutId = setTimeout(() => controller.abort(), 60000);

        try {
          const llmResponse = await fetch(fullUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
              contents: [{
                parts: [{ text: promptText }]
              }]
            }),
            signal: controller.signal
          });
          clearTimeout(timeoutId);

          if (!llmResponse.ok) {
            throw new Error(`LLM 게이트웨이 오류: ${llmResponse.status} ${llmResponse.statusText}`);
          }

          const llmData = await llmResponse.json();

          if (!llmData.candidates || llmData.candidates.length === 0 || !llmData.candidates[0].content) {
            throw new Error('LLM 응답이 안전 필터에 의해 차단되었거나 내용이 비어 있습니다.');
          }

          const generatedText = llmData.candidates[0].content.parts[0].text;
          const cleanJson = generatedText.replace(/```json/g, '').replace(/```/g, '').trim();
          const parsed = JSON.parse(cleanJson);

          if (
            !parsed.id ||
            !parsed.q ||
            !Array.isArray(parsed.opts) ||
            parsed.opts.length !== 4 ||
            !parsed.explain
          ) {
            throw new Error('생성된 퀴즈의 JSON 스키마가 올바르지 않습니다.');
          }
          // 보기는 [텍스트, 정답여부(1/0), 오답해설] 형식이고, 정답은 정확히 1개여야 한다
          const validOpts = parsed.opts.every(o =>
            Array.isArray(o) && typeof o[0] === 'string' && o[0].trim() !== '' && (o[1] === 0 || o[1] === 1));
          if (!validOpts) {
            throw new Error('생성된 퀴즈의 보기 형식이 올바르지 않습니다.');
          }
          const correctCount = parsed.opts.filter(o => o[1] === 1).length;
          if (correctCount !== 1) {
            throw new Error(`생성된 퀴즈의 정답 개수가 ${correctCount}개입니다 (1개여야 함).`);
          }
          // 같은 보기가 두 번 나오면 풀 수 없으므로 거른다
          if (new Set(parsed.opts.map(o => o[0].trim())).size !== parsed.opts.length) {
            throw new Error('생성된 퀴즈에 중복된 보기가 있습니다.');
          }

          quizData = parsed;
        } catch (err) {
          if (timeoutId) clearTimeout(timeoutId);
          console.warn(`[시도 ${attempt}/${MAX_RETRIES + 1}] 맞춤 퀴즈 생성 실패:`, err.message);
          if (attempt > MAX_RETRIES) {
            throw err;
          }
        }
      }

      return res.status(200).json({ success: true, quiz: quizData, meta });

    } catch (error) {
      console.error('맞춤형 문제 생성 최종 에러:', error);
      return res.status(500).json({
        success: false,
        error: '맞춤형 문제를 생성하는 중 서버 오류가 발생했습니다.',
        details: error.message
      });
    }
  };
}

export default createCustomHandler();

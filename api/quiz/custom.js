// api/quiz/custom.js
import { getWeakCategory, getRecentWrongAnswers } from '../../lib/learning.js';

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', ['POST', 'GET']);
    return res.status(405).json({ success: false, error: `Method ${req.method} Not Allowed` });
  }

  try {
    const body = req.method === 'POST' ? req.body : req.query;
    const { user_id } = body;

    if (!user_id) {
      return res.status(400).json({ success: false, error: 'user_id 파라미터가 필요합니다.' });
    }

    // 1. 학습 이력 및 취약 카테고리 조회
    const weakData = await getWeakCategory(user_id);
    console.log('🔍 [디버그] 조회된 weakData:', weakData);
    
    // 예시: 학습 기록이 없거나 시도 횟수가 너무 적으면(예: 3회 미만) 맞춤 문제 미해금 처리
    const isUnlocked = weakData !== null && weakData.attempts >= 3; 
    
    if (!isUnlocked) {
      return res.status(403).json({ 
        success: false, 
        error: '맞춤형 복습 퀴즈가 아직 해금되지 않았습니다. (더 많은 학습과 문제 풀이가 필요해요!)',
        weakData: weakData 
      });
    }

    const categoryLabel = weakData.label || '전세 계약';
    const categoryKey = weakData.category || 'jeonse';

    // 2. 프롬프트 인젝션 방어 (특수문자 및 따옴표 정제)
    const sanitizedLabel = String(categoryLabel).replace(/[\r\n"'`]/g, '');

    // 3. 환경변수 및 모델명 설정
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
사용자가 취약한 주제인 "${sanitizedLabel}"(카테고리 코드: ${categoryKey})과 관련된 실생활 법률 퀴즈 1문제를 새로 만들어줘.

반드시 아래의 JSON 형식 외에 다른 어떤 텍스트도 포함하지 말고, 순수 JSON 문자열만 출력해줘.

{
  "id": "custom-${Date.now()}",
  "title": "${sanitizedLabel} 맞춤형 복습 퀴즈",
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

    // 4. 타임아웃 및 재시도 로직 구현 (타임아웃 60초로 연장)
    const MAX_RETRIES = 1;
    let attempt = 0;
    let quizData = null;
    let timeoutId = null;

    while (attempt <= MAX_RETRIES && !quizData) {
      attempt++;
      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), 60000); // 60초 타임아웃

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

        // 5. LLM 응답 상태 코드 확인
        if (!llmResponse.ok) {
          throw new Error(`LLM 게이트웨이 오류: ${llmResponse.status} ${llmResponse.statusText}`);
        }

        const llmData = await llmResponse.json();

        // 6. 안전 필터 등으로 인한 candidates 누락 방어
        if (!llmData.candidates || llmData.candidates.length === 0 || !llmData.candidates[0].content) {
          throw new Error('LLM 응답이 안전 필터에 의해 차단되었거나 내용이 비어 있습니다.');
        }

        const generatedText = llmData.candidates[0].content.parts[0].text;
        const cleanJson = generatedText.replace(/```json/g, '').replace(/```/g, '').trim();
        
        const parsed = JSON.parse(cleanJson);

        // 7. 스키마 검증 (필수 필드 및 보기 개수 확인)
        if (
          !parsed.id || 
          !parsed.q || 
          !Array.isArray(parsed.opts) || 
          parsed.opts.length !== 4 || 
          !parsed.explain
        ) {
          throw new Error('생성된 퀴즈의 JSON 스키마가 올바르지 않습니다.');
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

    return res.status(200).json({
      success: true,
      quiz: quizData,
      meta: {
        weak_category: categoryKey,
        weak_label: categoryLabel,
        wrong_rate: weakData.wrong_rate
      }
    });

  } catch (error) {
    console.error('맞춤형 문제 생성 최종 에러:', error);
    return res.status(500).json({ 
      success: false, 
      error: '맞춤형 문제를 생성하는 중 서버 오류가 발생했습니다.',
      details: error.message 
    });
  }
}

// api/quiz/custom.js

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', ['POST', 'GET']);
    return res.status(405).json({ success: false, error: `Method ${req.method} Not Allowed` });
  }

  try {
    const body = req.method === 'POST' ? req.body : req.query;
    const { user_id, weak_category = '전세 계약' } = body;

    // 직접 입력한 테스트용 API 키 (환경 변수 문제 해결 전까지 사용)
    const apiKey = 'baze_bxzGG11H3SjnohHzQt7AUrNt2x3q9I1V3PfrYa'; 

    const baseURL = 'https://factchat-cloud.mindlogic.ai';
    const endpoint = '/v1/gateway/gemini/v1beta/models/gemini-3.5-flash:generateContent';
    const fullUrl = `${baseURL}${endpoint}`;

    // LLM이 반드시 정해진 JSON 구조로만 답변하도록 엄격한 프롬프트 작성
    const promptText = `
너는 생활법률 교육 게임 'Law-Kick'의 문제 출제 AI야.
"${weak_category}" 주제와 관련된 실생활 법률 퀴즈 1문제를 새로 만들어줘.
반드시 아래의 JSON 형식 외에 다른 어떤 텍스트도 포함하지 말고, 순수 JSON 문자열만 출력해줘.

{
  "id": "custom-${Date.now()}",
  "title": "${weak_category} 맞춤형 복습 퀴즈",
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
      })
    });

    const llmData = await llmResponse.json();
    
    // LLM이 생성한 실제 텍스트 추출
    const generatedText = llmData.candidates[0].content.parts[0].text;
    console.log('LLM이 생성한 원본 텍스트:', generatedText);

    // 마크다운 코드블록(```json ... ```) 제거 및 JSON 파싱
    const cleanJson = generatedText.replace(/```json/g, '').replace(/```/g, '').trim();
    const quizData = JSON.parse(cleanJson);

    return res.status(200).json({
      success: true,
      quiz: quizData
    });

  } catch (error) {
    console.error('맞춤형 문제 생성 및 파싱 에러:', error);
    return res.status(500).json({ 
      success: false, 
      error: '맞춤형 문제를 생성하는 중 서버 오류가 발생했습니다.' 
    });
  }
}
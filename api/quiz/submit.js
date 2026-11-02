// api/quiz/submit.js

export default async function handler(req, res) {
  // 1. POST 요청만 허용
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, error: `Method ${req.method} Not Allowed` });
  }

  try {
    // 2. 프론트엔드에서 전송한 데이터 파싱
    const { user_id, stage_id, category, is_correct, tries_count } = req.body;

    // 3. 필수 데이터 검증
    if (!user_id || !stage_id) {
      return res.status(400).json({ 
        success: false, 
        error: '필수 데이터(user_id 또는 stage_id)가 누락되었습니다.' 
      });
    }

    // [참고] 데이터베이스 연동 영역
    // 추후 Supabase나 Firebase 등 DB를 연결한다면 이 부분에서 
    // QuizLogs 테이블에 데이터를 INSERT하고 UserStates를 업데이트하면 됩니다.
    console.log(`[학습 이력 저장 완료] 사용자: ${user_id}, 단계: ${stage_id}, 정답여부: ${is_correct}`);

    // 4. 성공 응답 반환
    return res.status(200).json({
      success: true,
      message: '정오답 데이터가 안전하게 저장되었습니다.',
      data: {
        user_id,
        stage_id,
        is_correct,
        recorded_at: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('서버 에러 발생:', error);
    return res.status(500).json({ 
      success: false, 
      error: '서버 내부 오류가 발생했습니다.' 
    });
  }
}
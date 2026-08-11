export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
  ADMIN_PASSWORD: string;
  GEMINI_API_KEY: string;
}

// 개인 기록. 공개 API 응답에는 절대 포함하지 않는다(관리자 전용 엔드포인트에서만 반환).
export interface WodRecord {
  id: string;
  session_id: string;
  raw_record: string;
  parsed_record: string | null;
  created_at: string;
  updated_at: string;
}

export interface WodSession {
  id: string;
  date: string;
  class_type: string;
  raw_wod: string;
  parsed_guide: string | null;
  created_at: string;
  updated_at: string;
}

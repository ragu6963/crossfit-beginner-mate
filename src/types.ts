export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
  ADMIN_PASSWORD: string;
  GEMINI_API_KEY: string;
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

-- 개인 와드 기록. 관리자(=서비스 운영자 본인)만 쓰고 보는 데이터이며, 공개 API(/api/wods)에는
-- 절대 포함하지 않는다.
--
-- raw_record(원본)와 parsed_record(LLM 구조화 결과)를 함께 두는 것은 wod_sessions의
-- raw_wod/parsed_guide와 같은 패턴이다. 원본을 항상 손실 없이 남겨두면
--   1) 파싱이 실패하거나 틀려도 기록 자체는 사라지지 않고
--   2) 규칙이나 모델이 좋아졌을 때 언제든 다시 파싱할 수 있다.
-- parsed_record 안에는 parser_version이 들어 있어 "특정 버전으로 파싱된 것만 재파싱"도 가능하다.
--
-- 세션당 기록은 하나다(같은 날 같은 클래스의 와드를 두 번 하지는 않으므로).
CREATE TABLE wod_records (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES wod_sessions(id) ON DELETE CASCADE,
  raw_record TEXT NOT NULL,
  parsed_record TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_wod_records_session ON wod_records (session_id);

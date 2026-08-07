CREATE TABLE wod_sessions (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  class_type TEXT NOT NULL,
  raw_wod TEXT NOT NULL,
  parsed_guide TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_wod_sessions_date_class_type ON wod_sessions (date, class_type);

CREATE TABLE login_attempts (
  ip TEXT PRIMARY KEY,
  fail_count INTEGER NOT NULL DEFAULT 0,
  blocked_until TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

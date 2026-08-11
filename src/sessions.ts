import type { WodRecord, WodSession } from "./types";

export interface SessionInput {
  date: string;
  class_type: string;
  raw_wod: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateSessionInput(input: Partial<SessionInput>): string | null {
  if (!input.date || !DATE_RE.test(input.date)) return "date는 YYYY-MM-DD 형식이어야 합니다.";
  if (!input.class_type || input.class_type.trim() === "") return "class_type은 비어있을 수 없습니다.";
  if (!input.raw_wod || input.raw_wod.trim() === "") return "raw_wod는 비어있을 수 없습니다.";
  return null;
}

export async function listSessionsByDate(db: D1Database, date: string): Promise<WodSession[]> {
  const { results } = await db
    .prepare(
      "SELECT * FROM wod_sessions WHERE date = ? ORDER BY class_type ASC",
    )
    .bind(date)
    .all<WodSession>();
  return results;
}

export async function findDuplicateSession(
  db: D1Database,
  date: string,
  classType: string,
  excludeId?: string,
): Promise<boolean> {
  const row = excludeId
    ? await db
        .prepare("SELECT id FROM wod_sessions WHERE date = ? AND class_type = ? AND id != ?")
        .bind(date, classType, excludeId)
        .first()
    : await db
        .prepare("SELECT id FROM wod_sessions WHERE date = ? AND class_type = ?")
        .bind(date, classType)
        .first();
  return row !== null;
}

export async function createSession(db: D1Database, input: SessionInput): Promise<WodSession> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO wod_sessions (id, date, class_type, raw_wod, parsed_guide, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?)`,
    )
    .bind(id, input.date, input.class_type, input.raw_wod, now, now)
    .run();

  return {
    id,
    date: input.date,
    class_type: input.class_type,
    raw_wod: input.raw_wod,
    parsed_guide: null,
    record_template: null,
    created_at: now,
    updated_at: now,
  };
}

export async function getSessionById(db: D1Database, id: string): Promise<WodSession | null> {
  const row = await db.prepare("SELECT * FROM wod_sessions WHERE id = ?").bind(id).first<WodSession>();
  return row ?? null;
}

export async function updateSession(
  db: D1Database,
  id: string,
  input: SessionInput,
): Promise<WodSession | null> {
  const existing = await getSessionById(db, id);
  if (!existing) return null;

  // 와드 원문이 바뀌면 기존 입력 뼈대는 더 이상 맞지 않으므로 비운다(다음에 열 때 새로 만든다).
  const templateStillValid = existing.raw_wod === input.raw_wod;

  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE wod_sessions
       SET date = ?, class_type = ?, raw_wod = ?, updated_at = ?,
           record_template = CASE WHEN ? THEN record_template ELSE NULL END
       WHERE id = ?`,
    )
    .bind(input.date, input.class_type, input.raw_wod, now, templateStillValid ? 1 : 0, id)
    .run();

  return {
    ...existing,
    ...input,
    record_template: templateStillValid ? existing.record_template : null,
    updated_at: now,
  };
}

export async function updateRecordTemplate(
  db: D1Database,
  id: string,
  template: string,
): Promise<void> {
  await db
    .prepare("UPDATE wod_sessions SET record_template = ? WHERE id = ?")
    .bind(template, id)
    .run();
}

export async function updateParsedGuide(
  db: D1Database,
  id: string,
  parsedGuideJson: string,
): Promise<WodSession | null> {
  const existing = await getSessionById(db, id);
  if (!existing) return null;

  const now = new Date().toISOString();
  await db
    .prepare("UPDATE wod_sessions SET parsed_guide = ?, updated_at = ? WHERE id = ?")
    .bind(parsedGuideJson, now, id)
    .run();

  return { ...existing, parsed_guide: parsedGuideJson, updated_at: now };
}

export async function deleteSession(db: D1Database, id: string): Promise<boolean> {
  const existing = await getSessionById(db, id);
  if (!existing) return false;
  // wod_records에 ON DELETE CASCADE를 걸어두었지만, 외래키 강제 여부에 의존하지 않도록 명시적으로 지운다.
  await db.prepare("DELETE FROM wod_records WHERE session_id = ?").bind(id).run();
  await db.prepare("DELETE FROM wod_sessions WHERE id = ?").bind(id).run();
  return true;
}

// ---------------------------------------------------------------------------
// 개인 기록(wod_records)
// ---------------------------------------------------------------------------

export async function getRecordBySessionId(
  db: D1Database,
  sessionId: string,
): Promise<WodRecord | null> {
  const row = await db
    .prepare("SELECT * FROM wod_records WHERE session_id = ?")
    .bind(sessionId)
    .first<WodRecord>();
  return row ?? null;
}

// 원본을 먼저 확정 저장한다. 이후 LLM 파싱이 실패하더라도 운동 직후 입력한 기록이 사라지지 않게
// 하기 위한 것이며, 원본이 바뀌면 기존 파싱 결과는 더 이상 유효하지 않으므로 NULL로 비운다.
export async function upsertRecord(
  db: D1Database,
  sessionId: string,
  rawRecord: string,
): Promise<WodRecord> {
  const existing = await getRecordBySessionId(db, sessionId);
  const now = new Date().toISOString();

  if (existing) {
    await db
      .prepare("UPDATE wod_records SET raw_record = ?, parsed_record = NULL, updated_at = ? WHERE id = ?")
      .bind(rawRecord, now, existing.id)
      .run();
    return { ...existing, raw_record: rawRecord, parsed_record: null, updated_at: now };
  }

  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO wod_records (id, session_id, raw_record, parsed_record, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?)`,
    )
    .bind(id, sessionId, rawRecord, now, now)
    .run();

  return {
    id,
    session_id: sessionId,
    raw_record: rawRecord,
    parsed_record: null,
    created_at: now,
    updated_at: now,
  };
}

export async function updateParsedRecord(
  db: D1Database,
  sessionId: string,
  parsedRecordJson: string,
): Promise<WodRecord | null> {
  const existing = await getRecordBySessionId(db, sessionId);
  if (!existing) return null;

  const now = new Date().toISOString();
  await db
    .prepare("UPDATE wod_records SET parsed_record = ?, updated_at = ? WHERE id = ?")
    .bind(parsedRecordJson, now, existing.id)
    .run();

  return { ...existing, parsed_record: parsedRecordJson, updated_at: now };
}

export async function deleteRecord(db: D1Database, sessionId: string): Promise<boolean> {
  const existing = await getRecordBySessionId(db, sessionId);
  if (!existing) return false;
  await db.prepare("DELETE FROM wod_records WHERE session_id = ?").bind(sessionId).run();
  return true;
}

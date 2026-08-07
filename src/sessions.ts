import type { WodSession } from "./types";

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

  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE wod_sessions
       SET date = ?, class_type = ?, raw_wod = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(input.date, input.class_type, input.raw_wod, now, id)
    .run();

  return { ...existing, ...input, updated_at: now };
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
  await db.prepare("DELETE FROM wod_sessions WHERE id = ?").bind(id).run();
  return true;
}

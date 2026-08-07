import { sign, verify } from "hono/jwt";
import type { Env } from "./types";

const JWT_ALG = "HS256";
const JWT_TTL_SECONDS = 60 * 60 * 24; // 24시간 (prd.md 인증 정책)
const MAX_FAIL_COUNT = 5;
const BLOCK_DURATION_SECONDS = 15 * 60;

export const ADMIN_SESSION_COOKIE = "admin_session";

export interface AdminJwtPayload {
  role: "admin";
  iat: number;
  exp: number;
  [key: string]: unknown;
}

export async function issueAdminSessionToken(secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: AdminJwtPayload = {
    role: "admin",
    iat: now,
    exp: now + JWT_TTL_SECONDS,
  };
  return sign(payload, secret, JWT_ALG);
}

export async function verifyAdminSessionToken(
  token: string,
  secret: string,
): Promise<AdminJwtPayload | null> {
  try {
    const payload = await verify(token, secret, JWT_ALG);
    if (payload.role !== "admin") return null;
    return payload as unknown as AdminJwtPayload;
  } catch {
    return null;
  }
}

// 타이밍 공격 완화를 위한 상수 시간 비교. 길이가 다르면 더미 비교를 수행해 조기 반환을 피한다.
export function constantTimeEquals(a: string, b: string): boolean {
  const bufA = new TextEncoder().encode(a);
  const bufB = new TextEncoder().encode(b);
  const length = Math.max(bufA.length, bufB.length, 1);
  let diff = bufA.length === bufB.length ? 0 : 1;
  for (let i = 0; i < length; i++) {
    const byteA = bufA[i] ?? 0;
    const byteB = bufB[i] ?? 0;
    diff |= byteA ^ byteB;
  }
  return diff === 0;
}

export function getClientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}

export interface RateLimitStatus {
  blocked: boolean;
  retryAfterSeconds: number;
}

export async function checkRateLimit(db: D1Database, ip: string): Promise<RateLimitStatus> {
  const row = await db
    .prepare("SELECT blocked_until FROM login_attempts WHERE ip = ?")
    .bind(ip)
    .first<{ blocked_until: string | null }>();

  if (!row?.blocked_until) return { blocked: false, retryAfterSeconds: 0 };

  const blockedUntilMs = Date.parse(row.blocked_until);
  const remainingMs = blockedUntilMs - Date.now();
  if (remainingMs <= 0) return { blocked: false, retryAfterSeconds: 0 };

  return { blocked: true, retryAfterSeconds: Math.ceil(remainingMs / 1000) };
}

export async function recordLoginFailure(db: D1Database, ip: string): Promise<void> {
  const nowIso = new Date().toISOString();
  const row = await db
    .prepare("SELECT fail_count FROM login_attempts WHERE ip = ?")
    .bind(ip)
    .first<{ fail_count: number }>();

  const nextFailCount = (row?.fail_count ?? 0) + 1;
  const blockedUntil =
    nextFailCount >= MAX_FAIL_COUNT
      ? new Date(Date.now() + BLOCK_DURATION_SECONDS * 1000).toISOString()
      : null;

  await db
    .prepare(
      `INSERT INTO login_attempts (ip, fail_count, blocked_until, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(ip) DO UPDATE SET fail_count = ?, blocked_until = ?, updated_at = ?`,
    )
    .bind(ip, nextFailCount, blockedUntil, nowIso, nextFailCount, blockedUntil, nowIso)
    .run();
}

export async function resetLoginAttempts(db: D1Database, ip: string): Promise<void> {
  await db.prepare("DELETE FROM login_attempts WHERE ip = ?").bind(ip).run();
}

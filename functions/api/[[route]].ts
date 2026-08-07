import { Context, Hono } from "hono";
import { handle } from "hono/cloudflare-pages";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Env } from "../../src/types";
import {
  ADMIN_SESSION_COOKIE,
  checkRateLimit,
  constantTimeEquals,
  getClientIp,
  issueAdminSessionToken,
  recordLoginFailure,
  resetLoginAttempts,
  verifyAdminSessionToken,
} from "../../src/auth";
import {
  createSession,
  deleteSession,
  findDuplicateSession,
  getSessionById,
  listSessionsByDate,
  updateParsedGuide,
  updateSession,
  validateSessionInput,
  type SessionInput,
} from "../../src/sessions";
import { generateWodGuide } from "../../src/llm";

const app = new Hono<{ Bindings: Env }>().basePath("/api");

function errorResponse(code: string, message: string) {
  return { error: { code, message } };
}

// GET /api/wods?date=YYYY-MM-DD (공개)
app.get("/wods", async (c) => {
  const date = c.req.query("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json(errorResponse("invalid_date", "date 파라미터는 YYYY-MM-DD 형식이어야 합니다."), 400);
  }

  const sessions = await listSessionsByDate(c.env.DB, date);
  return c.json({ date, sessions });
});

// POST /api/admin/login (공개, Rate Limiter 적용)
app.post("/admin/login", async (c) => {
  const ip = getClientIp(c.req.raw);
  const { blocked, retryAfterSeconds } = await checkRateLimit(c.env.DB, ip);
  if (blocked) {
    c.header("Retry-After", String(retryAfterSeconds));
    return c.json(errorResponse("rate_limited", "로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요."), 429);
  }

  const body = await c.req.json<{ password?: string }>().catch(() => ({ password: undefined }));
  const password = body.password ?? "";

  if (!constantTimeEquals(password, c.env.ADMIN_PASSWORD)) {
    await recordLoginFailure(c.env.DB, ip);
    return c.json(errorResponse("invalid_password", "비밀번호가 올바르지 않습니다."), 401);
  }

  await resetLoginAttempts(c.env.DB, ip);
  const token = await issueAdminSessionToken(c.env.JWT_SECRET);
  setCookie(c, ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/",
    maxAge: 60 * 60 * 24,
  });
  return c.json({ ok: true });
});

// POST /api/admin/logout (인증 필요 없음 - 쿠키만 제거)
app.post("/admin/logout", (c) => {
  deleteCookie(c, ADMIN_SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

// GET /api/admin/me (인증 필요) - 대시보드 진입 시 로그인 상태 확인용
app.get("/admin/me", async (c) => {
  const token = getCookie(c, ADMIN_SESSION_COOKIE);
  const payload = token ? await verifyAdminSessionToken(token, c.env.JWT_SECRET) : null;
  if (!payload) {
    return c.json(errorResponse("unauthorized", "인증이 필요합니다."), 401);
  }
  return c.json({ role: payload.role });
});

// 관리자 인증 확인 헬퍼: /api/admin/sessions 하위 쓰기 API에서 공통 사용
async function requireAdmin(c: Context<{ Bindings: Env }>): Promise<boolean> {
  const token = getCookie(c, ADMIN_SESSION_COOKIE);
  const payload = token ? await verifyAdminSessionToken(token, c.env.JWT_SECRET) : null;
  return payload !== null;
}

// POST /api/admin/sessions (세션 생성)
app.post("/admin/sessions", async (c) => {
  if (!(await requireAdmin(c))) {
    return c.json(errorResponse("unauthorized", "인증이 필요합니다."), 401);
  }

  const body = await c.req.json<Partial<SessionInput>>().catch(() => ({}));
  const validationError = validateSessionInput(body);
  if (validationError) {
    return c.json(errorResponse("validation_error", validationError), 400);
  }

  const input = body as SessionInput;
  const duplicate = await findDuplicateSession(c.env.DB, input.date, input.class_type);
  if (duplicate) {
    return c.json(errorResponse("duplicate_session", "같은 날짜·클래스 종류의 세션이 이미 존재합니다."), 409);
  }

  const session = await createSession(c.env.DB, input);
  return c.json(session, 201);
});

// PUT /api/admin/sessions/:id (세션 수정)
app.put("/admin/sessions/:id", async (c) => {
  if (!(await requireAdmin(c))) {
    return c.json(errorResponse("unauthorized", "인증이 필요합니다."), 401);
  }

  const id = c.req.param("id");
  const body = await c.req.json<Partial<SessionInput>>().catch(() => ({}));
  const validationError = validateSessionInput(body);
  if (validationError) {
    return c.json(errorResponse("validation_error", validationError), 400);
  }

  const input = body as SessionInput;
  const duplicate = await findDuplicateSession(c.env.DB, input.date, input.class_type, id);
  if (duplicate) {
    return c.json(errorResponse("duplicate_session", "같은 날짜·클래스 종류의 세션이 이미 존재합니다."), 409);
  }

  const updated = await updateSession(c.env.DB, id, input);
  if (!updated) {
    return c.json(errorResponse("not_found", "해당 세션을 찾을 수 없습니다."), 404);
  }
  return c.json(updated, 200);
});

// POST /api/admin/sessions/:id/guide (LLM 가이드 생성/재생성, 인증 필요)
app.post("/admin/sessions/:id/guide", async (c) => {
  if (!(await requireAdmin(c))) {
    return c.json(errorResponse("unauthorized", "인증이 필요합니다."), 401);
  }

  const id = c.req.param("id");
  const session = await getSessionById(c.env.DB, id);
  if (!session) {
    return c.json(errorResponse("not_found", "해당 세션을 찾을 수 없습니다."), 404);
  }

  let guide;
  try {
    guide = await generateWodGuide(c.env, session.raw_wod, session.class_type);
  } catch (err) {
    const message = err instanceof Error ? err.message : "LLM 가이드 생성에 실패했습니다.";
    return c.json(errorResponse("llm_error", message), 502);
  }

  const updated = await updateParsedGuide(c.env.DB, id, JSON.stringify(guide));
  return c.json(updated, 200);
});

// DELETE /api/admin/sessions/:id (세션 삭제)
app.delete("/admin/sessions/:id", async (c) => {
  if (!(await requireAdmin(c))) {
    return c.json(errorResponse("unauthorized", "인증이 필요합니다."), 401);
  }

  const id = c.req.param("id");
  const deleted = await deleteSession(c.env.DB, id);
  if (!deleted) {
    return c.json(errorResponse("not_found", "해당 세션을 찾을 수 없습니다."), 404);
  }
  return c.body(null, 204);
});

export const onRequest = handle(app);

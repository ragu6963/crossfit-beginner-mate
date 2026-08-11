import { Hono } from "hono";
import { handle } from "hono/cloudflare-pages";
import { createMiddleware } from "hono/factory";
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
  deleteRecord,
  deleteSession,
  findDuplicateSession,
  getRecordBySessionId,
  getSessionById,
  listSessionsByDate,
  updateParsedGuide,
  updateParsedRecord,
  updateRecordTemplate,
  updateSession,
  upsertRecord,
  validateSessionInput,
  type SessionInput,
} from "../../src/sessions";
import { generateWodGuide } from "../../src/llm";
import { parseWodRecord } from "../../src/records";
import { generateRecordTemplate } from "../../src/record-template";

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

// 관리자 인증 미들웨어: /api/admin/sessions 하위 쓰기 API 전체(생성/수정/삭제/가이드)에 공통 적용
const requireAdminMiddleware = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const token = getCookie(c, ADMIN_SESSION_COOKIE);
  const payload = token ? await verifyAdminSessionToken(token, c.env.JWT_SECRET) : null;
  if (!payload) {
    return c.json(errorResponse("unauthorized", "인증이 필요합니다."), 401);
  }
  await next();
});
app.use("/admin/sessions", requireAdminMiddleware);
app.use("/admin/sessions/*", requireAdminMiddleware);

// POST /api/admin/sessions (세션 생성)
app.post("/admin/sessions", async (c) => {
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

// ---------------------------------------------------------------------------
// 개인 기록 (관리자 전용). 공개 API(/api/wods)에는 절대 노출하지 않는다.
// ---------------------------------------------------------------------------

// GET /api/admin/sessions/:id/record (기록 + 입력 양식 조회)
app.get("/admin/sessions/:id/record", async (c) => {
  const id = c.req.param("id");
  const [record, session] = await Promise.all([
    getRecordBySessionId(c.env.DB, id),
    getSessionById(c.env.DB, id),
  ]);
  return c.json({ record, template: session?.record_template ?? null });
});

// POST /api/admin/sessions/:id/record/template (입력 양식 생성/재생성)
//
// 기록칸을 열 때마다 LLM을 부르면 매번 몇 초씩 기다려야 하므로, 세션당 한 번 만들어 저장하고
// 이후에는 저장된 것을 그대로 쓴다. 프론트엔드는 양식이 없을 때만 이 API를 호출한다.
app.post("/admin/sessions/:id/record/template", async (c) => {
  const id = c.req.param("id");
  const session = await getSessionById(c.env.DB, id);
  if (!session) {
    return c.json(errorResponse("not_found", "해당 세션을 찾을 수 없습니다."), 404);
  }

  let template: string;
  try {
    template = await generateRecordTemplate(c.env, session.raw_wod, session.class_type);
  } catch (err) {
    const message = err instanceof Error ? err.message : "입력 양식 생성에 실패했습니다.";
    return c.json(errorResponse("llm_error", message), 502);
  }

  await updateRecordTemplate(c.env.DB, id, template);
  return c.json({ template }, 200);
});

// PUT /api/admin/sessions/:id/record (기록 저장 + 즉시 파싱)
//
// 원본 저장과 파싱을 한 단계로 묶지 않는 것이 핵심이다. 운동 직후 입력한 기록은 어떤 경우에도
// 사라지면 안 되므로 원본을 먼저 커밋하고, Gemini 호출이 실패하면 parsed_record만 비어 있는
// 상태로 200을 돌려준다(파싱은 나중에 재파싱 버튼으로 언제든 다시 채울 수 있다).
app.put("/admin/sessions/:id/record", async (c) => {
  const id = c.req.param("id");
  const session = await getSessionById(c.env.DB, id);
  if (!session) {
    return c.json(errorResponse("not_found", "해당 세션을 찾을 수 없습니다."), 404);
  }

  const body = await c.req
    .json<{ raw_record?: string }>()
    .catch(() => ({}) as { raw_record?: string });
  const rawRecord = (body.raw_record ?? "").trim();
  if (!rawRecord) {
    return c.json(errorResponse("validation_error", "raw_record는 비어있을 수 없습니다."), 400);
  }

  const saved = await upsertRecord(c.env.DB, id, rawRecord);

  try {
    const parsed = await parseWodRecord(c.env, session.raw_wod, session.class_type, rawRecord);
    const updated = await updateParsedRecord(c.env.DB, id, JSON.stringify(parsed));
    return c.json({ record: updated ?? saved }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : "기록 파싱에 실패했습니다.";
    return c.json({ record: saved, parse_error: message }, 200);
  }
});

// POST /api/admin/sessions/:id/record/parse (재파싱)
app.post("/admin/sessions/:id/record/parse", async (c) => {
  const id = c.req.param("id");
  const session = await getSessionById(c.env.DB, id);
  if (!session) {
    return c.json(errorResponse("not_found", "해당 세션을 찾을 수 없습니다."), 404);
  }

  const record = await getRecordBySessionId(c.env.DB, id);
  if (!record) {
    return c.json(errorResponse("not_found", "이 세션에 저장된 기록이 없습니다."), 404);
  }

  let parsed;
  try {
    parsed = await parseWodRecord(c.env, session.raw_wod, session.class_type, record.raw_record);
  } catch (err) {
    const message = err instanceof Error ? err.message : "기록 파싱에 실패했습니다.";
    return c.json(errorResponse("llm_error", message), 502);
  }

  const updated = await updateParsedRecord(c.env.DB, id, JSON.stringify(parsed));
  return c.json({ record: updated }, 200);
});

// DELETE /api/admin/sessions/:id/record (기록 삭제)
app.delete("/admin/sessions/:id/record", async (c) => {
  const deleted = await deleteRecord(c.env.DB, c.req.param("id"));
  if (!deleted) {
    return c.json(errorResponse("not_found", "이 세션에 저장된 기록이 없습니다."), 404);
  }
  return c.body(null, 204);
});

// DELETE /api/admin/sessions/:id (세션 삭제)
app.delete("/admin/sessions/:id", async (c) => {
  const id = c.req.param("id");
  const deleted = await deleteSession(c.env.DB, id);
  if (!deleted) {
    return c.json(errorResponse("not_found", "해당 세션을 찾을 수 없습니다."), 404);
  }
  return c.body(null, 204);
});

export const onRequest = handle(app);

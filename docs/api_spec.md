# CRUD API 명세서

`prd.md`의 `wod_sessions` 스키마 및 인증 정책을 기준으로 정의합니다. 세션 조회는 관리자용 API를 별도로 두지 않고 공개 조회 API를 재사용하며, 쓰기 작업(생성/수정/삭제)만 인증으로 보호합니다.

**단, 개인 기록(`wod_records`)은 예외입니다.** 관리자 본인만 보는 데이터이므로 공개 조회 API에 절대 싣지 않고, 인증이 필요한 전용 엔드포인트(9~12번)로만 조회합니다.

## 공통 규칙

- **에러 응답 포맷:** `{ "error": { "code": "string", "message": "string" } }`
- **날짜 포맷:** `date`는 `YYYY-MM-DD` (Asia/Seoul 고정). 세션에는 시간 필드가 없습니다 — 같은 클래스 종류의 모든 타임은 동일한 와드이므로 시작/종료 시간을 저장하지 않습니다.
- **인증:** `admin_session` 쿠키(JWT, HttpOnly/Secure/SameSite=Strict)로 검증. 인증 필요 API에 쿠키가 없거나 유효하지 않으면 `401 Unauthorized`.

## 1. `GET /api/wods` (공개)

선택한 날짜의 세션 목록을 조회합니다.

**Query Parameters**
| 이름 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `date` | string (`YYYY-MM-DD`) | Y | 조회할 날짜 |

**Response 200**
```json
{
  "date": "2026-08-06",
  "sessions": [
    {
      "id": "uuid",
      "class_type": "CF Class",
      "raw_wod": "...",
      "parsed_guide": null
    }
  ]
}
```
데이터가 없는 날짜는 `"sessions": []`로 응답합니다(404가 아님).

**Response 400**: `date` 파라미터 누락/형식 오류.

---

## 2. `POST /api/admin/login` (공개)

관리자 로그인. Rate Limiter(`login_attempts` 테이블) 적용 대상입니다.

**Request Body**
```json
{ "password": "string" }
```

**Response 200**: `admin_session` 쿠키 발급.

**Response 401**: 비밀번호 불일치. 내부적으로 `login_attempts.fail_count` +1, 5회 도달 시 `blocked_until = now + 15분` 설정.

**Response 429**: 현재 IP가 차단 중(`blocked_until` 미래). `Retry-After` 헤더에 남은 초를 포함.

---

## 3. `POST /api/admin/logout` (인증 필요 없음 — 쿠키만 제거)

**Response 200**: `admin_session` 쿠키 제거.

---

## 4. `GET /api/admin/me` (인증 필요) — *구현 중 추가*

관리자 대시보드가 로그인 상태를 먼저 확인하기 위한 엔드포인트. 원래 명세서에는 없었으나, 대시보드 진입 시 매번 쓰기 API를 시도해 401을 받고서야 로그인 페이지로 튕기는 방식은 UX가 나빠 구현 단계에서 추가했다.

**Response 200**: `{ "role": "admin" }`

**Response 401**: 세션 쿠키 없음/만료.

---

## 5. `POST /api/admin/sessions` (인증 필요)

세션(날짜+클래스 종류)을 생성합니다.

**Request Body**
```json
{
  "date": "2026-08-06",
  "class_type": "CF Class",
  "raw_wod": "5Min on 2Min off x 4set\n400M Run\n..."
}
```

**검증 규칙**
- `date`는 `YYYY-MM-DD` 형식
- `class_type`, `raw_wod` 비어있지 않음
- 같은 `(date, class_type)` 조합이 이미 존재하면 거부

**Response 201**
```json
{ "id": "uuid", "date": "...", "class_type": "...", "raw_wod": "...", "parsed_guide": null, "created_at": "...", "updated_at": "..." }
```

**Response 400**: 검증 규칙 위반.

**Response 409**: `(date, class_type)` 중복.

---

## 6. `PUT /api/admin/sessions/:id` (인증 필요)

기존 세션을 수정합니다. Request Body는 생성과 동일한 필드 전체를 받습니다(부분 수정 미지원).

**Response 200**: 수정된 세션 객체.

**Response 400**: 검증 규칙 위반.

**Response 404**: 해당 `id` 없음.

**Response 409**: 수정 결과가 다른 레코드의 `(date, class_type)`과 중복.

---

## 7. `DELETE /api/admin/sessions/:id` (인증 필요)

**Response 204**: 삭제 성공(본문 없음).

**Response 404**: 해당 `id` 없음.

---

## 8. `POST /api/admin/sessions/:id/guide` (인증 필요)

세션의 `raw_wod`를 기반으로 Gemini API를 호출해 LLM 가이드(`parsed_guide`)를 생성/재생성합니다. 요청 본문은 없으며, 서버가 DB에 저장된 `raw_wod`·`class_type`을 그대로 사용합니다. 동기 처리로, 응답이 올 때까지 관리자 화면은 로딩 상태를 표시합니다.

**Response 200**: 갱신된 세션 객체(`parsed_guide`에 새 JSON 채워짐).

**Response 404**: 해당 `id` 없음.

**Response 502**: Gemini API 호출 실패 또는 응답이 예상 스키마와 불일치. `error.message`에 원인 요약 포함.

---

## 9~12. 개인 기록 API (인증 필요)

관리자 본인만 쓰고 보는 개인 와드 기록입니다. **공개 API(`GET /api/wods`)에는 절대 포함되지 않으며**, 아래 관리자 전용 엔드포인트로만 접근합니다. 기록은 세션당 1건입니다.

`wod_records`는 `raw_record`(내가 적은 원본)와 `parsed_record`(LLM 구조화 JSON)를 함께 저장합니다 — `wod_sessions`의 `raw_wod`/`parsed_guide`와 같은 패턴입니다. 원본을 항상 남기므로 파싱이 틀려도 기록은 보존되고, 규칙이 좋아지면 언제든 다시 파싱할 수 있습니다.

### 9. `GET /api/admin/sessions/:id/record`

**Response 200**: `{ "record": {...} | null, "template": "..." | null }` — 기록이 없으면 `record`는 `null`입니다(404 아님). `template`은 입력칸에 미리 채워 넣을 빈칸 서식이며, 아직 만들어지지 않았으면 `null`입니다(이때 프론트엔드가 13번을 호출합니다).

### 10. `PUT /api/admin/sessions/:id/record`

Request Body: `{ "raw_record": "타임캡 8분, 버피 5개 남김. 클린은 60kg으로 낮춤" }` (자유 텍스트 한 줄)

**원본 저장과 LLM 파싱을 분리한 것이 이 API의 핵심입니다.** 원본을 먼저 커밋한 뒤 파싱하므로, Gemini 호출이 실패해도 운동 직후 입력한 기록은 사라지지 않습니다.

**Response 200**: `{ "record": {...} }`. 파싱에 실패한 경우에도 **200**이며 `{ "record": {...}, "parse_error": "..." }` 형태로 원본 저장 결과와 실패 사유를 함께 반환합니다(`parsed_record`는 `null`). 이때는 11번 API로 재시도합니다.

**Response 400**: `raw_record`가 비어 있음. **Response 404**: 해당 세션 없음.

### 11. `POST /api/admin/sessions/:id/record/parse`

저장된 `raw_record`를 다시 파싱합니다. 파싱이 틀렸을 때 고치는 대상은 구조화 JSON이 아니라 원문이며, 원문을 고쳐 10번으로 다시 저장하거나 규칙 개선 후 이 API로 재해석합니다.

**Response 200**: `{ "record": {...} }`. **Response 404**: 세션 또는 기록 없음. **Response 502**: Gemini 호출/검증 실패.

### 12. `DELETE /api/admin/sessions/:id/record`

**Response 204**: 삭제 성공. **Response 404**: 기록 없음.

### 13. `POST /api/admin/sessions/:id/record/template`

기록 입력칸에 미리 채워 넣을 **빈칸 서식**을 생성해 `wod_sessions.record_template`에 저장합니다. 운동 직후 빈 textarea를 마주하면 무엇을 어떻게 적을지 막막해 기록이 잘 안 써진다는 실사용 피드백에서 나왔습니다.

LLM은 **파트 분리와 파트별 `score_type` 판정만** 담당하고(기록 파서와 같은 분류를 공유), 실제 서식 문자열은 코드가 조립합니다. LLM에 서식까지 맡겼을 때 9-7-5 For Time(완주 시간 하나가 스코어)에 "1라운드/2라운드/3라운드" 칸이 생기는 문제가 있었습니다 — **잘못된 뼈대는 빈 화면보다 나쁩니다.** 없는 기록을 적게 만들기 때문입니다.

세션당 한 번 만들어 재사용하며(매번 호출하면 몇 초씩 기다려야 함), 와드 원문(`raw_wod`)이 수정되면 자동으로 비워져 다음에 다시 만들어집니다.

**Response 200**: `{ "template": "무게: \n\n스케일링: \n체감: " }`. **Response 404**: 세션 없음. **Response 502**: Gemini 호출 실패(이 경우 프론트엔드는 빈 입력칸으로 두며, 기록은 여전히 자유 텍스트로 작성할 수 있습니다).

> 세션을 삭제하면(7번) 해당 세션의 기록도 함께 삭제됩니다.

---

## 캐시 Purge 연동

5~8번 API가 성공적으로 처리되면, 해당 세션의 `date` 기준으로 `GET /api/wods?date=YYYY-MM-DD` URL을 Cloudflare Cache API로 Purge합니다(`prd.md`의 캐싱 전략 참고). **MVP 구현 범위에서는 실제 Cloudflare Cache API 호출(Zone API 토큰 필요)은 보류했습니다** — 로컬/개발 환경에는 실제 Edge 캐시가 없어 검증할 수 없고, CI/CD와 함께 배포 단계에서 붙이기로 결정했습니다.

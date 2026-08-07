# CrossFit Beginner Mate - MVP 개발 과정 및 결과 보고서

본 문서는 프로젝트의 초기 기획부터 MVP 개발 완료까지의 전체 대화 기록, 구현 계획, 그리고 최종 반영 결과를 하나로 통합하여 정리한 문서입니다.

## 1. 프로젝트 개요 및 목표

- **서비스 목적:** 크로스핏 와드(WOD) 정보를 입력하면, LLM API를 통해 초보자 눈높이에 맞춘 운동 설명, 팁, 쿨다운 스트레칭 정보를 자동 생성하고 제공하는 웹 서비스입니다.
- **주요 과제:** 로그인 인증 보안 수준 보완, 데이터 스키마 구체화(LLM 구조화 출력 포함), 데이터 미존재 일자 화면 렌더링, Cloudflare Edge 캐싱 전략 수립.
- **기술 스택:** Cloudflare Pages Functions (Hono, TypeScript), Cloudflare D1, 정적 HTML/CSS + Vanilla JS.

## 2. 주요 개발 진행 경과

### 기획 구체화 및 보안 보완
- **인증 및 보안:** 단일 고정 비밀번호 검증에 D1 기반의 Rate Limiter(5회 실패 시 15분 차단)를 추가하고, HS256 알고리즘의 JWT 기반 세션 쿠키(HttpOnly, Secure, SameSite=Strict)를 적용했습니다.
- **스키마 구체화:** 입력 와드의 다양성을 수용하도록 WOD 세션 테이블(`wod_sessions`)을 정의하고, LLM 출력을 위해 JSON Structured Output 스키마를 설계했습니다.
- **캐싱 전략:** Cloudflare Pages 및 D1 환경에 맞춰 `Cache-Control`을 설정하고, 데이터 업데이트 시 URL 단위로 캐시를 무효화(Purge by URL)하는 전략을 세웠습니다.

### MVP 개발 착수 및 완료
- `wrangler.toml` 및 `package.json` 등 프로젝트 스캐폴딩 후 로컬 D1 마이그레이션(`0001_init.sql`)을 적용했습니다.
- Hono 기반의 CRUD 및 인증 API를 구현하고 로컬에서 curl로 엔드투엔드 테스트를 완료했습니다.
- 사용자 뷰, 관리자 로그인, 관리자 대시보드의 3개 정적 프론트엔드 화면을 구축했습니다. 디자인 시스템(`DESIGN.md`)을 바탕으로 `Pretendard` 폰트를 적용하고 모바일 반응형 UI를 적용했습니다.

### UI 및 UX 개선 사항
- **사용자 뷰 개편:** 복잡한 이전/다음 주 버튼을 삭제하고 직관적인 좌우 스크롤 방식의 날짜 스트립 구조로 개편했습니다. 와드가 없는 날짜에는 친절한 안내 카드를 노출합니다. 날짜를 변경하면 목록이 즉시 교체되지 않고 좌우 슬라이드 전환(진행 방향에 따라 반대편에서 들어오는 애니메이션)으로 자연스럽게 갱신됩니다.
- **세션 카드 및 상세 정보 노출 정책 (여러 차례 조정을 거쳐 최종 확정):** 세션 카드는 클래스 종류와 관리자가 입력한 **원본 와드 텍스트를 목록에서 바로** 보여줍니다. LLM이 생성한 추가 가이드(오늘의 목표/웜업·본 운동 동작 설명/운동 팁/쿨다운 스트레칭)만 카드를 클릭했을 때 **PC 중앙 모달 / 모바일 하단 바텀시트**로 표시합니다. `parsed_guide`가 없는 카드는 더 볼 내용이 없으므로 클릭 동작 자체를 두지 않습니다. 카드 우측의 `›` 화살표 아이콘과 클래스 이니셜 원형 배지는 정보 밀도를 낮추기 위해 최종적으로 제거했습니다. 클릭 가능함을 알리는 표시는 pill 라벨 → 왼쪽 액센트 띠 순으로 시도했으나 둘 다 인위적이라는 피드백을 받아, `DESIGN.md`의 `store-utility-card` 컴포넌트가 실제로 쓰는 패턴(카드 배경/칩 없이 끝에 순수 `{component.text-link}` 하나만 두는 방식)을 그대로 재사용하는 것으로 최종 확정했습니다.
- **관리자 대시보드 동기화:** 관리자 페이지 UI 역시 일반 사용자 페이지와 동일한 날짜 스트립·세션 카드·상세 모달/바텀시트 구조를 재사용하고, 상세 패널 하단에 관리자 전용 액션(가이드 생성/재생성, 수정, 삭제)을 배치했습니다. 관리자는 가이드 유무와 무관하게 항상 카드를 클릭할 수 있습니다.
- **유튜브 임베드 정책 변경:** 특정 영상의 iframe 임베드 대신, 환각 방지 및 유지보수를 위해 "유튜브에서 검색해보기" 링크(새 탭)로 전환했습니다.
- **폰트:** 한글 가독성을 위해 Inter에서 Pretendard(CDN)로 교체했습니다.
- **파비콘:** 서비스 아이덴티티에 맞춰 바벨 실루엣을 Action Blue(`#0066cc`) 단일 색상으로 그린 SVG 파비콘(`public/favicon.svg`)을 제작하고 세 HTML(사용자 뷰, 관리자 로그인, 관리자 대시보드)에 연결했습니다.

### 데이터 스키마 정립 (타임 슬롯 논의)
- **논의 경과:** 하루 여러 타임 편성(CF Class ↔ Strength Class)을 반영하기 위해 시작/종료 시간을 도입하려 했으나, "같은 클래스 종류면 모두 동일한 와드를 수행하므로 시간표가 불필요하다"는 피드백을 수용했습니다.
- **최종 반영:** `wod_sessions` 테이블에서 `start_time`, `end_time`을 완전히 제거하고, Unique Index를 `(date, class_type)` 단위로 확정 지었습니다.

### LLM (Gemini) 연동 완료
- `gemini-3.1-flash-lite` 모델을 연동하여, 관리자가 수동으로 "가이드 생성" 버튼을 눌렀을 때 동기 방식으로 가이드가 생성되도록 구현했습니다(`POST /api/admin/sessions/:id/guide`, `src/llm.ts`). Gemini의 `responseSchema` 구조화 출력을 사용해 파싱 실패 위험을 줄이고, API 키는 `GEMINI_API_KEY` 환경 변수(로컬 `.dev.vars`, 배포 시 Cloudflare Workers Secret)로 관리합니다.
- Core 파트와 METCON 파트가 나뉘는 와드 대응을 위해 `warmup_movements` 선택 필드를 출력 스키마에 추가하고, 완벽하게 두 파트로 분리 렌더링되도록 처리했습니다.

## 3. 알려진 이슈 / 배포 전 남은 작업

- **배포 미완료:** `wrangler.toml`의 `database_id`가 플레이스홀더 상태입니다. 실제 Cloudflare D1 생성(`wrangler d1 create`) 후 교체가 필요합니다.
- **시크릿 미등록:** `JWT_SECRET`, `ADMIN_PASSWORD`, `GEMINI_API_KEY`를 `wrangler secret put`으로 실제 배포 환경에 등록해야 합니다(현재는 로컬 `.dev.vars`에만 존재).
- **Cache Purge 미연동:** 캐싱 전략(Cache-Control + Purge by URL)은 설계만 완료했고, 실제 Cloudflare Cache API 호출(Zone API 토큰 필요)은 로컬 환경에서 검증할 수 없어 배포 단계로 이월했습니다.
- **CI/CD 미구성:** GitHub Actions 등 자동화 파이프라인은 아직 구성하지 않았습니다.
- **DESIGN.md 정합성 gap 3건 (수정 완료):** `DESIGN.md`(애플 디자인 시스템) 대비 검토에서 발견된 3건을 모두 반영했습니다. (1) `:active { transform: scale(0.95) }`를 `.btn-primary`뿐 아니라 `.btn-secondary`/`.btn-danger`/`.btn-utility`/`.detail-close-btn`/`.day-cell`에 공통 적용(단, 여러 줄짜리 세션 카드에 축소 애니메이션을 적용하니 부자연스러워 보인다는 피드백을 받아 `.session-row`는 제외하고 은은한 배경색 변화로 대체), (2) `button`/`a`/`input`/`select`/`textarea`에 `--color-primary-focus` 기반 `:focus-visible` 아웃라인 추가, (3) h2(21px, tagline)의 letter-spacing을 디스플레이용 음의 트래킹(-0.02em)에서 스펙상의 양의 트래킹(+0.011em)으로 분리.

## 4. 최종 산출물 및 문서 위치

모든 개발 및 논의 결과는 최신 단일 소스인 **PRD 문서**에 완벽히 통합되어 있습니다.
- [`prd.md`](./prd.md) — 서비스 요구사항 전체
- [`api_spec.md`](./api_spec.md) — API 엔드포인트 명세
- [`commands.md`](./commands.md) — 개발/배포 명령어 정리
- [`DESIGN.md`](./DESIGN.md) — 디자인 시스템 토큰
- [`../migrations/0001_init.sql`](../migrations/0001_init.sql) — D1 마이그레이션


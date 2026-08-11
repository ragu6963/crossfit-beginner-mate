# 명령어 정리 (개발자 / AI용)

이 프로젝트에서 반복적으로 사용하는 명령어를 정리합니다. 새로 합류하는 개발자나 이후 이 저장소를 다루는 AI 에이전트가 매번 구조를 다시 파악하지 않도록 하기 위한 문서입니다.

## 최초 설정

```bash
npm install
```

로컬 개발용 환경 변수 파일 `.dev.vars`가 저장소 루트에 필요합니다(커밋되지 않음, `.gitignore`에 등록됨). 없다면 아래 내용으로 생성합니다:

```
ADMIN_PASSWORD=<로컬 테스트용 비밀번호>
JWT_SECRET=<로컬 테스트용 임의 문자열>
GEMINI_API_KEY=<Gemini API 키>
```

## D1 마이그레이션

```bash
# 로컬 D1에 스키마 적용 (최초 1회, 또는 migrations/ 에 새 파일 추가 시)
npm run db:migrate:local

# 실제 Cloudflare D1(원격)에 적용 — 배포 전 필수
npm run db:migrate:remote
```

새 마이그레이션 파일을 추가할 때는 `migrations/000N_설명.sql` 형식으로 번호를 이어서 작성합니다(기존 `0001_init.sql` 참고).

## 로컬 개발 서버 실행

```bash
npm run dev
```

`wrangler pages dev public`을 실행하며, `wrangler.toml`에 정의된 D1 바인딩(`DB`)과 `.dev.vars`의 환경 변수를 자동으로 사용합니다. 기본 포트는 `8788`입니다.

**주의(Windows):** 백그라운드로 띄운 `wrangler pages dev`를 터미널 강제 종료(Ctrl+C가 아닌 프로세스 kill)로 멈추면 자식 프로세스(workerd 등)가 남아 포트를 계속 점유하는 경우가 있습니다. 포트가 이미 사용 중이라는 오류가 나면 다음으로 정리합니다:

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'wrangler' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

## 타입 체크

```bash
npm run typecheck
```

`tsc --noEmit`으로 `functions/`, `src/` 하위 TypeScript를 검사합니다. 프론트엔드(`public/*.js`)는 Vanilla JS라 타입 체크 대상이 아닙니다.

## 트러블슈팅: 로컬에서 관리자 로그인이 계속 429(Too Many Requests)

로컬 개발 서버(`wrangler pages dev`)는 `CF-Connecting-IP` 헤더를 보내지 않기 때문에, 로컬에서는 모든 로그인 요청이 `ip="unknown"`이라는 동일한 키로 Rate Limiter에 집계됩니다. 비밀번호를 5회 틀리면(테스트 중 실수 포함) 15분간 차단되며, 실제 배포 환경에서는 Cloudflare가 항상 실제 클라이언트 IP를 채워주므로 사용자별로 정상 분리됩니다. 로컬에서 차단을 바로 풀어야 하면:

```bash
npx wrangler d1 execute crossfit_beginner_mate --local --command "DELETE FROM login_attempts"
```

## API 동작 확인 (curl 예시)

로컬 서버(`npm run dev`)가 실행 중일 때:

```bash
# 공개 조회
curl "http://127.0.0.1:8788/api/wods?date=2026-08-06"

# 관리자 로그인 (쿠키 저장)
curl -c cookies.txt -X POST http://127.0.0.1:8788/api/admin/login \
  -H "Content-Type: application/json" -d '{"password":"<ADMIN_PASSWORD 값>"}'

# 로그인 상태 확인
curl -b cookies.txt http://127.0.0.1:8788/api/admin/me

# 세션 생성
curl -b cookies.txt -X POST http://127.0.0.1:8788/api/admin/sessions \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-08-06","class_type":"CF Class","raw_wod":"..."}'
```

전체 엔드포인트 명세는 [`docs/api_spec.md`](./api_spec.md)를 참고합니다.

## 배포

**이 프로젝트는 로컬에서 직접 업로드하는 수동 배포(direct upload)를 공식 절차로 사용합니다.** Cloudflare Pages의 GitHub 연동 빌드는 사용하지 않습니다(아래 "왜 수동 배포인가" 참고). 따라서 **GitHub에 push하는 것만으로는 배포되지 않으며**, 아래 명령을 반드시 실행해야 프로덕션에 반영됩니다.

프로덕션: https://crossfit-beginner-mate.pages.dev

```bash
# 0. 배포 전 확인
npm run typecheck
git status            # 배포는 현재 로컬 디렉토리 내용을 그대로 올린다. 커밋/푸시된 상태에서 실행할 것

# 1. 마이그레이션이 추가된 경우에만 (migrations/ 에 새 파일이 있을 때)
npm run db:migrate:remote

# 2. Pages 배포 (wrangler.toml의 pages_build_output_dir=public 을 사용하므로 경로 인자 불필요)
npx wrangler pages deploy --branch main
```

배포 후 확인:

```bash
npx wrangler pages deployment list --project-name crossfit-beginner-mate   # 최신 항목의 Source가 방금 커밋 해시인지 확인
curl -s -o /dev/null -w "%{http_code}\n" https://crossfit-beginner-mate.pages.dev/
```

정적 에셋(`public/*.js`, `*.css`)은 엣지 캐시 때문에 배포 직후 잠시 이전 버전이 응답할 수 있습니다. 반영 여부를 확인할 때는 쿼리스트링으로 캐시를 우회하세요: `curl -s "https://crossfit-beginner-mate.pages.dev/shared.js?v=$(date +%s)"`.

### 최초 1회만 필요한 설정

```bash
# Cloudflare에 실제 D1 데이터베이스 생성 (wrangler.toml의 database_id를 결과값으로 교체해야 함)
npx wrangler d1 create crossfit_beginner_mate

# 시크릿 등록 (JWT_SECRET, ADMIN_PASSWORD, GEMINI_API_KEY는 코드/설정 파일에 직접 넣지 않음)
npx wrangler secret put JWT_SECRET
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put GEMINI_API_KEY
```

### 왜 수동 배포인가 (2026-08-11 결정)

Pages 프로젝트에 GitHub 연동이 켜져 있던 시기에 **모든 push의 자동 빌드가 Failure로 끝났습니다**(`9355045`, `11be9a2`, `e145fe4`, `c84479a` 전부). 서비스가 정상으로 보였던 것은 매번 수동 배포로 덮어썼기 때문이고, 커밋마다 실패 배포 1건이 이력에 쌓이고 있었습니다. 자동 배포의 이점보다 실패 알림/이력 오염 비용이 커서 연동을 해제하고 수동 배포로 확정했습니다.

**주의:** Git 연동 해제는 wrangler CLI로 할 수 없습니다(`wrangler pages project`에는 `list/create/delete`만 존재). 대시보드 → 프로젝트 → Settings → Builds & deployments에서만 가능하며, `wrangler pages project delete`는 프로덕션 도메인·시크릿·D1 바인딩까지 함께 삭제하므로 연동 해제 목적으로 절대 사용하지 마세요.

GitHub Actions 등 CI/CD 자동화는 여전히 구성하지 않았습니다(`prd.md` MVP 범위 참고).

## 관련 문서

- [`prd.md`](./prd.md) — 서비스 요구사항 전체(항상 최신 단일 소스)
- [`api_spec.md`](./api_spec.md) — API 엔드포인트 명세
- [`development_report.md`](./development_report.md) — MVP 개발 과정 통합 보고서
- [`DESIGN.md`](./DESIGN.md) — 디자인 시스템 토큰

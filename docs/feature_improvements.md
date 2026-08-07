# 기능 개선 제안 (2026-08-07 리팩토링 중 발견)

이번 경량화 리팩토링(중복 코드 제거, 인증 미들웨어 통합) 과정에서 코드를 훑어보며 발견한, 아직 구현되지 않은 개선 포인트입니다. `development_report.md`에 이미 기록된 "배포 전 남은 작업"(Cache Purge, CI/CD 부재 등)과는 겹치지 않는 항목만 정리했습니다.

## 보안

- **GEMINI_API_KEY 로테이션 권장**: 배포 작업 과정에서 로컬 `.dev.vars`의 실제 Gemini API 키 값이 대화 로그(터미널 출력)에 노출된 적이 있습니다. 저장소에 커밋되지는 않았지만(`.gitignore` 적용됨), 안전을 위해 Google AI Studio에서 키를 재발급하고 프로덕션 시크릿(Cloudflare Pages) 값을 교체하는 것을 권장합니다.
- **Rate Limiter가 IP 단일 키 기준**: `src/auth.ts`의 로그인 시도 제한이 `CF-Connecting-IP` 하나로만 집계됩니다. 카페/회사 공유 Wi-Fi처럼 여러 사용자가 같은 공인 IP(NAT)를 쓰는 환경에서는, 한 사람이 비밀번호를 5회 틀리면 같은 IP를 쓰는 다른 관리자도 15분간 로그인이 막힙니다. 지금은 관리자가 1명뿐이라 문제되지 않지만, 관리자가 늘어나면 재현 가능한 이슈입니다.
- **단일 고정 관리자 비밀번호**: 관리자 계정이 개별 식별자 없이 `ADMIN_PASSWORD` 하나를 공유합니다. 관리자가 여러 명이 되면 "누가 어떤 세션을 수정/삭제했는지" 감사 로그를 남길 수 없습니다.

## 안정성

- **LLM 가이드 생성이 요청-응답 동기 처리**: `POST /api/admin/sessions/:id/guide`가 Gemini 응답을 기다렸다가 그대로 반환합니다. Cloudflare Pages Functions는 요청당 실행 시간 제한이 있어, Gemini 응답이 느려지면(네트워크 이슈, 모델 부하 등) 502 에러 대신 플랫폼 타임아웃으로 실패할 수 있습니다. 트래픽이 늘어나면 Queue(Cloudflare Queues)로 비동기 처리하고 프론트엔드는 폴링/재조회로 전환하는 방식을 고려할 수 있습니다.
- **동시 수정 시 마지막 쓰기 우선(lost update)**: `src/sessions.ts`의 `updateSession`/`updateParsedGuide`는 버전 검사 없이 덮어씁니다. 관리자가 1명인 지금은 영향이 없지만, 여러 관리자가 동시에 같은 세션을 수정하는 시나리오가 생기면 먼저 저장한 수정 내용이 조용히 사라질 수 있습니다.

## 개발 프로세스

- **자동화 테스트 부재**: 현재 검증은 `docs/commands.md`의 curl 예시나 수동 `wrangler pages dev` 스모크 테스트에 의존합니다. API 레벨 최소 테스트(예: `POST /api/admin/sessions` 검증 실패/중복/성공 케이스)만 추가해도 회귀를 조기에 잡을 수 있습니다.
- **GitHub Actions로 typecheck 자동화**: 저장소가 이번에 GitHub에 연결됐으니, PR/push 시 `npm run typecheck`를 자동 실행하는 워크플로를 추가하면 좋습니다. `development_report.md`에 이미 "CI/CD 미구성"으로 기록돼 있지만, 지금이 착수하기 좋은 시점이라 다시 짚어둡니다.
- **Cloudflare Pages Git 연동 미설정**: 현재 배포는 `wrangler pages deploy`로 로컬에서 직접 업로드하는 방식입니다. 대시보드에서 GitHub 저장소를 연결하면 `main` push마다 자동 배포되어, 매번 CLI를 실행할 필요가 없어집니다.

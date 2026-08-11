// 기록 파싱(src/records.ts)의 골든 케이스 회귀 테스트 러너.
//
//   npm run test:records                 전체 케이스 (프롬프트가 그대로면 API 호출 없이 캐시로 끝난다)
//   npm run test:records -- template     id에 "template"이 들어간 케이스만
//   npm run test:records -- --repeat 3   같은 케이스를 여러 번 돌려 흔들림 확인 (캐시 자동 우회)
//   npm run test:records -- --no-cache   캐시를 무시하고 전부 실제 호출
//
// 케이스마다 실제 Gemini를 호출하므로 시간과 토큰 소모가 크다. 그래서 아래 장치를 뒀다.
//  1) 응답 캐시 — 요청 본문(프롬프트+스키마+temperature) 해시로 캐싱한다. 프롬프트를 건드리지 않은
//     변경에서는 호출이 0회가 되고, 규칙을 고치면 해시가 바뀌어 자동으로 무효화된다.
//  2) 부분 실행 — id 부분 문자열로 관련 케이스만 돌린다.
//  3) 병렬 실행 — 캐시 미스가 많을 때 대기 시간을 줄인다.
//  4) 실패 출력 축약 — 파싱 결과 전문은 파일로 빼고 화면에는 어긋난 필드만 남긴다.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseWodRecord } from "../src/records.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const CACHE_DIR = resolve(root, "tests/.cache");
const FAILURE_DUMP = resolve(CACHE_DIR, "last-failures.json");
const CONCURRENCY = 4;

const devVars = readFileSync(resolve(root, ".dev.vars"), "utf8");
const apiKey = devVars.match(/GEMINI_API_KEY\s*=\s*"?([^"\r\n]+)"?/)?.[1];
if (!apiKey) {
  console.error("✗ .dev.vars에서 GEMINI_API_KEY를 찾지 못했습니다.");
  process.exit(1);
}

const golden = JSON.parse(readFileSync(resolve(root, "tests/golden-records.json"), "utf8"));

const args = process.argv.slice(2);
const repeatIdx = args.indexOf("--repeat");
const repeat = repeatIdx === -1 ? 1 : Number(args[repeatIdx + 1] ?? 1);
// 흔들림을 보려면 매번 실제로 호출해야 한다. 캐시를 쓰면 같은 응답을 N번 읽을 뿐이라 의미가 없다.
const useCache = !args.includes("--no-cache") && repeat === 1;

// --repeat이 없으면 repeatIdx가 -1이라 repeatIdx+1이 0이 된다. 그대로 비교하면 첫 번째 인자가
// "--repeat의 값"으로 오인되어 필터에서 사라진다.
const repeatValueIdx = repeatIdx === -1 ? -1 : repeatIdx + 1;
const filters = args.filter((a, i) => !a.startsWith("--") && i !== repeatValueIdx);
const cases = golden.cases.filter(
  (c: any) => filters.length === 0 || filters.some((f) => c.id.includes(f)),
);
if (cases.length === 0) {
  console.error(`✗ 실행할 케이스가 없습니다. 사용 가능한 id:\n  ${golden.cases.map((c: any) => c.id).join("\n  ")}`);
  process.exit(1);
}

// 요청 본문 해시로 응답을 캐싱한다. src/records.ts를 건드리지 않으려고 fetch를 감싼다.
const realFetch = globalThis.fetch;
let cacheHits = 0;
let apiCalls = 0;
globalThis.fetch = (async (url: any, init: any) => {
  if (!useCache) {
    apiCalls++;
    return realFetch(url, init);
  }
  const key = createHash("sha256")
    .update(String(url) + String(init?.body ?? ""))
    .digest("hex")
    .slice(0, 32);
  const file = resolve(CACHE_DIR, `${key}.json`);
  if (existsSync(file)) {
    cacheHits++;
    return new Response(readFileSync(file, "utf8"), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  apiCalls++;
  const res = await realFetch(url, init);
  const text = await res.text();
  if (res.ok) {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(file, text);
  }
  return new Response(text, { status: res.status, headers: res.headers });
}) as typeof fetch;

// expect의 키는 파싱 결과의 필드명과 1:1이 아니다.
//   parts_count        → 파트 개수
//   p2.<key>, p3.<key> → 2번째/3번째 파트의 값 (접두사 없으면 첫 번째 파트)
//   laps_reps 등       → 해당 파트 laps 안의 값을 배열로 꺼낸다
//   rpe/is_team 등     → 최상위 필드는 파트가 아니라 결과 루트에서 찾는다
const ROOT_KEYS = ["rpe", "rpe_inferred", "is_team", "needs_review", "review_reason", "unmatched_text"];

function actualFor(key: string, parsed: any): unknown {
  if (key === "parts_count") return parsed.parts?.length;

  let partIndex = 0;
  const prefixed = key.match(/^p(\d+)\.(.+)$/);
  if (prefixed) {
    partIndex = Number(prefixed[1]) - 1;
    key = prefixed[2];
  }

  if (!prefixed && ROOT_KEYS.includes(key)) return parsed[key];

  const part = parsed.parts?.[partIndex];
  if (!part) return undefined;
  if (key === "laps_reps") return part.laps?.map((l: any) => l.reps);
  if (key === "laps_time_sec") return part.laps?.map((l: any) => l.time_sec);
  if (key === "laps_load") return part.laps?.map((l: any) => l.load);
  return part[key];
}

function eq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

interface CaseResult {
  id: string;
  why: string;
  record: string;
  failures: string[];
  unstable: boolean;
  parsed: unknown;
}

async function runCase(c: any): Promise<CaseResult> {
  const failures: string[] = [];
  const fingerprints = new Set<string>();
  let parsed: any;

  for (let run = 0; run < repeat; run++) {
    parsed = await parseWodRecord({ GEMINI_API_KEY: apiKey } as any, c.wod, c.class_type, c.record);

    // 재현성 확인용 지문: 단언 대상 필드만 모아서 실행 간 동일한지 본다.
    fingerprints.add(
      Object.keys(c.expect ?? {})
        .map((k) => `${k}=${JSON.stringify(actualFor(k, parsed))}`)
        .join(","),
    );

    for (const [key, want] of Object.entries(c.expect ?? {})) {
      const got = actualFor(key, parsed);
      const msg = `${key}: 기대 ${JSON.stringify(want)} / 실제 ${JSON.stringify(got)}`;
      if (!eq(got, want) && !failures.includes(msg)) failures.push(msg);
    }
    for (const key of c.expect_present ?? []) {
      const got = actualFor(key, parsed);
      const msg = `${key}: 값이 있어야 하는데 비어 있음`;
      if ((got === undefined || got === "") && !failures.includes(msg)) failures.push(msg);
    }
  }

  return {
    id: c.id,
    why: c.why,
    record: c.record,
    failures,
    unstable: repeat > 1 && fingerprints.size > 1,
    parsed,
  };
}

// 캐시 미스가 많을 때 순차 실행은 그대로 대기 시간이 된다. 소수만 동시에 돌린다.
const results: CaseResult[] = new Array(cases.length);
let next = 0;
await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, cases.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= cases.length) return;
      results[i] = await runCase(cases[i]);
    }
  }),
);

const failed = results.filter((r) => r.failures.length > 0);
const unstable = results.filter((r) => r.unstable);

for (const r of results) {
  if (r.failures.length === 0) {
    console.log(`✓ ${r.id}`);
    continue;
  }
  // 파싱 결과 전문은 화면에 쏟지 않는다(읽는 쪽 토큰도 자원이다). 어긋난 필드만 남기고 전문은 파일로.
  console.log(`✗ ${r.id}`);
  for (const f of r.failures) console.log(`    ${f}`);
  console.log(`    기록: ${r.record.replace(/\n/g, " / ").slice(0, 70)}`);
}

if (failed.length > 0) {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(
    FAILURE_DUMP,
    JSON.stringify(
      failed.map((r) => ({ id: r.id, why: r.why, record: r.record, parsed: r.parsed })),
      null,
      2,
    ),
  );
}

const passed = results.length - failed.length;
console.log(
  `\n${passed}/${results.length} 통과${repeat > 1 ? ` (각 ${repeat}회 실행)` : ""}` +
    ` · API 호출 ${apiCalls}회${cacheHits ? ` (캐시 재사용 ${cacheHits}회)` : ""}`,
);
if (unstable.length > 0) {
  console.log(`⚠ 실행마다 결과가 달라진 케이스: ${unstable.map((r) => r.id).join(", ")}`);
}
if (failed.length > 0) {
  console.log(`↳ 실패 케이스의 파싱 결과 전문: tests/.cache/last-failures.json`);
}
process.exit(failed.length > 0 ? 1 : 0);

// 기록 파싱(src/records.ts)의 골든 케이스 회귀 테스트 러너.
//
//   npm run test:records            전체 케이스 실행
//   npm run test:records -- <id>    특정 케이스만 실행
//   npm run test:records -- --repeat 3   같은 케이스를 여러 번 돌려 흔들림(재현성) 확인
//
// 실제 Gemini API를 호출하므로 네트워크와 .dev.vars의 GEMINI_API_KEY가 필요하다.
// 프롬프트 규칙을 고칠 때마다 돌려서 "개선이 실은 개악인지" 확인하는 용도다.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseWodRecord } from "../src/records.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

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
const idFilter = args.filter((a, i) => !a.startsWith("--") && i !== repeatIdx + 1);

const cases = golden.cases.filter((c: any) => idFilter.length === 0 || idFilter.includes(c.id));
if (cases.length === 0) {
  console.error(`✗ 실행할 케이스가 없습니다. 사용 가능한 id: ${golden.cases.map((c: any) => c.id).join(", ")}`);
  process.exit(1);
}

// expect의 키는 파싱 결과의 필드명과 1:1이 아니다. laps 안의 값을 꺼내 비교하는 별칭을 둔다.
function actualFor(key: string, parsed: any): unknown {
  if (key === "laps_reps") return parsed.laps?.map((l: any) => l.reps);
  if (key === "laps_time_sec") return parsed.laps?.map((l: any) => l.time_sec);
  if (key === "laps_load") return parsed.laps?.map((l: any) => l.load);
  return parsed[key];
}

function eq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

let passed = 0;
let failed = 0;
const unstable: string[] = [];

for (const c of cases) {
  const failures: string[] = [];
  const fingerprints = new Set<string>();
  let parsed: any;

  for (let run = 0; run < repeat; run++) {
    parsed = await parseWodRecord({ GEMINI_API_KEY: apiKey } as any, c.wod, c.class_type, c.record);

    // 재현성 확인용 지문: 단언 대상 필드만 모아서 실행 간 동일한지 본다.
    const fp = Object.keys(c.expect ?? {})
      .map((k) => `${k}=${JSON.stringify(actualFor(k, parsed))}`)
      .join(",");
    fingerprints.add(fp);

    for (const [key, want] of Object.entries(c.expect ?? {})) {
      const got = actualFor(key, parsed);
      if (!eq(got, want)) {
        const msg = `${key}: 기대 ${JSON.stringify(want)} / 실제 ${JSON.stringify(got)}`;
        if (!failures.includes(msg)) failures.push(msg);
      }
    }
    for (const key of c.expect_present ?? []) {
      if (parsed[key] === undefined || parsed[key] === "") {
        const msg = `${key}: 값이 있어야 하는데 비어 있음`;
        if (!failures.includes(msg)) failures.push(msg);
      }
    }
  }

  if (repeat > 1 && fingerprints.size > 1) unstable.push(c.id);

  if (failures.length === 0) {
    passed++;
    console.log(`✓ ${c.id}`);
  } else {
    failed++;
    console.log(`✗ ${c.id}  — ${c.why}`);
    for (const f of failures) console.log(`    ${f}`);
    console.log(`    기록: ${c.record}`);
    console.log(`    파싱: ${JSON.stringify(parsed)}`);
  }
}

console.log(`\n${passed}/${passed + failed} 통과${repeat > 1 ? ` (각 ${repeat}회 실행)` : ""}`);
if (unstable.length > 0) {
  console.log(`⚠ 실행마다 결과가 달라진 케이스: ${unstable.join(", ")}`);
}
process.exit(failed > 0 ? 1 : 0);

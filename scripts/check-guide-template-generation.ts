// 가이드와 기록 양식 프롬프트의 대표 실제 Gemini 회귀 검사.
// 프롬프트 계약만 확인하는 test:prompts와 달리 API를 호출하므로 필요할 때 실행한다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateWodGuide } from "../src/llm.ts";
import { generateRecordTemplate } from "../src/record-template.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const devVars = readFileSync(resolve(root, ".dev.vars"), "utf8");
const apiKey = devVars.match(/GEMINI_API_KEY\s*=\s*"?([^"\r\n]+)"?/)?.[1];
if (!apiKey) throw new Error(".dev.vars에서 GEMINI_API_KEY를 찾지 못했습니다.");
const env = { GEMINI_API_KEY: apiKey } as any;

const forTimeWod = `9-7-5
Clean & jerk (185/125)
Burpee box jump over (30/24)

Target : 6:00 Under`;
const mixedWod = `Core
3Set
20Sec hollow rock
20Sec arch hold

METCON
For time of
30 Devil Press (50 / 35 x 2)
Target : 5:00 Under`;
const liftingWod = `Low hang snatch (below knee)

Every 3:00 x 5Set
3 Low hang snatch + snatch (70-80%)`;
const intervalWod = `5Min on 2Min off x 4set
400M Run
500 / 450M Row
Remaining time, max double under
Target : 50++`;

const [guide, mixedGuide, liftingTemplate, intervalTemplate] = await Promise.all([
  generateWodGuide(env, forTimeWod, "CF Class"),
  generateWodGuide(env, mixedWod, "CF Class"),
  generateRecordTemplate(env, liftingWod, "Weightlifting Class"),
  generateRecordTemplate(env, intervalWod, "CF Class"),
]);

assert.equal(guide.workout_type, "For Time");
assert.match(guide.target_explanation, /총 3라운드|3라운드/);
assert.doesNotMatch(guide.target_explanation, /9-7-5 라운드/);
assert.ok(guide.safety_note);
assert.equal(guide.parts[0]?.part_type, "metcon");
assert.ok(guide.parts.flatMap((part) => part.movements).every((movement) => movement.coach_check_required));
const scalingText = guide.parts.flatMap((part) => part.movements).map((movement) => movement.scaling_tip).join(" ");
assert.doesNotMatch(scalingText, /1RM의?\s*50|20인치(?:를|가)?\s*(?:사용|선택|권장)/);

assert.ok(mixedGuide.parts.some((part) => part.part_type === "accessory"));
assert.ok(mixedGuide.parts.some((part) => part.part_type === "metcon"));
assert.doesNotMatch(mixedGuide.parts.find((part) => part.part_type === "accessory")?.label ?? "", /웜업/i);

assert.match(liftingTemplate, /1세트 무게\(숫자\+kg\/lb\):/);
assert.match(liftingTemplate, /5세트 무게\(숫자\+kg\/lb\):/);
assert.match(liftingTemplate, /수행 방식\(Rx\/스케일\/모름\):/);

assert.match(intervalTemplate, /1세트 횟수\(회\):/);
assert.match(intervalTemplate, /4세트 횟수\(회\):/);
assert.match(intervalTemplate, /남은 횟수\(있을 때만\):/);

console.log("✓ For Time 초보자 안전 가이드");
console.log("✓ Core와 METCON 파트 분리");
console.log("✓ 역도 세트별 중량 양식");
console.log("✓ 인터벌 세트별 횟수·단위 양식");

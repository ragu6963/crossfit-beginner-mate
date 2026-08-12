import assert from "node:assert/strict";
import { buildGuideSystemInstruction } from "../src/llm.ts";
import { assembleTemplate, buildTemplateSystemInstruction, type TemplatePart } from "../src/record-template.ts";
import { buildRecordSystemInstruction } from "../src/records.ts";

const guidePrompt = buildGuideSystemInstruction();
assert.match(guidePrompt, /자세\(mechanics\).*일관성\(consistency\).*강도\(intensity\)/);
assert.match(guidePrompt, /고정 숫자로 단정하지 마세요/);
assert.match(guidePrompt, /Core를 자동으로 웜업이라 부르지 않습니다/);
assert.match(guidePrompt, /needs_review=true/);
assert.doesNotMatch(guidePrompt, /1RM의 50~60%|20인치 박스|바닥에 머무는 시간을 1초/);

const recordPrompt = buildRecordSystemInstruction();
assert.match(recordPrompt, /score_type.*result_status/s);
assert.match(recordPrompt, /time_capped.*stopped.*incomplete/s);
assert.match(recordPrompt, /숫자로 직접 적은 경우에만 넣는다/);
assert.match(recordPrompt, /슬래시 처방값 중 한 숫자와 일치한다는 사실만으로/);

const templatePrompt = buildTemplateSystemInstruction();
assert.match(templatePrompt, /sets뿐 아니라 세트별 중량을 남기는 load 파트에도 적용/);
assert.match(templatePrompt, /value_type과 value_unit/);
assert.match(templatePrompt, /파트 제목은 자르지 않는다/);

const parts: TemplatePart[] = [
  {
    label: "Weightlifting",
    score_type: "load",
    has_numeric_score: true,
    set_count: 3,
    value_type: "load",
    value_unit: "kg/lb",
    primary_movement: "Low hang snatch",
  },
  {
    label: "METCON",
    score_type: "rounds_reps",
    has_numeric_score: true,
    set_count: 0,
    value_type: "rounds_reps",
    value_unit: "라운드+추가 반복",
    primary_movement: "",
  },
];

const template = assembleTemplate(parts);
assert.match(template, /1세트 무게\(숫자\+kg\/lb\):/);
assert.match(template, /3세트 무게\(숫자\+kg\/lb\):/);
assert.match(template, /완료 라운드:/);
assert.match(template, /추가 반복\(회\):/);
assert.equal((template.match(/수행 방식\(Rx\/스케일\/모름\):/g) || []).length, 2);
assert.equal((template.match(/스케일링 내용:/g) || []).length, 2);
assert.match(template, /체감 강도 RPE\(1=매우 쉬움, 10=더 수행 불가\):/);

const noScoreTemplate = assembleTemplate([
  {
    label: "Core",
    score_type: "none",
    has_numeric_score: false,
    set_count: 0,
    value_type: "none",
    value_unit: "없음",
    primary_movement: "",
  },
]);
assert.match(noScoreTemplate, /수행 메모:/);
assert.doesNotMatch(noScoreTemplate, /총 횟수|기록\(시간\)/);

console.log("✓ 가이드 안전 규칙");
console.log("✓ 기록 의미 분리 규칙");
console.log("✓ 초보자용 기록 양식 계약");

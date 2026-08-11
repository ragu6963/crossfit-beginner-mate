import type { Env } from "./types";

const GEMINI_MODEL = "gemini-3.6-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// 기록 파싱은 "원문에 있는 값을 꺼내는" 추출 작업이므로 창작 여지가 필요 없다. 가이드 생성(0.3)과 달리
// 0을 써서 같은 입력에 항상 같은 구조가 나오게 한다. 다만 temperature 0은 재현성을 줄 뿐 정확성을
// 보장하지 않으므로(일관되게 틀릴 수 있다), 정확성은 아래 판단 규칙과 골든 케이스 회귀 테스트로 잡는다.
const RECORD_TEMPERATURE = 0;

// 파싱 규칙/모델이 바뀌면 이 값을 올린다. parsed_record에 함께 저장해두면 나중에 "v1으로 파싱된
// 기록만 재파싱" 같은 선택적 재처리가 가능해진다. 원본(raw_record)이 항상 남아 있으므로 재파싱은
// 몇 번이든 안전하다.
//
// v2: 스코어를 파트 배열(parts)로 바꿨다. 실제 기록해보니 한 세션의 와드가 "Find 1Rep max
// weighted pull up"(스트렝스) + "2Min on/1Min off"(메트콘)처럼 성격이 다른 파트로 나뉘는 경우가
// 흔한데, v1은 세션당 스코어 하나만 담을 수 있어 한쪽이 통째로 버려졌다.
// v3: score_type에 unscored를 추가했다. v2는 수치 스코어가 있는 파트만 담아서, "가중 풀업은
// 못해서 밴드로 대체"처럼 수행 사실과 스케일링만 적힌 파트가 unmatched_text로 버려졌다.
// v4: 미완료를 기록에 명시했는데도 needs_review가 계속 붙던 문제를 고쳤다(경고가 상시 표시되면
// 경고를 읽지 않게 된다). score_display 길이 제한도 함께 넣었다.
// v5: 기록을 빈 화면이 아니라 입력 뼈대(record-template.ts) 위에 쓰게 되면서, 채워지지 않은
// 항목이 그대로 저장된다. 빈 항목을 "언급됨"으로 보면 유령 파트가 생기므로 무시하도록 했다.
export const RECORD_PARSER_VERSION = 5;

// "unscored"는 그 파트를 수행하긴 했지만 수치 스코어가 남지 않은 경우다(예: 가중 풀업을 밴드
// 보조로 대체해서 중량이 없음). 이 값이 없던 v2에서는 해당 파트가 파트로 잡히지 못하고
// unmatched_text로 버려졌는데, 밴드 보조 → 무보조 같은 전환은 초보자 성장의 핵심 신호라
// 반드시 파트로 남아야 한다.
export const SCORE_TYPES = ["unscored", "load", "sets", "rounds_reps", "time", "reps", "distance"] as const;
export type ScoreType = (typeof SCORE_TYPES)[number];

export interface RecordLap {
  index: number;
  reps?: number;
  time_sec?: number;
  load?: number;
  note?: string;
}

export interface RecordMovement {
  name_en: string;
  reps?: number;
  load?: number;
  load_unit?: "kg" | "lb";
}

// 와드의 한 파트(스트렝스 / METCON / Core 등)에 대한 결과. 파트마다 스코어 성격이 다르므로
// score_type과 Rx 여부도 파트 단위로 판정한다.
export interface RecordPart {
  label: string;
  score_type: ScoreType;
  score_display: string;
  score_seconds?: number;
  score_reps?: number;
  score_rounds?: number;
  score_load?: number;
  score_load_unit?: "kg" | "lb";
  laps: RecordLap[];
  laps_movement?: string;
  movements: RecordMovement[];
  rx_level: "rx" | "scaled" | "unknown";
  scaling_detail?: string;
  capped: boolean;
  reps_remaining?: number;
}

export interface ParsedRecord {
  parser_version: number;
  parts: RecordPart[];
  // 체감·팀 여부는 파트가 아니라 그날 세션 전체의 속성이라 최상위에 둔다.
  rpe?: number;
  rpe_inferred?: boolean;
  is_team: boolean;
  needs_review: boolean;
  review_reason?: string;
  unmatched_text?: string;
}

const PART_SCHEMA = {
  type: "OBJECT",
  properties: {
    label: {
      type: "STRING",
      description:
        "와드 원문에 적힌 파트 제목을 그대로 쓴다(예: 'Core', 'METCON', 'Find 1Rep max weighted pull up'). 파트 제목이 따로 없으면 빈 문자열.",
    },
    // enum으로 값 집합을 못박아 "For Time" / "for_time" / "time" 같은 표기 흔들림을 원천 차단한다.
    score_type: { type: "STRING", enum: SCORE_TYPES },
    score_display: { type: "STRING" },
    // 타입에 해당하는 필드만 채운다. 하나의 다형 필드(score_primary)로 합치면 단위가 매번 흔들려서,
    // 타입별로 이름과 단위가 고정된 별도 필드로 나눴다.
    score_seconds: { type: "INTEGER" },
    score_reps: {
      type: "INTEGER",
      description:
        "총 반복 횟수. reps 타입이거나, sets 타입에서 세트별 횟수의 합계를 알 수 있으면 그 합계를 넣는다. 해당 없으면 0.",
    },
    score_rounds: { type: "INTEGER" },
    score_load: { type: "NUMBER" },
    score_load_unit: { type: "STRING", enum: ["kg", "lb"] },
    laps: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          index: { type: "INTEGER" },
          reps: { type: "INTEGER" },
          time_sec: { type: "INTEGER" },
          load: { type: "NUMBER" },
          note: { type: "STRING" },
        },
        required: ["index"],
      },
    },
    // 실제 기록에서 "4/4/3/1/1/2"가 무엇의 횟수인지가 구조화 결과에 전혀 남지 않는 문제가 있었다.
    laps_movement: {
      type: "STRING",
      description:
        "laps의 숫자가 어떤 동작의 횟수·시간인지(예: 'Burpee pull up'). 기록이나 와드 원문에서 알 수 있으면 반드시 채운다. laps가 비어 있거나 어떤 동작인지 알 수 없을 때만 빈 문자열.",
    },
    movements: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name_en: { type: "STRING" },
          reps: { type: "INTEGER" },
          load: { type: "NUMBER" },
          load_unit: { type: "STRING", enum: ["kg", "lb"] },
        },
        required: ["name_en"],
      },
    },
    rx_level: { type: "STRING", enum: ["rx", "scaled", "unknown"] },
    scaling_detail: { type: "STRING" },
    capped: { type: "BOOLEAN" },
    // 프롬프트 본문에만 규칙을 적었을 때는 이 값이 unmatched_text로 새어 나갔다. 스키마 필드에 직접
    // 붙은 description이 더 강하게 작동해서, 자주 누락되는 필드는 여기에 설명을 붙여 고정한다.
    reps_remaining: {
      type: "INTEGER",
      description:
        "타임캡에 걸려 완주하지 못했을 때 남은 횟수. 기록에 '5개 남기고', 'CAP+5', '5개 못 채움' 등으로 적혀 있으면 그 숫자를 반드시 여기에 넣는다. 캡에 걸리지 않았거나 남은 횟수를 알 수 없으면 0.",
    },
  },
  required: [
    "label",
    "score_type",
    "score_display",
    "laps",
    "movements",
    "rx_level",
    "capped",
    // 선택 필드로 두면 모델이 조용히 비워버려서(실측으로 확인) 정보가 새거나 실행마다 값이
    // 들쭉날쭉해진다. 반드시 판단해야 하는 값은 required로 강제하고, 해당 없을 때의 기본값을
    // description에 못박는다. score_reps/laps_movement도 같은 이유로 여기에 있다.
    "reps_remaining",
    "score_reps",
    "laps_movement",
  ],
} as const;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    parts: { type: "ARRAY", items: PART_SCHEMA },
    rpe: { type: "INTEGER" },
    rpe_inferred: { type: "BOOLEAN" },
    is_team: { type: "BOOLEAN" },
    needs_review: { type: "BOOLEAN" },
    review_reason: { type: "STRING" },
    unmatched_text: {
      type: "STRING",
      description:
        "다른 어떤 필드에도 반영하지 못한 기록 조각만 넣는다. 남은 횟수·스케일링 내용처럼 전용 필드가 있는 정보는 여기에 넣지 말고 그 필드로 옮긴다.",
    },
  },
  required: ["parts", "is_team", "needs_review"],
} as const;

function buildPrompt(rawWod: string, classType: string, rawRecord: string): string {
  return `당신은 크로스핏 기록 파서입니다. "와드 원문"을 맥락으로 삼아 "내 기록"을 JSON으로 구조화하세요.
기록은 박스 화이트보드에 적듯 자유롭게 쓰인 짧은 메모입니다. 추측으로 값을 지어내지 말고, 원문에 있는 것만 옮기세요.

# 빈칸 처리 (기록은 미리 채워진 입력 뼈대 위에 작성됩니다)
기록 입력칸에는 "무게: ", "1세트: ", "스케일링: " 같은 빈칸 서식이 미리 들어가 있고, 사용자는 그중 해당하는 칸만 채웁니다.
- **값이 비어 있는 항목은 없는 것으로 취급한다.** 그 파트를 수행하지 않았거나 기록하지 않은 것이므로 파트로 만들지 않고, unmatched_text에도 넣지 않는다.
- 항목 이름만 있고 값이 없는 줄 때문에 파트나 랩을 만들어내면 안 된다. 값이 채워진 항목만 근거로 삼는다.
- 모든 항목이 비어 있으면 파트를 만들 수 없으므로 needs_review를 true로 하고 review_reason에 값이 비어 있다고 적는다.

# 파트 분리 (가장 먼저 판단한다)
와드 원문은 성격이 다른 여러 파트로 나뉘는 경우가 많다(예: "Find 1Rep max weighted pull up" 같은 스트렝스 파트 + 인터벌 메트콘, 또는 "Core" + "METCON"). 파트마다 스코어의 성격이 다르므로 각각을 parts 배열에 원문 순서대로 담는다.
- **기록에 언급된 파트는 모두 담는다.** 수치 스코어가 없어도 수행 사실이나 스케일링·실패가 적혀 있으면 파트로 담고, score_type을 unscored로 둔다(예: "가중 풀업은 못해서 밴드로 대체" → label은 해당 파트, score_type=unscored, rx_level=scaled, scaling_detail에 밴드 대체 내용). 이런 내용을 unmatched_text로 흘려보내면 안 된다.
- 와드에 있지만 기록에 아무 언급도 없는 파트는 넣지 않는다(수행 여부를 지어내지 말 것).
- **다만 스케일링·대체 언급만으로 새 파트를 만들지는 않는다.** unscored 파트는 (a) 그 파트의 제목이 기록에 언급되었거나, (b) 그 파트에만 등장하는 동작이 언급되었을 때만 만든다. 어느 파트의 것인지 분명하지 않은 스케일링 언급은 그 동작이 등장하는 파트의 scaling_detail에 넣는다.
- 비슷한 동작명이 여러 파트에 걸쳐 나오면(예: 스트렝스의 "weighted pull up"과 메트콘의 "burpee pull up") 그 언급이 기록에서 놓인 위치와 앞뒤 문맥을 따른다. 메트콘 기록 줄 옆에 붙은 대체 언급은 메트콘의 것이다.
- 와드가 한 덩어리이거나 기록이 한 파트만 다루면 parts는 원소 하나짜리 배열이다.
- score_type, Rx/스케일링, 타임캡은 파트마다 따로 판정한다. 체감(rpe)과 팀 여부(is_team)는 세션 전체 속성이므로 최상위에만 둔다.

# score_type 판정 (파트마다 각각)
score_type은 **와드 원문의 구조만으로** 정한다. 내 기록이 어떻게 쓰였는지는 판정에 영향을 주지 않는다.
기록에 세트별 숫자 없이 총합만 적혀 있어도 판정은 달라지지 않는다. 같은 와드는 그날 기록을 어떻게
적었든 항상 같은 score_type이어야 한다(그래야 나중에 같은 와드끼리 비교할 수 있다).
아래를 위에서부터 순서대로 검사하고, 처음 해당하는 것 하나만 고른다. 여러 개에 해당해 보이면 항상 번호가 작은 쪽이다.
0. unscored — 그 파트를 수행했다는 언급은 있으나 수치 스코어가 기록되지 않은 경우(중량·시간·횟수 어느 것도 없음). score_display에는 "밴드 보조로 대체"처럼 기록 원문의 표현을 그대로 옮긴다.
1. load — 와드가 중량 자체를 겨루는 경우(Strength/Weightlifting, %나 RM 표기, "Find 1RM"). 스코어는 kg/lb.
   **"Every 3:00 x 5Set"처럼 세트 구조로 진행되더라도, 세트마다 남는 결과가 든 무게라면 sets가 아니라 load다.**
2. sets — 세트·인터벌마다 개별 스코어가 남되 그 스코어가 중량이 아닌 경우("N Min on M Min off x K set",
   "Every N:00 x K Set", EMOM). 세트별 시간이나 횟수가 결과로 남으면 이쪽이며, 아래 3~5보다 우선한다.
3. rounds_reps — 정해진 시간 안에 최대한 많이 반복(AMRAP). 스코어는 "N라운드 + M렙".
4. time — 정해진 분량을 모두 끝내는 데 걸린 시간(For Time, 9-7-5 같은 렙 스킴, Chipper).
5. reps — 단일 구간에서 총 횟수만 재는 경우(Max reps).
6. distance — 거리나 칼로리를 재는 경우.

# 값 규칙
- score_display는 사람이 읽을 요약이며 기록 원문의 표기를 최대한 살린다(예: "5:42", "4R+12", "75kg", "48/45/47/47"). 화면에서 배지 하나로 표시되므로 **15자 이내로 짧게** 쓰고, 자세한 내용은 scaling_detail 등 전용 필드에 넣는다(unscored 파트도 "밴드 보조로 대체"처럼 짧게).
- 시간은 초로 환산해 score_seconds에 넣는다("5:42"→342, "1:02:30"→3750). 타입이 sets면 세트별 시간은 laps[].time_sec에 넣는다.
- score_rounds(라운드 수), score_load(중량)는 해당 타입일 때만 채운다. score_reps(총 횟수)는 reps 타입일 때뿐 아니라 **sets 타입에서 세트별 횟수의 합계를 알 수 있으면 그 합계를 채운다**(나중에 세션 간 비교에 쓴다).
- laps는 세트/랩별 숫자가 기록에 있을 때만 채운다. index는 1부터 시작한다.
  score_type이 load이고 세트별로 다른 무게가 적혀 있으면 각 무게를 laps[].load에 넣고, score_load에는 그중 가장 무거운 값(그날의 최고 중량)을 넣는다.
- laps를 채웠으면 laps_movement에 그 숫자가 어떤 동작의 횟수·시간인지 적는다. 기록에 "로잉 - 푸시업 - 버피 풀업 기록"처럼 단서가 있거나 와드 원문에서 유추할 수 있으면 반드시 채운다.
- movements는 기록에서 특정 동작의 무게·횟수를 알 수 있을 때만 채운다. 동작명은 와드 원문의 영문 표기를 그대로 쓴다.

# Rx / 스케일링 판정 (자주 틀리는 부분이니 주의)
- 크로스핏 와드의 "(185/125)", "(30/24)", "(50/35 x 2)", "500 / 450M" 같은 슬래시 표기는 남성/여성 처방(Rx)이다.
  둘 중 한쪽 값을 그대로 수행한 것은 **Rx이며 스케일링이 아니다**. rx_level은 "rx"로 판정한다.
- rx_level이 "scaled"인 경우는 처방보다 무게/높이/거리를 낮췄거나, 다른 동작으로 대체했을 때뿐이다.
  이때 scaling_detail에 무엇을 어떻게 바꿨는지 기록 원문 표현으로 적는다.
- 기록에 판단 근거가 전혀 없으면 "unknown"으로 두고, 임의로 rx라고 단정하지 않는다.
- 무게 단위가 기록에 명시되면(kg/lb) 그대로 쓴다. 명시가 없으면 와드 원문의 표기를 따르되, 이때는 needs_review를 true로 한다.

# 그 밖의 필드
- is_team(최상위): 와드 원문이 팀 와드("Team of N", "In pairs")이면 true. 팀 기록은 개인 기량과 다르므로 반드시 표시한다.
- capped: 시간 제한에 걸려 완주하지 못했으면 true(타임캡, "캡", "컷오프", "못 끝냄" 등).
  이때 score_seconds에는 완주 시간이 아니라 걸린 타임캡 시간을 넣고, 남은 횟수가 적혀 있으면 reps_remaining에 넣는다.
  캡에 걸린 기록과 완주한 기록은 성격이 다르므로, 남은 횟수를 unmatched_text에 흘려보내지 말고 반드시 이 필드로 옮긴다.
- rpe(최상위): 힘들었다/수월했다 같은 체감 표현이 있으면 1~10으로 추정하고 rpe_inferred를 true로 한다. 표현이 없으면 생략한다.
- unmatched_text: 위 필드 어디에도 반영하지 못한 기록 원문 조각을 그대로 옮긴다. 없으면 생략한다.

# needs_review 판정 (스스로 "애매하다"고 느낄 때가 아니라, 아래 조건에 하나라도 걸리면 기계적으로 true)
- 기록의 세트/랩 숫자 개수가 와드 원문의 세트 수와 다르다.
- 기록에 와드 원문에 없는 동작이 등장하는데, 그것이 대체 동작이라는 설명이 없다.
  (스케일링으로 대체한 동작은 원래 와드에 없는 게 당연하다. scaling_detail에 담았다면 이 조건에 해당하지 않는다.)
- 무게 숫자에 단위 표기가 없다.
- score_type을 1~6 중 하나로 확정할 근거가 와드 원문에 없다.
- 기록이 너무 짧거나 모호해서 어떤 수치인지 특정할 수 없다.
- 와드에 완료 기준이 정해져 있는데("Until 60Rep", "For time of", 총 렙 스킴 등) 기록의 합계가 그에 미치지 못하고, 완주했는지 중간에 끝났는지 기록만으로 알 수 없다.
  단, 기록에 "다 못했다", "중단", "타임캡" 처럼 미완료가 **명시되어 있으면 이 조건에 해당하지 않는다.** 그 사실은 capped와 reps_remaining으로 이미 표현되므로 needs_review를 올리지 않는다. 확인이 필요 없는 기록에까지 경고가 붙으면 경고 자체를 무시하게 된다.
- 와드에 파트가 여러 개인데 기록이 일부 파트만 다루고 있어, 나머지 파트를 수행했는지 알 수 없다.
  단, 입력 뼈대의 항목이 빈칸으로 남아 그 파트가 빠진 경우는 해당하지 않는다(빈칸은 의도적으로 비운 것으로 본다).
위에 걸리면 review_reason에 어떤 조건인지 한 문장으로 적는다. 걸리지 않으면 needs_review는 false다.

# 와드 원문 (class_type: ${classType})
${rawWod}

# 내 기록
${rawRecord}

위 기록만 JSON으로 출력하세요.`;
}

export async function parseWodRecord(
  env: Env,
  rawWod: string,
  classType: string,
  rawRecord: string,
): Promise<ParsedRecord> {
  const response = await fetch(GEMINI_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": env.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: buildPrompt(rawWod, classType, rawRecord) }] }],
      generationConfig: {
        temperature: RECORD_TEMPERATURE,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Gemini API 요청 실패 (${response.status}): ${detail.slice(0, 300)}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Gemini API 응답에서 텍스트를 찾을 수 없습니다.");
  }

  let parsed: ParsedRecord;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Gemini API 응답이 유효한 JSON이 아닙니다.");
  }

  // 파트가 0개인 것은 오류가 아니다. 입력 뼈대를 한 칸도 채우지 않고 저장하면 담을 파트가 없는 게
  // 정상이며, 이때는 예외를 던지는 대신 needs_review로 "값이 비어 있다"고 알려주는 편이 낫다.
  if (!Array.isArray(parsed.parts)) {
    throw new Error("Gemini API 응답이 예상된 기록 스키마와 일치하지 않습니다.");
  }
  if (parsed.parts.some((p) => typeof p?.score_type !== "string" || !SCORE_TYPES.includes(p.score_type))) {
    throw new Error("Gemini API 응답이 예상된 기록 스키마와 일치하지 않습니다.");
  }

  return {
    ...parsed,
    parser_version: RECORD_PARSER_VERSION,
    parts: parsed.parts.map((p) => ({
      ...p,
      label: p.label ?? "",
      score_display: String(p.score_display ?? ""),
      laps: Array.isArray(p.laps) ? p.laps : [],
      movements: Array.isArray(p.movements) ? p.movements : [],
      rx_level: p.rx_level ?? "unknown",
      capped: p.capped ?? false,
    })),
    is_team: parsed.is_team ?? false,
    needs_review: parsed.parts.length === 0 ? true : (parsed.needs_review ?? false),
    review_reason:
      parsed.parts.length === 0
        ? (parsed.review_reason ?? "기록에 채워진 값이 없습니다.")
        : parsed.review_reason,
  };
}

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
export const RECORD_PARSER_VERSION = 1;

export const SCORE_TYPES = ["load", "sets", "rounds_reps", "time", "reps", "distance"] as const;
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

export interface ParsedRecord {
  parser_version: number;
  score_type: ScoreType;
  score_display: string;
  score_seconds?: number;
  score_reps?: number;
  score_rounds?: number;
  score_load?: number;
  score_load_unit?: "kg" | "lb";
  laps: RecordLap[];
  movements: RecordMovement[];
  rx_level: "rx" | "scaled" | "unknown";
  scaling_detail?: string;
  rpe?: number;
  rpe_inferred?: boolean;
  is_team: boolean;
  capped: boolean;
  reps_remaining?: number;
  needs_review: boolean;
  review_reason?: string;
  unmatched_text?: string;
}

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    // enum으로 값 집합을 못박아 "For Time" / "for_time" / "time" 같은 표기 흔들림을 원천 차단한다.
    score_type: { type: "STRING", enum: SCORE_TYPES },
    score_display: { type: "STRING" },
    // 타입에 해당하는 필드만 채운다. 하나의 다형 필드(score_primary)로 합치면 단위가 매번 흔들려서,
    // 타입별로 이름과 단위가 고정된 별도 필드로 나눴다.
    score_seconds: { type: "INTEGER" },
    score_reps: { type: "INTEGER" },
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
    rpe: { type: "INTEGER" },
    rpe_inferred: { type: "BOOLEAN" },
    is_team: { type: "BOOLEAN" },
    capped: { type: "BOOLEAN" },
    // 프롬프트 본문에만 규칙을 적었을 때는 이 값이 unmatched_text로 새어 나갔다. 스키마 필드에 직접
    // 붙은 description이 더 강하게 작동해서, 자주 누락되는 필드는 여기에 설명을 붙여 고정한다.
    reps_remaining: {
      type: "INTEGER",
      description:
        "타임캡에 걸려 완주하지 못했을 때 남은 횟수. 기록에 '5개 남기고', 'CAP+5', '5개 못 채움' 등으로 적혀 있으면 그 숫자를 반드시 여기에 넣는다. 캡에 걸리지 않았거나 남은 횟수를 알 수 없으면 0.",
    },
    needs_review: { type: "BOOLEAN" },
    review_reason: { type: "STRING" },
    unmatched_text: {
      type: "STRING",
      description:
        "다른 어떤 필드에도 반영하지 못한 기록 조각만 넣는다. 남은 횟수·스케일링 내용처럼 전용 필드가 있는 정보는 여기에 넣지 말고 그 필드로 옮긴다.",
    },
  },
  required: [
    "score_type",
    "score_display",
    "laps",
    "movements",
    "rx_level",
    "is_team",
    "capped",
    // 선택 필드로 두면 모델이 조용히 비워버려서(실측으로 확인) unmatched_text로 정보가 새어 나간다.
    // 반드시 판단해야 하는 값은 required로 강제하고, 해당 없을 때의 기본값을 description에 못박는다.
    "reps_remaining",
    "needs_review",
  ],
} as const;

function buildPrompt(rawWod: string, classType: string, rawRecord: string): string {
  return `당신은 크로스핏 기록 파서입니다. "와드 원문"을 맥락으로 삼아 "내 기록"을 JSON으로 구조화하세요.
기록은 박스 화이트보드에 적듯 자유롭게 쓰인 짧은 메모입니다. 추측으로 값을 지어내지 말고, 원문에 있는 것만 옮기세요.

# score_type 판정
score_type은 **와드 원문의 구조만으로** 정한다. 내 기록이 어떻게 쓰였는지는 판정에 영향을 주지 않는다.
기록에 세트별 숫자 없이 총합만 적혀 있어도 판정은 달라지지 않는다. 같은 와드는 그날 기록을 어떻게
적었든 항상 같은 score_type이어야 한다(그래야 나중에 같은 와드끼리 비교할 수 있다).
아래를 위에서부터 순서대로 검사하고, 처음 해당하는 것 하나만 고른다. 여러 개에 해당해 보이면 항상 번호가 작은 쪽이다.
1. load — 와드가 중량 자체를 겨루는 경우(Strength/Weightlifting, %나 RM 표기, "Find 1RM"). 스코어는 kg/lb.
   **"Every 3:00 x 5Set"처럼 세트 구조로 진행되더라도, 세트마다 남는 결과가 든 무게라면 sets가 아니라 load다.**
2. sets — 세트·인터벌마다 개별 스코어가 남되 그 스코어가 중량이 아닌 경우("N Min on M Min off x K set",
   "Every N:00 x K Set", EMOM). 세트별 시간이나 횟수가 결과로 남으면 이쪽이며, 아래 3~5보다 우선한다.
3. rounds_reps — 정해진 시간 안에 최대한 많이 반복(AMRAP). 스코어는 "N라운드 + M렙".
4. time — 정해진 분량을 모두 끝내는 데 걸린 시간(For Time, 9-7-5 같은 렙 스킴, Chipper).
5. reps — 단일 구간에서 총 횟수만 재는 경우(Max reps).
6. distance — 거리나 칼로리를 재는 경우.

# 값 규칙
- score_display는 사람이 읽을 요약이며 기록 원문의 표기를 최대한 살린다(예: "5:42", "4R+12", "75kg", "48/45/47/47").
- 시간은 초로 환산해 score_seconds에 넣는다("5:42"→342, "1:02:30"→3750). 타입이 sets면 세트별 시간은 laps[].time_sec에 넣는다.
- score_reps(총 횟수), score_rounds(라운드 수), score_load(중량)는 해당 타입일 때만 채우고 나머지는 생략한다.
- laps는 세트/랩별 숫자가 기록에 있을 때만 채운다. index는 1부터 시작한다.
  score_type이 load이고 세트별로 다른 무게가 적혀 있으면 각 무게를 laps[].load에 넣고, score_load에는 그중 가장 무거운 값(그날의 최고 중량)을 넣는다.
- movements는 기록에서 특정 동작의 무게·횟수를 알 수 있을 때만 채운다. 동작명은 와드 원문의 영문 표기를 그대로 쓴다.

# Rx / 스케일링 판정 (자주 틀리는 부분이니 주의)
- 크로스핏 와드의 "(185/125)", "(30/24)", "(50/35 x 2)", "500 / 450M" 같은 슬래시 표기는 남성/여성 처방(Rx)이다.
  둘 중 한쪽 값을 그대로 수행한 것은 **Rx이며 스케일링이 아니다**. rx_level은 "rx"로 판정한다.
- rx_level이 "scaled"인 경우는 처방보다 무게/높이/거리를 낮췄거나, 다른 동작으로 대체했을 때뿐이다.
  이때 scaling_detail에 무엇을 어떻게 바꿨는지 기록 원문 표현으로 적는다.
- 기록에 판단 근거가 전혀 없으면 "unknown"으로 두고, 임의로 rx라고 단정하지 않는다.
- 무게 단위가 기록에 명시되면(kg/lb) 그대로 쓴다. 명시가 없으면 와드 원문의 표기를 따르되, 이때는 needs_review를 true로 한다.

# 그 밖의 필드
- is_team: 와드 원문이 팀 와드("Team of N", "In pairs")이면 true. 팀 기록은 개인 기량과 다르므로 반드시 표시한다.
- capped: 시간 제한에 걸려 완주하지 못했으면 true(타임캡, "캡", "컷오프", "못 끝냄" 등).
  이때 score_seconds에는 완주 시간이 아니라 걸린 타임캡 시간을 넣고, 남은 횟수가 적혀 있으면 reps_remaining에 넣는다.
  캡에 걸린 기록과 완주한 기록은 성격이 다르므로, 남은 횟수를 unmatched_text에 흘려보내지 말고 반드시 이 필드로 옮긴다.
- rpe: 힘들었다/수월했다 같은 체감 표현이 있으면 1~10으로 추정하고 rpe_inferred를 true로 한다. 표현이 없으면 생략한다.
- unmatched_text: 위 필드 어디에도 반영하지 못한 기록 원문 조각을 그대로 옮긴다. 없으면 생략한다.

# needs_review 판정 (스스로 "애매하다"고 느낄 때가 아니라, 아래 조건에 하나라도 걸리면 기계적으로 true)
- 기록의 세트/랩 숫자 개수가 와드 원문의 세트 수와 다르다.
- 기록에 와드 원문에 없는 동작이 등장한다.
- 무게 숫자에 단위 표기가 없다.
- score_type을 1~6 중 하나로 확정할 근거가 와드 원문에 없다.
- 기록이 너무 짧거나 모호해서 어떤 수치인지 특정할 수 없다.
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

  if (
    typeof parsed.score_type !== "string" ||
    !SCORE_TYPES.includes(parsed.score_type) ||
    typeof parsed.score_display !== "string"
  ) {
    throw new Error("Gemini API 응답이 예상된 기록 스키마와 일치하지 않습니다.");
  }

  return {
    ...parsed,
    parser_version: RECORD_PARSER_VERSION,
    laps: Array.isArray(parsed.laps) ? parsed.laps : [],
    movements: Array.isArray(parsed.movements) ? parsed.movements : [],
    rx_level: parsed.rx_level ?? "unknown",
    is_team: parsed.is_team ?? false,
    capped: parsed.capped ?? false,
    needs_review: parsed.needs_review ?? false,
  };
}

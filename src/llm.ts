import type { Env } from "./types";

const GEMINI_MODEL = "gemini-3.1-flash-lite";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export interface ParsedGuide {
  workout_type: string;
  target_explanation: string;
  warmup_movements?: Array<{ name_en: string; name_kr: string; description: string; scaling_tip: string }>;
  movements: Array<{ name_en: string; name_kr: string; description: string; scaling_tip: string }>;
  key_tips: string[];
  cooldown_stretches: Array<{ stretch_name: string; target_muscle: string; youtube_search_keyword: string }>;
}

// Gemini structured output(responseSchema)에 맞춘 OpenAPI 서브셋 스키마. LLM이 필드를 빠뜨리거나
// 형태를 바꾸는 것을 방지해 프론트엔드(renderGuide)가 항상 같은 모양의 JSON을 받도록 강제한다.
const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    workout_type: { type: "STRING" },
    target_explanation: { type: "STRING" },
    warmup_movements: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name_en: { type: "STRING" },
          name_kr: { type: "STRING" },
          description: { type: "STRING" },
          scaling_tip: { type: "STRING" },
        },
        required: ["name_en", "name_kr", "description", "scaling_tip"],
      },
    },
    movements: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name_en: { type: "STRING" },
          name_kr: { type: "STRING" },
          description: { type: "STRING" },
          scaling_tip: { type: "STRING" },
        },
        required: ["name_en", "name_kr", "description", "scaling_tip"],
      },
    },
    key_tips: { type: "ARRAY", items: { type: "STRING" } },
    cooldown_stretches: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          stretch_name: { type: "STRING" },
          target_muscle: { type: "STRING" },
          youtube_search_keyword: { type: "STRING" },
        },
        required: ["stretch_name", "target_muscle", "youtube_search_keyword"],
      },
    },
  },
  required: ["workout_type", "target_explanation", "movements", "key_tips", "cooldown_stretches"],
} as const;

// 실제 운영 중인 더미 데이터(2026-08-06)를 few-shot 예시로 사용해 출력 톤/분량/스타일을 고정한다.
const EXAMPLE_RAW_WOD = `9-7-5\nClean & jerk (185/125)\nBurpee box jump over (30/24)\n\nTarget : 6:00 Under`;
const EXAMPLE_CLASS_TYPE = "CF Class";
const EXAMPLE_OUTPUT: ParsedGuide = {
  workout_type: "For Time",
  target_explanation:
    "9-7-5 라운드로 클린 앤 저크와 버피 박스 점프 오버를 수행합니다. 라운드가 줄어들수록 반복 수도 줄어드니, 초반에 무리하지 않고 목표 시간(6분) 안에 끝내는 것을 목표로 페이스를 조절하세요.",
  movements: [
    {
      name_en: "Clean & Jerk",
      name_kr: "클린 앤 저크",
      description: "바벨을 바닥에서 어깨로 들어올린 뒤(클린), 다시 머리 위로 밀어 올리는(저크) 두 동작이 이어진 리프팅 동작입니다.",
      scaling_tip: "초보자는 바 무게를 낮추고, 클린과 저크를 한 번에 잇지 않고 나누어(파워 클린 후 스트릭 프레스) 진행해도 좋습니다.",
    },
    {
      name_en: "Burpee Box Jump Over",
      name_kr: "버피 박스 점프 오버",
      description: "바닥에 엎드려 가슴을 터치한 뒤 일어나 박스를 뛰어 넘는 동작입니다.",
      scaling_tip: "박스를 뛰어넘기 어렵다면 박스 위에 올라섰다가 반대쪽으로 내려가는 스텝 오버로 대체하세요.",
    },
  ],
  key_tips: [
    "처음 라운드(9회)에서 힘을 다 쓰지 말고 호흡을 일정하게 유지하세요.",
    "클린 앤 저크는 랙 포지션에서 짧게 숨을 고른 뒤 저크하면 안정적입니다.",
  ],
  cooldown_stretches: [
    { stretch_name: "어깨 및 가슴 스트레칭", target_muscle: "삼각근, 대흉근", youtube_search_keyword: "어깨 스트레칭" },
    { stretch_name: "고관절 스트레칭", target_muscle: "둔근, 대퇴근", youtube_search_keyword: "고관절 스트레칭" },
  ],
};

function buildPrompt(rawWod: string, classType: string): string {
  return `당신은 크로스핏 초보자를 위한 운동 가이드 작성자입니다. 아래 "입력 예시"와 "출력 예시"의 톤·분량·형식을 그대로 유지하면서, "실제 입력"에 대한 가이드를 JSON으로 생성하세요.

# 작성 규칙
- 모든 텍스트는 한국어로, 크로스핏을 처음 접하는 초보자가 이해할 수 있는 눈높이로 작성합니다.
- 와드 원문에 "Core"처럼 본 운동 전에 진행하는 웜업/보조 파트가 별도로 있으면, 그 동작들은 warmup_movements에 담습니다. "METCON"(또는 별도 표시 없는 본 운동) 파트의 동작은 movements에 담습니다. 웜업 파트가 없는 와드는 warmup_movements를 생략하거나 빈 배열로 두세요.
- movements(및 warmup_movements)는 와드 원문에 등장한 동작만 순서대로 포함합니다. 원문에 없는 동작을 추가하지 마세요.
- scaling_tip은 초보자가 무게/난이도를 낮춰서도 같은 자극을 얻을 수 있는 구체적인 대안을 제시합니다.
- key_tips는 2~3개, 이 와드를 수행할 때 실제로 도움이 되는 페이싱/호흡/자세 팁만 담습니다.
- cooldown_stretches는 이 와드에서 많이 사용된 근육 부위를 기준으로 1~3개 선정합니다.
- youtube_search_keyword는 유튜브 검색창에 그대로 입력할 짧은 한국어 키워드입니다("스트레칭"류 범용 단어만 조합하면 검색 결과가 부정확해지므로, 부위명을 중심으로 2~3단어로 간결하게 작성하세요). 실제 영상 제목이나 video_id를 지어내지 마세요 — 키워드만 생성합니다.
- class_type("CF Class"/"Strength Class"/"Weightlifting Class" 등)은 이미 별도로 저장되므로 출력에 포함하지 않습니다.

# 입력 예시 (class_type: ${EXAMPLE_CLASS_TYPE})
${EXAMPLE_RAW_WOD}

# 출력 예시
${JSON.stringify(EXAMPLE_OUTPUT, null, 2)}

# 실제 입력 (class_type: ${classType})
${rawWod}

위 실제 입력에 대한 가이드만 JSON으로 출력하세요.`;
}

export async function generateWodGuide(env: Env, rawWod: string, classType: string): Promise<ParsedGuide> {
  const response = await fetch(GEMINI_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": env.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: buildPrompt(rawWod, classType) }] }],
      generationConfig: {
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

  let parsed: ParsedGuide;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Gemini API 응답이 유효한 JSON이 아닙니다.");
  }

  if (
    typeof parsed.workout_type !== "string" ||
    typeof parsed.target_explanation !== "string" ||
    !Array.isArray(parsed.movements) ||
    !Array.isArray(parsed.key_tips) ||
    !Array.isArray(parsed.cooldown_stretches)
  ) {
    throw new Error("Gemini API 응답이 예상된 가이드 스키마와 일치하지 않습니다.");
  }

  return parsed;
}

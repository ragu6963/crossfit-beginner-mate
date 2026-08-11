import type { Env } from "./types";

const GEMINI_MODEL = "gemini-3.6-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// 지정하지 않으면 모델 기본값(높은 샘플링)으로 동작해 같은 와드를 재생성할 때마다 동작 설명·팁이
// 크게 달라진다. 가이드는 창작이 아니라 "와드 원문의 해설"이므로 낮은 값으로 톤과 분량을 고정한다.
// 다만 0까지 내리면 재생성 버튼이 항상 같은 결과만 내놓아 "다시 뽑아본다"는 동작이 무의미해지므로,
// 표현의 여지는 남기는 선에서 0.3을 사용한다. (기록 파싱처럼 정답이 정해진 추출 작업은 0을 쓸 것)
const GUIDE_TEMPERATURE = 0.3;

export interface GuideMovement {
  name_en: string;
  name_kr: string;
  description: string;
  beginner_tip: string;
  caution: string;
  scaling_tip: string;
}

export interface ParsedGuide {
  workout_type: string;
  target_explanation: string;
  warmup_movements?: GuideMovement[];
  movements: GuideMovement[];
  key_tips: string[];
  cooldown_stretches: Array<{ stretch_name: string; target_muscle: string; youtube_search_keyword: string }>;
}

// Gemini structured output(responseSchema)에 맞춘 OpenAPI 서브셋 스키마. LLM이 필드를 빠뜨리거나
// 형태를 바꾸는 것을 방지해 프론트엔드(renderGuide)가 항상 같은 모양의 JSON을 받도록 강제한다.
const MOVEMENT_SCHEMA = {
  type: "OBJECT",
  properties: {
    name_en: { type: "STRING" },
    name_kr: { type: "STRING" },
    description: { type: "STRING" },
    beginner_tip: { type: "STRING" },
    caution: { type: "STRING" },
    scaling_tip: { type: "STRING" },
  },
  required: ["name_en", "name_kr", "description", "beginner_tip", "caution", "scaling_tip"],
} as const;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    workout_type: { type: "STRING" },
    target_explanation: { type: "STRING" },
    warmup_movements: { type: "ARRAY", items: MOVEMENT_SCHEMA },
    movements: { type: "ARRAY", items: MOVEMENT_SCHEMA },
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
      description:
        "발은 골반 너비, 바는 발등 위에 두고 어깨가 바보다 살짝 앞에 오도록 셋업합니다. 가슴을 세운 채 다리로 바닥을 밀어 바를 무릎까지 끌어올리고, 골반이 바에 닿는 순간 폭발적으로 펴면서 팔꿈치를 빠르게 돌려 어깨 위 랙 포지션으로 받습니다(클린). 이어서 살짝 앉았다 튕기는 힘으로 바를 머리 위로 보내고, 팔꿈치를 완전히 편 채 귀 뒤쪽에서 고정하며 일어섭니다(저크).",
      beginner_tip:
        "바를 팔로 당겨 올리려 하지 말고 '다리로 바닥을 민다'고 생각하세요. 랙 포지션에서는 팔꿈치를 높게 들어 바를 어깨 앞 삼각근에 얹어두면 손목 부담이 훨씬 줄어듭니다.",
      caution:
        "무게에 밀려 허리가 둥글게 말리면 요추에 부담이 큽니다. 셋업부터 마무리까지 가슴을 세우고 복압을 유지하세요. 저크에서 팔꿈치가 완전히 펴지지 않은 채 버티는 것도 어깨 부상 위험이 있으니, 락아웃이 안 되는 무게라면 즉시 낮추세요.",
      scaling_tip:
        "초보자는 바 무게를 1RM의 50~60% 또는 빈 바(20/15kg)로 낮추고, 클린과 저크를 한 번에 잇지 말고 파워 클린 후 푸시 프레스로 나누어 수행하세요.",
    },
    {
      name_en: "Burpee Box Jump Over",
      name_kr: "버피 박스 점프 오버",
      description:
        "박스 앞에서 바닥에 엎드려 가슴과 허벅지를 대고, 발을 손 옆으로 당겨오며 일어섭니다. 그대로 두 발로 박스 위에 점프해 올라선 뒤 반대편으로 내려가면 1회입니다.",
      beginner_tip:
        "착지할 때 발 전체로 박스를 딛고 무릎을 살짝 굽혀 충격을 흡수하세요. 점프 직전 팔을 뒤로 스윙했다가 앞으로 뻗으면 훨씬 적은 힘으로 올라갈 수 있습니다.",
      caution:
        "지친 상태에서 정강이가 박스 모서리에 걸리는 사고가 가장 흔합니다. 호흡이 가빠지면 점프 대신 스텝 업으로 바꾸고, 박스에서 내려올 때는 두 발 착지로 아킬레스건 부담을 줄이세요.",
      scaling_tip:
        "박스를 뛰어넘기 어렵다면 박스 높이를 낮추거나(20인치), 박스 위에 올라섰다가 반대쪽으로 내려가는 스텝 오버로 대체하세요.",
    },
  ],
  key_tips: [
    "9회 라운드에서 클린 앤 저크를 3-3-3으로 끊어 가면 뒤 라운드까지 폼이 유지됩니다. 첫 라운드에 힘을 다 쓰지 마세요.",
    "버피는 '느리지만 멈추지 않는' 속도가 가장 빠릅니다. 바닥에 머무는 시간을 1초 이내로 유지하세요.",
    "저크 직전 랙 포지션에서 짧게 한 번 숨을 들이마시고 복압을 잡으면 바가 안정적으로 떠오릅니다.",
  ],
  cooldown_stretches: [
    { stretch_name: "어깨 및 가슴 스트레칭", target_muscle: "삼각근, 대흉근", youtube_search_keyword: "어깨 스트레칭" },
    { stretch_name: "고관절 스트레칭", target_muscle: "둔근, 대퇴근", youtube_search_keyword: "고관절 스트레칭" },
  ],
};

function buildPrompt(rawWod: string, classType: string): string {
  return `당신은 CrossFit Level 2 트레이너이자 기능해부학·역도 코칭 경력 10년 이상의 전문 코치입니다. 박스에 처음 온 초보자 옆에서 직접 자세를 잡아주듯, 전문가의 정확한 지식을 초보자의 언어로 풀어 설명합니다. 아래 "입력 예시"와 "출력 예시"의 톤·분량·형식을 그대로 유지하면서, "실제 입력"에 대한 가이드를 JSON으로 생성하세요.

# 작성 규칙
- 모든 텍스트는 한국어로 작성합니다. 전문 용어(랙 포지션, 힙 힌지, 락아웃 등)는 쓰되, 처음 등장할 때 괄호나 짧은 설명으로 초보자가 이해할 수 있게 풀어줍니다.
- 와드 원문에 "Core"처럼 본 운동 전에 진행하는 웜업/보조 파트가 별도로 있으면, 그 동작들은 warmup_movements에 담습니다. "METCON"(또는 별도 표시 없는 본 운동) 파트의 동작은 movements에 담습니다. 웜업 파트가 없는 와드는 warmup_movements를 생략하거나 빈 배열로 두세요.
- movements(및 warmup_movements)는 와드 원문에 등장한 동작만 순서대로 포함합니다. 원문에 없는 동작을 추가하지 마세요.
- 각 동작은 description / beginner_tip / caution / scaling_tip 네 필드를 모두 채웁니다. 서로 내용이 겹치지 않게 역할을 분명히 나누세요.
  - description: 셋업 → 실행 → 마무리 순서로 동작의 실제 수행 방법을 2~4문장으로 설명합니다. 발·손 위치, 시선, 바(또는 기구)의 경로처럼 초보자가 바로 따라 할 수 있는 기준을 포함하세요.
  - beginner_tip: 초보자가 이 동작을 처음 할 때 가장 도움이 되는 코칭 큐(cue) 1~2가지를 1~2문장으로 씁니다. "다리로 바닥을 민다", "팔꿈치를 높게" 처럼 몸으로 즉시 이해되는 표현을 쓰고, 왜 그렇게 하면 쉬워지는지 근거를 덧붙이세요.
  - caution: 이 동작에서 초보자가 가장 흔하게 저지르는 실수와 그로 인한 부상 위험 부위를 1~2문장으로 구체적으로 경고하고, 어떻게 교정·중단해야 하는지 알려줍니다. "조심하세요" 같은 막연한 문장은 금지합니다.
  - scaling_tip: 무게·높이·횟수·대체 동작 등 난이도를 낮추는 구체적인 수치나 대안을 제시합니다(예: 빈 바, 1RM의 50~60%, 20인치 박스, 밴드 보조).
- key_tips는 2~3개, 개별 동작 팁이 아니라 이 와드 전체를 관통하는 페이싱·분할(브레이크업)·호흡 전략만 담습니다. 동작별 자세 팁은 각 동작의 beginner_tip에 쓰고 여기서 반복하지 마세요. 가능하면 "9회를 3-3-3으로 끊어라"처럼 횟수 분할을 구체적인 숫자로 제안하세요.
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
        temperature: GUIDE_TEMPERATURE,
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

  // 모델이 일부 필드를 누락해도 프론트엔드가 undefined를 렌더링하지 않도록 문자열로 정규화한다.
  const normalizeMovements = (movements: GuideMovement[] | undefined) =>
    (movements || []).map((m) => ({
      name_en: String(m?.name_en ?? ""),
      name_kr: String(m?.name_kr ?? ""),
      description: String(m?.description ?? ""),
      beginner_tip: String(m?.beginner_tip ?? ""),
      caution: String(m?.caution ?? ""),
      scaling_tip: String(m?.scaling_tip ?? ""),
    }));

  parsed.movements = normalizeMovements(parsed.movements);
  if (parsed.warmup_movements) {
    parsed.warmup_movements = normalizeMovements(parsed.warmup_movements);
  }

  return parsed;
}

import type { Env } from "./types";

const GEMINI_MODEL = "gemini-3.6-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// 양식은 매번 같아야 한다. 오늘 연 화면과 내일 연 화면의 입력칸 모양이 다르면 신뢰할 수 없다.
const TEMPLATE_TEMPERATURE = 0;

// LLM에게 서식까지 맡겼더니 9-7-5 For Time(완주 시간 하나가 스코어)에 "1라운드/2라운드/3라운드"
// 칸을 만들어냈다. 잘못된 양식은 빈 화면보다 나쁘다 — 없는 기록을 적게 만들기 때문이다.
// 그래서 LLM은 "이 파트의 스코어가 무엇인가"만 판정하고(records.ts와 같은 분류를 공유한다),
// 실제 양식 문자열은 아래 표에 따라 코드가 조립한다. time인데 라운드칸이 생기는 일이 구조적으로 불가능해진다.
const TEMPLATE_SCORE_TYPES = ["load", "sets", "rounds_reps", "time", "reps", "distance"] as const;
type TemplateScoreType = (typeof TEMPLATE_SCORE_TYPES)[number];

interface TemplatePart {
  label: string;
  score_type: TemplateScoreType;
  set_count: number;
  primary_movement: string;
}

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    parts: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          label: {
            type: "STRING",
            description: "와드 원문에 적힌 파트 제목을 그대로. 파트가 하나뿐이면 빈 문자열.",
          },
          score_type: { type: "STRING", enum: TEMPLATE_SCORE_TYPES },
          set_count: {
            type: "INTEGER",
            description:
              "와드에 세트·라운드 수가 정해져 있으면 그 개수. 정해져 있지 않거나 세트별로 기록하지 않는 파트면 0.",
          },
          primary_movement: {
            type: "STRING",
            description:
              "세트별로 횟수를 세는 동작 이름(예: 'Burpee pull up'). 해당 없으면 빈 문자열.",
          },
        },
        // 선택 필드는 모델이 조용히 비운다(records.ts에서 실측). 전부 required로 강제한다.
        required: ["label", "score_type", "set_count", "primary_movement"],
      },
    },
  },
  required: ["parts"],
} as const;

function buildPrompt(rawWod: string, classType: string): string {
  return `당신은 크로스핏 와드 분석기입니다. 아래 와드를 파트로 나누고, 파트마다 무엇이 스코어인지 판정하세요.
기록 입력칸의 양식을 만드는 데 쓰이므로, 결과값을 지어내지 말고 구조만 판정합니다.

# 파트 분리
- 와드 원문이 성격이 다른 파트로 나뉘면(예: 스트렝스 파트 + METCON, Core + METCON) 각각을 원문 순서대로 담는다.
- **파트가 2개 이상이면 label을 반드시 채운다(빈 문자열 금지).** 입력칸에 어느 파트의 값을 적는지 알려주는 유일한 단서다. 와드 원문의 파트 제목 줄을 그대로 쓰되 20자가 넘으면 앞부분만 쓴다.
- 한 덩어리면 파트 하나짜리 배열이고, 이때만 label을 빈 문자열로 둔다.

# score_type 판정 (위에서부터 순서대로, 처음 해당하는 것 하나만)
1. load — 파트가 중량 자체를 겨룬다(Strength/Weightlifting, %나 RM 표기, "Find 1RM"). 세트 구조로 진행되더라도 결과가 든 무게면 load다.
2. sets — 세트·인터벌마다 개별 스코어가 남고 그 스코어가 중량이 아니다("N Min on M Min off x K set", "Every N:00 x K Set", EMOM).
3. rounds_reps — 정해진 시간 안에 최대한 많이 반복(AMRAP).
4. time — 정해진 분량을 모두 끝내는 데 걸린 시간(For Time, 9-7-5 같은 렙 스킴, Chipper). **완주 시간 하나가 스코어이므로 라운드별로 나누지 않는다.**
5. reps — 단일 구간에서 총 횟수만 잰다(Max reps).
6. distance — 거리나 칼로리를 잰다.

# set_count
- score_type이 sets일 때만 의미가 있다. 와드에 세트 수가 명시되어 있으면("x 4set", "x 5Set") 그 숫자를, 명시되지 않았으면("Until 60Rep") 0을 넣는다.
- sets가 아닌 파트는 항상 0이다. time 파트에 라운드 수를 넣지 마세요.

# 와드 원문 (class_type: ${classType})
${rawWod}`;
}

const SCORE_TYPE_FIELD_LABEL: Record<TemplateScoreType, string> = {
  load: "무게",
  sets: "세트별",
  rounds_reps: "라운드+렙",
  time: "기록(시간)",
  reps: "총 횟수",
  distance: "거리·칼로리",
};

// 판정된 구조를 실제 입력 양식 문자열로 조립한다. 여기가 코드인 덕분에 서식이 항상 일정하다.
export function assembleTemplate(parts: TemplatePart[]): string {
  const blocks: string[] = [];
  const showLabel = parts.length > 1;

  for (const [i, part] of parts.entries()) {
    const lines: string[] = [];
    // 파트가 여럿인데 제목이 비면 어느 칸이 어느 파트인지 알 수 없다. 모델이 비워 보낸 경우를 대비해
    // 최소한의 자리표시자라도 넣는다.
    if (showLabel) lines.push(part.label || `파트 ${i + 1}`);

    if (part.score_type === "sets" && part.set_count > 0) {
      if (part.primary_movement) lines.push(`(${part.primary_movement})`);
      for (let i = 1; i <= part.set_count; i++) lines.push(`${i}세트: `);
    } else if (part.score_type === "sets") {
      // 세트 수가 정해지지 않은 와드("Until 60Rep")는 몇 세트를 할지 미리 알 수 없다.
      const movement = part.primary_movement ? ` ${part.primary_movement}` : "";
      lines.push(`세트별${movement}: `);
    } else {
      lines.push(`${SCORE_TYPE_FIELD_LABEL[part.score_type]}: `);
    }

    blocks.push(lines.join("\n"));
  }

  // 스케일링과 체감은 나중에 복원이 불가능한 값이라 어떤 와드든 항상 칸을 만들어 둔다.
  blocks.push("스케일링: \n체감: ");
  return blocks.join("\n\n");
}

export async function generateRecordTemplate(
  env: Env,
  rawWod: string,
  classType: string,
): Promise<string> {
  const response = await fetch(GEMINI_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": env.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: buildPrompt(rawWod, classType) }] }],
      generationConfig: {
        temperature: TEMPLATE_TEMPERATURE,
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

  let parsed: { parts?: TemplatePart[] };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Gemini API 응답이 유효한 JSON이 아닙니다.");
  }

  const parts = (parsed.parts ?? []).filter(
    (p): p is TemplatePart => !!p && TEMPLATE_SCORE_TYPES.includes(p.score_type),
  );
  if (parts.length === 0) {
    throw new Error("와드에서 기록할 파트를 찾지 못했습니다.");
  }

  return assembleTemplate(
    parts.map((p) => ({
      label: p.label ?? "",
      score_type: p.score_type,
      set_count: Number.isFinite(p.set_count) ? Math.max(0, Math.min(20, p.set_count)) : 0,
      primary_movement: p.primary_movement ?? "",
    })),
  );
}

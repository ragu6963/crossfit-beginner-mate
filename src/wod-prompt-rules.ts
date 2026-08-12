// 기록 파서와 기록 양식 생성기가 동일한 와드를 서로 다르게 분류하지 않도록 한 곳에서 공유한다.
// none은 애초에 수치 스코어가 없는 기술·보조 파트이고, unknown은 원문만으로 판정할 수 없는 경우다.
export const WORKOUT_SCORE_TYPES = [
  "load",
  "sets",
  "rounds_reps",
  "time",
  "reps",
  "distance",
  "none",
  "unknown",
] as const;

export type WorkoutScoreType = (typeof WORKOUT_SCORE_TYPES)[number];

export const WORKOUT_STRUCTURE_RULES = `# 파트와 score_type 판정
- 와드 원문이 제목, 빈 줄, METCON/Strength/Core 같은 표식으로 성격이 다른 파트로 나뉘면 원문 순서대로 분리한다.
- label은 원문의 파트 제목을 그대로 보존한다. 제목이 없는 단일 파트만 빈 문자열을 허용한다. 길이 자르기나 번역은 하지 않는다.
- score_type은 사용자가 이번에 무엇을 기록했는지가 아니라 와드가 원래 무엇을 결과로 남기는지로 판정한다. 아래를 위에서부터 검사해 처음 해당하는 하나를 고른다.
  1. load — 중량 자체가 결과인 Strength/Weightlifting, % 또는 RM 작업. 세트가 있어도 결과가 중량이면 load다.
  2. sets — 인터벌·세트마다 중량이 아닌 개별 결과가 남는 N Min on/M Min off, Every N:00 x K Set, 점수형 EMOM.
  3. rounds_reps — 정해진 시간 동안 최대 라운드와 추가 반복을 기록하는 AMRAP.
  4. time — 정해진 총 분량의 완주 시간을 기록하는 For Time, 9-7-5, Chipper. 9-7-5는 세트별 기록이 아니라 완주 시간 하나다.
  5. reps — 단일 구간에서 최대 또는 총 반복 수를 기록한다.
  6. distance — 거리 또는 칼로리를 결과로 기록한다.
  7. none — 기술 연습, 일반 Core·보조운동처럼 원문상 수치 결과를 남기지 않는다. 단순히 사용자가 숫자를 안 적었다는 이유로 none을 선택하지 않는다.
  8. unknown — 원문만으로 위 유형을 확정할 수 없다. 그럴듯하게 추정하지 않는다.
- score_type은 같은 와드 파트라면 사용자의 기록 방식과 관계없이 항상 같아야 한다.`;

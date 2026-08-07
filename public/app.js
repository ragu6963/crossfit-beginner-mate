// 사용자 뷰 페이지: 상단 날짜 제목 + 좌우 스크롤 날짜 스트립 + 세션 카드 목록
// "오늘"은 클라이언트 로컬 타임존 기준으로 계산한다(서버는 date 문자열만 다루므로 영향 없음).

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
const DAYS_BEFORE = 14;
const DAYS_AFTER = 14;

function toDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isPastDate(date, today) {
  const a = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const b = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return a < b;
}

function buildDateRange(centerDate, daysBefore, daysAfter) {
  const dates = [];
  for (let i = -daysBefore; i <= daysAfter; i++) {
    const d = new Date(centerDate);
    d.setDate(d.getDate() + i);
    dates.push(d);
  }
  return dates;
}

const today = new Date();
const state = {
  selectedDate: toDateString(today),
};

const weekStripEl = document.getElementById("week-strip");
const contentEl = document.getElementById("content");
const titleEl = document.getElementById("selected-date-title");

function renderWeekStrip() {
  const dates = buildDateRange(today, DAYS_BEFORE, DAYS_AFTER);
  weekStripEl.innerHTML = "";

  let selectedButton = null;

  for (const d of dates) {
    const dateStr = toDateString(d);
    const isSelected = dateStr === state.selectedDate;
    const past = isPastDate(d, today);

    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "day-cell" + (isSelected ? " selected" : past ? " past" : "");
    cell.dataset.date = dateStr;
    cell.innerHTML = `
      <span class="day-label">${WEEKDAY_LABELS[d.getDay()]}</span>
      <span class="day-number">${d.getDate()}</span>
    `;
    cell.addEventListener("click", () => selectDate(dateStr));
    weekStripEl.appendChild(cell);

    if (isSelected) selectedButton = cell;
  }

  if (selectedButton) {
    selectedButton.scrollIntoView({ block: "nearest", inline: "center" });
  }
}

function formatTitleDate(dateStr) {
  const [y, m, d] = dateStr.split("-");
  const dateObj = new Date(Number(y), Number(m) - 1, Number(d));
  return `${m}월 ${d}일 ${WEEKDAY_LABELS[dateObj.getDay()]}요일`;
}

async function selectDate(dateStr) {
  const prevDate = state.selectedDate;
  state.selectedDate = dateStr;
  renderWeekStrip();
  titleEl.textContent = formatTitleDate(dateStr);
  await loadSessions(dateStr, prevDate === dateStr ? null : prevDate);
}

function renderEmptyCard(dateStr) {
  contentEl.innerHTML = `
    <div class="empty-card">
      <p>선택하신 날짜에는 등록된 와드가 없습니다.</p>
    </div>
  `;
}

let currentSessions = [];

// 관리자가 등록한 와드 원문은 목록에 바로 노출한다. LLM이 생성한 추가 정보(parsed_guide)만
// 클릭 시 모달/바텀시트로 감춰서 보여준다(정보 과다 방지). 가이드가 없는 세션은 더 볼 내용이
// 없으므로 클릭 동작을 두지 않는다.
function renderSessions(sessions) {
  currentSessions = sessions;
  contentEl.innerHTML = sessions
    .map((s, i) => {
      const hasGuide = Boolean(s.parsed_guide);
      const tag = hasGuide ? "button" : "div";
      const typeAttr = hasGuide ? ' type="button"' : "";
      return `
      <${tag}${typeAttr} class="session-row${hasGuide ? "" : " session-row-static"}" data-index="${i}">
        <div class="session-row-header">
          <span class="class-type-name">${escapeHtml(s.class_type)}</span>
        </div>
        <pre class="session-row-wod">${escapeHtml(s.raw_wod)}</pre>
        ${hasGuide ? '<span class="session-row-link">가이드 열람</span>' : ""}
      </${tag}>
    `;
    })
    .join("");

  contentEl.querySelectorAll(".session-row:not(.session-row-static)").forEach((row) => {
    row.addEventListener("click", () => openDetail(currentSessions[Number(row.dataset.index)]));
  });
}

const detailBackdrop = document.getElementById("detail-backdrop");
const detailClassType = document.getElementById("detail-class-type");
const detailRawWod = document.getElementById("detail-raw-wod");
const detailGuide = document.getElementById("detail-guide");

// parsed_guide가 있으면(LLM이 생성했거나 관리자가 채워둔 더미 데이터) 초보자 가이드를 보여준다.
// 유튜브는 특정 영상을 임베드하지 않고 항상 검색 결과 링크로 연결한다(prd.md 설계 결정 참고).
function renderGuide(parsedGuideRaw) {
  if (!parsedGuideRaw) {
    detailGuide.innerHTML = "";
    return;
  }

  let guide;
  try {
    guide = JSON.parse(parsedGuideRaw);
  } catch {
    detailGuide.innerHTML = "";
    return;
  }

  const renderMovementsHtml = (movements) =>
    (movements || [])
      .map(
        (m) => `
      <div class="guide-movement">
        <div class="guide-movement-name">${escapeHtml(m.name_kr)} <span class="guide-movement-name-en">(${escapeHtml(m.name_en)})</span></div>
        <p class="guide-movement-desc">${escapeHtml(m.description)}</p>
        <p class="guide-scaling-tip">Scaling: ${escapeHtml(m.scaling_tip)}</p>
      </div>
    `,
      )
      .join("");

  const warmupMovementsHtml = renderMovementsHtml(guide.warmup_movements);
  const movementsHtml = renderMovementsHtml(guide.movements);

  const keyTipsHtml = (guide.key_tips || []).map((tip) => `<li>${escapeHtml(tip)}</li>`).join("");

  // 특정 영상을 골라 임베드하지 않는다. YouTube Data API 연동/videoEmbeddable 필터/환각 위험 없이,
  // 키워드로 유튜브 검색 결과 페이지를 새 탭으로 열어주는 방식으로 고정한다(설계 결정, prd.md 참고).
  const stretchesHtml = (guide.cooldown_stretches || [])
    .map(
      (s) => `
      <div class="guide-stretch">
        <div class="guide-stretch-name">${escapeHtml(s.stretch_name)} <span class="guide-movement-name-en">(${escapeHtml(s.target_muscle)})</span></div>
        <a
          class="guide-video-search-link"
          href="https://www.youtube.com/results?search_query=${encodeURIComponent(s.youtube_search_keyword)}"
          target="_blank"
          rel="noopener noreferrer"
        >유튜브에서 "${escapeHtml(s.youtube_search_keyword)}" 검색해보기 ↗</a>
      </div>
    `,
    )
    .join("");

  detailGuide.innerHTML = `
    <div class="guide-section">
      <h3 class="guide-section-title">오늘의 목표</h3>
      <p>${escapeHtml(guide.workout_type)} · ${escapeHtml(guide.target_explanation)}</p>
    </div>
    ${warmupMovementsHtml ? `<div class="guide-section"><h3 class="guide-section-title">웜업 (Core)</h3>${warmupMovementsHtml}</div>` : ""}
    ${movementsHtml ? `<div class="guide-section"><h3 class="guide-section-title">동작 설명</h3>${movementsHtml}</div>` : ""}
    ${keyTipsHtml ? `<div class="guide-section"><h3 class="guide-section-title">운동 팁</h3><ul class="guide-key-tips">${keyTipsHtml}</ul></div>` : ""}
    ${stretchesHtml ? `<div class="guide-section"><h3 class="guide-section-title">쿨다운 스트레칭</h3>${stretchesHtml}</div>` : ""}
  `;
}

function openDetail(session) {
  detailClassType.textContent = session.class_type;
  detailRawWod.textContent = session.raw_wod;
  renderGuide(session.parsed_guide);
  detailBackdrop.classList.add("open");
}

function closeDetail() {
  detailBackdrop.classList.remove("open");
}

detailBackdrop.addEventListener("click", (e) => {
  if (e.target === detailBackdrop) closeDetail();
});
document.getElementById("detail-close-btn").addEventListener("click", closeDetail);

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

const SLIDE_DISTANCE_PX = 24;
const SLIDE_DURATION_MS = 200;

// direction: 1 = 이후 날짜로 이동(왼쪽으로 빠지고 오른쪽에서 들어옴), -1 = 이전 날짜로 이동(반대)
async function loadSessions(dateStr, prevDateStr) {
  const direction = !prevDateStr ? 0 : dateStr > prevDateStr ? 1 : -1;

  const fetchPromise = fetch(`/api/wods?date=${dateStr}`)
    .then((res) => res.json())
    .catch(() => null);

  if (direction !== 0) {
    contentEl.style.transform = `translateX(${-direction * SLIDE_DISTANCE_PX}px)`;
    contentEl.style.opacity = "0";
    await Promise.all([fetchPromise, wait(SLIDE_DURATION_MS)]).then(([data]) => {
      applySessionData(dateStr, data);
    });
  } else {
    const data = await fetchPromise;
    applySessionData(dateStr, data);
    return;
  }

  // 반대편에서 들어오는 시작 위치로 즉시 이동(트랜지션 없이) 후 다음 프레임에 원위치로 애니메이션
  contentEl.style.transition = "none";
  contentEl.style.transform = `translateX(${direction * SLIDE_DISTANCE_PX}px)`;
  contentEl.style.opacity = "0";
  contentEl.getBoundingClientRect(); // 강제 리플로우
  requestAnimationFrame(() => {
    contentEl.style.transition = "transform 0.2s ease, opacity 0.2s ease";
    contentEl.style.transform = "translateX(0)";
    contentEl.style.opacity = "1";
  });
}

function applySessionData(dateStr, data) {
  if (!data) {
    contentEl.innerHTML = "<p>데이터를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.</p>";
    return;
  }
  if (!data.sessions || data.sessions.length === 0) {
    renderEmptyCard(dateStr);
  } else {
    renderSessions(data.sessions);
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

selectDate(state.selectedDate);

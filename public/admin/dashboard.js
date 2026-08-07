// 관리자 대시보드: 사용자 뷰(public/app.js)와 동일한 날짜 제목 + 좌우 스크롤 날짜 스트립 +
// 세션 요약 행 + 상세 모달/바텀시트 UI를 재사용하고, 상세 패널 하단에 관리자 액션
// (가이드 생성/수정/삭제)을 추가한다.

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
const DAYS_BEFORE = 14;
const DAYS_AFTER = 14;
const KNOWN_CLASS_TYPES = ["CF Class", "Strength Class", "Weightlifting Class"];

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

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

const today = new Date();
const state = { selectedDate: toDateString(today) };
let currentSessions = [];
let currentDetailId = null;

const weekStripEl = document.getElementById("week-strip");
const contentEl = document.getElementById("content");
const titleEl = document.getElementById("selected-date-title");

const detailBackdrop = document.getElementById("detail-backdrop");
const detailClassType = document.getElementById("detail-class-type");
const detailRawWod = document.getElementById("detail-raw-wod");
const detailGuide = document.getElementById("detail-guide");
const detailGuideBtn = document.getElementById("detail-guide-btn");
const detailEditBtn = document.getElementById("detail-edit-btn");
const detailDeleteBtn = document.getElementById("detail-delete-btn");

const modalBackdrop = document.getElementById("modal-backdrop");
const modalTitle = document.getElementById("modal-title");
const form = document.getElementById("session-form");
const formError = document.getElementById("form-error");
const classTypeSelect = document.getElementById("form-class-type-select");
const classTypeCustomField = document.getElementById("form-class-type-custom-field");
const classTypeCustomInput = document.getElementById("form-class-type-custom");

async function checkAuth() {
  const res = await fetch("/api/admin/me");
  if (!res.ok) {
    window.location.href = "/admin/login.html";
  }
}

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

function renderEmptyCard() {
  contentEl.innerHTML = `
    <div class="empty-card">
      <p>이 날짜에 등록된 세션이 없습니다.</p>
    </div>
  `;
}

// 관리자 목록에도 와드 원문을 바로 노출한다(사용자 뷰와 동일한 정책). 관리자는 가이드 유무와
// 무관하게 항상 클릭해 수정/삭제/가이드 생성 액션에 접근해야 하므로 행은 항상 클릭 가능하다.
function renderSessions(sessions) {
  currentSessions = sessions;
  contentEl.innerHTML = sessions
    .map(
      (s, i) => `
      <button type="button" class="session-row" data-index="${i}">
        <div class="session-row-header">
          <span class="class-type-name">${escapeHtml(s.class_type)}</span>
        </div>
        <pre class="session-row-wod">${escapeHtml(s.raw_wod)}</pre>
        <span class="session-row-link">자세히 보기</span>
      </button>
    `,
    )
    .join("");

  contentEl.querySelectorAll(".session-row").forEach((row) => {
    row.addEventListener("click", () => openDetail(currentSessions[Number(row.dataset.index)]));
  });
}

// 사용자 뷰(app.js)의 renderGuide와 동일한 렌더링 규칙을 사용해 관리자도 같은 형태로 미리 확인한다.
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
  currentDetailId = session.id;
  detailClassType.textContent = session.class_type;
  detailRawWod.textContent = session.raw_wod;
  renderGuide(session.parsed_guide);
  detailGuideBtn.textContent = session.parsed_guide ? "가이드 재생성" : "가이드 생성";
  detailGuideBtn.disabled = false;
  detailBackdrop.classList.add("open");
}

function closeDetail() {
  detailBackdrop.classList.remove("open");
  currentDetailId = null;
}

detailBackdrop.addEventListener("click", (e) => {
  if (e.target === detailBackdrop) closeDetail();
});
document.getElementById("detail-close-btn").addEventListener("click", closeDetail);

detailGuideBtn.addEventListener("click", async () => {
  if (!currentDetailId) return;
  const session = currentSessions.find((s) => s.id === currentDetailId);
  if (session?.parsed_guide && !confirm("기존 가이드를 덮어쓰고 다시 생성하시겠습니까?")) return;

  const originalText = detailGuideBtn.textContent;
  detailGuideBtn.disabled = true;
  detailGuideBtn.textContent = "생성 중...";

  try {
    const res = await fetch(`/api/admin/sessions/${currentDetailId}/guide`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data?.error?.message ?? "가이드 생성에 실패했습니다.");
      detailGuideBtn.disabled = false;
      detailGuideBtn.textContent = originalText;
      return;
    }
    const index = currentSessions.findIndex((s) => s.id === currentDetailId);
    if (index !== -1) currentSessions[index] = data;
    renderGuide(data.parsed_guide);
    detailGuideBtn.textContent = "가이드 재생성";
    detailGuideBtn.disabled = false;
  } catch {
    alert("가이드 생성에 실패했습니다.");
    detailGuideBtn.disabled = false;
    detailGuideBtn.textContent = originalText;
  }
});

detailEditBtn.addEventListener("click", () => {
  const session = currentSessions.find((s) => s.id === currentDetailId);
  closeDetail();
  openEditModal(session);
});

detailDeleteBtn.addEventListener("click", async () => {
  if (!currentDetailId) return;
  if (!confirm("이 세션을 삭제하시겠습니까?")) return;

  const res = await fetch(`/api/admin/sessions/${currentDetailId}`, { method: "DELETE" });
  if (res.ok || res.status === 204) {
    closeDetail();
    await loadSessions(state.selectedDate);
  } else {
    alert("삭제에 실패했습니다.");
  }
});

function openAddModal() {
  form.reset();
  document.getElementById("session-id").value = "";
  document.getElementById("form-date").value = state.selectedDate;
  classTypeSelect.value = "CF Class";
  classTypeCustomField.classList.add("hidden");
  modalTitle.textContent = "세션 추가";
  formError.classList.add("hidden");
  modalBackdrop.classList.remove("hidden");
}

function openEditModal(session) {
  if (!session) return;
  document.getElementById("session-id").value = session.id;
  document.getElementById("form-date").value = session.date;
  document.getElementById("form-raw-wod").value = session.raw_wod;

  if (KNOWN_CLASS_TYPES.includes(session.class_type)) {
    classTypeSelect.value = session.class_type;
    classTypeCustomField.classList.add("hidden");
  } else {
    classTypeSelect.value = "__custom__";
    classTypeCustomField.classList.remove("hidden");
    classTypeCustomInput.value = session.class_type;
  }

  modalTitle.textContent = "세션 수정";
  formError.classList.add("hidden");
  modalBackdrop.classList.remove("hidden");
}

function closeModal() {
  modalBackdrop.classList.add("hidden");
}

classTypeSelect.addEventListener("change", () => {
  classTypeCustomField.classList.toggle("hidden", classTypeSelect.value !== "__custom__");
});

document.getElementById("add-session-btn").addEventListener("click", openAddModal);
document.getElementById("modal-cancel-btn").addEventListener("click", closeModal);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  formError.classList.add("hidden");

  const id = document.getElementById("session-id").value;
  const classType =
    classTypeSelect.value === "__custom__" ? classTypeCustomInput.value.trim() : classTypeSelect.value;

  const payload = {
    date: document.getElementById("form-date").value,
    class_type: classType,
    raw_wod: document.getElementById("form-raw-wod").value,
  };

  const url = id ? `/api/admin/sessions/${id}` : "/api/admin/sessions";
  const method = id ? "PUT" : "POST";

  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (res.ok) {
    closeModal();
    if (payload.date !== state.selectedDate) {
      await selectDate(payload.date);
    } else {
      await loadSessions(state.selectedDate);
    }
    return;
  }

  const data = await res.json().catch(() => ({}));
  formError.textContent = data?.error?.message ?? "저장에 실패했습니다.";
  formError.classList.remove("hidden");
});

document.getElementById("logout-btn").addEventListener("click", async () => {
  await fetch("/api/admin/logout", { method: "POST" });
  window.location.href = "/admin/login.html";
});

const SLIDE_DISTANCE_PX = 24;
const SLIDE_DURATION_MS = 200;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function selectDate(dateStr) {
  const prevDate = state.selectedDate;
  state.selectedDate = dateStr;
  renderWeekStrip();
  titleEl.textContent = formatTitleDate(dateStr);
  await loadSessions(dateStr, prevDate === dateStr ? null : prevDate);
}

async function loadSessions(dateStr, prevDateStr) {
  const direction = !prevDateStr ? 0 : dateStr > prevDateStr ? 1 : -1;

  const fetchPromise = fetch(`/api/wods?date=${dateStr}`)
    .then((res) => res.json())
    .catch(() => null);

  if (direction !== 0) {
    contentEl.style.transform = `translateX(${-direction * SLIDE_DISTANCE_PX}px)`;
    contentEl.style.opacity = "0";
    await Promise.all([fetchPromise, wait(SLIDE_DURATION_MS)]).then(([data]) => {
      applySessionData(data);
    });
  } else {
    const data = await fetchPromise;
    applySessionData(data);
    return;
  }

  contentEl.style.transition = "none";
  contentEl.style.transform = `translateX(${direction * SLIDE_DISTANCE_PX}px)`;
  contentEl.style.opacity = "0";
  contentEl.getBoundingClientRect();
  requestAnimationFrame(() => {
    contentEl.style.transition = "transform 0.2s ease, opacity 0.2s ease";
    contentEl.style.transform = "translateX(0)";
    contentEl.style.opacity = "1";
  });
}

function applySessionData(data) {
  if (!data) {
    contentEl.innerHTML = "<p>데이터를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.</p>";
    return;
  }
  if (!data.sessions || data.sessions.length === 0) {
    renderEmptyCard();
  } else {
    renderSessions(data.sessions);
  }
}

(async function init() {
  await checkAuth();
  renderWeekStrip();
  titleEl.textContent = formatTitleDate(state.selectedDate);
  await loadSessions(state.selectedDate);
})();

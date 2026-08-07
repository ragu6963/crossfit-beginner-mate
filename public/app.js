// 사용자 뷰 페이지: 상단 날짜 제목 + 좌우 스크롤 날짜 스트립 + 세션 카드 목록
// "오늘"은 클라이언트 로컬 타임존 기준으로 계산한다(서버는 date 문자열만 다루므로 영향 없음).
// 날짜 계산/가이드 렌더링/슬라이드 애니메이션 등 공통 로직은 shared.js(Shared) 참고.

const DAYS_BEFORE = 14;
const DAYS_AFTER = 14;

const today = new Date();
const state = {
  selectedDate: Shared.toDateString(today),
};

const weekStripEl = document.getElementById("week-strip");
const contentEl = document.getElementById("content");
const titleEl = document.getElementById("selected-date-title");

function renderWeekStrip() {
  Shared.renderWeekStrip(weekStripEl, {
    today,
    selectedDate: state.selectedDate,
    daysBefore: DAYS_BEFORE,
    daysAfter: DAYS_AFTER,
    onSelect: selectDate,
  });
}

async function selectDate(dateStr) {
  const prevDate = state.selectedDate;
  state.selectedDate = dateStr;
  renderWeekStrip();
  titleEl.textContent = Shared.formatTitleDate(dateStr);
  await loadSessions(dateStr, prevDate === dateStr ? null : prevDate);
}

function renderEmptyCard() {
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
          <span class="class-type-name">${Shared.escapeHtml(s.class_type)}</span>
        </div>
        <pre class="session-row-wod">${Shared.escapeHtml(s.raw_wod)}</pre>
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

function openDetail(session) {
  detailClassType.textContent = session.class_type;
  detailRawWod.textContent = session.raw_wod;
  detailGuide.innerHTML = Shared.renderGuideHtml(session.parsed_guide);
  detailBackdrop.classList.add("open");
}

function closeDetail() {
  detailBackdrop.classList.remove("open");
}

detailBackdrop.addEventListener("click", (e) => {
  if (e.target === detailBackdrop) closeDetail();
});
document.getElementById("detail-close-btn").addEventListener("click", closeDetail);

async function loadSessions(dateStr, prevDateStr) {
  const direction = !prevDateStr ? 0 : dateStr > prevDateStr ? 1 : -1;
  const fetchPromise = fetch(`/api/wods?date=${dateStr}`)
    .then((res) => res.json())
    .catch(() => null);

  await Shared.animatedSwap(contentEl, direction, fetchPromise, (data) => applySessionData(dateStr, data));
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

selectDate(state.selectedDate);

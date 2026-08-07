// 관리자 대시보드: 사용자 뷰(public/app.js)와 동일한 날짜 제목 + 좌우 스크롤 날짜 스트립 +
// 세션 요약 행 + 상세 모달/바텀시트 UI를 재사용하고, 상세 패널 하단에 관리자 액션
// (가이드 생성/수정/삭제)을 추가한다. 공통 로직은 shared.js(Shared) 참고.

const DAYS_BEFORE = 14;
const DAYS_AFTER = 14;
const KNOWN_CLASS_TYPES = ["CF Class", "Strength Class", "Weightlifting Class"];

const today = new Date();
const state = { selectedDate: Shared.toDateString(today) };
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
const modalCancelBtn = document.getElementById("modal-cancel-btn");
const form = document.getElementById("session-form");
const formError = document.getElementById("form-error");
const classTypeSelect = document.getElementById("form-class-type-select");
const classTypeCustomField = document.getElementById("form-class-type-custom-field");
const classTypeCustomInput = document.getElementById("form-class-type-custom");
const formGuideBtn = document.getElementById("form-guide-btn");
const formGuidePreview = document.getElementById("form-guide-preview");

// 모달 안에서 "가이드 생성" 버튼으로 이미 저장(생성/수정)이 일어난 적이 있으면 true.
// true인 상태로 "취소"를 누르면 목록에는 이미 반영된 데이터이므로 새로고침이 필요하다.
let modalDirty = false;

async function checkAuth() {
  const res = await fetch("/api/admin/me");
  if (!res.ok) {
    window.location.href = "/admin/login.html";
  }
}

function renderWeekStrip() {
  Shared.renderWeekStrip(weekStripEl, {
    today,
    selectedDate: state.selectedDate,
    daysBefore: DAYS_BEFORE,
    daysAfter: DAYS_AFTER,
    onSelect: selectDate,
  });
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
          <span class="class-type-name">${Shared.escapeHtml(s.class_type)}</span>
        </div>
        <pre class="session-row-wod">${Shared.escapeHtml(s.raw_wod)}</pre>
        <span class="session-row-link">자세히 보기</span>
      </button>
    `,
    )
    .join("");

  contentEl.querySelectorAll(".session-row").forEach((row) => {
    row.addEventListener("click", () => openDetail(currentSessions[Number(row.dataset.index)]));
  });
}

function openDetail(session) {
  currentDetailId = session.id;
  detailClassType.textContent = session.class_type;
  detailRawWod.textContent = session.raw_wod;
  detailGuide.innerHTML = Shared.renderGuideHtml(session.parsed_guide);
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
    detailGuide.innerHTML = Shared.renderGuideHtml(data.parsed_guide);
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
  formGuidePreview.innerHTML = "";
  formGuideBtn.textContent = "가이드 생성";
  formGuideBtn.disabled = false;
  modalCancelBtn.textContent = "취소";
  modalDirty = false;
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
  formGuidePreview.innerHTML = Shared.renderGuideHtml(session.parsed_guide);
  formGuideBtn.textContent = session.parsed_guide ? "가이드 재생성" : "가이드 생성";
  formGuideBtn.disabled = false;
  modalCancelBtn.textContent = "취소";
  modalDirty = false;
  modalBackdrop.classList.remove("hidden");
}

function closeModal() {
  modalBackdrop.classList.add("hidden");
}

classTypeSelect.addEventListener("change", () => {
  classTypeCustomField.classList.toggle("hidden", classTypeSelect.value !== "__custom__");
});

document.getElementById("add-session-btn").addEventListener("click", openAddModal);

modalCancelBtn.addEventListener("click", async () => {
  closeModal();
  // "가이드 생성" 버튼을 통해 이미 서버에 저장된 상태라면, 취소해도 목록에 반영해야 한다.
  if (modalDirty) {
    modalDirty = false;
    await loadSessions(state.selectedDate);
  }
});

function readFormPayload() {
  const classType =
    classTypeSelect.value === "__custom__" ? classTypeCustomInput.value.trim() : classTypeSelect.value;
  return {
    date: document.getElementById("form-date").value,
    class_type: classType,
    raw_wod: document.getElementById("form-raw-wod").value,
  };
}

// 폼 내용을 세션 생성/수정 API로 저장한다. session-id가 비어있으면 생성 후 id를 채워 넣어,
// 이후 같은 모달 안에서 재호출(가이드 생성 → 저장 버튼)해도 자연스럽게 수정 요청으로 이어진다.
async function saveSessionFromForm() {
  const idField = document.getElementById("session-id");
  const payload = readFormPayload();
  const url = idField.value ? `/api/admin/sessions/${idField.value}` : "/api/admin/sessions";
  const method = idField.value ? "PUT" : "POST";

  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message ?? "저장에 실패했습니다.");
  }
  idField.value = data.id;
  return data;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  formError.classList.add("hidden");

  try {
    const saved = await saveSessionFromForm();
    closeModal();
    modalDirty = false;
    if (saved.date !== state.selectedDate) {
      await selectDate(saved.date);
    } else {
      await loadSessions(state.selectedDate);
    }
  } catch (err) {
    formError.textContent = err.message;
    formError.classList.remove("hidden");
  }
});

// 세션 추가/수정 모달 안에서 와드 텍스트 저장과 가이드 생성을 한 화면에서 이어서 처리한다.
// (기존에는 저장 후 모달을 닫고 목록에서 세션을 다시 클릭해야 가이드를 생성할 수 있어 불편했다.)
formGuideBtn.addEventListener("click", async () => {
  if (!form.reportValidity()) return;
  if (formGuidePreview.innerHTML.trim() && !confirm("기존 가이드를 덮어쓰고 다시 생성하시겠습니까?")) return;

  formError.classList.add("hidden");
  formGuideBtn.disabled = true;

  try {
    formGuideBtn.textContent = "저장 중...";
    const saved = await saveSessionFromForm();
    modalDirty = true;
    modalCancelBtn.textContent = "닫기";

    formGuideBtn.textContent = "생성 중...";
    const res = await fetch(`/api/admin/sessions/${saved.id}/guide`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error?.message ?? "가이드 생성에 실패했습니다.");
    }

    formGuidePreview.innerHTML = Shared.renderGuideHtml(data.parsed_guide);
    formGuideBtn.textContent = "가이드 재생성";
  } catch (err) {
    formError.textContent = err.message;
    formError.classList.remove("hidden");
    formGuideBtn.textContent = formGuidePreview.innerHTML.trim() ? "가이드 재생성" : "가이드 생성";
  } finally {
    formGuideBtn.disabled = false;
  }
});

document.getElementById("logout-btn").addEventListener("click", async () => {
  await fetch("/api/admin/logout", { method: "POST" });
  window.location.href = "/admin/login.html";
});

async function selectDate(dateStr) {
  const prevDate = state.selectedDate;
  state.selectedDate = dateStr;
  renderWeekStrip();
  titleEl.textContent = Shared.formatTitleDate(dateStr);
  await loadSessions(dateStr, prevDate === dateStr ? null : prevDate);
}

async function loadSessions(dateStr, prevDateStr) {
  const direction = !prevDateStr ? 0 : dateStr > prevDateStr ? 1 : -1;
  const fetchPromise = fetch(`/api/wods?date=${dateStr}`)
    .then((res) => res.json())
    .catch(() => null);

  await Shared.animatedSwap(contentEl, direction, fetchPromise, applySessionData);
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
  titleEl.textContent = Shared.formatTitleDate(state.selectedDate);
  await loadSessions(state.selectedDate);
})();

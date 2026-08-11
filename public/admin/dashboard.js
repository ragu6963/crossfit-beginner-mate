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

const recordInput = document.getElementById("detail-record-input");
const recordHint = document.getElementById("detail-record-hint");
const recordTmplBtn = document.getElementById("detail-record-tmpl-btn");
const recordSaveBtn = document.getElementById("detail-record-save-btn");
const recordReparseBtn = document.getElementById("detail-record-reparse-btn");
const recordDeleteBtn = document.getElementById("detail-record-delete-btn");
const recordParsedEl = document.getElementById("detail-record-parsed");

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
  loadRecord(session.id);
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

// ---------------------------------------------------------------------------
// 내 기록 (관리자 전용). 입력은 자유 텍스트 한 칸이고, 저장하면 서버가 곧바로 LLM으로 구조화한다.
// 구조화 결과는 읽기 전용으로만 보여준다 — 틀렸을 때 고치는 대상은 JSON이 아니라 원문이며,
// 원문을 고쳐 다시 저장하거나 "다시 해석"을 누르는 흐름이다(원본이 항상 진실의 원천).
// ---------------------------------------------------------------------------

// unscored는 라벨을 두지 않는다 — 수치 스코어가 없다는 뜻이라 배지로 표시할 게 없고,
// score_display("보라색 밴드로 대체")와 스케일 배지만으로 충분히 읽힌다.
const SCORE_TYPE_LABELS = {
  time: "시간",
  sets: "세트별",
  rounds_reps: "라운드+렙",
  load: "중량",
  reps: "총 횟수",
  distance: "거리·칼로리",
};

function formatSeconds(sec) {
  if (typeof sec !== "number") return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function renderRecordPartHtml(part, showLabel) {
  const badges = [];
  if (part.score_display) badges.push(`<span class="record-badge record-badge-score">${Shared.escapeHtml(part.score_display)}</span>`);
  if (SCORE_TYPE_LABELS[part.score_type]) badges.push(`<span class="record-badge">${SCORE_TYPE_LABELS[part.score_type]}</span>`);
  if (part.rx_level === "rx") badges.push(`<span class="record-badge">Rx</span>`);
  if (part.rx_level === "scaled") badges.push(`<span class="record-badge">스케일</span>`);
  if (part.capped) badges.push(`<span class="record-badge">타임캡${part.reps_remaining ? ` · ${part.reps_remaining}개 남음` : ""}</span>`);

  const lapsHtml = (part.laps || [])
    .map((l) => {
      const value =
        typeof l.reps === "number"
          ? `${l.reps}회`
          : typeof l.time_sec === "number"
            ? formatSeconds(l.time_sec)
            : typeof l.load === "number"
              ? `${l.load}${part.score_load_unit ?? ""}`
              : "-";
      return `<span class="record-lap"><b>${l.index}</b> ${Shared.escapeHtml(String(value))}</span>`;
    })
    .join("");

  return `
    <div class="record-part">
      ${showLabel && part.label ? `<div class="record-part-label">${Shared.escapeHtml(part.label)}</div>` : ""}
      <div class="record-badges">${badges.join("")}</div>
      ${part.laps_movement ? `<p class="record-detail">${Shared.escapeHtml(part.laps_movement)}</p>` : ""}
      ${lapsHtml ? `<div class="record-laps">${lapsHtml}</div>` : ""}
      ${part.scaling_detail ? `<p class="record-detail">스케일링: ${Shared.escapeHtml(part.scaling_detail)}</p>` : ""}
    </div>
  `;
}

function renderParsedRecordHtml(parsedRecordRaw) {
  if (!parsedRecordRaw) return "";

  let p;
  try {
    p = JSON.parse(parsedRecordRaw);
  } catch {
    return "";
  }

  // parser_version 1은 파트 개념이 없는 평면 구조였다. 원본이 남아 있어 재파싱하면 되지만,
  // 재파싱 전에 열어봐도 깨지지 않도록 단일 파트로 감싸서 같은 경로로 렌더링한다.
  const parts = Array.isArray(p.parts) ? p.parts : [p];
  const showLabel = parts.length > 1;

  const sessionBadges = [];
  if (p.is_team) sessionBadges.push(`<span class="record-badge">팀</span>`);
  if (p.rpe) sessionBadges.push(`<span class="record-badge">RPE ${p.rpe}${p.rpe_inferred ? " (추정)" : ""}</span>`);

  // 아래 두 줄이 사실상의 검토 장치다. 크로스핏 지식이 없어도 "내가 실제로 한 것과 다른가"만
  // 보면 되도록, 해석이 미심쩍은 부분과 아예 반영되지 않은 원문 조각을 눈에 띄게 노출한다.
  const warnings = [];
  if (p.needs_review) {
    warnings.push(`확인 필요 — ${Shared.escapeHtml(p.review_reason || "해석이 확실하지 않습니다.")}`);
  }
  if (p.unmatched_text) {
    warnings.push(`반영되지 않은 내용 — "${Shared.escapeHtml(p.unmatched_text)}"`);
  }

  return `
    <div class="record-parsed">
      ${parts.map((part) => renderRecordPartHtml(part, showLabel)).join("")}
      ${sessionBadges.length ? `<div class="record-badges">${sessionBadges.join("")}</div>` : ""}
      ${warnings.map((w) => `<p class="record-warning">${w}</p>`).join("")}
    </div>
  `;
}

function applyRecord(record, parseError) {
  const hasRecord = Boolean(record);
  recordInput.value = record?.raw_record ?? "";
  recordSaveBtn.textContent = hasRecord ? "기록 수정" : "기록 저장";
  recordReparseBtn.classList.toggle("hidden", !hasRecord);
  recordDeleteBtn.classList.toggle("hidden", !hasRecord);
  // 양식은 아직 기록을 쓰지 않았을 때만 의미가 있다. 저장된 기록을 양식으로 덮어쓰면 안 된다.
  recordTmplBtn.classList.toggle("hidden", hasRecord);
  recordHint.classList.toggle("hidden", hasRecord || !recordInput.value);

  if (parseError) {
    // 원본은 저장됐고 해석만 실패한 상태. 기록이 사라진 게 아니라는 점을 분명히 알린다.
    recordParsedEl.innerHTML = `<p class="record-warning">기록은 저장됐지만 해석에 실패했습니다 (${Shared.escapeHtml(parseError)}). "다시 해석"을 눌러 재시도할 수 있습니다.</p>`;
    return;
  }
  if (hasRecord && !record.parsed_record) {
    recordParsedEl.innerHTML = `<p class="record-warning">아직 해석되지 않은 기록입니다. "다시 해석"을 눌러주세요.</p>`;
    return;
  }
  recordParsedEl.innerHTML = renderParsedRecordHtml(record?.parsed_record);
}

// 빈 textarea를 마주하면 무엇을 어떻게 적을지 막막해 기록이 잘 안 써진다. 아직 기록이 없으면
// 와드 구조에 맞춘 빈칸 서식을 미리 채워 넣는다. 양식이 없으면 이때 한 번 만들어 세션에 저장한다.
// 저장 시 "양식을 하나도 안 채웠는지" 판단하기 위해 마지막으로 채워 넣은 양식을 기억해 둔다.
let lastFilledTemplate = "";

function fillTemplate(template) {
  if (!template) return;
  recordInput.value = template;
  lastFilledTemplate = template;
  recordHint.classList.remove("hidden");
}

async function loadRecord(sessionId) {
  applyRecord(null);
  try {
    const res = await fetch(`/api/admin/sessions/${sessionId}/record`);
    if (!res.ok) return;
    const data = await res.json();
    // 응답이 늦게 도착했는데 이미 다른 세션을 열었다면 무시한다.
    if (currentDetailId !== sessionId) return;
    applyRecord(data.record);

    if (data.record) return;
    if (data.template) {
      fillTemplate(data.template);
      return;
    }
    // 양식 생성은 몇 초 걸리므로 화면을 막지 않고 뒤이어 채운다. 실패해도 빈 입력칸으로 남을 뿐이다.
    const made = await fetch(`/api/admin/sessions/${sessionId}/record/template`, { method: "POST" });
    if (!made.ok) return;
    const tmpl = await made.json();
    if (currentDetailId === sessionId && !recordInput.value.trim()) fillTemplate(tmpl.template);
  } catch {
    /* 조회/생성 실패 시 입력칸은 빈 상태로 둔다 — 기록 자체는 자유 텍스트로 언제든 쓸 수 있다 */
  }
}

recordTmplBtn.addEventListener("click", async () => {
  if (!currentDetailId) return;
  if (recordInput.value.trim() && !confirm("입력칸 내용을 새 양식으로 덮어쓰시겠습니까?")) return;

  const sessionId = currentDetailId;
  await withRecordButtonBusy(recordTmplBtn, "만드는 중...", async () => {
    try {
      const res = await fetch(`/api/admin/sessions/${sessionId}/record/template`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data?.error?.message ?? "입력 양식 생성에 실패했습니다.");
        return;
      }
      if (currentDetailId === sessionId) fillTemplate(data.template);
    } catch {
      alert("입력 양식 생성에 실패했습니다.");
    }
  });
});

async function withRecordButtonBusy(btn, busyText, fn) {
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = busyText;
  try {
    await fn();
  } finally {
    btn.disabled = false;
    if (btn.textContent === busyText) btn.textContent = original;
  }
}

recordSaveBtn.addEventListener("click", async () => {
  if (!currentDetailId) return;
  const rawRecord = recordInput.value.trim();
  if (!rawRecord) {
    alert("기록을 입력해주세요.");
    return;
  }
  // 양식을 한 칸도 채우지 않고 저장하면 해석할 값이 없어 빈 기록만 남는다. LLM 호출도 낭비다.
  if (lastFilledTemplate && rawRecord === lastFilledTemplate.trim()) {
    alert("아직 빈칸을 채우지 않았습니다. 값을 입력한 뒤 저장해주세요.");
    return;
  }

  const sessionId = currentDetailId;
  await withRecordButtonBusy(recordSaveBtn, "저장 후 해석 중...", async () => {
    try {
      const res = await fetch(`/api/admin/sessions/${sessionId}/record`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw_record: rawRecord }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data?.error?.message ?? "기록 저장에 실패했습니다.");
        return;
      }
      if (currentDetailId === sessionId) applyRecord(data.record, data.parse_error);
    } catch {
      alert("기록 저장에 실패했습니다.");
    }
  });
});

recordReparseBtn.addEventListener("click", async () => {
  if (!currentDetailId) return;
  const sessionId = currentDetailId;
  await withRecordButtonBusy(recordReparseBtn, "해석 중...", async () => {
    try {
      const res = await fetch(`/api/admin/sessions/${sessionId}/record/parse`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data?.error?.message ?? "기록 해석에 실패했습니다.");
        return;
      }
      if (currentDetailId === sessionId) applyRecord(data.record);
    } catch {
      alert("기록 해석에 실패했습니다.");
    }
  });
});

recordDeleteBtn.addEventListener("click", async () => {
  if (!currentDetailId) return;
  if (!confirm("이 기록을 삭제하시겠습니까? 원문도 함께 사라집니다.")) return;

  const res = await fetch(`/api/admin/sessions/${currentDetailId}/record`, { method: "DELETE" });
  if (res.ok || res.status === 204) {
    applyRecord(null);
  } else {
    alert("기록 삭제에 실패했습니다.");
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

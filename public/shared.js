// public/app.js(사용자 뷰)와 public/admin/dashboard.js(관리자 대시보드)가 공유하는 순수 유틸리티 모음.
// 두 화면 모두 날짜 스트립 + 세션 목록 + 상세 가이드 렌더링 구조가 동일해서(development_report.md 참고)
// 여기서 한 번만 구현하고 각 페이지는 페이지 고유 상태(state)와 DOM 참조만 관리한다.

const Shared = (() => {
  const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
  const SLIDE_DISTANCE_PX = 24;
  const SLIDE_DURATION_MS = 200;

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

  function formatTitleDate(dateStr) {
    const [y, m, d] = dateStr.split("-");
    const dateObj = new Date(Number(y), Number(m) - 1, Number(d));
    return `${m}월 ${d}일 ${WEEKDAY_LABELS[dateObj.getDay()]}요일`;
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // 좌우 스크롤 날짜 스트립을 렌더링하고 클릭 핸들러를 붙인다. onSelect(dateStr)는 호출부에서 정의.
  function renderWeekStrip(weekStripEl, { today, selectedDate, daysBefore, daysAfter, onSelect }) {
    const dates = buildDateRange(today, daysBefore, daysAfter);
    weekStripEl.innerHTML = "";

    let selectedButton = null;

    for (const d of dates) {
      const dateStr = toDateString(d);
      const isSelected = dateStr === selectedDate;
      const past = isPastDate(d, today);

      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "day-cell" + (isSelected ? " selected" : past ? " past" : "");
      cell.dataset.date = dateStr;
      cell.innerHTML = `
        <span class="day-label">${WEEKDAY_LABELS[d.getDay()]}</span>
        <span class="day-number">${d.getDate()}</span>
      `;
      cell.addEventListener("click", () => onSelect(dateStr));
      weekStripEl.appendChild(cell);

      if (isSelected) selectedButton = cell;
    }

    if (selectedButton) {
      selectedButton.scrollIntoView({ block: "nearest", inline: "center" });
    }
  }

  // parsed_guide(JSON 문자열)를 상세 패널 HTML로 변환한다. 파싱 실패/빈 값이면 빈 문자열을 반환.
  function renderGuideHtml(parsedGuideRaw) {
    if (!parsedGuideRaw) return "";

    let guide;
    try {
      guide = JSON.parse(parsedGuideRaw);
    } catch {
      return "";
    }

    // beginner_tip/caution은 나중에 추가된 필드라 기존에 저장된 가이드에는 없을 수 있다.
    // 값이 있을 때만 해당 줄을 렌더링해 하위 호환을 유지한다.
    const renderMovementNote = (className, label, text) =>
      text ? `<p class="${className}"><span class="guide-note-label">${label}</span>${escapeHtml(text)}</p>` : "";

    const renderMovementsHtml = (movements) =>
      (movements || [])
        .map(
          (m) => `
        <div class="guide-movement">
          <div class="guide-movement-name">${escapeHtml(m.name_kr)} <span class="guide-movement-name-en">(${escapeHtml(m.name_en)})</span></div>
          <p class="guide-movement-desc">${escapeHtml(m.description)}</p>
          ${renderMovementNote("guide-beginner-tip", "초보자 팁", m.beginner_tip)}
          ${renderMovementNote("guide-caution", "주의사항", m.caution)}
          ${renderMovementNote("guide-scaling-tip", "Scaling", m.scaling_tip)}
        </div>
      `,
        )
        .join("");

    const warmupMovementsHtml = renderMovementsHtml(guide.warmup_movements);
    const movementsHtml = renderMovementsHtml(guide.movements);
    const keyTipsHtml = (guide.key_tips || []).map((tip) => `<li>${escapeHtml(tip)}</li>`).join("");

    // 특정 영상을 골라 임베드하지 않는다. 키워드로 유튜브 검색 결과 페이지를 새 탭으로 열어주는
    // 방식으로 고정한다(환각 위험/유지보수 부담 회피, prd.md 설계 결정 참고).
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

    // 카테고리별 modifier 클래스는 순수 스타일링 훅이다(로직 없음) — 상세 시트에서 어느 섹션을 보고
    // 있는지 색으로 구분할 수 있게 한다(크로스핏 지식이 없어도 스캔 가능하도록).
    return `
      <div class="guide-section guide-section--goal">
        <h3 class="guide-section-title">오늘의 목표</h3>
        <p>${escapeHtml(guide.workout_type)} · ${escapeHtml(guide.target_explanation)}</p>
      </div>
      ${warmupMovementsHtml ? `<div class="guide-section guide-section--warmup"><h3 class="guide-section-title">웜업 (Core)</h3>${warmupMovementsHtml}</div>` : ""}
      ${movementsHtml ? `<div class="guide-section guide-section--movements"><h3 class="guide-section-title">동작 설명</h3>${movementsHtml}</div>` : ""}
      ${keyTipsHtml ? `<div class="guide-section guide-section--tips"><h3 class="guide-section-title">와드 전략 (페이싱)</h3><ul class="guide-key-tips">${keyTipsHtml}</ul></div>` : ""}
      ${stretchesHtml ? `<div class="guide-section guide-section--stretch"><h3 class="guide-section-title">쿨다운 스트레칭</h3>${stretchesHtml}</div>` : ""}
    `;
  }

  // 날짜 이동 시 좌우 슬라이드 전환 애니메이션과 함께 데이터를 교체한다.
  // direction: 1 = 이후 날짜로 이동, -1 = 이전 날짜로 이동, 0 = 애니메이션 없이 즉시 교체.
  async function animatedSwap(contentEl, direction, fetchPromise, applyData) {
    if (direction !== 0) {
      contentEl.style.transform = `translateX(${-direction * SLIDE_DISTANCE_PX}px)`;
      contentEl.style.opacity = "0";
      const [data] = await Promise.all([fetchPromise, wait(SLIDE_DURATION_MS)]);
      applyData(data);
    } else {
      const data = await fetchPromise;
      applyData(data);
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

  return {
    WEEKDAY_LABELS,
    toDateString,
    isPastDate,
    buildDateRange,
    escapeHtml,
    formatTitleDate,
    wait,
    renderWeekStrip,
    renderGuideHtml,
    animatedSwap,
  };
})();

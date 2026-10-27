const STORAGE_KEY = "bleed-cycle-pwa-v1";
const APP_VERSION = "v24";
const MS_DAY = 24 * 60 * 60 * 1000;
const LUTEAL_PRIOR_DAYS = 14;
const MIN_VALID_CYCLE_DAYS = 15;
const MAX_VALID_CYCLE_DAYS = 90;
const MAX_VALID_BLEED_DAYS = 10;
const RECENT_SAMPLE_LIMIT = 6;

const phaseLabels = {
  menstrual: "Менструальная фаза",
  early_follicular: "Ранняя фолликулярная",
  late_follicular: "Поздняя фолликулярная",
  ovulatory: "Около предполагаемой овуляции",
  early_luteal: "Ранняя лютеиновая",
  mid_luteal: "Средняя лютеиновая",
  late_luteal: "Поздняя лютеиновая",
  unknown: "Недостаточно данных"
};

const phaseColors = {
  menstrual: "#d97862",
  early_follicular: "#7fb6ba",
  late_follicular: "#78b7a4",
  ovulatory: "#f2b66d",
  early_luteal: "#9fc7a0",
  mid_luteal: "#b7a176",
  late_luteal: "#7d5b75",
  unknown: "#b5bec0"
};

const state = {
  data: loadData(),
  visibleMonth: startOfMonth(new Date()),
  selectedDate: stripTime(new Date()),
  installPrompt: null,
  updateWorker: null
};

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  bindElements();
  initializeDates();
  bindEvents();
  applyThemeAndPrivacy();
  updateInstallButton();
  render();
  registerServiceWorker();
  state.renderedDate = toInputDate(new Date());
  document.addEventListener("visibilitychange", refreshCurrentDay);
  setInterval(refreshCurrentDay, 60 * 1000);
});

function bindElements() {
  ["onboarding", "dashboard", "cycleForm", "startDateInput", "endDateInput", "cycleLengthInput", "cycleNoteInput", "todayCard", "monthTitle", "calendarGrid", "legend", "forecastList", "historyList", "settingsForm", "settingCycleLength", "settingBleedLength", "settingDetail", "settingTheme", "settingPrivate", "settingModel", "settingFertility", "daySheet", "sheetContent", "exportButton", "importInput", "clearButton", "addCycleButton", "prevMonth", "nextMonth", "todayButton", "quickStartButton", "quickEndButton", "diaryTodayButton", "importWelcome", "privacyLockButton", "installButton", "updateButton", "modelInfo", "sampleHint", "historyStats", "personalPatterns", "appStatus", "privacyScreen", "unlockButton"].forEach(id => { els[id] = document.getElementById(id); });
}

function initializeDates() {
  const now = new Date();
  const today = toInputDate(now);
  els.startDateInput.value = today;
  els.startDateInput.max = today;
  els.endDateInput.max = today;
  state.selectedDate = stripTime(now);
  state.visibleMonth = startOfMonth(now);
}

function bindEvents() {
  els.cycleForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const saved = upsertCycle({
      start: els.startDateInput.value,
      end: els.endDateInput.value || "",
      note: els.cycleNoteInput.value.trim()
    });
    if (!saved) return;
    state.data.settings.cycleLength = Number(els.cycleLengthInput.value) || 28;
    state.formDirty = false;
    saveAndRender();
  });

  els.calendarGrid.addEventListener("pointerdown", event => { state.pointerStart = {x: event.clientX, y: event.clientY}; });
  els.calendarGrid.addEventListener("pointerup", event => {
    if (!state.pointerStart) return;
    const dx = event.clientX - state.pointerStart.x, dy = event.clientY - state.pointerStart.y;
    state.pointerStart = null;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    state.swipeUntil = Date.now() + 200;
    state.visibleMonth = addMonths(state.visibleMonth, dx < 0 ? 1 : -1);
    renderCalendar();
  });
  els.calendarGrid.addEventListener("pointercancel", () => { state.pointerStart = null; });
  els.calendarGrid.addEventListener("keydown", event => {
    const amount = {ArrowLeft:-1, ArrowRight:1, ArrowUp:-7, ArrowDown:7}[event.key];
    const cell = event.target.closest("[data-date]");
    if (!amount || !cell) return;
    event.preventDefault();
    const date = addDays(parseDate(cell.dataset.date), amount);
    state.selectedDate = date;
    state.visibleMonth = startOfMonth(date);
    renderCalendar();
    els.calendarGrid.querySelector(`[data-date="${toInputDate(date)}"]`)?.focus();
  });
  els.prevMonth.addEventListener("click", () => {
    state.visibleMonth = addMonths(state.visibleMonth, -1);
    render();
  });

  els.nextMonth.addEventListener("click", () => {
    state.visibleMonth = addMonths(state.visibleMonth, 1);
    render();
  });

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => switchView(tab.dataset.view));
  });

  document.querySelectorAll("[data-close-sheet]").forEach((node) => {
    node.addEventListener("click", closeSheet);
  });

  els.settingsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    state.data.settings.cycleLength = clamp(Number(els.settingCycleLength.value), MIN_VALID_CYCLE_DAYS, MAX_VALID_CYCLE_DAYS);
    state.data.settings.bleedLength = clamp(Number(els.settingBleedLength.value), 1, 10);
    state.data.settings.detail = els.settingDetail.value;
    state.data.settings.theme = els.settingTheme.value;
    state.data.settings.privateMode = els.settingPrivate.checked;
    state.data.settings.showModel = els.settingModel.checked;
    state.data.settings.showFertility = els.settingFertility.checked;
    state.formDirty = false;
    saveAndRender();
    notifyUser("Настройки сохранены");
  });

  els.todayButton.addEventListener("click", () => { state.visibleMonth = startOfMonth(new Date()); render(); });
  els.quickStartButton.addEventListener("click", () => openCycleSheet());
  els.quickEndButton.addEventListener("click", () => openCycleSheet(getLatestCycle(), null, true));
  els.diaryTodayButton.addEventListener("click", () => openDaySheet(buildDayModel(new Date())));
  els.unlockButton.addEventListener("click", () => {
    state.data.settings.privateMode = false;
    saveAndRender();
    els.privacyLockButton.focus();
  });
  document.addEventListener("input", event => {
    if (event.target.closest("form")) state.formDirty = true;
    if (event.target.closest("#daySheet")) state.sheetDirty = true;
  });
  document.addEventListener("change", event => {
    if (event.target.closest("form")) state.formDirty = true;
    if (event.target.closest("#daySheet")) state.sheetDirty = true;
  });
  window.addEventListener("popstate", () => {
    if (els.daySheet.classList.contains("open")) closeSheet({ fromPop: true });
  });
  window.addEventListener("beforeunload", event => {
    if (state.sheetDirty || state.formDirty) { event.preventDefault(); event.returnValue = ""; }
  });
  els.importWelcome.addEventListener("change", importData);
  document.addEventListener("keydown", (event) => {
    if (state.data.settings.privateMode && event.key === "Tab") { event.preventDefault(); els.unlockButton.focus(); return; }
    if (!els.daySheet.classList.contains("open")) return;
    if (event.key === "Escape") { event.preventDefault(); closeSheet(); }
    if (event.key === "Tab") {
      const nodes = [...els.daySheet.querySelectorAll('button, input, textarea, select, summary, [tabindex="0"]')].filter(node => !node.disabled);
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement.classList.contains("sheet-panel"))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  els.addCycleButton.addEventListener("click", () => openCycleSheet());
  els.exportButton.addEventListener("click", exportData);
  els.importInput.addEventListener("change", importData);
  els.clearButton.addEventListener("click", clearData);
  els.privacyLockButton.addEventListener("click", () => {
    state.data.settings.privateMode = !state.data.settings.privateMode;
    saveAndRender();
  });
  els.installButton.addEventListener("click", installApp);
  els.updateButton.addEventListener("click", applyAppUpdate);

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.installPrompt = event;
    updateInstallButton();
  });

  window.addEventListener("appinstalled", () => {
    state.installPrompt = null;
    updateInstallButton();
  });
}

function defaultData() {
  return {
    version: 1,
    cycles: [],
    notes: {},
    observations: {},
    overrides: {},
    settings: {
      cycleLength: 28,
      bleedLength: 5,
      detail: "balanced",
      theme: "soft",
      privateMode: false,
      showModel: false,
      showFertility: false,
      enabledMetrics: ["stability", "sensitivity", "irritability", "anxiety", "energy", "fatigue", "social", "libido", "support", "conflict", "seriousTalk", "activePlans", "pms"]
    }
  };
}

function loadData() {
  try {
    return normalizeData(JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"));
  } catch {
    return defaultData();
  }
}

function normalizeData(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const fallback = defaultData();
  const cycles = Array.isArray(source.cycles)
    ? source.cycles
      .filter((cycle) => cycle && isInputDate(cycle.start))
      .map((cycle) => {
        const endLooksValid = cycle.end
          && isInputDate(cycle.end)
          && daysBetween(parseDate(cycle.start), parseDate(cycle.end)) >= 0;
        return {
          start: cycle.start,
          end: endLooksValid ? cycle.end : "",
          excludeFromPrediction: Boolean(cycle.excludeFromPrediction),
          note: typeof cycle.note === "string" ? cycle.note : ""
        };
      })
      .sort((a, b) => a.start.localeCompare(b.start))
    : [];
  return {
    ...fallback,
    ...source,
    cycles: [...new Map(cycles.map(cycle => [cycle.start, cycle])).values()],
    notes: source.notes && typeof source.notes === "object" ? source.notes : fallback.notes,
    observations: normalizeObservations(source.observations),
    overrides: source.overrides && typeof source.overrides === "object" ? source.overrides : fallback.overrides,
    settings: {
      ...fallback.settings,
      ...(source.settings || {}),
      cycleLength: Math.round(clamp(Number(source.settings?.cycleLength) || 28, MIN_VALID_CYCLE_DAYS, MAX_VALID_CYCLE_DAYS)),
      bleedLength: Math.round(clamp(Number(source.settings?.bleedLength) || 5, 1, 10)),
      detail: ["short", "balanced", "full"].includes(source.settings?.detail) ? source.settings.detail : "balanced",
      theme: source.settings?.theme === "contrast" ? "contrast" : "soft",
      showModel: source.settings?.showModel === true,
      showFertility: source.settings?.showFertility === true
    }
  };
}

function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
    return true;
  } catch {
    alert("Не удалось сохранить данные на устройстве. Экспортируйте JSON, чтобы не потерять изменения.");
    return false;
  }
}

function saveAndRender() {
  saveData();
  applyThemeAndPrivacy();
  render();
}

function render() {
  const hasCycles = state.data.cycles.length > 0;
  els.onboarding.classList.toggle("hidden", hasCycles);
  els.dashboard.classList.toggle("hidden", !hasCycles);
  if (!hasCycles) return;

  renderToday();
  renderCalendar();
  renderLegend();
  renderForecast();
  renderHistory();
  renderSettings();
  renderInsights();
}

function renderToday() {
  const today = buildDayModel(new Date());
  const latest = getLatestCycle();
  const stale = today.cycleDay > today.bleedStats.length + 7;
  els.quickEndButton.classList.toggle("hidden", Boolean(latest.end) || stale);
  const nextLabel = today.overdue ? "Дата прошла" : `~${formatDate(today.nextStartDate)}`;
  const range = today.overdue ? "Отметьте начало, если оно было" : `${compactDate(today.predictionRange.start)} — ${compactDate(today.predictionRange.end)}`;
  const end = addDays(parseDate(latest.start), today.bleedLength - 1);
  const foot = today.isBleed
    ? `${latest.end ? "Окончание отмечено" : "Ожидаемое окончание"}: ${formatDate(end)}`
    : today.overdue ? `Новая менструация пока не отмечена. Отсчёт продолжается.` : `${today.cycleStats.length} дн. — типичный цикл · ${sampleLabel(today.cycleStats.usedIntervals)}`;
  els.todayCard.innerHTML = `
    <div class="today-top"><p class="eyebrow">Сегодня · ${compactDate(today.date)}</p><span class="phase-tag">${today.unknown ? "Уточните записи" : today.isBleed ? (today.isRecordedBleed ? "Менструация" : "Менструация*") : shortPhase(today.phase)}</span></div>
    <div class="today-body"><div><div class="cycle-number">${today.cycleDay > 0 ? today.cycleDay : "—"}<span>день</span></div><p class="cycle-caption">текущего цикла</p></div><div class="next-prediction"><p class="prediction-caption">Следующее начало</p><strong>${nextLabel}</strong><span class="range-caption">${range}</span></div></div>
    <p class="today-foot">${foot}</p>`;
}

function renderCalendar() {
  els.monthTitle.textContent = monthTitle(state.visibleMonth).replace(/ г\.$/, "");
  els.calendarGrid.innerHTML = "";
  const first = startOfMonth(state.visibleMonth);
  const start = startOfWeek(first);
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const count = Math.ceil((daysBetween(start, first) + days) / 7) * 7;
  for (let i = 0; i < count; i += 1) {
    const date = addDays(start, i), model = buildDayModel(date);
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "day-cell";
    cell.dataset.date = toInputDate(date);
    cell.style.background = dayBackground(model);
    cell.classList.toggle("outside", date.getMonth() !== state.visibleMonth.getMonth());
    cell.classList.toggle("today", sameDay(date, new Date()));
    if (sameDay(date, new Date())) cell.setAttribute("aria-current", "date");
    cell.classList.toggle("recorded-bleed", model.isRecordedBleed);
    cell.classList.toggle("predicted", model.isBleed && !model.isRecordedBleed);
    cell.setAttribute("aria-label", `${formatDate(date)}, ${model.cycleDay > 0 ? `день цикла ${model.cycleDay}, ` : ""}${model.phaseLabel}${model.isRecordedBleed ? ", кровотечение отмечено" : model.isBleed ? ", предполагаемая менструация" : ""}${hasDiaryEntry(date) ? ", есть запись в дневнике" : ""}`);
    cell.innerHTML = `<strong>${date.getDate()}</strong><div class="day-markers" aria-hidden="true">${markers(model)}</div>`;
    cell.addEventListener("click", () => { if (Date.now() >= (state.swipeUntil || 0)) openDaySheet(model); });
    els.calendarGrid.appendChild(cell);
  }
}

function renderLegend() {
  els.legend.innerHTML = [
    ["#f5ddd6", "Менструация"], ["#edf3e9", "Фолликулярная"],
    ["#fbf0db", "Около овуляции*"], ["#edeaf0", "Лютеиновая*"]
  ].map(([color, label]) => `<div class="legend-item"><i class="legend-swatch" style="background:${color}"></i><span>${label}</span></div>`).join("") + '<p>* Оценка, не наблюдение</p>';
}

function renderForecast() {
  els.forecastList.innerHTML = "";
  for (let i = 0; i < 5; i += 1) {
    const model = buildDayModel(addDays(new Date(), i));
    const item = document.createElement("button");
    item.type = "button";
    item.className = "forecast-item";
    item.innerHTML = `<strong>${i === 0 ? "Сегодня" : formatWeekday(model.date)}</strong><span>${model.unknown ? "Недостаточно записей" : model.isBleed ? (model.isRecordedBleed ? "Кровотечение отмечено" : "Предполагаемая менструация") : model.phaseLabel}</span>`;
    item.addEventListener("click", () => openDaySheet(model));
    els.forecastList.appendChild(item);
  }
}

function renderHistory() {
  const cycles = getSortedCycles();
  const cycleStats = getCycleStats();
  const intervalsByEnd = new Map(cycleStats.intervals.map((record) => [record.to, record]));
  const reversed = [...cycles].reverse();
  els.historyList.innerHTML = reversed.map((cycle) => {
    const interval = intervalsByEnd.get(cycle.start);
    const bleed = getBleedLength(cycle);
    const drift = interval?.valid ? interval.length - cycleStats.length : 0;
    const intervalLabel = historyIntervalLabel(interval);
    const bleedLabel = cycle.end ? `${bleed} дн. менструация` : `~${bleed} дн. менструация`;
    return `
      <article class="history-item">
        <div class="history-title">
          <strong>${formatDate(parseDate(cycle.start))}</strong>
          <div class="history-actions">
            <button class="mini-button" data-edit-cycle="${cycle.start}" type="button">Изменить</button>
            <button class="mini-button danger-mini" data-delete-cycle="${cycle.start}" type="button">Удалить</button>
          </div>
        </div>
        <div class="history-meta">
          <span>${cycle.end ? `до ${formatDate(parseDate(cycle.end))}` : "окончание не указано"}</span>
          <span class="${interval && !interval.valid ? "history-warn" : ""}">${intervalLabel}</span>
          <span>${bleedLabel}</span>
          ${cycle.end && bleed > MAX_VALID_BLEED_DAYS ? '<span class="history-warn">Длительность сохранена, но не участвует в типичной оценке (более 10 дней)</span>' : ""}
          ${interval?.valid ? `<span>${drift === 0 ? "около типичного" : `${drift > 0 ? "+" : ""}${drift} дн. к расчету`}</span>` : ""}
        </div>
        ${cycle.note ? `<p>${escapeHtml(cycle.note)}</p>` : ""}
      </article>
    `;
  }).join("");
  els.historyList.querySelectorAll("[data-edit-cycle]").forEach((button) => {
    button.addEventListener("click", () => {
      const cycle = state.data.cycles.find((item) => item.start === button.dataset.editCycle);
      if (cycle) openCycleSheet(cycle);
    });
  });
  els.historyList.querySelectorAll("[data-delete-cycle]").forEach((button) => {
    button.addEventListener("click", () => deleteCycle(button.dataset.deleteCycle));
  });
}

function historyIntervalLabel(interval) {
  if (!interval) return "первая запись";
  if (interval.valid) return `${interval.length} дн. цикл, учтён`;
  return `${interval.length} дн. цикл, не учтён: ${interval.reason}`;
}

function renderSettings() {
  els.settingCycleLength.value = state.data.settings.cycleLength;
  els.settingBleedLength.value = state.data.settings.bleedLength;
  els.settingDetail.value = state.data.settings.detail;
  els.settingTheme.value = state.data.settings.theme;
  els.settingPrivate.checked = state.data.settings.privateMode;
  els.settingModel.checked = state.data.settings.showModel;
  els.settingFertility.checked = state.data.settings.showFertility;
}

function buildDayModel(dateLike) {
  const date = stripTime(dateLike);
  const cycleStats = getCycleStats();
  const bleedStats = getBleedStats();
  const forecastCycleLen = cycleStats.length;
  const cycle = getCycleForDate(date);
  const nextRecordedCycle = getNextCycleAfter(cycle.start);
  const nextRecordedStart = nextRecordedCycle ? parseDate(nextRecordedCycle.start) : null;
  const hasKnownNextStart = Boolean(nextRecordedStart && date < nextRecordedStart);
  const baseStart = parseDate(cycle.start);
  const today = stripTime(new Date());
  const firstPrediction = addDays(baseStart, forecastCycleLen);
  // Never invent a new cycle in the recorded past or after an unconfirmed overdue start.
  const canProject = date > today && firstPrediction > today && !hasKnownNextStart;
  const start = canProject ? getCycleAnchorStart(cycle, date, forecastCycleLen) : baseStart;
  const projectedCycles = canProject ? Math.max(0, Math.floor(daysBetween(baseStart, date) / forecastCycleLen)) : 0;
  const cycleLen = hasKnownNextStart ? daysBetween(start, nextRecordedStart) : forecastCycleLen;
  const bleedLen = projectedCycles ? bleedStats.length : getBleedLength(cycle);
  const cycleDay = daysBetween(start, date) + 1;
  const projectedStart = hasKnownNextStart ? nextRecordedStart : addDays(start, forecastCycleLen);
  const expectedBleedEnd = addDays(projectedStart, bleedStats.length - 1);
  const ovulationDay = estimateOvulationDay(cycleLen);
  const ovulation = addDays(start, ovulationDay - 1);
  const daysToNext = daysBetween(date, projectedStart);
  const cycleContext = {
    source: hasKnownNextStart ? "actual" : "forecast",
    length: cycleLen,
    forecastLength: forecastCycleLen,
    nextStartKnown: hasKnownNextStart
  };
  const beforeHistory = date < baseStart;
  const overdue = !hasKnownNextStart && !projectedCycles && date >= firstPrediction;
  const uncertainGap = cycleLen < 21 || cycleLen > 45 || (hasKnownNextStart && cycleStats.intervals.some(record => record.from === cycle.start && !record.valid));
  const recordedBleed = !beforeHistory && !projectedCycles && (sameDay(date, baseStart) || Boolean(cycle.end && date <= parseDate(cycle.end)));
  const unknown = beforeHistory || (overdue || uncertainGap) && !recordedBleed && cycleDay > bleedLen;
  const confidenceProfile = { ...getConfidenceProfile(cycleStats, bleedStats) };
  confidenceProfile.timing = clamp(confidenceProfile.timing - projectedCycles * 12 - (overdue ? 20 : 0), 18, 88);
  confidenceProfile.overall = unknown ? 20 : confidenceProfile.timing;
  const rangeDays = Math.ceil(cycleStats.rangeDays * Math.sqrt(projectedCycles + 1));
  const fertileWindow = {
    // Common 10–16-day timing before next start, five preceding days and one following day.
    // These are broad calendar bounds, not a guarantee that fertility lies within them.
    startDay: clamp(cycleLen - 16 + 1 - 5 - (hasKnownNextStart ? 0 : rangeDays), 1, cycleLen),
    endDay: clamp(cycleLen - 10 + 1 + 1 + (hasKnownNextStart ? 0 : rangeDays), 1, cycleLen)
  };

  let phase = "mid_luteal";
  if (cycleDay <= bleedLen) phase = "menstrual";
  else if (cycleDay <= bleedLen + 4) phase = "early_follicular";
  else if (cycleDay < ovulationDay - 2) phase = "late_follicular";
  else if (cycleDay <= ovulationDay + 2) phase = "ovulatory";
  else if (daysToNext > 9) phase = "early_luteal";
  else if (daysToNext > 5) phase = "mid_luteal";
  else phase = "late_luteal";

  const signals = cycleSignals(cycleDay, cycleLen, bleedLen, cycleStats.sd);
  const raw = rawMetrics(signals);
  let metrics = normalizedMetricsForDay(cycleDay, cycleLen, bleedLen, raw, cycleStats.sd);
  if (unknown) {
    phase = "unknown";
    metrics = Object.fromEntries(Object.keys(metrics).map(key => [key, null]));
  }

  return {
    date,
    cycleDay,
    cycleLength: cycleLen,
    bleedLength: bleedLen,
    daysToNext,
    nextStartDate: beforeHistory ? baseStart : projectedStart,
    predictionRange: { start: addDays(projectedStart, -rangeDays), end: addDays(projectedStart, rangeDays) },
    overdue,
    unknown,
    projectedCycles,
    isRecordedBleed: recordedBleed,
    expectedBleedEndDate: expectedBleedEnd,
    ovulationDay,
    ovulationDate: ovulation,
    fertileWindow,
    phase,
    phaseLabel: phaseLabels[phase],
    confidence: confidenceProfile.overall,
    confidenceProfile,
    cycleStats,
    bleedStats,
    cycleContext,
    metrics,
    explanation: explanationFor(phase, confidenceProfile, cycleStats, bleedStats, cycleContext),
    isBleed: !unknown && cycleDay >= 1 && cycleDay <= bleedLen,
    isFertile: !unknown && cycleDay >= fertileWindow.startDay && cycleDay <= fertileWindow.endDay
  };
}

function getCycleForDate(date) {
  const sorted = [...state.data.cycles].sort((a, b) => a.start.localeCompare(b.start));
  let current = sorted[0];
  for (const cycle of sorted) {
    if (parseDate(cycle.start) <= date) current = cycle;
  }
  return current || { start: toInputDate(new Date()), end: "", note: "" };
}

function getNextCycleAfter(start) {
  return getSortedCycles().find((cycle) => cycle.start > start) || null;
}

function getCycleAnchorStart(cycle, date, cycleLen) {
  const baseStart = parseDate(cycle.start);
  const diff = daysBetween(baseStart, date);
  const offset = Math.floor(diff / cycleLen) * cycleLen;
  return addDays(baseStart, offset);
}

function upsertCycle(cycle, previousStart = null) {
  const normalized = normalizeCycleInput(cycle);
  if (!normalized.ok) {
    alert(normalized.message);
    return false;
  }
  if (previousStart && previousStart !== normalized.cycle.start && state.data.cycles.some(item => item.start === normalized.cycle.start)) {
    alert("На эту дату уже есть запись. Измените её в истории.");
    return false;
  }
  const candidate = normalized.cycle;
  const overlap = state.data.cycles.some(item => item.start !== previousStart && item.start !== candidate.start &&
    ((item.start < candidate.start && item.end && item.end >= candidate.start) || (candidate.end && item.start > candidate.start && item.start <= candidate.end)));
  if (overlap) { alert("Даты кровотечения пересекаются с другой записью. Проверьте историю."); return false; }
  if (previousStart && previousStart !== normalized.cycle.start) {
    state.data.cycles = state.data.cycles.filter((item) => item.start !== previousStart);
  }
  const existing = state.data.cycles.findIndex((item) => item.start === normalized.cycle.start);
  if (existing >= 0) state.data.cycles[existing] = normalized.cycle;
  else state.data.cycles.push(normalized.cycle);
  state.data.cycles.sort((a, b) => a.start.localeCompare(b.start));
  return true;
}

function normalizeCycleInput(cycle) {
  if (!cycle.start) return { ok: false, message: "Укажите дату начала менструации." };
  if (!isInputDate(cycle.start)) return { ok: false, message: "Проверьте дату начала менструации." };
  if (cycle.start > toInputDate(new Date()) || cycle.end > toInputDate(new Date())) return { ok: false, message: "Фактическую менструацию нельзя записать будущей датой." };
  if (cycle.end && !isInputDate(cycle.end)) return { ok: false, message: "Проверьте дату окончания менструации." };
  if (cycle.end) {
    const length = daysBetween(parseDate(cycle.start), parseDate(cycle.end)) + 1;
    if (length < 1) return { ok: false, message: "Дата окончания не может быть раньше даты начала." };
  }
  return {
    ok: true,
    cycle: {
      start: cycle.start,
      end: cycle.end || "",
      note: typeof cycle.note === "string" ? cycle.note : "",
      excludeFromPrediction: Boolean(cycle.excludeFromPrediction)
    }
  };
}

function getLatestCycle() {
  return [...state.data.cycles].sort((a, b) => b.start.localeCompare(a.start))[0];
}

function getCycleLength() {
  return getCycleStats().length;
}

function getCycleSd() {
  return getCycleStats().sd;
}

function getBleedLength(cycle) {
  if (cycle.end) return daysBetween(parseDate(cycle.start), parseDate(cycle.end)) + 1;
  return getBleedStats().length;
}

function summarizeIntervals(records) {
  // Look at recent consecutive records before filtering. A run of gaps must not resurrect old data.
  const window = records.slice(-RECENT_SAMPLE_LIMIT);
  const recent = window.filter(record => record.valid).map(record => record.length);
  const fallback = state.data.settings.cycleLength;
  const sd = recent.length >= 2 ? standardDeviation(recent) : 4;
  const length = recent.length ? Math.round(weightedMedian(recent)) : fallback;
  return {
    length, sd,
    rangeDays: Math.ceil(Math.max(2 + Math.max(0, 4 - recent.length), sd * 1.5)),
    intervals: records,
    validIntervals: records.filter(record => record.valid).length,
    usedIntervals: recent.length,
    excludedIntervals: records.filter(record => !record.valid).length,
    recentExcluded: window.filter(record => !record.valid).length,
    source: recent.length ? "history" : "default"
  };
}

function getCycleStats() {
  const records = getCycleIntervalRecords();
  const stats = summarizeIntervals(records);
  const audit = getForecastAudit();
  // Historical errors can widen the heuristic band, never narrow it.
  if (audit.count >= 3) stats.rangeDays = Math.max(stats.rangeDays, Math.ceil(audit.error90));
  return { ...stats, audit };
}

function getCycleIntervalRecords(cycles = getSortedCycles()) {
  const records = cycles.slice(1).map((current, i) => ({
    from: cycles[i].start,
    to: current.start,
    length: daysBetween(parseDate(cycles[i].start), parseDate(current.start)),
    valid: !current.excludeFromPrediction,
    reason: current.excludeFromPrediction ? "исключён вручную: пропуск или особый цикл" : ""
  }));
  // Only recent records establish the current baseline; older rhythms must not dominate it.
  const bounded = records.slice(-8).filter(record => record.valid && record.length >= MIN_VALID_CYCLE_DAYS && record.length <= MAX_VALID_CYCLE_DAYS).map(record => record.length);
  const center = bounded.length ? median(bounded) : 0;
  const threshold = Math.max(7, 3 * medianAbsoluteDeviation(bounded, center) * 1.4826);
  return records.map((record, i) => {
    if (!record.valid) return record;
    if (record.length < MIN_VALID_CYCLE_DAYS || record.length > MAX_VALID_CYCLE_DAYS) {
      return { ...record, valid: false, reason: "вне диапазона модели 15–90 дней" };
    }
    const isDifferent = Math.abs(record.length - center) > threshold;
    // Two consecutive similar changed intervals are evidence of a new rhythm, not isolated noise.
    const supported = [records[i - 1], records[i + 1]].some(other => other?.valid && other.length >= MIN_VALID_CYCLE_DAYS && other.length <= MAX_VALID_CYCLE_DAYS && Math.abs(other.length - record.length) <= 3 && Math.abs(other.length - center) > threshold);
    if (bounded.length >= 4 && isDifferent && !supported) {
      return { ...record, valid: false, reason: "одиночный нетипичный интервал; проверьте пропуск записей" };
    }
    return record;
  });
}

function getForecastAudit() {
  const cycles = getSortedCycles();
  const errors = [];
  // Walk forward: each estimate sees only starts recorded BEFORE its target interval.
  for (let i = Math.max(4, cycles.length - 6); i < cycles.length; i += 1) {
    if (cycles[i].excludeFromPrediction) continue;
    const actual = daysBetween(parseDate(cycles[i - 1].start), parseDate(cycles[i].start));
    if (actual < MIN_VALID_CYCLE_DAYS || actual > MAX_VALID_CYCLE_DAYS) continue;
    const previous = summarizeIntervals(getCycleIntervalRecords(cycles.slice(0, i)));
    if (previous.usedIntervals < 3) continue;
    errors.push(Math.abs(previous.length - actual));
  }
  const recent = errors.slice(-6);
  return { count: recent.length, mae: recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : null, error90: recent.length ? quantile(recent, 0.9) : null };
}

function getBleedStats() {
  const lengths = getSortedCycles()
    .filter((cycle) => cycle.start && cycle.end)
    .map((cycle) => daysBetween(parseDate(cycle.start), parseDate(cycle.end)) + 1)
    .filter((length) => length >= 1 && length <= MAX_VALID_BLEED_DAYS);
  const recent = lengths.slice(-RECENT_SAMPLE_LIMIT);
  const fallback = clamp(Number(state.data.settings.bleedLength) || 5, 1, MAX_VALID_BLEED_DAYS);
  return {
    length: recent.length ? clamp(Math.round(weightedMedian(recent)), 1, MAX_VALID_BLEED_DAYS) : fallback,
    sd: recent.length >= 3 ? standardDeviation(recent) : 1.5,
    sampleCount: lengths.length,
    usedCount: recent.length,
    source: recent.length ? "history" : "default"
  };
}

function getConfidenceProfile(cycleStats = getCycleStats(), bleedStats = getBleedStats()) {
  let timing = cycleStats.source === "history" ? 34 + cycleStats.usedIntervals * 8 : 30;
  timing -= Math.max(0, cycleStats.sd - 3) * 5;
  timing -= (cycleStats.recentExcluded || 0) * 4;
  timing = clamp(Math.round(timing), 18, 88);

  let bleed = bleedStats.source === "history" ? 38 + Math.min(bleedStats.sampleCount, RECENT_SAMPLE_LIMIT) * 7 : 34;
  bleed -= Math.max(0, bleedStats.sd - 1.5) * 4;
  bleed = clamp(Math.round(bleed), 24, 86);

  const fertility = Math.min(30, timing); // No physiological observations confirm ovulation.
  const emotional = 0; // Dates alone cannot validate an individual emotional forecast.
  const overall = clamp(Math.round(timing * 0.34 + bleed * 0.18 + fertility * 0.18 + emotional * 0.3), 20, 86);
  return { overall, timing, bleed, fertility, emotional };
}

function getSortedCycles() {
  return [...state.data.cycles].sort((a, b) => a.start.localeCompare(b.start));
}

function estimateOvulationDay(cycleLen) {
  const upper = Math.max(1, cycleLen - 5);
  const lower = Math.min(8, upper);
  return clamp(cycleLen - LUTEAL_PRIOR_DAYS + 1, lower, upper);
}

function cycleSignals(cycleDay, cycleLen, bleedLen, cycleSd = getCycleSd()) {
  const ovulationDay = estimateOvulationDay(cycleLen);
  const daysToNext = cycleLen - cycleDay + 1;
  const cycleUncertainty = Math.min(cycleSd, 8);
  return {
    menstrual: gaussian(cycleDay, 2, Math.max(1.45, bleedLen / 2.2)),
    earlyBleed: gaussian(cycleDay, 1, 1.25),
    recovery: gaussian(cycleDay, bleedLen + 3, 2.4),
    follicularLift: gaussian(cycleDay, Math.max(bleedLen + 5, ovulationDay - 5), 3.2),
    ovulatory: gaussian(cycleDay, ovulationDay, 1.7 + cycleUncertainty * 0.22),
    fertileWindow: Math.max(
      gaussian(cycleDay, ovulationDay - 2, 2.2 + cycleUncertainty * 0.24),
      0.7 * gaussian(cycleDay, ovulationDay, 1.7 + cycleUncertainty * 0.22)
    ),
    earlyLuteal: gaussian(cycleDay, ovulationDay + 4, 2.8),
    midLuteal: gaussian(cycleDay, ovulationDay + 8, 3.1),
    lateLuteal: gaussian(daysToNext, 2, 2.2 + cycleUncertainty * 0.25),
    premenstrualRamp: logistic(7 - daysToNext, 0.92)
  };
}

function rawMetrics(s) {
  const lutealDrift = 0.45 * s.earlyLuteal + 0.75 * s.midLuteal;
  const perimenstrual = Math.max(s.lateLuteal, 0.62 * s.menstrual + 0.28 * s.earlyBleed);
  const irritability = 18 + 50 * s.lateLuteal + 16 * s.premenstrualRamp + 10 * s.menstrual + 8 * lutealDrift - 14 * s.recovery;
  const anxiety = 16 + 42 * s.lateLuteal + 14 * s.premenstrualRamp + 7 * s.menstrual + 14 * lutealDrift - 10 * s.follicularLift;
  const sensitivity = 20 + 48 * s.lateLuteal + 16 * s.premenstrualRamp + 13 * s.menstrual + 7 * s.ovulatory + 7 * lutealDrift - 10 * s.recovery;
  const fatigue = 18 + 40 * s.menstrual + 26 * s.lateLuteal + 14 * s.premenstrualRamp + 6 * s.midLuteal - 18 * s.ovulatory - 10 * s.follicularLift;
  const energy = 42 + 42 * s.follicularLift + 36 * s.ovulatory + 8 * s.earlyLuteal - 36 * s.menstrual - 28 * s.lateLuteal - 10 * s.premenstrualRamp;
  const social = 38 + 34 * s.follicularLift + 42 * s.ovulatory - 24 * s.lateLuteal - 16 * s.menstrual;
  const libido = 28 + 58 * s.ovulatory + 20 * s.follicularLift - 20 * s.menstrual - 26 * s.lateLuteal - 8 * s.premenstrualRamp;
  const fertility = 5 + 84 * s.fertileWindow + 14 * s.ovulatory - 18 * s.menstrual - 14 * s.lateLuteal;
  const support = 18 + 34 * s.menstrual + 42 * s.lateLuteal + 16 * s.premenstrualRamp + 6 * s.midLuteal - 12 * s.follicularLift;
  const pms = 8 + 58 * perimenstrual + 24 * s.premenstrualRamp + 10 * s.midLuteal - 12 * s.recovery;
  const conflict = 12 + 44 * s.lateLuteal + 14 * s.premenstrualRamp + 10 * s.menstrual + 7 * lutealDrift - 10 * s.follicularLift;

  const seriousTalk = 68 - 0.36 * irritability - 0.32 * anxiety - 0.22 * fatigue + 0.22 * energy + 10 * s.recovery;
  const activePlans = 34 + 0.42 * energy + 0.28 * social - 0.28 * fatigue - 10 * s.menstrual;
  const stability = 78 - 0.34 * sensitivity - 0.32 * anxiety - 0.26 * irritability + 8 * s.recovery;
  const load = 0.22 * sensitivity + 0.18 * irritability + 0.16 * anxiety + 0.16 * fatigue + 0.14 * support + 0.14 * pms;

  return { stability, sensitivity, irritability, anxiety, energy, fatigue, social, libido, fertility, support, conflict, seriousTalk, activePlans, pms, load };
}

function normalizedMetricsForDay(cycleDay, cycleLen, bleedLen, raw, cycleSd = getCycleSd()) {
  const ranges = metricRanges(cycleLen, bleedLen, cycleSd);
  return Object.fromEntries(Object.entries(raw).map(([key, value]) => {
    const range = ranges[key];
    return [key, normalizeToScale(value, range.min, range.max)];
  }));
}

function metricRanges(cycleLen, bleedLen, cycleSd = getCycleSd()) {
  const ranges = {};
  for (let day = 1; day <= cycleLen; day += 1) {
    const values = rawMetrics(cycleSignals(day, cycleLen, bleedLen, cycleSd));
    Object.entries(values).forEach(([key, value]) => {
      if (!ranges[key]) ranges[key] = { min: value, max: value };
      ranges[key].min = Math.min(ranges[key].min, value);
      ranges[key].max = Math.max(ranges[key].max, value);
    });
  }
  return ranges;
}

function normalizeToScale(value, min, max) {
  if (Math.abs(max - min) < 0.001) return 50;
  return clamp(Math.round(((value - min) / (max - min)) * 100), 0, 100);
}

function openDaySheet(model) {
  state.selectedDate = model.date;
  const key = toInputDate(model.date), future = key > toInputDate(new Date());
  const entry = state.data.observations[key] || {};
  const fields = [["mood", "Настроение", ["Очень тяжело", "Сниженное", "Обычное", "Хорошее", "Отличное"]], ["energy", "Энергия", ["Нет сил", "Мало", "Обычная", "Много", "Очень много"]], ["pain", "Боль", ["Нет", "Слабая", "Умеренная", "Сильная", "Очень сильная"]], ["fatigue", "Усталость", ["Нет", "Небольшая", "Умеренная", "Сильная", "Очень сильная"]]];
  const cycle = getCycleForDate(model.date);
  const status = model.isRecordedBleed ? "Кровотечение отмечено" : model.isBleed ? "Предполагаемая менструация" : model.unknown ? "Недостаточно записей" : model.phaseLabel;
  const metrics = [["energy", "Энергия"], ["fatigue", "Усталость"], ["support", "Поддержка"], ["pms", "ПМС-окно"], ["stability", "Стабильность"], ["sensitivity", "Чувствительность"], ["irritability", "Раздражительность"], ["anxiety", "Тревожность"], ["social", "Общительность"], ["libido", "Либидо"], ["conflict", "Конфликтность"], ["seriousTalk", "Разговоры"], ["activePlans", "Активные планы"]];
  const enabled = Array.isArray(state.data.settings.enabledMetrics) ? state.data.settings.enabledMetrics : defaultData().settings.enabledMetrics;
  els.sheetContent.innerHTML = `
    <div class="sheet-title"><p class="eyebrow">${model.cycleDay > 0 ? `День цикла ${model.cycleDay}` : "До первой записи"}</p><h2 id="sheetTitle">${formatDate(model.date)}</h2><p>${status}</p></div>
    <form id="dayDiaryForm">
      ${future ? '<p class="scale-note">Это будущая дата. Можно оставить заметку; оценки самочувствия доступны за сегодня и прошедшие дни.</p>' : ""}
      <div class="diary-grid">${fields.map(([id, label, options]) => `<label>${label}<select id="diary_${id}" ${future ? "disabled" : ""}><option value="">Не отмечено</option>${options.map((text, i) => `<option value="${i}" ${entry[id] === i ? "selected" : ""}>${text}</option>`).join("")}</select></label>`).join("")}</div>
      <label class="day-note-label">Заметка<textarea id="dayNote" rows="2" placeholder="Сон, ощущения, события дня…"></textarea></label>
      <div class="sheet-save"><button class="primary-button" id="saveDayNote" type="submit">Сохранить запись</button></div><p id="noteStatus" role="status"></p>
    </form>
    ${!future ? `<div class="day-cycle-actions"><button id="dayStartButton" class="secondary-button" type="button">${sameDay(model.date, parseDate(cycle.start)) ? "Изменить менструацию" : "Начало менструации"}</button>${model.cycleDay > 0 && model.cycleDay <= 20 ? '<button id="dayEndButton" class="secondary-button" type="button">Окончание</button>' : ""}</div>` : ""}
    <details class="info-block"><summary>О расчёте этого дня</summary><p>${predictionText(model)}</p><p>${model.explanation}</p>${state.data.settings.showFertility ? `<p>Оценочное окно: ${formatDate(addDays(model.date, model.fertileWindow.startDay - model.cycleDay))} — ${formatDate(addDays(model.date, model.fertileWindow.endDay - model.cycleDay))}. Это широкий календарный ориентир, не подтверждение овуляции.</p>` : ""}</details>
    ${state.data.settings.showModel ? `<details class="info-block"><summary>Иллюстративная модель</summary><p class="scale-note">Шкалы 0–100 описывают общую условную кривую, а не ваше настроение, уровень гормонов или вероятность симптомов. Оценки дневника сюда не подставляются.</p><div class="metric-list">${metrics.filter(([id], i) => enabled.includes(id) && (state.data.settings.detail !== "short" || i < 4)).map(([id, label]) => metricRow(label, model.metrics[id])).join("")}</div></details>` : ""}`;
  document.getElementById("dayNote").value = typeof state.data.notes[key] === "string" ? state.data.notes[key] : "";
  document.getElementById("dayDiaryForm").addEventListener("submit", event => {
    event.preventDefault();
    const value = document.getElementById("dayNote").value.trim();
    if (value) state.data.notes[key] = value; else delete state.data.notes[key];
    const observation = {};
    if (!future) for (const [id] of fields) {
      const selected = document.getElementById(`diary_${id}`).value;
      if (selected !== "") observation[id] = Number(selected);
    }
    if (Object.keys(observation).length) state.data.observations[key] = observation;
    else delete state.data.observations[key];
    if (saveData()) {
      state.sheetDirty = state.formDirty = false;
      document.getElementById("noteStatus").textContent = "Сохранено на устройстве";
      document.getElementById("saveDayNote").textContent = "Сохранено";
      renderCalendar(); renderInsights();
      notifyUser("Запись сохранена");
    }
  });
  document.getElementById("dayStartButton")?.addEventListener("click", () => {
    if (state.sheetDirty && !confirm("Перейти к менструации без сохранения дневника?")) return;
    openCycleSheet(sameDay(model.date, parseDate(cycle.start)) ? cycle : null, key);
  });
  document.getElementById("dayEndButton")?.addEventListener("click", () => {
    if (state.sheetDirty && !confirm("Перейти к менструации без сохранения дневника?")) return;
    openCycleSheet(cycle, key, true);
  });
  showSheet();
}

function openCycleSheet(cycle = null, selectedDate = null, finish = false) {
  cycle ||= state.data.cycles.find(item => item.start === (selectedDate || toInputDate(new Date()))) || null;
  const template = document.getElementById("addCycleTemplate");
  els.sheetContent.innerHTML = `<h2 id="sheetTitle">${cycle ? "Изменить цикл" : "Добавить цикл"}</h2>`;
  els.sheetContent.appendChild(template.content.cloneNode(true));
  document.getElementById("newCycleStart").value = selectedDate || toInputDate(new Date());
  document.getElementById("newCycleStart").max = toInputDate(new Date());
  document.getElementById("newCycleEnd").max = toInputDate(new Date());
  if (cycle) {
    document.getElementById("newCycleStart").value = cycle.start;
    document.getElementById("newCycleEnd").value = cycle.end || "";
    document.getElementById("newCycleNote").value = cycle.note || "";
    document.getElementById("excludeInterval").checked = Boolean(cycle.excludeFromPrediction);
  }
  if (finish) document.getElementById("newCycleEnd").value = selectedDate || toInputDate(new Date());
  const syncMinimum = () => { document.getElementById("newCycleEnd").min = document.getElementById("newCycleStart").value; };
  syncMinimum();
  document.getElementById("newCycleStart").addEventListener("change", syncMinimum);
  document.getElementById("newCycleSubmit").textContent = finish ? "Сохранить окончание" : cycle ? "Сохранить изменения" : "Добавить менструацию";
  document.getElementById("newCycleForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const saved = upsertCycle({
      start: document.getElementById("newCycleStart").value,
      end: document.getElementById("newCycleEnd").value || "",
      note: document.getElementById("newCycleNote").value.trim(),
      excludeFromPrediction: document.getElementById("excludeInterval").checked
    }, cycle?.start || null);
    if (!saved) return;
    if (!saveData()) return;
    state.sheetDirty = state.formDirty = false;
    closeSheet({ force: true });
    render();
    notifyUser(finish ? "Окончание сохранено" : "Менструация сохранена");
  });
  showSheet();
}

function deleteCycle(start) {
  const cycle = state.data.cycles.find((item) => item.start === start);
  if (!cycle) return;
  if (!confirm(`Удалить запись от ${formatDate(parseDate(start))}?`)) return;
  state.data.cycles = state.data.cycles.filter((item) => item.start !== start);
  saveAndRender();
}

function showSheet() {
  if (!els.daySheet.classList.contains("open")) {
    state.sheetOpener = document.activeElement;
    history.pushState({ sheet: true }, "");
  }
  state.sheetDirty = false;
  els.daySheet.classList.add("open");
  els.daySheet.setAttribute("aria-hidden", "false");
  document.body.classList.add("sheet-open");
  document.querySelector("main").inert = true;
  document.querySelector(".topbar").inert = true;
  els.daySheet.querySelector(".sheet-panel").focus({ preventScroll: true });
  els.daySheet.querySelector(".sheet-panel").scrollTop = 0;
}

function closeSheet(options = {}) {
  if (state.sheetDirty && !options.force && !confirm("Закрыть без сохранения изменений?")) {
    if (options.fromPop) history.pushState({ sheet: true }, "");
    return false;
  }
  state.sheetDirty = false;
  if (els.sheetContent.querySelector("form")) state.formDirty = false;
  els.daySheet.classList.remove("open");
  els.daySheet.setAttribute("aria-hidden", "true");
  document.body.classList.remove("sheet-open");
  document.querySelector("main").inert = false;
  document.querySelector(".topbar").inert = false;
  if (!options.fromPop && history.state?.sheet) history.back();
  const fallback = els.calendarGrid.querySelector(`[data-date="${toInputDate(state.selectedDate)}"]`);
  (state.sheetOpener?.isConnected ? state.sheetOpener : fallback)?.focus({ preventScroll: true });
  return true;
}

function switchView(view) {
  if (state.formDirty && !confirm("Перейти без сохранения настроек?")) return;
  if (state.formDirty) renderSettings();
  state.formDirty = false;
  document.querySelectorAll(".tab").forEach(tab => {
    tab.classList.toggle("active", tab.dataset.view === view);
    if (tab.dataset.view === view) tab.setAttribute("aria-current", "page"); else tab.removeAttribute("aria-current");
  });
  document.querySelectorAll(".view").forEach(node => node.classList.toggle("active", node.id === `${view}View`));
  document.body.dataset.view = view;
  window.scrollTo({ top: 0, behavior: "instant" });
}

function applyThemeAndPrivacy() {
  const privateMode = Boolean(state.data.settings.privateMode);
  document.body.classList.toggle("theme-contrast", state.data.settings.theme === "contrast");
  document.getElementById("app").classList.toggle("private", privateMode);
  els.privacyScreen.hidden = !privateMode;
  els.privacyLockButton.setAttribute("aria-pressed", String(privateMode));
  document.querySelector("main").inert = privateMode || els.daySheet.classList.contains("open");
  document.querySelector(".topbar").inert = privateMode || els.daySheet.classList.contains("open");
  if (privateMode) els.unlockButton.focus();
}

function exportData() {
  const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `cycle-backup-${toInputDate(new Date())}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function importData(event) {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(String(reader.result));
      if (!imported || imported.version !== 1 || !Array.isArray(imported.cycles)) throw new Error("bad shape");
      if (imported.cycles.some(cycle => !cycle || !isInputDate(cycle.start) || (cycle.end && (!isInputDate(cycle.end) || cycle.end < cycle.start)))) throw new Error("invalid dates");
      if (new Set(imported.cycles.map(cycle => cycle.start)).size !== imported.cycles.length) throw new Error("duplicate dates");
      const ordered = [...imported.cycles].sort((a, b) => a.start.localeCompare(b.start));
      if (ordered.some((cycle, index) => cycle.end && ordered[index + 1] && cycle.end >= ordered[index + 1].start)) throw new Error("overlapping dates");
      const normalized = normalizeData(imported);
      if (imported.cycles.length && !normalized.cycles.length) throw new Error("no valid cycles");
      if (state.data.cycles.length && !confirm("Заменить текущую историю и настройки данными из файла? Сначала можно отменить и экспортировать свою историю.")) return;
      state.data = normalized;
      state.formDirty = false;
      saveAndRender();
      notifyUser("История восстановлена");
    } catch {
      alert("Не удалось импортировать файл. Проверьте, что это JSON-экспорт приложения.");
    }
  };
  reader.readAsText(file);
}

function clearData() {
  if (!confirm("Удалить всю локальную историю циклов и настройки?")) return;
  state.data = defaultData();
  state.formDirty = false;
  switchView("calendar");
  saveAndRender();
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  let refreshing = false;
  let hasBeenControlled = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    if (!hasBeenControlled) { hasBeenControlled = true; return; }
    if (els.daySheet.classList.contains("open") || state.formDirty || document.activeElement?.closest("form")) {
      state.updateWorker = null;
      els.updateButton.classList.remove("hidden-install");
      return;
    }
    refreshing = true;
    window.location.reload();
  });
  try {
    const registration = await navigator.serviceWorker.register("service-worker.js", { updateViaCache: "none" });
    watchServiceWorker(registration);
    registration.addEventListener("updatefound", () => watchServiceWorker(registration));
    setTimeout(() => registration.update().catch(() => {}), 1000);
    setInterval(() => {
      if (document.visibilityState === "visible") registration.update().catch(() => {});
    }, 60 * 60 * 1000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") registration.update().catch(() => {});
    });
  } catch {
    // Offline or unsupported update checks should not block the app.
  }
}

function watchServiceWorker(registration) {
  if (registration.waiting) {
    showUpdateButton(registration.waiting);
    return;
  }
  const worker = registration.installing;
  if (!worker) return;
  worker.addEventListener("statechange", () => {
    if (worker.state === "installed" && navigator.serviceWorker.controller) {
      showUpdateButton(worker);
    }
  });
}

function showUpdateButton(worker) {
  state.updateWorker = worker;
  if (els.updateButton) els.updateButton.classList.remove("hidden-install");
}

function applyAppUpdate() {
  if ((state.sheetDirty || state.formDirty) && !confirm("Обновить приложение без сохранения введённых изменений?")) return;
  state.sheetDirty = state.formDirty = false;
  if (!state.updateWorker || state.updateWorker.state === "activated") {
    window.location.reload();
    return;
  }
  state.updateWorker.postMessage({ type: "SKIP_WAITING" });
}

async function installApp() {
  if (isStandalone() || !state.installPrompt) return;
  const promptEvent = state.installPrompt;
  state.installPrompt = null;
  updateInstallButton();
  promptEvent.prompt();
  await promptEvent.userChoice.catch(() => null);
}

function updateInstallButton() {
  if (!els.installButton) return;
  const canInstall = Boolean(state.installPrompt) && !isStandalone();
  els.installButton.classList.toggle("hidden-install", !canInstall);
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function dayBackground(model) {
  if (model.unknown) return "#f3f4ef";
  if (model.isBleed) return "#fbf1ed";
  if (model.phase === "ovulatory" && state.data.settings.showFertility) return "#fbf0db";
  if (model.phase.includes("luteal")) return "#efedf2";
  return "#eef3ea";
}

function markers(model) {
  const output = [];
  if (model.isBleed) output.push('<span class="marker bleed"></span>');
  if (model.isFertile && state.data.settings.showFertility) output.push('<span class="marker fertile"></span>');
  if (hasDiaryEntry(model.date)) output.push('<span class="note-marker"></span>');
  return output.join("");
}

function metricRow(label, value) {
  if (value === null) return `<div class="metric"><span>${label}</span><span> — нет данных</span></div>`;
  return `
    <div class="metric">
      <div class="metric-head"><span>${label}</span><span>${value}</span></div>
      <div class="bar"><span style="width:${value}%"></span></div>
    </div>
  `;
}

function explanationFor(phase, confidenceProfile, cycleStats, bleedStats, cycleContext = null) {
  const basic = `Типичный цикл ${cycleStats.length} дн.; длительность менструации около ${bleedStats.length} дн.`;
  if (state.data.settings.detail === "short") return `${basic} Фаза оценена по датам; овуляция не подтверждена.`;
  const source = cycleStats.source === "history" ? `Расчёт по ${cycleStats.usedIntervals} последним подходящим интервалам, новые имеют больший вес.` : "Для длины цикла пока используется настройка.";
  const bleed = bleedStats.source === "history" ? `Длительность уточнена по ${bleedStats.usedCount} записанным окончаниям.` : "Для длительности менструации пока используется настройка.";
  const known = cycleContext?.nextStartKnown ? " Даты обоих начал известны; фазы между ними остаются предположением." : "";
  const detail = state.data.settings.detail === "full" ? ` Разброс интервалов ${cycleStats.sd.toFixed(1)} дн.; в последних шести записях исключено ${cycleStats.recentExcluded}. Диапазон прогноза эвристический и не имеет клинически проверенного уровня вероятности.` : "";
  return `${basic} ${source} ${bleed}${known}${detail} Даты менструаций не подтверждают овуляцию, не измеряют гормоны и не определяют личное настроение.`;
}

function confidenceText(value) {
  if (value >= 70) return "выше средней";
  if (value >= 48) return "средняя";
  return "низкая";
}

function shortPhase(phase) {
  const map = {
    menstrual: "менстр.",
    early_follicular: "восст.",
    late_follicular: "рост",
    ovulatory: "ферт.",
    early_luteal: "лют.",
    mid_luteal: "лют.",
    late_luteal: "ПМС",
    unknown: "нет данных"
  };
  return map[phase];
}

function logistic(value, steepness = 1) {
  return 1 / (1 + Math.exp(-value * steepness));
}

function gaussian(x, center, sigma) {
  return Math.exp(-((x - center) ** 2) / (2 * sigma ** 2));
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function weightedMedian(values) {
  const weighted = values.map((value, index) => ({ value, weight: index + 1 })).sort((a, b) => a.value - b.value);
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  let running = 0;
  for (const item of weighted) {
    running += item.weight;
    if (running === total / 2) {
      const next = weighted[weighted.indexOf(item) + 1];
      return next ? (item.value + next.value) / 2 : item.value;
    }
    if (running > total / 2) return item.value;
  }
  return weighted[weighted.length - 1]?.value || 0;
}

function standardDeviation(values) {
  if (!values.length) return 0;
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length);
}

function medianAbsoluteDeviation(values, center = median(values)) {
  return median(values.map((value) => Math.abs(value - center)));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function isInputDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = parseDate(value);
  return !Number.isNaN(date.getTime()) && toInputDate(date) === value;
}

function parseDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function stripTime(value) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function startOfMonth(value) {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

function startOfWeek(value) {
  const date = stripTime(value);
  const day = (date.getDay() + 6) % 7;
  return addDays(date, -day);
}

function addDays(value, days) {
  const date = stripTime(value);
  date.setDate(date.getDate() + days);
  return date;
}

function addMonths(value, months) {
  return new Date(value.getFullYear(), value.getMonth() + months, 1);
}

function daysBetween(a, b) {
  return Math.round((stripTime(b) - stripTime(a)) / MS_DAY);
}

function sameDay(a, b) {
  return stripTime(a).getTime() === stripTime(b).getTime();
}

function toInputDate(value) {
  const date = stripTime(value);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(value);
}

function formatWeekday(value) {
  return new Intl.DateTimeFormat("ru-RU", { weekday: "short", day: "numeric" }).format(value);
}

function monthTitle(value) {
  return new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(value);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  })[char]);
}

function predictionText(model) {
  if (model.cycleDay < 1) return "До первой записи: прогноз отсутствует.";
  if (model.overdue) return `Расчётная дата ${formatDate(model.nextStartDate)} прошла. Новое начало не отмечено; цикл не перезапускается автоматически.`;
  if (model.cycleContext.nextStartKnown) return `Следующая запись: ${formatDate(model.nextStartDate)}. Фазы между записями оценочные.`;
  return `Следующая менструация: ~${formatDate(model.nextStartDate)} · ориентир ${formatDate(model.predictionRange.start)} — ${formatDate(model.predictionRange.end)}. Длительность ~${model.bleedStats.length} дн.`;
}

function refreshCurrentDay() {
  const today = toInputDate(new Date());
  if (document.visibilityState !== "visible" || state.renderedDate === today) return;
  state.renderedDate = today;
  if (state.data.cycles.length) {
    renderToday();
    renderCalendar();
    renderForecast();
  }
}

function quantile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * fraction;
  const low = Math.floor(pos);
  return sorted[low] + (sorted[Math.ceil(pos)] - sorted[low]) * (pos - low);
}

function normalizeObservations(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const result = {};
  for (const [date, entry] of Object.entries(input)) {
    if (!isInputDate(date) || !entry || typeof entry !== "object") continue;
    const clean = {};
    for (const key of ["mood", "energy", "pain", "fatigue"]) {
      if (Number.isInteger(entry[key]) && entry[key] >= 0 && entry[key] <= 4) clean[key] = entry[key];
    }
    if (Object.keys(clean).length) result[date] = clean;
  }
  return result;
}

function getPersonalPatterns() {
  const cycles = getSortedCycles();
  const result = [];
  for (const key of ["mood", "energy", "pain", "fatigue"]) {
    const before = [], other = [], pairedCycles = [];
    let observationCount = 0;
    const average = values => values.reduce((a, b) => a + b, 0) / values.length;
    for (let i = Math.max(1, cycles.length - 6); i < cycles.length; i += 1) {
      if (cycles[i].excludeFromPrediction) continue;
      const start = parseDate(cycles[i - 1].start), end = parseDate(cycles[i].start);
      const length = daysBetween(start, end);
      if (length < MIN_VALID_CYCLE_DAYS || length > MAX_VALID_CYCLE_DAYS) continue;
      const pre = [], rest = [];
      for (const [date, entry] of Object.entries(state.data.observations)) {
        const when = parseDate(date);
        if (when < start || when >= end || when > stripTime(new Date()) || !Number.isInteger(entry[key])) continue;
        (daysBetween(when, end) <= 5 ? pre : rest).push(entry[key]);
      }
      // Each contributing cycle needs observations in both windows.
      if (pre.length >= 3 && rest.length >= 3) {
        before.push(average(pre)); other.push(average(rest)); pairedCycles.push(i);
        observationCount += pre.length + rest.length;
      }
    }
    if (pairedCycles.length >= 2) {
      result.push({ key, cycles: pairedCycles.length, count: observationCount, before: average(before), other: average(other) });
    }
  }
  return result;
}

function compactDate(date) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(date);
}
function sampleLabel(count) {
  return count ? `по ${count} интервалам` : "пока по настройке";
}
function hasDiaryEntry(date) {
  const key = toInputDate(date);
  return Boolean(state.data.notes[key] || Object.keys(state.data.observations[key] || {}).length);
}
function notifyUser(message) {
  els.appStatus.textContent = message;
  els.appStatus.classList.add("visible");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => els.appStatus.classList.remove("visible"), 3500);
}
function renderInsights() {
  const stats = getCycleStats(), bleed = getBleedStats();
  els.sampleHint.textContent = sampleLabel(stats.usedIntervals);
  els.modelInfo.innerHTML = `<p>Типичный цикл — <strong>${stats.length} дн.</strong> ${stats.usedIntervals ? `Последние ${stats.usedIntervals} подходящих интервалов получают больший вес по мере приближения к сегодняшнему дню.` : "Пока используется значение из настроек."}</p><p>Менструация — около <strong>${bleed.length} дн.</strong> ${bleed.usedCount ? `По ${bleed.usedCount} записанным окончаниям.` : "Пока по настройке; укажите окончание, чтобы уточнить."}</p><p>${stats.recentExcluded ? `В последних шести интервалах ${stats.recentExcluded} не участвуют в прогнозе. Проверьте историю: возможны пропуски записей.` : "Новые даты начала и окончания автоматически уточняют прогноз."}</p><p>${stats.audit.count >= 3 ? `Проверка на вашей прошлой истории: ${stats.audit.count} прогнозов, средняя абсолютная ошибка ${stats.audit.mae.toFixed(1)} дн. Это проверка прошлых данных, не обещание точности в будущем.` : "Для оценки ошибки прошлых прогнозов нужно больше последовательных записей."}</p><p>Диапазон дат — ориентир. Приложение не подтверждает овуляцию и не вычисляет настроение по календарю.</p>`;
  els.historyStats.innerHTML = `<div class="stat-card"><span>Типичный цикл</span><strong>${stats.length} дн.</strong><small>${sampleLabel(stats.usedIntervals)}</small></div><div class="stat-card"><span>Менструация</span><strong>${bleed.length} дн.</strong><small>${bleed.usedCount ? `по ${bleed.usedCount} окончаниям` : "по настройке"}</small></div>`;
  const count = Object.keys(state.data.observations).length;
  const patterns = getPersonalPatterns();
  const names = { mood: "Настроение", energy: "Энергия", pain: "Боль", fatigue: "Усталость" };
  els.personalPatterns.innerHTML = `<p>${count ? `Дней с оценками самочувствия: ${count}.` : "Пока нет оценок самочувствия. Начните с кнопки «Самочувствие» на главном экране."}</p>` + (patterns.length ? patterns.map(pattern => `<div class="pattern-item"><strong>${names[pattern.key]}</strong>: ${Math.abs(pattern.before - pattern.other) < 0.5 ? "без заметной разницы" : pattern.before > pattern.other ? "оценки выше перед менструацией" : "оценки ниже перед менструацией"}<small>Последние 5 дней: ${pattern.before.toFixed(1)} из 4 · остальные: ${pattern.other.toFixed(1)} из 4. ${pattern.cycles} завершённых цикла, ${pattern.count} оценок. Описание ваших записей; не прогноз.</small></div>`).join("") : '<p>Сравнение появится после двух завершённых циклов: в каждом нужны хотя бы 3 оценки за последние 5 дней и 3 в остальные дни. Каждый показатель рассматривается отдельно.</p>');
}

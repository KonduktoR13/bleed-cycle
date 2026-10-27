const STORAGE_KEY = "bleed-cycle-pwa-v1";
const APP_VERSION = "v23";
const MS_DAY = 24 * 60 * 60 * 1000;
const LUTEAL_PRIOR_DAYS = 14;
const MIN_VALID_CYCLE_DAYS = 21;
const MAX_VALID_CYCLE_DAYS = 45;
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
  [
    "onboarding", "dashboard", "cycleForm", "startDateInput", "endDateInput", "cycleLengthInput",
    "cycleNoteInput", "todayCard", "indexRing", "indexValue", "monthTitle", "calendarGrid",
    "phaseStrip", "legend", "forecastList", "historyList", "settingsForm", "settingCycleLength",
    "settingBleedLength", "settingDetail", "settingTheme", "settingPrivate", "daySheet",
    "sheetContent", "exportButton", "importInput", "clearButton", "addCycleButton",
    "prevMonth", "nextMonth", "todayButton", "quickStartButton", "quickEndButton", "importWelcome", "privacyLockButton", "installButton", "updateButton"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
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
    saveAndRender();
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
    state.data.settings.cycleLength = clamp(Number(els.settingCycleLength.value), 21, 45);
    state.data.settings.bleedLength = clamp(Number(els.settingBleedLength.value), 1, 10);
    state.data.settings.detail = els.settingDetail.value;
    state.data.settings.theme = els.settingTheme.value;
    state.data.settings.privateMode = els.settingPrivate.checked;
    saveAndRender();
  });

  els.todayButton.addEventListener("click", () => { state.visibleMonth = startOfMonth(new Date()); render(); });
  els.quickStartButton.addEventListener("click", () => openCycleSheet());
  els.quickEndButton.addEventListener("click", () => openCycleSheet(getLatestCycle()));
  els.importWelcome.addEventListener("change", importData);
  document.addEventListener("keydown", (event) => {
    if (!els.daySheet.classList.contains("open")) return;
    if (event.key === "Escape") closeSheet();
    if (event.key === "Tab") {
      const nodes = [...els.daySheet.querySelectorAll('button, input, textarea, select, [tabindex="0"]')].filter(node => !node.disabled);
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
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
    overrides: {},
    settings: {
      cycleLength: 28,
      bleedLength: 5,
      detail: "balanced",
      theme: "soft",
      privateMode: false,
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
    overrides: source.overrides && typeof source.overrides === "object" ? source.overrides : fallback.overrides,
    settings: {
      ...fallback.settings,
      ...(source.settings || {}),
      cycleLength: Math.round(clamp(Number(source.settings?.cycleLength) || 28, 21, 45)),
      bleedLength: Math.round(clamp(Number(source.settings?.bleedLength) || 5, 1, 10)),
      detail: ["short", "balanced", "full"].includes(source.settings?.detail) ? source.settings.detail : "balanced",
      theme: source.settings?.theme === "contrast" ? "contrast" : "soft"
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
}

function renderToday() {
  const today = buildDayModel(new Date());
  const latest = getLatestCycle();
  els.quickEndButton.classList.toggle("hidden", Boolean(latest.end));
  els.todayCard.innerHTML = `
    <p class="eyebrow">Сегодня, ${formatDate(today.date)}</p>
    <h2>${today.phaseLabel}</h2>
    <p>${today.summary}</p>
    <p class="history-meta">${today.cycleDay > 0 ? `День ${today.cycleDay} · ориентир ${today.cycleStats.length} дн.` : "До первой записи"} · надёжность дат ${confidenceText(today.confidence)}</p>
    <p class="history-meta">${predictionText(today)}</p>
    ${today.isBleed ? `<p class="history-meta">Окончание этой менструации: ${latest.end ? "" : "~"}${formatDate(addDays(parseDate(latest.start), today.bleedLength - 1))}${latest.end ? " · отмечено" : " · по длительности из истории"}.</p>` : ""}
  `;
  els.indexValue.textContent = today.metrics.load === null ? "—" : String(today.metrics.load);
  const offset = 314 - (314 * (today.metrics.load || 0)) / 100;
  els.indexRing.style.strokeDashoffset = String(offset);
}

function renderCalendar() {
  els.monthTitle.textContent = monthTitle(state.visibleMonth);
  els.calendarGrid.innerHTML = "";
  const start = startOfWeek(startOfMonth(state.visibleMonth));
  for (let i = 0; i < 42; i += 1) {
    const date = addDays(start, i);
    const model = buildDayModel(date);
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "day-cell";
    cell.style.background = dayBackground(model);
    cell.style.setProperty("--phase-color", phaseColors[model.phase]);
    cell.style.setProperty("--load-color", loadColor(model.metrics.load));
    cell.style.opacity = model.unknown ? "0.65" : "1";
    cell.classList.toggle("outside", date.getMonth() !== state.visibleMonth.getMonth());
    cell.classList.toggle("today", sameDay(date, new Date()));
    if (sameDay(date, new Date())) cell.setAttribute("aria-current", "date");
    cell.classList.toggle("recorded-bleed", model.isRecordedBleed);
    cell.classList.toggle("predicted", model.isBleed && !model.isRecordedBleed);
    cell.setAttribute(
      "aria-label",
      `${formatDate(date)}, день цикла ${model.cycleDay}, ${model.phaseLabel}, индекс нагрузки ${model.metrics.load ?? "—"}, уверенность ${confidenceText(model.confidence)}`
    );
    cell.innerHTML = `
      <span class="phase-band" aria-hidden="true"></span>
      <strong>${date.getDate()}</strong>
      <div class="day-markers">${markers(model)}</div>
      <small>${shortPhase(model.phase)}</small>
      <span class="load-meter" aria-hidden="true"><span style="width:${model.metrics.load ?? 0}%"></span></span>
    `;
    cell.addEventListener("click", () => openDaySheet(model));
    els.calendarGrid.appendChild(cell);
  }
  renderPhaseStrip();
}

function renderPhaseStrip() {
  els.phaseStrip.innerHTML = "";
  const len = getCycleLength();
  els.phaseStrip.style.gridTemplateColumns = `repeat(${len}, 1fr)`;
  for (let day = 1; day <= len; day += 1) {
    const latest = getLatestCycle();
    const model = buildDayModel(addDays(parseDate(latest.start), day - 1));
    const chip = document.createElement("span");
    chip.className = "phase-chip";
    chip.style.background = phaseColors[model.phase];
    chip.title = `${day}: ${model.phaseLabel}`;
    els.phaseStrip.appendChild(chip);
  }
}

function renderLegend() {
  const items = [
    { label: "Фон клетки: модель нагрузки", swatch: "background: linear-gradient(90deg, #e7f4ef, #f6e7a8, #ef9a87, #c97b97)" },
    { label: "Верхняя полоска: фаза цикла", swatch: `background: linear-gradient(90deg, ${phaseColors.menstrual}, ${phaseColors.early_follicular}, ${phaseColors.late_follicular}, ${phaseColors.ovulatory}, ${phaseColors.late_luteal})` },
    { label: "Нижняя полоска: сила нагрузки", swatch: "background: linear-gradient(90deg, #5da995 18%, transparent 18%, transparent 28%, #d69f3d 28%, #d69f3d 62%, transparent 62%, transparent 72%, #9a527c 72%)" },
    { label: "Капля: запись / пунктир — прогноз", marker: "bleed" },
    { label: "Ромб: оценка фертильного окна", marker: "fertile" },
    { label: "Квадрат: больше поддержки", marker: "support" }
  ];
  els.legend.innerHTML = items.map((item) => `
    <div class="legend-item">
      ${item.marker ? `<span class="marker ${item.marker}"></span>` : `<span class="legend-swatch" style="${item.swatch}"></span>`}
      <span>${item.label}</span>
    </div>
  `).join("");
}

function renderForecast() {
  els.forecastList.innerHTML = "";
  for (let i = 0; i < 5; i += 1) {
    const model = buildDayModel(addDays(new Date(), i));
    const item = document.createElement("button");
    item.type = "button";
    item.className = "forecast-item";
    item.innerHTML = `
      <strong>${i === 0 ? "Сегодня" : formatWeekday(model.date)}</strong>
      <span>${shortRecommendation(model)}</span>
      <span class="score-pill">${model.metrics.load ?? "—"}</span>
    `;
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
  const uncertainGap = hasKnownNextStart && (cycleLen < MIN_VALID_CYCLE_DAYS || cycleLen > MAX_VALID_CYCLE_DAYS);
  const recordedBleed = !beforeHistory && !projectedCycles && (sameDay(date, baseStart) || Boolean(cycle.end && date <= parseDate(cycle.end)));
  const unknown = beforeHistory || (overdue || uncertainGap) && !recordedBleed && cycleDay > bleedLen;
  const confidenceProfile = { ...getConfidenceProfile(cycleStats, bleedStats) };
  confidenceProfile.timing = clamp(confidenceProfile.timing - projectedCycles * 12 - (overdue ? 20 : 0), 18, 88);
  confidenceProfile.overall = unknown ? 20 : confidenceProfile.timing;
  const rangeDays = Math.ceil(Math.max(2 + Math.max(0, 4 - cycleStats.usedIntervals), cycleStats.sd * 1.5) * Math.sqrt(projectedCycles + 1));
  const fertileWindow = {
    startDay: clamp(ovulationDay - 5, 1, cycleLen),
    endDay: clamp(ovulationDay + 1, 1, cycleLen)
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
    hormone: hormoneText(phase),
    summary: summaryText(phase, metrics),
    recommendations: recommendationsFor(phase, metrics),
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
      note: typeof cycle.note === "string" ? cycle.note : ""
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

function getTypicalBleedLength() {
  return getBleedStats().length;
}

function getCycleStats() {
  const records = getCycleIntervalRecords();
  const validLengths = records.filter((record) => record.valid).map((record) => record.length);
  const recent = validLengths.slice(-RECENT_SAMPLE_LIMIT);
  const fallback = clamp(Number(state.data.settings.cycleLength) || 28, MIN_VALID_CYCLE_DAYS, MAX_VALID_CYCLE_DAYS);
  return {
    length: recent.length ? Math.round(weightedMedian(recent)) : fallback,
    sd: recent.length >= 3 ? standardDeviation(recent) : 4,
    intervals: records,
    validIntervals: validLengths.length,
    usedIntervals: recent.length,
    excludedIntervals: records.filter((record) => !record.valid).length,
    source: recent.length ? "history" : "default"
  };
}

function getCycleIntervalRecords() {
  const cycles = getSortedCycles();
  const records = [];
  for (let i = 1; i < cycles.length; i += 1) {
    const previous = cycles[i - 1];
    const current = cycles[i];
    records.push({
      from: previous.start,
      to: current.start,
      length: daysBetween(parseDate(previous.start), parseDate(current.start)),
      valid: true,
      reason: ""
    });
  }

  const bounded = records
    .filter((record) => record.length >= MIN_VALID_CYCLE_DAYS && record.length <= MAX_VALID_CYCLE_DAYS)
    .map((record) => record.length);
  const center = bounded.length ? median(bounded) : null;
  const mad = bounded.length >= 4 ? medianAbsoluteDeviation(bounded, center) : 0;
  const outlierThreshold = Math.max(7, 3 * mad * 1.4826);

  return records.map((record) => {
    if (record.length < MIN_VALID_CYCLE_DAYS) {
      return { ...record, valid: false, reason: "короче 21 дня" };
    }
    if (record.length > MAX_VALID_CYCLE_DAYS) {
      return { ...record, valid: false, reason: "длиннее 45 дней" };
    }
    if (bounded.length >= 4 && Math.abs(record.length - center) > outlierThreshold) {
      return { ...record, valid: false, reason: "статистический выброс" };
    }
    return record;
  });
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
  let timing = cycleStats.source === "history" ? 34 + Math.min(cycleStats.validIntervals, RECENT_SAMPLE_LIMIT) * 8 : 30;
  timing -= Math.max(0, cycleStats.sd - 3) * 5;
  timing -= cycleStats.excludedIntervals * 2;
  timing = clamp(Math.round(timing), 18, 88);

  let bleed = bleedStats.source === "history" ? 38 + Math.min(bleedStats.sampleCount, RECENT_SAMPLE_LIMIT) * 7 : 34;
  bleed -= Math.max(0, bleedStats.sd - 1.5) * 4;
  bleed = clamp(Math.round(bleed), 24, 86);

  const fertility = clamp(Math.round(timing - 14 - Math.max(0, cycleStats.sd - 4) * 2), 14, 76);
  const emotional = 25; // Dates alone cannot validate an individual emotional forecast.
  const overall = clamp(Math.round(timing * 0.34 + bleed * 0.18 + fertility * 0.18 + emotional * 0.3), 20, 86);
  return { overall, timing, bleed, fertility, emotional };
}

function getConfidence() {
  return getConfidenceProfile().overall;
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
  const metricNames = [
    ["stability", "Эмоциональная стабильность"],
    ["sensitivity", "Чувствительность"],
    ["irritability", "Индекс раздражительности"],
    ["anxiety", "Тревожность"],
    ["energy", "Энергия"],
    ["fatigue", "Усталость"],
    ["social", "Социальная открытость"],
    ["libido", "Либидо"],
    ["fertility", "Фертильное окно, индекс"],
    ["support", "Потребность в поддержке"],
    ["conflict", "Риск конфликтности"],
    ["seriousTalk", "Комфорт для серьёзных разговоров"],
    ["activePlans", "Комфорт для активных планов"],
    ["pms", "Ориентир ПМС-симптомов"]
  ];
  els.sheetContent.innerHTML = `
    <div class="sheet-title">
      <p class="eyebrow">${formatDate(model.date)} · день цикла ${model.cycleDay}</p>
      <h2 id="sheetTitle">${model.phaseLabel}</h2>
      <p class="scale-note">${model.isRecordedBleed ? "Менструация отмечена в истории." : model.unknown ? "Недостаточно записей для расчёта." : "Фаза рассчитана по датам и не подтверждена наблюдениями."}</p>
      <p>${model.summary}</p>
    </div>
    <div class="history-meta">
      <span>Общая уверенность ${confidenceText(model.confidence)}</span>
      <span>Модель фазы: ${model.hormone}</span>
      <span>${predictionText(model)}</span>
    </div>
    <div class="confidence-grid" aria-label="Уверенность расчёта">
      ${confidenceItem("Цикл", model.confidenceProfile.timing)}
      ${confidenceItem("Менструация", model.confidenceProfile.bleed)}
      ${confidenceItem("Фертильность", model.confidenceProfile.fertility)}
      ${confidenceItem("Самочувствие", model.confidenceProfile.emotional)}
    </div>
    <p class="scale-note">Шкалы 0–100 — относительные индексы внутри расчётного цикла, а не медицинские проценты и не точная вероятность беременности.</p>
    <div class="metric-list">
      ${(state.data.settings.detail === "short" ? metricNames.filter(([key]) => ["energy", "fatigue", "support", "pms"].includes(key)) : metricNames).map(([key, label]) => metricRow(label, model.metrics[key])).join("")}
    </div>
    <div class="note-box">
      <strong>Рекомендации по общению</strong>
      <p>${(state.data.settings.detail === "short" ? model.recommendations.slice(0, 1) : model.recommendations).join(" ")}</p>
    </div>
    <label class="day-note-label"><span>Заметка о самочувствии</span><textarea id="dayNote" rows="3" placeholder="Как вы себя чувствуете на самом деле?"></textarea></label>
    <button class="secondary-button" id="saveDayNote" type="button">Сохранить заметку</button>
    <p id="noteStatus" role="status"></p>
    <div class="info-block">
      <h3>Почему такой прогноз</h3>
      <p>${model.explanation}</p>
      ${state.data.settings.detail === "full" ? `<p>Разброс интервалов: ${model.cycleStats.sd.toFixed(1)} дн. Диапазон дат — ориентир, а не статистически проверенный доверительный интервал.</p>` : ""}
    </div>
  `;
  const key = toInputDate(model.date);
  document.getElementById("dayNote").value = typeof state.data.notes[key] === "string" ? state.data.notes[key] : "";
  document.getElementById("saveDayNote").addEventListener("click", () => {
    const value = document.getElementById("dayNote").value.trim();
    if (value) state.data.notes[key] = value;
    else delete state.data.notes[key];
    if (saveData()) {
      document.getElementById("noteStatus").textContent = "Заметка сохранена на устройстве";
      const cell = [...els.calendarGrid.children].find(cell => cell.getAttribute("aria-label").startsWith(`${formatDate(model.date)},`));
      if (cell) cell.querySelector(".day-markers").innerHTML = markers(model);
    }
  });
  showSheet();
}

function openCycleSheet(cycle = null) {
  cycle ||= state.data.cycles.find(item => item.start === toInputDate(new Date())) || null;
  const template = document.getElementById("addCycleTemplate");
  els.sheetContent.innerHTML = `<h2 id="sheetTitle">${cycle ? "Изменить цикл" : "Добавить цикл"}</h2>`;
  els.sheetContent.appendChild(template.content.cloneNode(true));
  document.getElementById("newCycleStart").value = toInputDate(new Date());
  document.getElementById("newCycleStart").max = toInputDate(new Date());
  document.getElementById("newCycleEnd").max = toInputDate(new Date());
  if (cycle) {
    document.getElementById("newCycleStart").value = cycle.start;
    document.getElementById("newCycleEnd").value = cycle.end || "";
    document.getElementById("newCycleNote").value = cycle.note || "";
  }
  document.getElementById("newCycleSubmit").textContent = cycle ? "Сохранить" : "Добавить";
  document.getElementById("newCycleForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const saved = upsertCycle({
      start: document.getElementById("newCycleStart").value,
      end: document.getElementById("newCycleEnd").value || "",
      note: document.getElementById("newCycleNote").value.trim()
    }, cycle?.start || null);
    if (!saved) return;
    closeSheet();
    saveAndRender();
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
  state.sheetOpener = document.activeElement;
  els.daySheet.classList.add("open");
  els.daySheet.setAttribute("aria-hidden", "false");
  document.body.classList.add("sheet-open");
  els.daySheet.querySelector("input, button").focus();
}

function closeSheet() {
  els.daySheet.classList.remove("open");
  els.daySheet.setAttribute("aria-hidden", "true");
  document.body.classList.remove("sheet-open");
  state.sheetOpener?.focus();
}

function switchView(view) {
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === view));
  document.querySelectorAll(".view").forEach((node) => node.classList.toggle("active", node.id === `${view}View`));
}

function applyThemeAndPrivacy() {
  document.body.classList.toggle("theme-contrast", state.data.settings.theme === "contrast");
  document.getElementById("app").classList.toggle("private", Boolean(state.data.settings.privateMode));
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
      const normalized = normalizeData(imported);
      if (imported.cycles.length && !normalized.cycles.length) throw new Error("no valid cycles");
      if (state.data.cycles.length && !confirm("Заменить текущую историю и настройки данными из файла? Сначала можно отменить и экспортировать свою историю.")) return;
      state.data = normalized;
      saveAndRender();
    } catch {
      alert("Не удалось импортировать файл. Проверьте, что это JSON-экспорт приложения.");
    }
  };
  reader.readAsText(file);
}

function clearData() {
  if (!confirm("Удалить всю локальную историю циклов и настройки?")) return;
  state.data = defaultData();
  saveAndRender();
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  let refreshing = false;
  let hasBeenControlled = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    if (!hasBeenControlled) { hasBeenControlled = true; return; }
    if (els.daySheet.classList.contains("open") || document.activeElement?.closest("form")) {
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
  const load = model.metrics.load;
  if (load === null) return "var(--surface)";
  const alpha = 0.82 + model.confidence / 500;
  if (load < 20) return `linear-gradient(135deg, rgba(231,244,239,${alpha}), rgba(250,253,250,0.98))`;
  if (load < 40) return `linear-gradient(135deg, rgba(210,235,238,${alpha}), rgba(239,248,244,0.96))`;
  if (load < 60) return `linear-gradient(135deg, rgba(246,231,168,${alpha}), rgba(242,199,120,0.58))`;
  if (load < 80) return `linear-gradient(135deg, rgba(242,181,125,${alpha}), rgba(232,145,116,0.62))`;
  return `linear-gradient(135deg, rgba(239,154,135,${alpha}), rgba(201,123,151,0.72))`;
}

function loadColor(load) {
  if (load < 20) return "#5da995";
  if (load < 40) return "#62a8b5";
  if (load < 60) return "#d69f3d";
  if (load < 80) return "#d97862";
  return "#9a527c";
}

function markers(model) {
  const output = [];
  if (state.data.notes[toInputDate(model.date)]) output.push('<span class="note-marker" title="Есть заметка">•</span>');
  const supportMarker = model.metrics.support >= 58 || (model.isBleed && model.metrics.fatigue >= 58);
  if (model.isBleed) output.push('<span class="marker bleed" title="Менструация"></span>');
  if (model.isFertile) output.push('<span class="marker fertile" title="Фертильное окно"></span>');
  if (supportMarker) output.push('<span class="marker support" title="Больше поддержки"></span>');
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

function confidenceItem(label, value) {
  return `
    <div class="confidence-item">
      <span>${label}</span>
      <strong>${confidenceText(value)}</strong>
    </div>
  `;
}

function hormoneText(phase) {
  if (phase === "unknown") return "Фаза и гормональный фон не определены";
  const map = {
    menstrual: "после падения эстрогена и прогестерона",
    early_follicular: "низкий прогестерон, постепенное восстановление эстрадиола",
    late_follicular: "растущий эстрадиол, низкий прогестерон",
    ovulatory: "оценочный пик эстрогена вокруг овуляции",
    early_luteal: "начало роста прогестерона",
    mid_luteal: "лютеиновая фаза с более высоким прогестероном",
    late_luteal: "позднелютеиновое снижение гормонов перед новым циклом"
  };
  return map[phase];
}

function summaryText(phase, metrics) {
  if (phase === "unknown") return "Нет подтверждённых данных для определения фазы. Добавьте пропущенную менструацию, если она была.";
  if (phase === "menstrual") return "Возможен более спокойный темп. Реальное самочувствие важнее расчёта.";
  if (phase === "ovulatory") return "Окно около предполагаемой овуляции. Оценка только по календарю.";
  if (phase === "late_luteal") return "Расчётное предменструальное окно. Симптомы индивидуальны.";
  if (metrics.energy > 72 && metrics.social > 65) return "День выглядит ресурсным: активность, общение и лёгкие планы могут даваться проще.";
  if (metrics.stability > 70 && metrics.seriousTalk > 68) return "Фон выглядит относительно ровным; сложные темы лучше всё равно обсуждать спокойно и с согласием на разговор.";
  return "Ориентировочный фон ближе к нейтральному; реальные ощущения могут сильнее зависеть от сна, стресса и событий дня.";
}

function recommendationsFor(phase, metrics) {
  if (phase === "unknown") return ["Ориентируйтесь на реальное самочувствие: календарь сейчас не может оценить фазу."];
  const recs = [];
  if (metrics.fatigue >= 72) {
    recs.push("Практично начать с бытовой помощи: еда, покупки, тишина, перенос необязательных дел.");
  } else if (metrics.energy >= 72 && metrics.activePlans >= 65) {
    recs.push("Можно предлагать прогулку, дела вне дома или совместные планы, но лучше оставить простой вариант отказа.");
  }

  if (metrics.sensitivity >= 70) {
    recs.push("Критику, шутки на острые темы и оценочные формулировки лучше отложить или сказать максимально мягко.");
  } else if (metrics.stability >= 72) {
    recs.push("Для обсуждения бытовых решений день выглядит спокойнее обычного; всё равно стоит сначала спросить, удобно ли говорить.");
  }

  if (metrics.irritability >= 68 || metrics.conflict >= 68) {
    recs.push("Если разговор накаляется, лучше сделать паузу и вернуться к теме позже, без попытки доказать правоту сразу.");
  } else if (metrics.social >= 70) {
    recs.push("Общение, гости или короткие совместные активности могут быть комфортнее, если нет усталости и стресса.");
  }

  if (metrics.anxiety >= 65) {
    recs.push("Помогают конкретика и предсказуемость: договориться о времени, плане и следующих шагах без давления.");
  }

  if (metrics.support >= 70) {
    recs.push("Лучший формат поддержки сегодня — спросить, что снять с неё прямо сейчас, и выполнить без долгого обсуждения.");
  }

  if (phase === "ovulatory" && metrics.libido >= 70) {
    recs.push("Сексуальный интерес по модели может быть выше, но инициатива всё равно должна быть бережной и опираться на явное согласие.");
  }

  if (metrics.fertility >= 70) {
    recs.push("Если беременность сейчас нежелательна, не полагайтесь на календарь как на контрацепцию: фертильное окно здесь только приблизительное.");
  }

  if (!recs.length) {
    recs.push("Подойдёт обычный внимательный тон: задавать прямые вопросы, не додумывать состояние по календарю и не спорить с реальными ощущениями.");
  }
  recs.push("Прогноз ориентировочный и может не совпадать с реальным состоянием.");
  return recs;
}

function explanationFor(phase, confidenceProfile, cycleStats, bleedStats, cycleContext = null) {
  const cycleSource = cycleStats.source === "history"
    ? `Длина цикла ${cycleStats.length} дн. рассчитана по ${cycleStats.usedIntervals} последним валидным интервалам из ${cycleStats.validIntervals}.`
    : `Длина цикла ${cycleStats.length} дн. взята из настройки по умолчанию, потому что валидной истории пока мало.`;
  const actualSpan = cycleContext?.source === "actual"
    ? ` Для этого дня уже известна следующая фактическая менструация, поэтому участок считается фактическим циклом длиной ${cycleContext.length} дн., а не старым прогнозным перезапуском.`
    : "";
  const excluded = cycleStats.excludedIntervals
    ? ` ${cycleStats.excludedIntervals} интервал(а) не участвует в типичной оценке как слишком короткий, длинный или выброс.`
    : "";
  const bleedSource = bleedStats.source === "history"
    ? `Типичная менструация ${bleedStats.length} дн. рассчитана по ${bleedStats.usedCount} последним датам окончания.`
    : `Типичная менструация ${bleedStats.length} дн. взята из настройки по умолчанию.`;
  return `${cycleSource}${actualSpan}${excluded} ${bleedSource} Фертильное окно строится вокруг оценочной овуляции примерно за ${LUTEAL_PRIOR_DAYS} дней до следующей менструации; это не точный расчёт зачатия. Эмоциональные индексы используют плавные окна из модели: позднелютеиновый риск, перименструальный след, фолликулярное восстановление и фертильное окно. Даты не позволяют предсказать личное настроение, либидо или конфликтность. Индексы — общая иллюстративная модель, которая не обучается на вашем самочувствии.`;
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

function estimateCycleLengthFor() {
  return getCycleLength();
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
    if (running >= total / 2) return item.value;
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

function normalizeCycleDay(day, cycleLen) {
  while (day < 1) day += cycleLen;
  while (day > cycleLen) day -= cycleLen;
  return day;
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

function shortRecommendation(model) {
  if (model.unknown) return "Уточните записи в истории";
  if (model.metrics.fatigue >= 72) return "Можно предложить помощь и отдых";
  if (model.metrics.support >= 70) return "Спросите, какая поддержка нужна";
  if (model.metrics.energy >= 72) return "Можно предложить прогулку";
  return "Сверьтесь с реальным самочувствием";
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

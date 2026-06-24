const STORAGE_KEY = "bleed-cycle-pwa-v1";
const MS_DAY = 24 * 60 * 60 * 1000;

const phaseLabels = {
  menstrual: "Менструальная фаза",
  early_follicular: "Ранняя фолликулярная",
  late_follicular: "Поздняя фолликулярная",
  ovulatory: "Фертильное окно",
  early_luteal: "Ранняя лютеиновая",
  mid_luteal: "Средняя лютеиновая",
  late_luteal: "Поздняя лютеиновая"
};

const phaseColors = {
  menstrual: "#d97862",
  early_follicular: "#7fb6ba",
  late_follicular: "#78b7a4",
  ovulatory: "#f2b66d",
  early_luteal: "#9fc7a0",
  mid_luteal: "#b7a176",
  late_luteal: "#7d5b75"
};

const state = {
  data: loadData(),
  visibleMonth: startOfMonth(new Date()),
  selectedDate: stripTime(new Date()),
  installPrompt: null
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
});

function bindElements() {
  [
    "onboarding", "dashboard", "cycleForm", "startDateInput", "endDateInput", "cycleLengthInput",
    "cycleNoteInput", "todayCard", "indexRing", "indexValue", "monthTitle", "calendarGrid",
    "phaseStrip", "legend", "forecastList", "historyList", "settingsForm", "settingCycleLength",
    "settingBleedLength", "settingDetail", "settingTheme", "settingPrivate", "daySheet",
    "sheetContent", "exportButton", "importInput", "clearButton", "addCycleButton",
    "prevMonth", "nextMonth", "privacyLockButton", "installButton"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function initializeDates() {
  const now = new Date();
  const today = toInputDate(now);
  els.startDateInput.value = today;
  els.newCycleStart?.setAttribute("max", today);
  state.selectedDate = stripTime(now);
  state.visibleMonth = startOfMonth(now);
}

function bindEvents() {
  els.cycleForm.addEventListener("submit", (event) => {
    event.preventDefault();
    upsertCycle({
      start: els.startDateInput.value,
      end: els.endDateInput.value || "",
      note: els.cycleNoteInput.value.trim()
    });
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
    state.data.settings.bleedLength = clamp(Number(els.settingBleedLength.value), 2, 10);
    state.data.settings.detail = els.settingDetail.value;
    state.data.settings.theme = els.settingTheme.value;
    state.data.settings.privateMode = els.settingPrivate.checked;
    saveAndRender();
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
    return { ...defaultData(), ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
  } catch {
    return defaultData();
  }
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
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
  els.todayCard.innerHTML = `
    <p class="eyebrow">Сегодня, ${formatDate(today.date)}</p>
    <h2>${today.phaseLabel}</h2>
    <p>${today.summary}</p>
    <p class="history-meta">День цикла ${today.cycleDay} · уверенность ${confidenceText(today.confidence)}</p>
  `;
  els.indexValue.textContent = String(today.metrics.load);
  const offset = 314 - (314 * today.metrics.load) / 100;
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
    cell.style.opacity = model.confidence < 45 ? "0.72" : "1";
    cell.classList.toggle("outside", date.getMonth() !== state.visibleMonth.getMonth());
    cell.classList.toggle("today", sameDay(date, new Date()));
    cell.innerHTML = `
      <span class="phase-band" aria-hidden="true"></span>
      <strong>${date.getDate()}</strong>
      <div class="day-markers">${markers(model)}</div>
      <small>${shortPhase(model.phase)}</small>
      <span class="load-meter" aria-hidden="true"><span style="width:${model.metrics.load}%"></span></span>
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
    { label: "Фон клетки: индекс нагрузки", swatch: "background: linear-gradient(90deg, #e7f4ef, #f6e7a8, #ef9a87, #c97b97)" },
    { label: "Верхняя полоска: фаза цикла", swatch: `background: linear-gradient(90deg, ${phaseColors.menstrual}, ${phaseColors.early_follicular}, ${phaseColors.late_follicular}, ${phaseColors.ovulatory}, ${phaseColors.late_luteal})` },
    { label: "Нижняя полоска: сила нагрузки", swatch: "background: linear-gradient(90deg, #5da995 18%, transparent 18%, transparent 28%, #d69f3d 28%, #d69f3d 62%, transparent 62%, transparent 72%, #9a527c 72%)" },
    { label: "Капля: менструация", marker: "bleed" },
    { label: "Ромб: фертильное окно", marker: "fertile" },
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
      <span>${model.recommendations[0]}</span>
      <span class="score-pill">${model.metrics.load}</span>
    `;
    item.addEventListener("click", () => openDaySheet(model));
    els.forecastList.appendChild(item);
  }
}

function renderHistory() {
  const cycles = [...state.data.cycles].sort((a, b) => b.start.localeCompare(a.start));
  els.historyList.innerHTML = cycles.map((cycle, index) => {
    const next = cycles[index - 1];
    const prevChronological = state.data.cycles.sort((a, b) => a.start.localeCompare(b.start))[state.data.cycles.findIndex((c) => c.start === cycle.start) + 1];
    const len = next ? daysBetween(parseDate(cycle.start), parseDate(next.start)) : estimateCycleLengthFor(cycle, prevChronological);
    const bleed = cycle.end ? daysBetween(parseDate(cycle.start), parseDate(cycle.end)) + 1 : state.data.settings.bleedLength;
    const avg = getCycleLength();
    const drift = len ? len - avg : 0;
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
          <span>${len ? `${len} дн. цикл` : "длина уточняется"}</span>
          <span>${bleed} дн. менструация</span>
          <span>${drift === 0 ? "около среднего" : `${drift > 0 ? "+" : ""}${drift} дн. к среднему`}</span>
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

function renderSettings() {
  els.settingCycleLength.value = getCycleLength();
  els.settingBleedLength.value = state.data.settings.bleedLength;
  els.settingDetail.value = state.data.settings.detail;
  els.settingTheme.value = state.data.settings.theme;
  els.settingPrivate.checked = state.data.settings.privateMode;
}

function buildDayModel(dateLike) {
  const date = stripTime(dateLike);
  const cycleLen = getCycleLength();
  const cycle = getCycleForDate(date);
  const start = getCycleAnchorStart(cycle, date, cycleLen);
  const bleedLen = getBleedLength(cycle);
  const cycleDay = daysBetween(start, date) + 1;
  const projectedStart = addDays(start, cycleLen);
  const ovulation = addDays(projectedStart, -12);
  const ovulationDay = daysBetween(start, ovulation) + 1;
  const daysToNext = daysBetween(date, projectedStart);
  const cycleSd = getCycleSd();
  const confidence = getConfidence(cycleSd);

  let phase = "mid_luteal";
  if (cycleDay <= bleedLen) phase = "menstrual";
  else if (cycleDay <= bleedLen + 4) phase = "early_follicular";
  else if (cycleDay < ovulationDay - 2) phase = "late_follicular";
  else if (cycleDay <= ovulationDay + 2) phase = "ovulatory";
  else if (daysToNext > 9) phase = "early_luteal";
  else if (daysToNext > 5) phase = "mid_luteal";
  else phase = "late_luteal";

  const signals = cycleSignals(cycleDay, cycleLen, bleedLen);
  const raw = rawMetrics(signals);
  const metrics = normalizedMetricsForDay(cycleDay, cycleLen, bleedLen, raw);

  return {
    date,
    cycleDay,
    phase,
    phaseLabel: phaseLabels[phase],
    confidence,
    metrics,
    hormone: hormoneText(phase),
    summary: summaryText(phase, metrics),
    recommendations: recommendationsFor(phase, metrics),
    explanation: explanationFor(phase, confidence),
    isBleed: cycleDay <= bleedLen,
    isFertile: metrics.fertility >= 70
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

function getCycleAnchorStart(cycle, date, cycleLen) {
  const baseStart = parseDate(cycle.start);
  const diff = daysBetween(baseStart, date);
  const offset = Math.floor(diff / cycleLen) * cycleLen;
  return addDays(baseStart, offset);
}

function upsertCycle(cycle) {
  if (!cycle.start) return;
  const existing = state.data.cycles.findIndex((item) => item.start === cycle.start);
  if (existing >= 0) state.data.cycles[existing] = cycle;
  else state.data.cycles.push(cycle);
  state.data.cycles.sort((a, b) => a.start.localeCompare(b.start));
}

function getLatestCycle() {
  return [...state.data.cycles].sort((a, b) => b.start.localeCompare(a.start))[0];
}

function getCycleLength() {
  const starts = state.data.cycles.map((cycle) => parseDate(cycle.start)).sort((a, b) => a - b);
  const diffs = [];
  for (let i = 1; i < starts.length; i += 1) {
    const diff = daysBetween(starts[i - 1], starts[i]);
    if (diff >= 21 && diff <= 45) diffs.push(diff);
  }
  if (diffs.length >= 2) return Math.round(median(diffs.slice(-6)));
  return Number(state.data.settings.cycleLength) || 28;
}

function getCycleSd() {
  const starts = state.data.cycles.map((cycle) => parseDate(cycle.start)).sort((a, b) => a - b);
  const diffs = [];
  for (let i = 1; i < starts.length; i += 1) diffs.push(daysBetween(starts[i - 1], starts[i]));
  if (diffs.length < 3) return 4;
  const avg = diffs.reduce((sum, value) => sum + value, 0) / diffs.length;
  return Math.sqrt(diffs.reduce((sum, value) => sum + (value - avg) ** 2, 0) / diffs.length);
}

function getBleedLength(cycle) {
  if (cycle.end) return clamp(daysBetween(parseDate(cycle.start), parseDate(cycle.end)) + 1, 2, 10);
  return Number(state.data.settings.bleedLength) || 5;
}

function getConfidence(cycleSd) {
  let score = 38;
  if (state.data.cycles.length >= 3) score += 28;
  if (state.data.cycles.length >= 6) score += 10;
  score -= Math.max(0, cycleSd - 3) * 5;
  return clamp(Math.round(score), 20, 86);
}

function cycleSignals(cycleDay, cycleLen, bleedLen) {
  const ovulationDay = cycleLen - 12;
  const daysToNext = cycleLen - cycleDay + 1;
  const cycleUncertainty = Math.min(getCycleSd(), 8);
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

function normalizedMetricsForDay(cycleDay, cycleLen, bleedLen, raw) {
  const ranges = metricRanges(cycleLen, bleedLen);
  return Object.fromEntries(Object.entries(raw).map(([key, value]) => {
    const range = ranges[key];
    return [key, normalizeToScale(value, range.min, range.max)];
  }));
}

function metricRanges(cycleLen, bleedLen) {
  const ranges = {};
  for (let day = 1; day <= cycleLen; day += 1) {
    const values = rawMetrics(cycleSignals(day, cycleLen, bleedLen));
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
    ["fertility", "Фертильное окно"],
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
      <p>${model.summary}</p>
    </div>
    <div class="history-meta">
      <span>Уверенность ${confidenceText(model.confidence)}</span>
      <span>${model.hormone}</span>
    </div>
    <div class="metric-list">
      ${metricNames.map(([key, label]) => metricRow(label, model.metrics[key])).join("")}
    </div>
    <div class="note-box">
      <strong>Рекомендации по общению</strong>
      <p>${model.recommendations.join(" ")}</p>
    </div>
    <div class="info-block">
      <h3>Почему такой прогноз</h3>
      <p>${model.explanation}</p>
    </div>
  `;
  els.daySheet.classList.add("open");
  els.daySheet.setAttribute("aria-hidden", "false");
}

function openCycleSheet(cycle = null) {
  const template = document.getElementById("addCycleTemplate");
  els.sheetContent.innerHTML = `<h2 id="sheetTitle">${cycle ? "Изменить цикл" : "Добавить цикл"}</h2>`;
  els.sheetContent.appendChild(template.content.cloneNode(true));
  if (cycle) {
    document.getElementById("newCycleStart").value = cycle.start;
    document.getElementById("newCycleEnd").value = cycle.end || "";
    document.getElementById("newCycleNote").value = cycle.note || "";
  }
  document.getElementById("newCycleForm").addEventListener("submit", (event) => {
    event.preventDefault();
    if (cycle && cycle.start !== document.getElementById("newCycleStart").value) {
      state.data.cycles = state.data.cycles.filter((item) => item.start !== cycle.start);
    }
    upsertCycle({
      start: document.getElementById("newCycleStart").value,
      end: document.getElementById("newCycleEnd").value || "",
      note: document.getElementById("newCycleNote").value.trim()
    });
    closeSheet();
    saveAndRender();
  });
  els.daySheet.classList.add("open");
  els.daySheet.setAttribute("aria-hidden", "false");
}

function deleteCycle(start) {
  const cycle = state.data.cycles.find((item) => item.start === start);
  if (!cycle) return;
  if (!confirm(`Удалить запись от ${formatDate(parseDate(start))}?`)) return;
  state.data.cycles = state.data.cycles.filter((item) => item.start !== start);
  saveAndRender();
}

function closeSheet() {
  els.daySheet.classList.remove("open");
  els.daySheet.setAttribute("aria-hidden", "true");
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
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(String(reader.result));
      if (!Array.isArray(imported.cycles)) throw new Error("bad shape");
      state.data = { ...defaultData(), ...imported };
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

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("service-worker.js").catch(() => {});
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
  if (model.isBleed) output.push('<span class="marker bleed" title="Менструация"></span>');
  if (model.isFertile) output.push('<span class="marker fertile" title="Фертильное окно"></span>');
  if (model.metrics.support >= 58) output.push('<span class="marker support" title="Больше поддержки"></span>');
  return output.join("");
}

function metricRow(label, value) {
  return `
    <div class="metric">
      <div class="metric-head"><span>${label}</span><span>${value}</span></div>
      <div class="bar"><span style="width:${value}%"></span></div>
    </div>
  `;
}

function hormoneText(phase) {
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
  if (phase === "menstrual") return "Модель показывает перименструальное окно: вероятнее ниже ресурс и выше потребность в спокойном темпе.";
  if (phase === "ovulatory") return "Оценочное фертильное окно вокруг предполагаемой овуляции: у части женщин выше энергия, социальность и сексуальный интерес.";
  if (phase === "late_luteal") return "Поздняя лютеиновая фаза: чаще растут чувствительность, тревожность, усталость и потребность в поддержке.";
  if (metrics.energy > 72 && metrics.social > 65) return "День выглядит ресурсным: активность, общение и лёгкие планы могут даваться проще.";
  if (metrics.stability > 70 && metrics.seriousTalk > 68) return "Фон выглядит относительно ровным; сложные темы лучше всё равно обсуждать спокойно и с согласием на разговор.";
  return "Ориентировочный фон ближе к нейтральному; реальные ощущения могут сильнее зависеть от сна, стресса и событий дня.";
}

function recommendationsFor(phase, metrics) {
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

function explanationFor(phase, confidence) {
  return `Расчёт использует дату начала менструации, среднюю длину цикла, оценку кровотечения и плавные окна из модели: позднелютеиновый риск, перименструальный след, фолликулярное восстановление и оценочное овуляторно-фертильное окно. Текущая уверенность: ${confidenceText(confidence)}. Без ежедневного дневника симптомов и подтверждения овуляции это вероятностная подсказка, а не описание конкретного поведения или точный расчёт зачатия.`;
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
    late_luteal: "ПМС"
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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeCycleDay(day, cycleLen) {
  while (day < 1) day += cycleLen;
  while (day > cycleLen) day -= cycleLen;
  return day;
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
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  })[char]);
}

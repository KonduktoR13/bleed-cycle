const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function loadModel(seedData = {}) {
  const code = `${fs.readFileSync("app.js", "utf8")}
globalThis.__model = {
  state,
  normalizeData,
  buildDayModel,
  getCycleStats,
  getBleedStats,
  getConfidenceProfile,
  getCycleLength,
  estimateOvulationDay,
  cycleSignals,
  rawMetrics,
  normalizedMetricsForDay,
  normalizeCycleInput,
  parseDate,
  addDays,
  daysBetween
};`;

  const context = {
    alert(message) {
      throw new Error(message);
    },
    confirm() {
      return true;
    },
    document: {
      addEventListener() {},
      getElementById() {
        return null;
      },
      querySelectorAll() {
        return [];
      }
    },
    localStorage: {
      getItem() {
        return JSON.stringify(seedData);
      },
      setItem() {}
    },
    navigator: {},
    window: {
      addEventListener() {},
      matchMedia() {
        return { matches: false };
      },
      navigator: {}
    }
  };

  vm.runInNewContext(code, context, { filename: "app.js" });
  return context.__model;
}

function setData(model, data) {
  model.state.data = model.normalizeData(data);
}

function datesFromIntervals(firstStart, intervals) {
  const model = loadModel();
  const starts = [firstStart];
  let cursor = model.parseDate(firstStart);
  intervals.forEach((interval) => {
    cursor = model.addDays(cursor, interval);
    starts.push(inputDate(cursor));
  });
  return starts;
}

function inputDate(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function testOvulationIsSharedByPhaseAndSignals() {
  const model = loadModel();
  setData(model, {
    cycles: [{ start: "2026-05-31", end: "2026-06-04", note: "" }],
    settings: { cycleLength: 28, bleedLength: 5 }
  });

  const ovulationDay = model.estimateOvulationDay(28);
  assert.equal(ovulationDay, 17);

  const ovulationDate = model.addDays(model.parseDate("2026-05-31"), ovulationDay - 1);
  const day = model.buildDayModel(ovulationDate);
  const signals = model.cycleSignals(ovulationDay, 28, 5, 4);

  assert.equal(day.phase, "ovulatory");
  assert.ok(signals.ovulatory > 0.99);
  assert.equal(day.ovulationDay, ovulationDay);
}

function testRelativeScalesReachMinimumAndMaximum() {
  const model = loadModel();
  setData(model, {
    cycles: [{ start: "2026-05-31", end: "2026-06-04", note: "" }],
    settings: { cycleLength: 28, bleedLength: 5 }
  });

  const keys = Object.keys(model.buildDayModel(model.parseDate("2026-05-31")).metrics);
  const byMetric = Object.fromEntries(keys.map((key) => [key, []]));

  for (let offset = 0; offset < 28; offset += 1) {
    const day = model.buildDayModel(model.addDays(model.parseDate("2026-05-31"), offset));
    keys.forEach((key) => byMetric[key].push(day.metrics[key]));
  }

  keys.forEach((key) => {
    assert.equal(Math.min(...byMetric[key]), 0, `${key} should reach 0`);
    assert.equal(Math.max(...byMetric[key]), 100, `${key} should reach 100`);
  });
}

function testCycleOutlierIsExcluded() {
  const starts = datesFromIntervals("2026-01-01", [28, 28, 28, 40, 28]);
  const model = loadModel();
  setData(model, {
    cycles: starts.map((start) => ({ start, end: "", note: "" })),
    settings: { cycleLength: 28, bleedLength: 5 }
  });

  const stats = model.getCycleStats();
  assert.equal(stats.length, 28);
  assert.equal(stats.excludedIntervals, 1);
  assert.equal(stats.intervals.find((record) => record.length === 40).reason, "статистический выброс");
}

function testBleedLengthLearnsFromEnds() {
  const model = loadModel();
  setData(model, {
    cycles: [
      { start: "2026-01-01", end: "2026-01-05", note: "" },
      { start: "2026-01-29", end: "2026-02-01", note: "" },
      { start: "2026-02-26", end: "2026-03-03", note: "" }
    ],
    settings: { cycleLength: 28, bleedLength: 5 }
  });

  const stats = model.getBleedStats();
  assert.equal(stats.length, 5);
  assert.equal(stats.sampleCount, 3);
  assert.equal(stats.source, "history");
}

function testConfidenceProfileIsSeparated() {
  const starts = datesFromIntervals("2026-01-01", [28, 29, 28, 29, 28, 29]);
  const model = loadModel();
  setData(model, {
    cycles: starts.map((start) => ({ start, end: "", note: "" })),
    settings: { cycleLength: 28, bleedLength: 5 }
  });

  const confidence = model.getConfidenceProfile();
  assert.ok(confidence.timing > confidence.fertility);
  assert.ok(confidence.emotional <= 82);
  assert.ok(confidence.overall >= 20 && confidence.overall <= 86);
}

function testCycleValidationRejectsBadDates() {
  const model = loadModel();
  assert.equal(model.normalizeCycleInput({ start: "2026-06-10", end: "2026-06-09" }).ok, false);
  assert.equal(model.normalizeCycleInput({ start: "2026-06-01", end: "2026-06-20" }).ok, false);
  assert.equal(model.normalizeCycleInput({ start: "2026-06-01", end: "2026-06-05" }).ok, true);
}

[
  testOvulationIsSharedByPhaseAndSignals,
  testRelativeScalesReachMinimumAndMaximum,
  testCycleOutlierIsExcluded,
  testBleedLengthLearnsFromEnds,
  testConfidenceProfileIsSeparated,
  testCycleValidationRejectsBadDates
].forEach((test) => test());

console.log("model tests passed");

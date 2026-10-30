const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function loadModel(seedData = {}, source = fs.readFileSync("app.js", "utf8")) {
  const code = `${source}
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
  daysBetween,
  upsertCycle,
  getForecastAudit: typeof getForecastAudit === "function" ? getForecastAudit : null,
  getPersonalPatterns: typeof getPersonalPatterns === "function" ? getPersonalPatterns : null,
  communicationProfile: typeof communicationProfile === "function" ? communicationProfile : null,
  getPersonalMetricEstimates: typeof getPersonalMetricEstimates === "function" ? getPersonalMetricEstimates : null
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


module.exports = { loadModel, setData, datesFromIntervals, inputDate };

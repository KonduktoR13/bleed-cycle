const assert = require("node:assert/strict");
const {loadModel, setData, datesFromIntervals, inputDate} = require("./model-harness");

function testOvulationIsSharedByPhaseAndSignals() {
  const model = loadModel();
  setData(model, {
    cycles: [{ start: "2026-05-31", end: "2026-06-04", note: "" }],
    settings: { cycleLength: 28, bleedLength: 5 }
  });

  const ovulationDay = model.estimateOvulationDay(28);
  assert.equal(ovulationDay, 15);

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
  assert.equal(stats.intervals.find((record) => record.length === 40).reason, "одиночный нетипичный интервал; проверьте пропуск записей");
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
  assert.equal(stats.length, 6);
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
  assert.equal(model.normalizeCycleInput({ start: "2026-06-01", end: "2026-06-20" }).ok, true);
  assert.equal(model.normalizeCycleInput({ start: "2026-06-01", end: "2026-06-05" }).ok, true);
}

function testKnownLateStartSuppressesOldPredictedBleed() {
  const model = loadModel();
  setData(model, {
    cycles: [
      { start: "2026-05-31", end: "", note: "" },
      { start: "2026-07-30", end: "", note: "" }
    ],
    settings: { cycleLength: 28, bleedLength: 5 }
  });

  const oldPredictedStart = model.buildDayModel(model.parseDate("2026-07-26"));
  const dayBeforeActualStart = model.buildDayModel(model.parseDate("2026-07-29"));
  const actualStart = model.buildDayModel(model.parseDate("2026-07-30"));

  assert.equal(oldPredictedStart.isBleed, false);
  assert.notEqual(oldPredictedStart.phase, "menstrual");
  assert.equal(dayBeforeActualStart.cycleContext.source, "actual");
  assert.equal(dayBeforeActualStart.cycleLength, 60);
  assert.equal(model.daysBetween(dayBeforeActualStart.nextStartDate, model.parseDate("2026-07-30")), 0);
  assert.equal(actualStart.isBleed, true);
  assert.equal(actualStart.phase, "menstrual");
  assert.equal(actualStart.cycleDay, 1);
}

[
  testOvulationIsSharedByPhaseAndSignals,
  testRelativeScalesReachMinimumAndMaximum,
  testCycleOutlierIsExcluded,
  testBleedLengthLearnsFromEnds,
  testConfidenceProfileIsSeparated,
  testCycleValidationRejectsBadDates,
  testKnownLateStartSuppressesOldPredictedBleed
].forEach((test) => test());

console.log("model tests passed");

function testRepresentativeHistory() {
  // Synthetic fixture: a gap followed by 29-, 28- and 31-day intervals.
  const model = loadModel();
  setData(model, {cycles: [
    {start: "2025-01-01"}, {start: "2025-03-02", end: "2025-03-07"},
    {start: "2025-03-31"}, {start: "2025-04-28", end: "2025-05-04"}, {start: "2025-05-29"}
  ]});
  const stats = model.getCycleStats();
  assert.equal(stats.length, 30);
  assert.equal(stats.excludedIntervals, 1);
  assert.equal(stats.intervals[0].length, 60);
  assert.equal(model.getBleedStats().length, 7);
  const day = model.buildDayModel(model.parseDate("2025-05-30"));
  assert.equal(day.cycleDay, 2);
  assert.equal(inputDate(day.nextStartDate), "2025-06-28");
  assert.equal(inputDate(day.predictionRange.start), "2025-06-25");
  assert.equal(inputDate(day.predictionRange.end), "2025-07-01");
  assert.equal(day.isRecordedBleed, false);
  assert.equal(model.buildDayModel(model.parseDate("2025-05-29")).isRecordedBleed, true);
  assert.equal(model.buildDayModel(model.parseDate("2025-02-28")).phase, "unknown");
}

function testNoInventedPastCycles() {
  const model = loadModel();
  setData(model, {cycles: [{start: "2025-01-01", end: "2025-01-01"}]});
  const overdue = model.buildDayModel(model.parseDate("2025-01-29"));
  assert.equal(overdue.cycleDay, 29);
  assert.equal(overdue.isBleed, false);
  assert.equal(overdue.overdue, true);
  assert.equal(overdue.metrics.energy, null);
  const before = model.buildDayModel(model.parseDate("2024-12-31"));
  assert.equal(before.phase, "unknown");
  assert.equal(before.isBleed, false);
  assert.equal(before.isFertile, false);
  assert.equal(model.buildDayModel(model.parseDate("2025-01-02")).isBleed, false);
  assert.equal(model.getBleedStats().length, 1);
}

function testNormalizeMalformedBackup() {
  const model = loadModel();
  const data = model.normalizeData({cycles: [{start: "2026-02-30"}, {start: "2026-01-01", note: {x:1}}, {start: "2026-01-01", end: "2026-01-20"}], settings: {cycleLength: "oops", bleedLength: -10, detail: "oops"}});
  assert.equal(data.cycles.length, 1);
  assert.equal(data.cycles[0].end, "2026-01-20");
  assert.equal(data.settings.cycleLength, 28);
  assert.equal(data.settings.bleedLength, 1);
  assert.equal(data.settings.detail, "balanced");
  assert.equal(model.normalizeCycleInput({start: "2099-01-01"}).ok, false);
}

function testFutureForecastsAreExplicit() {
  const model = loadModel();
  const today = inputDate(new Date());
  setData(model, {cycles: [{start: today, end: today}]});
  const future = model.buildDayModel(model.addDays(model.parseDate(today), 28));
  const now = model.buildDayModel(model.parseDate(today));
  assert.equal(future.cycleDay, 1);
  assert.equal(future.isRecordedBleed, false);
  assert.equal(future.bleedLength, 1);
  assert.ok(future.confidence < now.confidence);
  assert.ok(future.predictionRange.end - future.predictionRange.start > now.predictionRange.end - now.predictionRange.start);
}

[testRepresentativeHistory, testNoInventedPastCycles, testNormalizeMalformedBackup, testFutureForecastsAreExplicit].forEach(test => test());
console.log("history, missing records, validation and forecast regressions passed");

function testEditingCannotReplaceAnotherRecord() {
  const model = loadModel();
  setData(model, {cycles: [{start: "2025-01-01", end: "2025-01-05"}, {start: "2025-02-01"}]});
  assert.throws(() => model.upsertCycle({start: "2025-02-01"}, "2025-01-01"), /уже есть запись/);
  assert.equal(model.state.data.cycles.length, 2);
  assert.throws(() => model.upsertCycle({start: "2025-01-04"}), /пересекаются/);
  assert.equal(model.state.data.cycles.length, 2);
}
testEditingCannotReplaceAnotherRecord();

function testChangedRhythmAndLongCyclesAreLearned() {
  for (const changed of [22,40,60]) {
    const model = loadModel();
    const starts = datesFromIntervals('2023-01-01',[28,28,28,28,28,28,changed,changed]);
    setData(model,{cycles:starts.map(start=>({start}))});
    const stats = model.getCycleStats();
    assert.equal(stats.length,changed,`two consecutive ${changed}-day cycles must influence the new rhythm`);
    assert.equal(stats.intervals.at(-1).valid,true);
    assert.equal(stats.intervals.at(-2).valid,true);
    if (changed === 60) assert.equal(model.buildDayModel(model.addDays(model.parseDate(starts.at(-1)),12)).phase,'unknown','Long-cycle timing is not evidence of an ovulatory phase');
  }
}

function testRecentGapsCannotResurrectAncientHistory() {
  const model = loadModel();
  const starts = datesFromIntervals('2020-01-01',[25,25,25,25,25,100,100,100,100,100,100]);
  setData(model,{cycles:starts.map(start=>({start})),settings:{cycleLength:31}});
  const stats = model.getCycleStats();
  assert.equal(stats.length,31);
  assert.equal(stats.source,'default');
  assert.equal(stats.usedIntervals,0);
  assert.equal(stats.recentExcluded,6);
}

function testManualExclusionAndInclusiveDuration() {
  const model = loadModel();
  const starts = datesFromIntervals('2023-01-01',[28,28,50,50]);
  setData(model,{cycles:starts.map((start,i)=>({start,excludeFromPrediction:i>=3})),settings:{cycleLength:30}});
  assert.equal(model.getCycleStats().length,28);
  assert.equal(model.getCycleStats().intervals.at(-1).valid,false);
  assert.equal(model.state.data.cycles.at(-1).excludeFromPrediction,true,'Exclude flag survives normalization');
  assert.equal(model.upsertCycle({start:starts.at(-1),end:inputDate(model.addDays(model.parseDate(starts.at(-1)),4)),excludeFromPrediction:true}),true);
  assert.equal(model.getBleedStats().length,5);
}

function testBacktestUsesOnlyThePast() {
  const model = loadModel();
  const starts = datesFromIntervals('2023-01-01',[28,28,28,40]);
  setData(model,{cycles:starts.map(start=>({start}))});
  const audit = model.getForecastAudit();
  assert.equal(audit.count,1);
  assert.equal(audit.mae,12,'The unexpected fourth interval must be evaluated against the first three');
  const stable = loadModel();
  setData(stable,{cycles:datesFromIntervals('2023-01-01',[28,28,28,28,28,28]).map(start=>({start}))});
  assert.equal(stable.getForecastAudit().mae,0);
}

function testPersonalObservationsNeedTwoPairedCycles() {
  const model = loadModel();
  const starts = datesFromIntervals('2023-01-01',[28,28]);
  const observations = {};
  for (let cycle=0;cycle<2;cycle++) {
    for (const offset of [3,5,8,23,24,26]) {
      observations[inputDate(model.addDays(model.parseDate(starts[cycle]),offset))] = {fatigue:offset>=23?4:0,pain:0};
    }
  }
  setData(model,{cycles:starts.map(start=>({start})),observations});
  const pattern = model.getPersonalPatterns().find(item=>item.key==='fatigue');
  assert.equal(pattern.cycles,2);
  assert.equal(pattern.before,4);
  assert.equal(pattern.other,0);
  assert.equal(model.getPersonalPatterns().find(item=>item.key==='pain').before,0,'A zero rating is real data');
  model.state.data.observations[inputDate(model.addDays(model.parseDate(starts[1]),26))] = {};
  assert.equal(model.getPersonalPatterns().length,0,'Two observed days in one window are insufficient');
  const malformed = model.normalizeData({observations:{'2023-01-01':{mood:99,energy:'4',pain:0},'not-a-date':{mood:2}}});
  assert.equal(Object.keys(malformed.observations).length,1);
  assert.equal(malformed.observations['2023-01-01'].pain,0);
  assert.equal(malformed.observations['2023-01-01'].mood,undefined);
}

function testOvulationUncertaintyNeverVanishes() {
  const model = loadModel();
  setData(model,{cycles:datesFromIntervals('2023-01-01',[28,28,28,28,28,28]).map(start=>({start}))});
  const day = model.buildDayModel(model.parseDate('2023-01-10'));
  assert.ok(day.fertileWindow.endDay-day.fertileWindow.startDay>=10,'Even a stable calendar does not establish exact ovulation');
  assert.equal(day.confidenceProfile.emotional,0);
  assert.ok(day.confidenceProfile.fertility<=30);
}
[testChangedRhythmAndLongCyclesAreLearned,testRecentGapsCannotResurrectAncientHistory,testManualExclusionAndInclusiveDuration,testBacktestUsesOnlyThePast,testPersonalObservationsNeedTwoPairedCycles,testOvulationUncertaintyNeverVanishes].forEach(test=>test());
console.log('adaptation, missingness, historical validation and personal diary tests passed');

function testPersonalPatternsCompareWithinCycles() {
  const model = loadModel();
  const starts = datesFromIntervals('2023-01-01',[28,28]);
  const observations = {};
  for (let offset=1;offset<=20;offset++) observations[inputDate(model.addDays(model.parseDate(starts[0]),offset))] = {mood:0};
  for (const offset of [23,24,25]) observations[inputDate(model.addDays(model.parseDate(starts[0]),offset))] = {mood:1};
  for (const offset of [1,2,3]) observations[inputDate(model.addDays(model.parseDate(starts[1]),offset))] = {mood:3};
  for (const offset of [23,24,25,26,27]) observations[inputDate(model.addDays(model.parseDate(starts[1]),offset))] = {mood:4};
  setData(model,{cycles:starts.map(start=>({start})),observations});
  const pattern = model.getPersonalPatterns().find(p=>p.key==='mood');
  assert.equal(pattern.before-pattern.other,1,'Unequal logging density must not turn a one-point within-cycle change into a larger effect');
  assert.equal(pattern.count,31);
}
testPersonalPatternsCompareWithinCycles();

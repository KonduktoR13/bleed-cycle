// Engineering simulation, not clinical validation. Targets and omissions are synthetic.
const {execFileSync} = require('node:child_process');
const {loadModel, datesFromIntervals, setData} = require('./model-harness');
const oldSource = execFileSync('git',['show','1cd16a0:app.js'],{encoding:'utf8'}).toString();
const scenarios = {
  'Стабильный 28-дневный цикл': [28,28,28,28,28,28,28,28,28,28,28,28],
  'Стабильный 35-дневный цикл': [35,35,35,35,35,35,35,35,35,35,35,35],
  'Небольшие колебания': [28,30,29,27,31,29,28,30,28,29,31,28],
  'Смена 28 → 40 дней': [28,28,28,28,28,28,40,40,40,40,40,40],
  'Смена 28 → 60 дней': [28,28,28,28,28,28,60,60,60,60,60,60],
  'Смена 40 → 28 дней': [40,40,40,40,40,40,28,28,28,28,28,28],
  'Высокая вариабельность': [24,38,29,45,21,36,28,42,23,40,27,43],
  'Постепенное удлинение': [26,27,28,29,30,31,32,33,34,35,36,37]
};
const rows = [];
for (const [name, intervals] of Object.entries(scenarios)) {
  const starts = datesFromIntervals('2023-01-01',intervals);
  const current = loadModel(), old = loadModel({},oldSource);
  const errors = {old:[],current:[],fixed:[]};
  for (let i=3;i<intervals.length;i++) {
    const cycles = starts.slice(0,i+1).map(start=>({start}));
    setData(current,{cycles});setData(old,{cycles});
    errors.current.push(Math.abs(current.getCycleStats().length-intervals[i]));
    errors.old.push(Math.abs(old.getCycleStats().length-intervals[i]));
    errors.fixed.push(Math.abs(28-intervals[i]));
  }
  const mean = values => (values.reduce((a,b)=>a+b,0)/values.length).toFixed(2);
  rows.push({scenario:name,forecasts:errors.current.length,MAE_v23:mean(errors.old),MAE_v24:mean(errors.current),MAE_fixed28:mean(errors.fixed)});
}
console.log('| Синтетический сценарий | Прогнозов | Ошибка v23, дн. | Ошибка v24, дн. | Всегда 28 дней |');
console.log('|---|---:|---:|---:|---:|');
for (const row of rows) console.log(`| ${row.scenario} | ${row.forecasts} | ${row.MAE_v23} | ${row.MAE_v24} | ${row.MAE_fixed28} |`);

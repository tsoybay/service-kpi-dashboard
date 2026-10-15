/* Checks the dashboard's calculations against numbers worked out by hand.
 *
 * Run it with:   node tests.js
 * It prints PASS or FAIL for each check and exits with an error if any check fails.
 */

'use strict';

const s = require('./script.js');

let passed = 0;
let failed = 0;

function same(name, got, want) {
  report(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
}

function near(name, got, want, tolerance = 1e-9) {
  report(name, Math.abs(got - want) < tolerance, `got ${got}, wanted ${want}`);
}

function report(name, ok, detail) {
  if (ok) passed += 1; else failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (${detail})`}`);
}

/* ---------- Four repair orders, worked out by hand ----------
   RO 1: Tech A, Oil change, 08:00 to 10:00 on Mar 2          turnaround  2 h
   RO 2: Tech A, Brakes,     09:00 to 17:00 on Mar 2          turnaround  8 h
   RO 3: Tech B, Brakes,     10:00 Mar 2 to 08:00 Mar 3       turnaround 22 h
   RO 4: Tech B, Oil change, 08:00 to 18:00 on Mar 3          turnaround 10 h
*/
const header = 'RO number,Opened,Completed,Technician,Service type';
const csv = [
  header,
  '1,2026-03-02 08:00,2026-03-02 10:00,Tech A,Oil change',
  '2,2026-03-02 09:00,2026-03-02 17:00,Tech A,Brakes',
  '3,2026-03-02 10:00,2026-03-03 08:00,Tech B,Brakes',
  '4,2026-03-03 08:00,2026-03-03 18:00,Tech B,Oil change',
].join('\n');

const data = s.buildDataset(csv);
same('reads 4 rows and skips none', [data.records.length, data.skipped.length], [4, 0]);

const k = s.computeKpis(data.records);
same('repair orders completed', k.count, 4);
same('days with completions (Mar 2 and Mar 3)', k.days, 2);
near('cars per working day = 4 / 2', k.perDay, 2);
near('average turnaround = (2 + 8 + 22 + 10) / 4', k.avgTurn, 10.5);
near('median turnaround = (8 + 10) / 2', k.medTurn, 9);
near('longest turnaround', k.longestH, 22);
same('longest turnaround is RO 3', k.longestRo, '3');

const techs = Object.fromEntries(s.byTechnician(data.records).map((t) => [t.name, t]));
same('Tech A repair orders', techs['Tech A'].n, 2);
near('Tech A share of orders = 2 of 4', techs['Tech A'].share, 0.5);
near('Tech A average turnaround = (2 + 8) / 2', techs['Tech A'].avgTurn, 5);
near('Tech B average turnaround = (22 + 10) / 2', techs['Tech B'].avgTurn, 16);

const services = s.byServiceType(data.records);
same('service types sorted slowest first', services.map((x) => x.name), ['Brakes', 'Oil change']);
near('Brakes average turnaround = (8 + 22) / 2', services[0].avgTurn, 15);
near('Oil change average turnaround = (2 + 10) / 2', services[1].avgTurn, 6);
same('longest turnarounds, longest first', s.slowestOrders(data.records).map((r) => r.ro), ['3', '4', '2', '1']);

/* ---------- Filters and chart buckets ---------- */
same('filter by technician', s.applyFilters(data.records, { tech: 'Tech A' }).length, 2);
same('filter by completion date', s.applyFilters(data.records, { from: '2026-03-03', to: '2026-03-03' }).length, 2);
same('filters combine', s.applyFilters(data.records, { tech: 'Tech B', service: 'Brakes' }).length, 1);
same('no matches gives no KPIs', s.computeKpis(s.applyFilters(data.records, { tech: 'Nobody' })), null);
same('daily buckets', s.completedPerPeriod(data.records, '2026-03-01', '2026-03-04').buckets.map((b) => b.count), [0, 2, 2, 0]);
same('long ranges switch to weeks', s.completedPerPeriod(data.records, '2026-01-01', '2026-06-30').weekly, true);
same('weekly buckets keep every order',
  s.completedPerPeriod(data.records, '2026-01-01', '2026-06-30').buckets.reduce((a, b) => a + b.count, 0), 4);

/* ---------- Day / week choice ---------- */
same('range of 4 days', s.rangeDays('2026-03-01', '2026-03-04'), 4);
same('weekly is not offered under 14 days', [s.groupingOptions(13).canWeek, s.groupingOptions(14).canWeek], [false, true]);
same('daily is not offered over 366 days', [s.groupingOptions(366).canDay, s.groupingOptions(367).canDay], [true, false]);
same('auto: 60 days is daily, 173 days is weekly', [s.effectiveGrouping('auto', 60), s.effectiveGrouping('auto', 173)], ['day', 'week']);
same('a weekly choice is ignored when the range is too short', s.effectiveGrouping('week', 10), 'day');
same('a daily choice is ignored when the range is over a year', s.effectiveGrouping('day', 400), 'week');
same('you can choose weekly on a 60-day range', s.effectiveGrouping('week', 60), 'week');
same('you can choose daily on a 173-day range', s.effectiveGrouping('day', 173), 'day');
same('forcing daily on 173 days gives 173 bars', s.completedPerPeriod(data.records, '2026-01-01', '2026-06-22', 'day').buckets.length, 173);
const forcedWeeks = s.completedPerPeriod(data.records, '2026-02-23', '2026-04-23', 'week');
same('forcing weekly on 60 days gives weeks and keeps every order', [forcedWeeks.weekly, forcedWeeks.buckets.reduce((a, b) => a + b.count, 0)], [true, 4]);

/* ---------- Dates ---------- */
same('accepts YYYY-MM-DD HH:MM', s.parseDateTime('2026-03-02 08:15').ok, true);
same('accepts a T between date and time', s.parseDateTime('2026-03-02T08:15:30').ok, true);
same('rejects a date with no time', s.parseDateTime('2026-03-02').reason, 'time');
same('rejects MM/DD/YYYY because it is ambiguous', s.parseDateTime('03/02/2026 08:15').reason, 'format');
same('rejects Feb 30', s.parseDateTime('2026-02-30 08:00').reason, 'invalid');
same('rejects hour 25', s.parseDateTime('2026-03-02 25:00').reason, 'invalid');

/* ---------- Messy files ---------- */
const french =
  '\uFEFFRO;Opened;Completed;Tech;Job type\r\n' +
  '7;2026-03-02 08:00;2026-03-02 10:00;"Smith, J.";"Brakes ""front"""\r\n';
const fr = s.buildDataset(french);
same('semicolon file with alternative headers loads', [fr.records.length, fr.delimiter], [1, ';']);
same('quoted comma stays in one cell', fr.records[0].technician, 'Smith, J.');
same('escaped quote is kept', fr.records[0].serviceType, 'Brakes "front"');

const wide = s.buildDataset([
  'RO number,Opened,Promised,Completed,Technician,Service type,Billed hours,Clocked hours,Comeback,Rating',
  '1,2026-03-02 08:00,2026-03-02 12:00,2026-03-02 10:00,A,B,1.0,0.8,N,5',
].join('\n'));
same('extra columns in a bigger export are ignored', [wide.records.length, wide.skipped.length], [1, 0]);

const messy = s.buildDataset([
  header,
  '1,2026-03-02 08:00,2026-03-02 10:00,A,B',
  '2,03/02/2026 08:00,2026-03-02 10:00,A,B',
  '3,2026-03-02 08:00,2026-03-02 07:00,A,B',
  ',2026-03-02 08:00,2026-03-02 10:00,A,B',
  '5,2026-03-02 08:00,,A,B',
].join('\n'));
same('keeps the good row, skips four bad ones', [messy.records.length, messy.skipped.length], [1, 4]);
same('reports spreadsheet row numbers (header is row 1)', messy.skipped.map((x) => x.row), [3, 4, 5, 6]);

const missing = s.buildDataset('RO number,Opened\n1,2026-03-02 08:00');
same('names missing columns', missing.error.includes('Completed') && missing.error.includes('Technician'), true);
same('empty file gives an error', s.buildDataset('').error, 'The file is empty.');
same('duplicate RO numbers are flagged',
  s.buildDataset(`${header}\n1,2026-03-02 08:00,2026-03-02 10:00,A,B\n1,2026-03-02 08:00,2026-03-02 10:00,A,B`).duplicates, 1);

/* ---------- Working hours (used by the sample data) ---------- */
const friday4pm = Date.UTC(2026, 6, 10, 16, 0); // the shop closes at 17:30, so 90 minutes remain
same('one hour fits in the day', s.formatIso(s.addWorkMinutes(friday4pm, 60)), '2026-07-10 17:00');
same('three hours carry over to Saturday morning', s.formatIso(s.addWorkMinutes(friday4pm, 180)), '2026-07-11 09:30');
same('Saturday afternoon waits for Monday', s.formatIso(s.addWorkMinutes(Date.UTC(2026, 6, 11, 16, 0), 30)), '2026-07-13 08:00');

/* ---------- Sample data ---------- */
same('sample data is the same every time', s.toCsv(s.generateSampleData()), s.toCsv(s.generateSampleData()));
const sample = s.buildDataset(s.sampleCsv());
same('sample data loads with no skipped rows', sample.skipped.length, 0);
same('sample data has only the five columns', s.sampleCsv().split('\n')[0], header);

/* ---------- The three sample files, as described in the README ---------- */
const fs = require('fs');
const load = (file) => s.buildDataset(fs.readFileSync(`${__dirname}/${file}`, 'utf8'));
const spanOf = (ds) => {
  const days = ds.records.map((r) => r.dayKey).sort();
  return { from: days[0], to: days[days.length - 1], days: s.rangeDays(days[0], days[days.length - 1]) };
};

const one = load('sample-data.csv');
same('sample-data.csv: 292 repair orders, none skipped', [one.records.length, one.skipped.length], [292, 0]);
same('sample-data.csv is the same data as the Load sample data button', s.toCsv(s.generateSampleData()), fs.readFileSync(`${__dirname}/sample-data.csv`, 'utf8'));
same('sample-data.csv: six technicians and six service types',
  [new Set(one.records.map((r) => r.technician)).size, new Set(one.records.map((r) => r.serviceType)).size], [6, 6]);
same('sample-data.csv: starts as daily bars', s.effectiveGrouping('auto', spanOf(one).days), 'day');

const two = load('sample-data-2-small-shop.csv');
same('sample-data-2: 548 repair orders, none skipped', [two.records.length, two.skipped.length], [548, 0]);
same('sample-data-2: technicians T-101 to T-104',
  [...new Set(two.records.map((r) => r.technician))].sort(), ['T-101', 'T-102', 'T-103', 'T-104']);
same('sample-data-2: seven service types', new Set(two.records.map((r) => r.serviceType)).size, 7);
same('sample-data-2: starts as weekly bars (25 of them)',
  [s.completedPerPeriod(two.records, spanOf(two).from, spanOf(two).to).weekly, s.completedPerPeriod(two.records, spanOf(two).from, spanOf(two).to).buckets.length], [true, 25]);
const aprilOrders = two.records.filter((r) => r.dayKey.startsWith('2026-04')).length;
const marchOrders = two.records.filter((r) => r.dayKey.startsWith('2026-03')).length;
same('sample-data-2: April has roughly double the volume of a normal month', aprilOrders > 1.8 * marchOrders, true);

const three = load('sample-data-3-with-problems.csv');
same('sample-data-3: 39 rows read, 33 used, 6 skipped', [three.totalRows, three.records.length, three.skipped.length], [39, 33, 6]);
same('sample-data-3: skipped rows are 6, 12, 18, 24, 30 and 37', three.skipped.map((x) => x.row), [6, 12, 18, 24, 30, 37]);
same('sample-data-3: the reasons match the README table', three.skipped.map((x) => x.reason), [
  'Opened "08/05/2026 09:15" is not a valid date (use YYYY-MM-DD HH:MM)',
  'Opened "2026-08-06" has no time (use YYYY-MM-DD HH:MM)',
  'Completed is before Opened',
  'RO number is empty',
  'Completed is empty',
  'Opened "2026-02-30 09:00" is not a real date and time',
]);
same('sample-data-3: one repeated RO number is flagged', three.duplicates, 1);
same('sample-data-3: covers 10 days, so weekly bars are not offered', s.groupingOptions(spanOf(three).days).canWeek, false);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

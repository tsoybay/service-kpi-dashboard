/* Service KPI Dashboard, Version 1
 *
 * What it does:
 *   1. Reads a CSV of repair orders (or generates fictional sample data).
 *   2. Checks every row and tells you which rows were skipped and why.
 *   3. Calculates cars per working day, turnaround time and workload per technician.
 *   4. Draws two charts and two tables.
 *
 * The CSV needs only five columns: RO number, Opened, Completed, Technician, Service type.
 * Any other columns in the file are ignored.
 *
 * Everything happens in the browser. No server, no libraries, no network calls.
 *
 * The file has four parts:
 *   1. Reading and checking a CSV
 *   2. The calculations
 *   3. Sample data (fictional, made by code with a fixed seed)
 *   4. The page: charts, tables and buttons
 */

'use strict';

/* ================================================================== */
/* 1. Reading and checking a CSV                                       */
/* ================================================================== */

// The columns the tool understands. "aliases" are other header names it accepts.
const FIELDS = [
  { key: 'ro', label: 'RO number',
    aliases: ['ro', 'ro #', 'ro no', 'repair order', 'repair order number', 'work order', 'work order number'] },
  { key: 'opened', label: 'Opened',
    aliases: ['opened at', 'open date', 'date opened', 'check in', 'checked in', 'check-in time'] },
  { key: 'completed', label: 'Completed',
    aliases: ['completed at', 'completion date', 'date completed', 'closed', 'finished', 'close date'] },
  { key: 'technician', label: 'Technician',
    aliases: ['tech', 'tech name', 'technician name', 'tech id', 'technician id', 'mechanic'] },
  { key: 'serviceType', label: 'Service type',
    aliases: ['service', 'job type', 'type', 'category', 'service category', 'operation'] },
];

// Lowercase and strip punctuation so "Job-type" and "job type" match.
const norm = (text) => String(text == null ? '' : text).toLowerCase().replace(/[^a-z0-9]/g, '');

const HEADER_LOOKUP = new Map();
for (const field of FIELDS) {
  HEADER_LOOKUP.set(norm(field.label), field.key);
  for (const alias of field.aliases) HEADER_LOOKUP.set(norm(alias), field.key);
}

// Excel in French-language settings saves with semicolons, so detect the separator.
function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  let best = ',';
  let bestCount = -1;
  for (const delimiter of [',', ';', '\t']) {
    let count = 0;
    let inQuotes = false;
    for (const ch of firstLine) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === delimiter && !inQuotes) count += 1;
    }
    if (count > bestCount) { best = delimiter; bestCount = count; }
  }
  return best;
}

// Splits CSV text into rows of cells. Handles quotes, commas inside quotes, and Windows line endings.
// "row" is the spreadsheet row number (the header is row 1).
function parseCsv(text) {
  const clean = String(text).replace(/^\uFEFF/, '');
  const delimiter = detectDelimiter(clean);
  const all = [];
  let cells = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') { cell += '"'; i += 1; } else { inQuotes = false; }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      cells.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i += 1;
      cells.push(cell);
      all.push(cells);
      cells = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || cells.length) { cells.push(cell); all.push(cells); }

  const rows = all
    .map((c, index) => ({ cells: c, row: index + 1 }))
    .filter((r) => r.cells.some((c) => c.trim() !== ''));
  return { rows, delimiter };
}

// Dates must be "YYYY-MM-DD HH:MM". Times are treated as the shop's wall clock,
// so daylight saving changes never distort a duration.
function parseDateTime(text) {
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(String(text).trim());
  if (!m) return { ok: false, reason: 'format' };
  if (m[4] === undefined) return { ok: false, reason: 'time' };
  const [y, mo, d, h, mi, s] = [+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] || 0)];
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  const real = date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d &&
    date.getUTCHours() === h && date.getUTCMinutes() === mi;
  return real ? { ok: true, date } : { ok: false, reason: 'invalid' };
}

const DATE_PROBLEMS = {
  format: 'is not a valid date (use YYYY-MM-DD HH:MM)',
  time: 'has no time (use YYYY-MM-DD HH:MM)',
  invalid: 'is not a real date and time',
};

const dayKeyOf = (date) => date.toISOString().slice(0, 10);

// Turns CSV text into clean records. Rows with problems are skipped and listed, never dropped silently.
function buildDataset(text) {
  const { rows, delimiter } = parseCsv(text);
  if (rows.length === 0) return { error: 'The file is empty.' };

  const header = rows[0].cells.map((c) => c.trim());
  const columnIndex = {};
  header.forEach((name, i) => {
    const key = HEADER_LOOKUP.get(norm(name));
    if (key && !(key in columnIndex)) columnIndex[key] = i;
  });

  const missing = FIELDS.filter((f) => !(f.key in columnIndex)).map((f) => f.label);
  if (missing.length) {
    return {
      error: `The file is missing ${missing.length === 1 ? 'a required column' : 'required columns'}: ${missing.join(', ')}.`,
      found: header.filter(Boolean),
    };
  }

  const records = [];
  const skipped = [];
  const roCounts = new Map();

  for (const { cells, row } of rows.slice(1)) {
    const get = (key) => (cells[columnIndex[key]] || '').trim();
    const skip = (reason) => skipped.push({ row, reason });

    const ro = get('ro');
    if (!ro) { skip('RO number is empty'); continue; }

    const dates = {};
    let dateProblem = '';
    for (const [key, label] of [['opened', 'Opened'], ['completed', 'Completed']]) {
      const raw = get(key);
      if (raw === '') { dateProblem = `${label} is empty`; break; }
      const parsed = parseDateTime(raw);
      if (!parsed.ok) { dateProblem = `${label} "${raw}" ${DATE_PROBLEMS[parsed.reason]}`; break; }
      dates[key] = parsed.date;
    }
    if (dateProblem) { skip(dateProblem); continue; }
    if (dates.completed < dates.opened) { skip('Completed is before Opened'); continue; }

    roCounts.set(ro, (roCounts.get(ro) || 0) + 1);
    records.push({
      ro,
      opened: dates.opened,
      completed: dates.completed,
      technician: get('technician') || 'Unassigned',
      serviceType: get('serviceType') || 'Other',
      turnaroundH: (dates.completed - dates.opened) / 3600000,
      dayKey: dayKeyOf(dates.completed),
    });
  }

  const duplicates = [...roCounts.values()].filter((n) => n > 1).length;
  return { records, skipped, totalRows: rows.length - 1, delimiter, duplicates };
}

/* ================================================================== */
/* 2. The calculations                                                 */
/* ================================================================== */

const sum = (list, pick) => list.reduce((total, item) => total + pick(item), 0);

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Filters use the completion date (as YYYY-MM-DD text, which sorts correctly).
function applyFilters(records, filters) {
  return records.filter((r) =>
    (!filters.from || r.dayKey >= filters.from) &&
    (!filters.to || r.dayKey <= filters.to) &&
    (!filters.tech || r.technician === filters.tech) &&
    (!filters.service || r.serviceType === filters.service));
}

function computeKpis(rows) {
  const count = rows.length;
  if (!count) return null;
  const days = new Set(rows.map((r) => r.dayKey)).size;
  const longest = rows.reduce((a, b) => (b.turnaroundH > a.turnaroundH ? b : a));
  return {
    count,
    days,
    perDay: count / days,
    avgTurn: sum(rows, (r) => r.turnaroundH) / count,
    medTurn: median(rows.map((r) => r.turnaroundH)),
    longestH: longest.turnaroundH,
    longestRo: longest.ro,
  };
}

function groupBy(rows, pick) {
  const groups = new Map();
  for (const row of rows) {
    const key = pick(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

function byTechnician(rows) {
  return [...groupBy(rows, (r) => r.technician)].map(([name, list]) => ({
    name,
    n: list.length,
    share: list.length / rows.length,
    avgTurn: sum(list, (r) => r.turnaroundH) / list.length,
  }));
}

function byServiceType(rows) {
  return [...groupBy(rows, (r) => r.serviceType)]
    .map(([name, list]) => ({ name, n: list.length, avgTurn: sum(list, (r) => r.turnaroundH) / list.length }))
    .sort((a, b) => b.avgTurn - a.avgTurn);
}

function slowestOrders(rows) {
  return [...rows].sort((a, b) => b.turnaroundH - a.turnaroundH);
}

const DAY_MS = 86400000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

// Rules for the day / week choice on the "Cars completed" chart.
const AUTO_WEEKLY_DAYS = 92;  // ranges longer than this start out as weekly bars
const MIN_WEEKLY_DAYS = 14;   // weekly bars need at least two weeks of data
const MAX_DAILY_DAYS = 366;   // more than a year of daily bars is too thin to read

function rangeDays(fromKey, toKey) {
  return Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / DAY_MS) + 1;
}

// Which groupings make sense for a range of this many days?
function groupingOptions(days) {
  return {
    canDay: days <= MAX_DAILY_DAYS,
    canWeek: days >= MIN_WEEKLY_DAYS,
    auto: days > AUTO_WEEKLY_DAYS ? 'week' : 'day',
  };
}

// "choice" is 'auto', 'day' or 'week'. Returns what will actually be drawn.
function effectiveGrouping(choice, days) {
  const { canDay, canWeek, auto } = groupingOptions(days);
  let mode = choice === 'day' || choice === 'week' ? choice : auto;
  if (mode === 'week' && !canWeek) mode = 'day';
  if (mode === 'day' && !canDay) mode = 'week';
  return mode;
}

// Counts completed orders per day, or per week (Monday start).
function completedPerPeriod(rows, fromKey, toKey, choice = 'auto') {
  const startMs = Date.parse(`${fromKey}T00:00:00Z`);
  const days = rangeDays(fromKey, toKey);
  if (!(days >= 1)) return { weekly: false, buckets: [] };

  const perDay = new Map();
  rows.forEach((r) => perDay.set(r.dayKey, (perDay.get(r.dayKey) || 0) + 1));

  if (effectiveGrouping(choice, days) === 'day') {
    const buckets = [];
    for (let i = 0; i < days; i++) {
      const key = isoDay(startMs + i * DAY_MS);
      buckets.push({ key, count: perDay.get(key) || 0 });
    }
    return { weekly: false, buckets };
  }

  const weeks = new Map();
  for (let i = 0; i < days; i++) {
    const ms = startMs + i * DAY_MS;
    const sinceMonday = (new Date(ms).getUTCDay() + 6) % 7;
    const weekKey = isoDay(ms - sinceMonday * DAY_MS);
    weeks.set(weekKey, (weeks.get(weekKey) || 0) + (perDay.get(isoDay(ms)) || 0));
  }
  return { weekly: true, buckets: [...weeks].map(([key, count]) => ({ key, count })) };
}

/* ================================================================== */
/* 3. Sample data (fictional, generated with a fixed seed)             */
/* ================================================================== */

// A small random number generator. The same seed always gives the same numbers,
// so everyone sees the same sample shop.
function mulberry32(seed) {
  let a = seed;
  return function next() {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Shop hours as minutes after midnight, by day of week (0 = Sunday). Sunday is closed.
const SHOP_HOURS = { 0: null, 1: [450, 1050], 2: [450, 1050], 3: [450, 1050], 4: [450, 1050], 5: [450, 1050], 6: [480, 780] };

// Moves forward by a number of working minutes, skipping nights and closed days.
function addWorkMinutes(startMs, minutes) {
  let t = startMs;
  let left = minutes;
  for (let guard = 0; guard < 500; guard++) {
    const day = new Date(t);
    const dayStart = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
    const window = SHOP_HOURS[day.getUTCDay()];
    if (!window) { t = dayStart + DAY_MS; continue; }
    const openMs = dayStart + window[0] * 60000;
    const closeMs = dayStart + window[1] * 60000;
    if (t < openMs) t = openMs;
    if (t >= closeMs) { t = dayStart + DAY_MS; continue; }
    const available = (closeMs - t) / 60000;
    if (left <= available) return t + left * 60000;
    left -= available;
    t = dayStart + DAY_MS;
  }
  return t;
}

const pad2 = (n) => String(n).padStart(2, '0');

function formatIso(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ` +
    `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

// "speed" above 1 means a faster technician.
const SAMPLE_TECHNICIANS = [
  { name: 'Technician 1', speed: 1.22 },
  { name: 'Technician 2', speed: 1.08 },
  { name: 'Technician 3', speed: 0.97 },
  { name: 'Technician 4', speed: 1.15 },
  { name: 'Technician 5', speed: 0.88 },
  { name: 'Technician 6', speed: 1.03 },
];

// "hours" is the typical hands-on time for the job. "delay" is the chance of waiting for parts or approval.
const SAMPLE_SERVICES = [
  { name: 'Oil change and inspection', hours: [0.7, 1.1], delay: 0.05, weight: 30 },
  { name: 'Tire swap', hours: [0.6, 1.0], delay: 0.04, weight: 14 },
  { name: 'Brake service', hours: [1.6, 3.4], delay: 0.12, weight: 16 },
  { name: 'Scheduled maintenance', hours: [2.0, 4.0], delay: 0.10, weight: 18 },
  { name: 'Diagnostics', hours: [1.0, 2.6], delay: 0.26, weight: 12 },
  { name: 'Warranty repair', hours: [2.5, 6.0], delay: 0.22, weight: 10 },
];

// About 60 days of repair orders for a fictional shop with six technicians.
function generateSampleData(seed = 2026) {
  const rand = mulberry32(seed);
  const between = (a, b) => a + rand() * (b - a);
  const totalWeight = sum(SAMPLE_SERVICES, (s) => s.weight);
  const pickService = () => {
    let roll = rand() * totalWeight;
    for (const service of SAMPLE_SERVICES) {
      roll -= service.weight;
      if (roll < 0) return service;
    }
    return SAMPLE_SERVICES[0];
  };

  const firstDay = Date.UTC(2026, 6, 6); // Monday, July 6, 2026
  const orders = [];

  for (let d = 0; d < 60; d++) {
    const dayMs = firstDay + d * DAY_MS;
    const dow = new Date(dayMs).getUTCDay();
    if (dow === 0) continue;

    const orderCount = dow === 6 ? Math.round(between(2, 4)) : Math.round(between(4, 8));
    const load = between(0.8, 1.5); // busy days mean longer waits in the queue

    for (let i = 0; i < orderCount; i++) {
      const service = pickService();
      const tech = SAMPLE_TECHNICIANS[Math.floor(rand() * SAMPLE_TECHNICIANS.length)];

      const window = SHOP_HOURS[dow];
      const arrival = rand() < 0.7 ? between(window[0], window[0] + 150) : between(window[0] + 150, window[1] - 150);
      const openedMs = dayMs + Math.round(arrival) * 60000;

      const workMin = (between(service.hours[0], service.hours[1]) / tech.speed) * 60;
      const waitMin = between(0.2, 2.2) * load * 60;
      const delayMin = rand() < service.delay ? between(2, 10) * 60 : 0;

      const completedMs = addWorkMinutes(openedMs, waitMin + workMin + delayMin);
      orders.push({ openedMs, completedMs, technician: tech.name, serviceType: service.name });
    }
  }

  orders.sort((a, b) => a.openedMs - b.openedMs);
  return orders.map((o, index) => ({
    'RO number': 10001 + index,
    Opened: formatIso(o.openedMs),
    Completed: formatIso(o.completedMs),
    Technician: o.technician,
    'Service type': o.serviceType,
  }));
}

function toCsv(rows) {
  if (!rows.length) return '';
  const columns = Object.keys(rows[0]);
  const quote = (value) => {
    const text = String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [columns.join(',')];
  for (const row of rows) lines.push(columns.map((c) => quote(row[c])).join(','));
  return `${lines.join('\n')}\n`;
}

let sampleCsvCache = null;
function sampleCsv() {
  if (!sampleCsvCache) sampleCsvCache = toCsv(generateSampleData());
  return sampleCsvCache;
}

/* ================================================================== */
/* 4. The page                                                         */
/* ================================================================== */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtDay(key, withYear = false) {
  const [y, m, d] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}${withYear ? `, ${y}` : ''}`;
}

function fmtDateTime(date) {
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`;
}

function fmtHours(h) {
  if (h === null || h === undefined) return 'n/a';
  return h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} days`;
}

const fmtPct = (x) => `${(x * 100).toFixed(1)}%`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

let els = {};
const state = {
  dataset: null,
  source: { kind: '', name: '' },
  range: { min: '', max: '' },
  sort: { key: 'n', dir: 'desc' },
  showAllSlow: false,
  grouping: 'auto', // 'auto', 'day' or 'week'
  view: null,
};

function $(id) { return document.getElementById(id); }

// Builds HTML elements. Using textContent (never innerHTML) means text from a CSV
// can never inject HTML into the page.
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function sv(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== null && value !== undefined) node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
  return node;
}

// Note: the built-in append() and replaceChildren() do not flatten arrays,
// so lists of elements are always spread with "..." when passed to them.
function setStatus(message, kind = '', details = []) {
  els.status.className = kind ? `status ${kind}` : 'status';
  els.status.replaceChildren();
  if (message) els.status.append(el('p', {}, message), ...details.map((line) => el('p', {}, line)));
}

/* ---------- Loading data ---------- */

function decodeBytes(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch (err) {
    // Excel on Windows often saves accented characters in this older encoding.
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

function loadText(text, source) {
  const dataset = buildDataset(text);
  if (dataset.error) {
    const details = dataset.found ? [`Columns found in your file: ${dataset.found.join(', ') || 'none'}.`] : [];
    setStatus(dataset.error, 'error', details);
    return false;
  }
  if (dataset.records.length === 0) {
    const first = dataset.skipped[0];
    setStatus('No usable rows were found in the file.', 'error',
      first ? [`First problem: row ${first.row}: ${first.reason}.`] : []);
    return false;
  }

  state.dataset = dataset;
  state.source = source;
  state.showAllSlow = false;
  state.grouping = 'auto';

  const days = dataset.records.map((r) => r.dayKey).sort();
  state.range = { min: days[0], max: days[days.length - 1] };

  fillFilterControls();
  setStatus('');
  els.startHint.hidden = true;
  els.dashboard.hidden = false;
  renderAll();
  return true;
}

async function loadFile(file) {
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) {
    setStatus('That file is larger than 20 MB. Export a shorter date range and try again.', 'error');
    return;
  }
  try {
    const text = decodeBytes(await file.arrayBuffer());
    loadText(text, { kind: 'file', name: file.name });
  } catch (err) {
    setStatus('The file could not be read. Check that it is a CSV and try again.', 'error');
  }
}

function loadSample() {
  loadText(sampleCsv(), { kind: 'sample', name: 'Sample data' });
}

function downloadTemplate() {
  const blob = new Blob([sampleCsv()], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: 'service-kpi-sample.csv' });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- Filters ---------- */

function fillSelect(select, allLabel, values) {
  select.replaceChildren(el('option', { value: '' }, allLabel), ...values.map((v) => el('option', { value: v }, v)));
}

function fillFilterControls() {
  const records = state.dataset.records;
  const techs = [...new Set(records.map((r) => r.technician))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const services = [...new Set(records.map((r) => r.serviceType))].sort();
  fillSelect(els.fTech, 'All technicians', techs);
  fillSelect(els.fService, 'All services', services);
  for (const input of [els.fFrom, els.fTo]) {
    input.min = state.range.min;
    input.max = state.range.max;
  }
  els.fFrom.value = state.range.min;
  els.fTo.value = state.range.max;
}

function currentFilters() {
  return { from: els.fFrom.value, to: els.fTo.value, tech: els.fTech.value, service: els.fService.value };
}

// A filter with nothing to choose between is switched off, and a line explains why.
function updateFilterAvailability() {
  const records = state.dataset.records;
  const techCount = new Set(records.map((r) => r.technician)).size;
  const serviceCount = new Set(records.map((r) => r.serviceType)).size;
  const oneDay = state.range.min === state.range.max;

  els.fFrom.disabled = oneDay;
  els.fTo.disabled = oneDay;
  els.fTech.disabled = techCount < 2;
  els.fService.disabled = serviceCount < 2;

  // From can never be later than To, and To can never be earlier than From.
  els.fFrom.max = els.fTo.value || state.range.max;
  els.fTo.min = els.fFrom.value || state.range.min;

  const f = currentFilters();
  const active = f.from !== state.range.min || f.to !== state.range.max || f.tech !== '' || f.service !== '';
  els.resetBtn.disabled = !active;

  const reasons = [];
  if (oneDay) reasons.push('The date filter is off because every repair order was completed on the same day.');
  if (techCount < 2) reasons.push('The technician filter is off because the file has only one technician.');
  if (serviceCount < 2) reasons.push('The service type filter is off because the file has only one service type.');
  els.filtersNote.textContent = ['Dates filter by when each repair order was completed.', ...reasons].join(' ');
}

function updateGroupingControls(days, mode) {
  const { canDay, canWeek } = groupingOptions(days);
  els.dayBtn.disabled = !canDay;
  els.weekBtn.disabled = !canWeek;
  els.dayBtn.setAttribute('aria-pressed', String(mode === 'day'));
  els.weekBtn.setAttribute('aria-pressed', String(mode === 'week'));
  if (!canWeek) els.groupingNote.textContent = 'Weekly bars need at least two weeks of data.';
  else if (!canDay) els.groupingNote.textContent = 'Daily bars are only available for up to a year of data.';
  else els.groupingNote.textContent = '';
}

/* ---------- Rendering ---------- */

function renderAll() {
  const dataset = state.dataset;
  if (!dataset) return;

  const filters = currentFilters();
  const rows = applyFilters(dataset.records, filters);
  const kpis = computeKpis(rows);

  renderSourceNote();
  renderQuality();
  updateFilterAvailability();

  if (!kpis) {
    els.content.hidden = true;
    els.empty.hidden = false;
    els.context.textContent = '';
    state.view = null;
    return;
  }
  els.content.hidden = false;
  els.empty.hidden = true;

  const from = filters.from && filters.from > state.range.min ? filters.from : state.range.min;
  const to = filters.to && filters.to < state.range.max ? filters.to : state.range.max;
  state.view = { rows, kpis, from, to, filters };

  els.context.textContent =
    `${plural(kpis.count, 'repair order', 'repair orders')} completed from ${fmtDay(from, true)} to ${fmtDay(to, true)}. ` +
    `${filters.tech || 'All technicians'}. ${filters.service || 'All service types'}.`;

  renderKpis(kpis);
  renderCharts();
  renderTechTable();
  renderSlow();
}

function renderSourceNote() {
  const ds = state.dataset;
  const notes = [];
  if (state.source.kind === 'sample') {
    const techCount = new Set(ds.records.map((r) => r.technician)).size;
    notes.push(el('div', { class: 'note sample' },
      el('p', {}, `Sample data: a fictional shop with ${plural(techCount, 'technician', 'technicians')} and ${ds.records.length} repair orders. These are not real numbers.`)));
  } else {
    notes.push(el('div', { class: 'note' },
      el('p', {}, `Showing your file: ${state.source.name}. ${plural(ds.records.length, 'repair order', 'repair orders')} loaded. The file was read in your browser and not uploaded anywhere.`)));
  }
  if (ds.skipped.length) {
    notes.push(el('div', { class: 'note warn' },
      el('p', {}, `${plural(ds.skipped.length, 'row was', 'rows were')} skipped because of problems. Open "Data quality" at the bottom of the page to see which rows and why.`)));
  }
  els.sourceNote.replaceChildren(...notes);
}

function renderQuality() {
  const ds = state.dataset;
  const delimiterName = { ',': 'comma', ';': 'semicolon', '\t': 'tab' }[ds.delimiter];
  const lines = [
    el('p', {}, `${plural(ds.totalRows, 'data row', 'data rows')} read, ${ds.records.length} used, ${ds.skipped.length} skipped.`),
    el('p', {}, `Separator detected: ${delimiterName}.`),
  ];
  if (ds.duplicates) {
    lines.push(el('p', {}, `${plural(ds.duplicates, 'RO number appears', 'RO numbers appear')} more than once. Every row is still counted, so check for duplicates.`));
  }
  if (ds.skipped.length) {
    const shown = ds.skipped.slice(0, 20);
    const items = shown.map((s) => el('li', {}, `Row ${s.row}: ${s.reason}.`));
    if (ds.skipped.length > shown.length) items.push(el('li', {}, `And ${ds.skipped.length - shown.length} more.`));
    lines.push(el('p', {}, 'Skipped rows:'), el('ul', {}, ...items));
  }
  els.qualityBody.replaceChildren(...lines);
}

function renderKpis(k) {
  const cards = [
    ['Repair orders completed', String(k.count), `across ${plural(k.days, 'day', 'days')}`],
    ['Cars per working day', k.perDay.toFixed(1), 'days with at least one completion'],
    ['Average turnaround', fmtHours(k.avgTurn), `median ${fmtHours(k.medTurn)}`],
    ['Longest turnaround', fmtHours(k.longestH), `RO ${k.longestRo}`],
  ];
  els.kpis.replaceChildren(...cards.map(([label, value, sub]) =>
    el('div', { class: 'kpi' },
      el('div', { class: 'kpi-label' }, label),
      el('div', { class: 'kpi-value' }, value),
      el('div', { class: 'kpi-sub' }, sub))));
}

function niceScale(value) {
  const step = value <= 5 ? 1 : value <= 10 ? 2 : value <= 20 ? 5 : value <= 50 ? 10 : 20;
  return { step, max: Math.max(step, Math.ceil(value / step) * step) };
}

function renderCharts() {
  if (!state.view) return;
  const { rows, from, to } = state.view;

  const days = rangeDays(from, to);
  const period = completedPerPeriod(rows, from, to, state.grouping);
  updateGroupingControls(days, period.weekly ? 'week' : 'day');
  els.dailyCaption.textContent = period.weekly
    ? 'Each bar is one week, starting on Monday.'
    : 'Each bar is one day. Days with no bar had no completed repair orders.';
  renderDailyChart(els.dailyChart, period, to);
  renderServiceChart(els.serviceChart, byServiceType(rows));
}

function chartWidth(container) {
  return Math.max(300, Math.floor(container.clientWidth || 720));
}

function renderDailyChart(container, period, toKey) {
  const { buckets, weekly } = period;
  const width = chartWidth(container);
  const height = 250;
  const m = { top: 12, right: 8, bottom: 40, left: 34 };
  const plotW = width - m.left - m.right;
  const plotH = height - m.top - m.bottom;
  const maxCount = Math.max(1, ...buckets.map((b) => b.count));
  const { max, step } = niceScale(maxCount);
  const y = (v) => m.top + plotH - (v / max) * plotH;
  const slot = plotW / Math.max(1, buckets.length);
  const barW = Math.min(48, Math.max(2, slot * 0.72)); // never wider than 48px, even with one bar
  const labelEvery = Math.max(1, Math.ceil(buckets.length / Math.max(2, Math.floor(plotW / 58))));
  const withYear = buckets.length > 1 && buckets[0].key.slice(0, 4) !== toKey.slice(0, 4);

  const parts = [];
  for (let v = 0; v <= max; v += step) {
    parts.push(
      sv('line', { class: 'grid', x1: m.left, x2: width - m.right, y1: y(v), y2: y(v) }),
      sv('text', { class: 'axis-text', x: m.left - 6, y: y(v) + 4, 'text-anchor': 'end' }, v));
  }
  buckets.forEach((b, i) => {
    const x = m.left + i * slot + (slot - barW) / 2;
    const label = fmtDay(b.key, withYear);
    if (b.count > 0) {
      parts.push(sv('rect', { class: 'bar', x, y: y(b.count), width: barW, height: (b.count / max) * plotH },
        sv('title', {}, `${weekly ? 'Week of ' : ''}${label}: ${b.count} completed`)));
    }
    if (i % labelEvery === 0) {
      parts.push(sv('text', { class: 'axis-text', x: x + barW / 2, y: height - m.bottom + 18, 'text-anchor': 'middle' }, label));
    }
  });
  parts.push(sv('line', { class: 'axis', x1: m.left, x2: width - m.right, y1: y(0), y2: y(0) }));

  const total = sum(buckets, (b) => b.count);
  container.replaceChildren(sv('svg', {
    viewBox: `0 0 ${width} ${height}`, width, height, role: 'img',
    'aria-label': `Bar chart of repair orders completed per ${weekly ? 'week' : 'day'}, ${total} in total.`,
  }, parts));
}

function truncate(text, maxChars) {
  return text.length > maxChars ? `${text.slice(0, Math.max(1, maxChars - 1))}\u2026` : text;
}

function renderServiceChart(container, items) {
  const width = chartWidth(container);
  const narrow = width < 520;
  const maxTurn = Math.max(...items.map((i) => i.avgTurn), 0.1);
  const parts = [];
  let height;

  if (narrow) {
    // Small screens: the name sits above its bar so the bar can use the full width.
    const rowH = 50;
    const valueRoom = 92;
    const barMax = Math.max(40, width - valueRoom - 8);
    height = items.length * rowH + 6;
    items.forEach((item, i) => {
      const y = 4 + i * rowH;
      const len = Math.max(2, (item.avgTurn / maxTurn) * barMax);
      parts.push(
        sv('text', { class: 'label-text', x: 0, y: y + 14 }, sv('title', {}, item.name), truncate(item.name, Math.floor(width / 7))),
        sv('rect', { class: 'bar', x: 0, y: y + 21, width: len, height: 18 },
          sv('title', {}, `${item.name}: average ${fmtHours(item.avgTurn)} across ${item.n} repair orders`)),
        sv('text', { class: 'value-text', x: len + 8, y: y + 35 }, `${fmtHours(item.avgTurn)} (${item.n})`));
    });
  } else {
    const rowH = 34;
    const labelW = Math.min(230, Math.floor(width * 0.4));
    const valueRoom = 118;
    const barMax = Math.max(40, width - labelW - valueRoom - 12);
    const maxChars = Math.floor(labelW / 7);
    height = 6 + items.length * rowH + 6;
    items.forEach((item, i) => {
      const y = 6 + i * rowH;
      const len = Math.max(2, (item.avgTurn / maxTurn) * barMax);
      parts.push(
        sv('text', { class: 'label-text', x: labelW, y: y + 20, 'text-anchor': 'end' },
          sv('title', {}, item.name), truncate(item.name, maxChars)),
        sv('rect', { class: 'bar', x: labelW + 10, y: y + 5, width: len, height: 20 },
          sv('title', {}, `${item.name}: average ${fmtHours(item.avgTurn)} across ${item.n} repair orders`)),
        sv('text', { class: 'value-text', x: labelW + 10 + len + 8, y: y + 20 }, `${fmtHours(item.avgTurn)} (${item.n})`));
    });
  }

  container.replaceChildren(sv('svg', {
    viewBox: `0 0 ${width} ${height}`, width, height, role: 'img',
    'aria-label': `Average turnaround by service type. ${items.map((i) => `${i.name}: ${fmtHours(i.avgTurn)}`).join('. ')}.`,
  }, parts));
}

const TECH_COLUMNS = [
  { key: 'name', label: 'Technician', numeric: false },
  { key: 'n', label: 'Repair orders', numeric: true },
  { key: 'share', label: 'Share of orders', numeric: true },
  { key: 'avgTurn', label: 'Average turnaround', numeric: true },
];

function renderTechTable() {
  if (!state.view) return;
  const { key, dir } = state.sort;
  const rows = byTechnician(state.view.rows).sort((a, b) => {
    let result;
    if (key === 'name') result = String(a.name).localeCompare(String(b.name), undefined, { numeric: true });
    else result = a[key] - b[key];
    if (result === 0) result = a.name.localeCompare(b.name, undefined, { numeric: true });
    return dir === 'asc' ? result : -result;
  });
  const maxShare = Math.max(...rows.map((t) => t.share), 0.0001);

  els.techHead.replaceChildren(el('tr', {}, TECH_COLUMNS.map((col) => {
    const active = state.sort.key === col.key;
    const button = el('button', { type: 'button', class: 'sort-btn', 'data-sort': col.key },
      col.label, el('span', { class: 'sort-arrow', 'aria-hidden': 'true' }, active ? (dir === 'asc' ? '\u25B2' : '\u25BC') : ''));
    return el('th', {
      scope: 'col',
      class: col.numeric ? 'num' : null,
      'aria-sort': active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none',
    }, button);
  })));

  els.techBody.replaceChildren(...rows.map((t) =>
    el('tr', {},
      el('th', { scope: 'row' }, t.name),
      el('td', { class: 'num' }, String(t.n)),
      el('td', { class: 'num share-cell' },
        el('span', { class: 'share-value' }, fmtPct(t.share)),
        el('div', { class: 'share-track', 'aria-hidden': 'true' },
          el('div', { class: 'share-fill', style: `width:${(t.share / maxShare) * 100}%` }))),
      el('td', { class: 'num' }, fmtHours(t.avgTurn)))));
}

function renderSlow() {
  if (!state.view) return;
  const slow = slowestOrders(state.view.rows);
  const limit = 10;
  const shown = state.showAllSlow ? slow : slow.slice(0, limit);

  els.slowCaption.textContent = state.showAllSlow || slow.length <= limit
    ? `All ${plural(slow.length, 'repair order', 'repair orders')}, longest first.`
    : `The ${limit} longest of ${slow.length} repair orders.`;

  els.slowWrap.replaceChildren(el('table', { class: 'data' },
    el('thead', {}, el('tr', {},
      el('th', { scope: 'col' }, 'RO number'),
      el('th', { scope: 'col' }, 'Technician'),
      el('th', { scope: 'col' }, 'Service type'),
      el('th', { scope: 'col' }, 'Opened'),
      el('th', { scope: 'col' }, 'Completed'),
      el('th', { scope: 'col', class: 'num' }, 'Turnaround'))),
    el('tbody', {}, ...shown.map((r) => el('tr', {},
      el('th', { scope: 'row' }, r.ro),
      el('td', {}, r.technician),
      el('td', {}, r.serviceType),
      el('td', {}, fmtDateTime(r.opened)),
      el('td', {}, fmtDateTime(r.completed)),
      el('td', { class: 'num' }, fmtHours(r.turnaroundH)))))));

  if (slow.length > limit) {
    els.slowActions.replaceChildren(
      el('button', { type: 'button', class: 'btn', id: 'slow-toggle' }, state.showAllSlow ? 'Show fewer' : `Show all ${slow.length}`));
  } else {
    els.slowActions.replaceChildren();
  }
}

/* ---------- Summary text for "Copy summary" ---------- */

function summaryText() {
  if (!state.view) return '';
  const { kpis: k, filters, from, to } = state.view;
  const lines = [
    'Service KPI summary',
    `Source: ${state.source.kind === 'sample' ? 'Sample data (fictional shop)' : state.source.name}`,
    `Completed ${fmtDay(from, true)} to ${fmtDay(to, true)}. ${filters.tech || 'All technicians'}. ${filters.service || 'All service types'}.`,
    '',
    `Repair orders completed: ${k.count}`,
    `Cars per working day: ${k.perDay.toFixed(1)}`,
    `Average turnaround: ${fmtHours(k.avgTurn)} (median ${fmtHours(k.medTurn)})`,
    `Longest turnaround: ${fmtHours(k.longestH)} (RO ${k.longestRo})`,
    '',
    'By technician:',
  ];
  for (const t of byTechnician(state.view.rows).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))) {
    lines.push(`${t.name}: ${t.n} repair orders (${fmtPct(t.share)}), average turnaround ${fmtHours(t.avgTurn)}`);
  }
  return lines.join('\n');
}

async function copySummary() {
  try {
    await navigator.clipboard.writeText(summaryText());
    setStatus('Summary copied.');
  } catch (err) {
    setStatus('Copying is blocked in this browser. Use Print instead, or select the numbers and copy them by hand.', 'error');
  }
}

/* ---------- Start up ---------- */

function init() {
  els = {
    status: $('status'),
    sourceNote: $('source-note'),
    startHint: $('start-hint'),
    dashboard: $('dashboard'),
    content: $('content'),
    empty: $('empty-state'),
    context: $('context-line'),
    kpis: $('kpis'),
    dailyCaption: $('daily-caption'),
    dailyChart: $('daily-chart'),
    serviceChart: $('service-chart'),
    techHead: $('tech-head'),
    techBody: $('tech-body'),
    slowCaption: $('slow-caption'),
    slowWrap: $('slow-wrap'),
    slowActions: $('slow-actions'),
    qualityBody: $('quality-body'),
    fFrom: $('f-from'),
    fTo: $('f-to'),
    fTech: $('f-tech'),
    fService: $('f-service'),
    resetBtn: $('reset-filters'),
    filtersNote: $('filters-note'),
    dayBtn: document.querySelector('[data-grouping="day"]'),
    weekBtn: document.querySelector('[data-grouping="week"]'),
    groupingNote: $('grouping-note'),
  };

  $('sample-btn').addEventListener('click', loadSample);
  $('template-btn').addEventListener('click', downloadTemplate);
  $('copy-summary-btn').addEventListener('click', copySummary);
  $('print-btn').addEventListener('click', () => window.print());

  const fileInput = $('file-input');
  fileInput.addEventListener('change', async () => {
    await loadFile(fileInput.files[0]);
    fileInput.value = ''; // lets you choose the same file again
  });

  const zone = $('drop-zone');
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragging'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragging'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dragging');
    loadFile(e.dataTransfer.files[0]);
  });

  const onFilterChange = () => { state.showAllSlow = false; renderAll(); };

  // Keep the date range sensible: a cleared date goes back to the data's edge,
  // and From and To never cross.
  els.fFrom.addEventListener('change', () => {
    if (!els.fFrom.value) els.fFrom.value = state.range.min;
    if (els.fTo.value && els.fFrom.value > els.fTo.value) els.fTo.value = els.fFrom.value;
    onFilterChange();
  });
  els.fTo.addEventListener('change', () => {
    if (!els.fTo.value) els.fTo.value = state.range.max;
    if (els.fFrom.value && els.fTo.value < els.fFrom.value) els.fFrom.value = els.fTo.value;
    onFilterChange();
  });
  els.fTech.addEventListener('change', onFilterChange);
  els.fService.addEventListener('change', onFilterChange);

  $('grouping').addEventListener('click', (e) => {
    const button = e.target.closest('[data-grouping]');
    if (!button || button.disabled) return;
    state.grouping = button.getAttribute('data-grouping');
    renderCharts();
  });

  $('reset-filters').addEventListener('click', () => {
    if (!state.dataset) return;
    els.fFrom.value = state.range.min;
    els.fTo.value = state.range.max;
    els.fTech.value = '';
    els.fService.value = '';
    state.showAllSlow = false;
    renderAll();
  });

  // Sorting and "show all" use event delegation because those buttons are rebuilt on every render.
  els.techHead.addEventListener('click', (e) => {
    const button = e.target.closest('[data-sort]');
    if (!button) return;
    const key = button.getAttribute('data-sort');
    state.sort = state.sort.key === key
      ? { key, dir: state.sort.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: key === 'name' ? 'asc' : 'desc' };
    renderTechTable();
  });
  els.slowActions.addEventListener('click', (e) => {
    if (e.target.closest('#slow-toggle')) { state.showAllSlow = !state.showAllSlow; renderSlow(); }
  });

  // Charts are drawn at the width of their container, so redraw when the window changes size.
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderCharts, 150);
  });

  // Nothing is loaded at the start. The person chooses: upload a file, or load the sample.
}

if (typeof document !== 'undefined') {
  init();
}

// Lets you test the pure functions with Node: node -e "require('./script.js')"
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseCsv, parseDateTime, buildDataset, applyFilters, computeKpis, byTechnician,
    byServiceType, slowestOrders, completedPerPeriod, median, rangeDays, groupingOptions, effectiveGrouping,
    generateSampleData, toCsv, sampleCsv, addWorkMinutes, formatIso,
  };
}

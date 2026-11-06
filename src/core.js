/* =========================================================================
   FEED LEDGER — Formulation & Optimization (MVP prototype)
   Self-contained vanilla JS app. No build step, no external runtime deps.
   ========================================================================= */

/* ---------------------------- Utilities -------------------------------- */
function uid(prefix) { return prefix + '_' + Math.random().toString(36).slice(2, 9); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function num(v, d) { const n = parseFloat(v); return isNaN(n) ? (d === undefined ? 0 : d) : n; }
function fmt(v, digits) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  digits = digits === undefined ? 2 : digits;
  return Number(v).toLocaleString('en-KE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function fmtInt(v) { return fmt(v, 0); }
function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function nowISO() { return new Date().toISOString(); }
function fmtDate(iso) {
  try { return new Date(iso).toLocaleString('en-KE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch (e) { return iso; }
}

const NUTRIENTS = [
  { key: 'protein',    label: 'Crude Protein', unit: '%',       digits: 1 },
  { key: 'energy',     label: 'Energy',        unit: 'kcal/kg', digits: 0 },
  { key: 'fibre',      label: 'Crude Fibre',   unit: '%',       digits: 1 },
  { key: 'fat',        label: 'Fat',           unit: '%',       digits: 1 },
  { key: 'calcium',    label: 'Calcium',       unit: '%',       digits: 2 },
  { key: 'phosphorus', label: 'Phosphorus',    unit: '%',       digits: 2 }
];

/* ------------------------- Big-M Simplex LP solver ---------------------- */
/* Minimizes cMin^T x subject to constraints (each: {coeffs, type: '<='|'>='|'=', rhs}), x >= 0. */
function solveLP(numVars, cMin, constraints) {
  const EPS = 1e-7;
  const BIG_M = 1e7;

  let rows = constraints.map(c => ({ coeffs: c.coeffs.slice(0, numVars), rhs: c.rhs, type: c.type }));
  rows.forEach(r => {
    if (r.rhs < 0) {
      r.coeffs = r.coeffs.map(v => -v);
      r.rhs = -r.rhs;
      if (r.type === '<=') r.type = '>=';
      else if (r.type === '>=') r.type = '<=';
    }
  });

  let cols = cMin.slice(0, numVars);
  let colType = new Array(numVars).fill('decision');
  const numConstraints = rows.length;
  let basis = new Array(numConstraints).fill(-1);

  rows.forEach((r, i) => {
    if (r.type === '<=') {
      let idx = cols.length;
      cols.push(0); colType.push('slack');
      rows.forEach((rr, k) => rr.coeffs.push(k === i ? 1 : 0));
      basis[i] = idx;
    } else if (r.type === '>=') {
      cols.push(0); colType.push('surplus');
      rows.forEach((rr, k) => rr.coeffs.push(k === i ? -1 : 0));
      let aIdx = cols.length;
      cols.push(BIG_M); colType.push('artificial');
      rows.forEach((rr, k) => rr.coeffs.push(k === i ? 1 : 0));
      basis[i] = aIdx;
    } else {
      let aIdx = cols.length;
      cols.push(BIG_M); colType.push('artificial');
      rows.forEach((rr, k) => rr.coeffs.push(k === i ? 1 : 0));
      basis[i] = aIdx;
    }
  });

  const totalCols = cols.length;
  let T = [];
  for (let i = 0; i < numConstraints; i++) T.push(rows[i].coeffs.concat([rows[i].rhs]));
  let objRow = new Array(totalCols + 1).fill(0);
  for (let j = 0; j < totalCols; j++) objRow[j] = cols[j];
  T.push(objRow);

  for (let i = 0; i < numConstraints; i++) {
    const cB = cols[basis[i]];
    if (cB === 0) continue;
    for (let j = 0; j <= totalCols; j++) T[numConstraints][j] -= cB * T[i][j];
  }

  let iter = 0;
  const MAX_ITER = 3000;
  while (iter++ < MAX_ITER) {
    let enter = -1, best = -EPS;
    for (let j = 0; j < totalCols; j++) {
      if (T[numConstraints][j] < best) { best = T[numConstraints][j]; enter = j; }
    }
    if (enter === -1) break;

    let leave = -1, bestRatio = Infinity;
    for (let i = 0; i < numConstraints; i++) {
      if (T[i][enter] > EPS) {
        const ratio = T[i][totalCols] / T[i][enter];
        if (ratio < bestRatio - EPS) { bestRatio = ratio; leave = i; }
      }
    }
    if (leave === -1) return { status: 'unbounded' };

    const pivotVal = T[leave][enter];
    for (let j = 0; j <= totalCols; j++) T[leave][j] /= pivotVal;
    for (let i = 0; i <= numConstraints; i++) {
      if (i === leave) continue;
      const factor = T[i][enter];
      if (Math.abs(factor) < EPS) continue;
      for (let j = 0; j <= totalCols; j++) T[i][j] -= factor * T[leave][j];
    }
    basis[leave] = enter;
  }

  for (let i = 0; i < numConstraints; i++) {
    if (colType[basis[i]] === 'artificial' && T[i][totalCols] > 1e-5) return { status: 'infeasible' };
  }

  let x = new Array(numVars).fill(0);
  for (let i = 0; i < numConstraints; i++) if (basis[i] < numVars) x[basis[i]] = T[i][totalCols];
  let objective = 0;
  for (let j = 0; j < numVars; j++) objective += cMin[j] * x[j];
  return { status: 'optimal', x, objective };
}

/* ------------------------------ Default data ---------------------------- */
function defaultIngredients() {
  const mk = (name, category, price, n, minPct, maxPct, stock) => ({
    id: uid('ing'), name, category, unit: 'kg', price,
    protein: n[0], energy: n[1], fibre: n[2], fat: n[3], calcium: n[4], phosphorus: n[5],
    minPct: minPct, maxPct: maxPct, stock: stock, available: true
  });
  return [
    mk('Maize', 'Energy source', 50,  [8.5, 3300, 2.5, 3.8, 0.02, 0.28], 0, 65, 1000),
    mk('Soybean Meal', 'Protein source', 78, [44, 2500, 5, 1.5, 0.3, 0.6], 0, 35, 300),
    mk('Fish Meal', 'Protein source', 165, [60, 2900, 1, 8, 4, 2.5], 2, 8, 150),
    mk('Sunflower Cake', 'Protein source', 38, [28, 1900, 22, 3, 0.3, 0.9], 0, 25, 400),
    mk('Wheat Bran', 'Fibre / energy', 40, [15, 1300, 10, 4, 0.1, 1.0], 0, 15, 500),
    mk('Limestone', 'Mineral', 15, [0, 0, 0, 0, 38, 0.02], 0, 10, 200),
    mk('DCP', 'Mineral', 120, [0, 0, 0, 0, 24, 18], 0, 3, 100),
    mk('Premix', 'Additive', 350, [0, 0, 0, 0, 0, 0], 0.25, 0.5, 50),
    mk('Salt', 'Additive', 25, [0, 0, 0, 0, 0, 0], 0.25, 0.5, 50)
  ];
}

function defaultFeedTypes() {
  const mk = (name, animal, description, reqs) => ({
    id: uid('feed'), name, animal, description,
    requirements: reqs
  });
  const req = (protein, energy, fibreMax, calcium, phosphorus) => ({
    protein: { min: protein, max: null },
    energy: { min: energy, max: null },
    fibre: { min: null, max: fibreMax },
    fat: { min: null, max: null },
    calcium: { min: calcium, max: null },
    phosphorus: { min: phosphorus, max: null }
  });
  return [
    mk('Chick Mash', 'Poultry', 'Starter feed for day-old to ~4 week chicks.', req(20, 2900, 6, 0.9, 0.4)),
    mk('Growers Mash', 'Poultry', 'Grower feed for 5–18 week birds.', req(16, 2800, 7, 0.8, 0.35)),
    mk('Layers Mash', 'Poultry', 'Feed for laying hens in production.', req(16, 2700, 7, 3.5, 0.4)),
    mk('Dairy Meal', 'Dairy', 'General dairy concentrate.', req(16, 2600, 12, 0.6, 0.4))
  ];
}

/* --------------------------------- State --------------------------------- */
const STORAGE_KEY = 'feedledger_state_v1';

function freshState() {
  const ingredients = defaultIngredients();
  const feedTypes = defaultFeedTypes();
  return {
    ingredients,
    feedTypes,
    scenarios: [],
    activeTab: 'dashboard',
    draft: makeDraft(feedTypes[0], ingredients),
    editingIngredientId: null,
    editingFeedTypeId: null,
    compareIds: [],
    modal: null,
    toast: null
  };
}

function makeDraft(feedType, ingredients) {
  return {
    name: '',
    feedTypeId: feedType ? feedType.id : null,
    batchSize: 500,
    objective: 'target_price',
    targetPriceMin: 50,
    targetPriceMax: 60,
    rows: ingredients.map(i => ({
      ingredientId: i.id,
      selected: true,
      price: i.price,
      stock: i.stock,
      available: i.available,
      minPct: i.minPct,
      maxPct: i.maxPct
    })),
    result: null,
    manualMode: false
  };
}

let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshState();
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.ingredients || !parsed.feedTypes) return freshState();
    if (!parsed.draft) parsed.draft = makeDraft(parsed.feedTypes[0], parsed.ingredients);
    if (!parsed.compareIds) parsed.compareIds = [];
    return parsed;
  } catch (e) {
    return freshState();
  }
}

function saveState() {
  try {
    const toSave = Object.assign({}, state, { modal: null, toast: null });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch (e) { /* storage unavailable; continue in-memory */ }
}

function setState(patch) {
  Object.assign(state, patch);
  saveState();
  render();
}

function showToast(msg) {
  state.toast = msg;
  render();
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => { state.toast = null; render(); }, 2600);
}

function ingredientById(id) { return state.ingredients.find(i => i.id === id); }
function feedTypeById(id) { return state.feedTypes.find(f => f.id === id); }
function scenarioById(id) { return state.scenarios.find(s => s.id === id); }

/* -------------------------------- Events -------------------------------- */
function readDraftFromDOM() {
  const d = state.draft;
  const feedSel = document.getElementById('draft-feedtype');
  if (feedSel) d.feedTypeId = feedSel.value;
  const batchEl = document.getElementById('draft-batch');
  if (batchEl) d.batchSize = num(batchEl.value, d.batchSize);
  const objEl = document.getElementById('draft-objective');
  if (objEl) d.objective = objEl.value;
  const pmin = document.getElementById('draft-price-min');
  if (pmin) d.targetPriceMin = pmin.value === '' ? '' : num(pmin.value);
  const pmax = document.getElementById('draft-price-max');
  if (pmax) d.targetPriceMax = pmax.value === '' ? '' : num(pmax.value);

  document.querySelectorAll('[data-row-ingredient]').forEach(rowEl => {
    const id = rowEl.getAttribute('data-row-ingredient');
    const row = d.rows.find(r => r.ingredientId === id);
    if (!row) return;
    row.selected = rowEl.querySelector('[data-field="selected"]').checked;
    row.available = rowEl.querySelector('[data-field="available"]').checked;
    row.price = num(rowEl.querySelector('[data-field="price"]').value);
    const stockEl = rowEl.querySelector('[data-field="stock"]');
    row.stock = stockEl.value === '' ? '' : num(stockEl.value);
    row.minPct = num(rowEl.querySelector('[data-field="minPct"]').value);
    row.maxPct = num(rowEl.querySelector('[data-field="maxPct"]').value);
  });
}

function syncDraftRowsWithIngredients() {
  const d = state.draft;
  const existingIds = d.rows.map(r => r.ingredientId);
  state.ingredients.forEach(i => {
    if (existingIds.indexOf(i.id) === -1) {
      d.rows.push({ ingredientId: i.id, selected: true, price: i.price, stock: i.stock, available: i.available, minPct: i.minPct, maxPct: i.maxPct });
    }
  });
  d.rows = d.rows.filter(r => ingredientById(r.ingredientId));
}

function initEvents() {
  document.getElementById('app').addEventListener('click', onAppClick);
  document.getElementById('app').addEventListener('change', onAppChange);
  document.getElementById('modal-root').addEventListener('click', onModalClick);
}

function onAppChange(e) {
  const feedSel = e.target.closest('#draft-feedtype');
  if (feedSel) {
    readDraftFromDOM();
    state.draft.feedTypeId = feedSel.value;
    state.draft.result = null;
    saveState(); render();
    return;
  }
  const manualToggle = e.target.closest('#draft-manual');
  if (manualToggle) {
    state.draft.manualMode = manualToggle.checked;
    saveState(); render();
    return;
  }
}

function onAppClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.getAttribute('data-action');
  const id = el.getAttribute('data-id');

  switch (action) {
    case 'nav':
      setState({ activeTab: el.getAttribute('data-tab') });
      break;

    /* ---- Ingredients ---- */
    case 'ing-new':
      setState({ editingIngredientId: 'new' });
      break;
    case 'ing-edit':
      setState({ editingIngredientId: id });
      break;
    case 'ing-cancel':
      setState({ editingIngredientId: null });
      break;
    case 'ing-save': {
      const data = {
        name: document.getElementById('ing-f-name').value.trim() || 'Unnamed ingredient',
        category: document.getElementById('ing-f-category').value.trim() || 'Uncategorised',
        price: num(document.getElementById('ing-f-price').value),
        protein: num(document.getElementById('ing-f-protein').value),
        energy: num(document.getElementById('ing-f-energy').value),
        fibre: num(document.getElementById('ing-f-fibre').value),
        fat: num(document.getElementById('ing-f-fat').value),
        calcium: num(document.getElementById('ing-f-calcium').value),
        phosphorus: num(document.getElementById('ing-f-phosphorus').value),
        minPct: num(document.getElementById('ing-f-min').value, 0),
        maxPct: num(document.getElementById('ing-f-max').value, 100),
        stock: document.getElementById('ing-f-stock').value === '' ? '' : num(document.getElementById('ing-f-stock').value),
        available: document.getElementById('ing-f-available').checked
      };
      if (id) {
        Object.assign(ingredientById(id), data);
      } else {
        state.ingredients.push(Object.assign({ id: uid('ing'), unit: 'kg' }, data));
      }
      syncDraftRowsWithIngredients();
      setState({ editingIngredientId: null });
      showToast('Ingredient saved.');
      break;
    }
    case 'ing-delete':
      state.ingredients = state.ingredients.filter(i => i.id !== id);
      state.draft.rows = state.draft.rows.filter(r => r.ingredientId !== id);
      setState({});
      showToast('Ingredient deleted.');
      break;

    /* ---- Feed types ---- */
    case 'feed-new':
      setState({ editingFeedTypeId: 'new' });
      break;
    case 'feed-edit':
      setState({ editingFeedTypeId: id });
      break;
    case 'feed-cancel':
      setState({ editingFeedTypeId: null });
      break;
    case 'feed-use':
      state.draft.feedTypeId = id;
      state.draft.result = null;
      setState({ activeTab: 'formulate' });
      break;
    case 'feed-save': {
      const requirements = {};
      NUTRIENTS.forEach(n => {
        const minEl = document.getElementById('feed-f-min-' + n.key);
        const maxEl = document.getElementById('feed-f-max-' + n.key);
        requirements[n.key] = {
          min: minEl.value === '' ? null : num(minEl.value),
          max: maxEl.value === '' ? null : num(maxEl.value)
        };
      });
      const data = {
        name: document.getElementById('feed-f-name').value.trim() || 'Unnamed feed',
        animal: document.getElementById('feed-f-animal').value.trim() || 'General',
        description: document.getElementById('feed-f-description').value.trim(),
        requirements
      };
      if (id) {
        Object.assign(feedTypeById(id), data);
      } else {
        const created = Object.assign({ id: uid('feed') }, data);
        state.feedTypes.push(created);
      }
      setState({ editingFeedTypeId: null });
      showToast('Feed type saved.');
      break;
    }
    case 'feed-delete':
      state.feedTypes = state.feedTypes.filter(f => f.id !== id);
      setState({});
      showToast('Feed type deleted.');
      break;

    /* ---- Formulate ---- */
    case 'draft-generate': {
      readDraftFromDOM();
      const ft = feedTypeById(state.draft.feedTypeId);
      const result = runOptimization(state.draft, ft);
      state.draft.result = result;
      state.draft.manualMode = false;
      saveState();
      render();
      const resPanel = document.querySelector('.panel:last-of-type');
      if (resPanel && typeof resPanel.scrollIntoView === 'function') resPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      break;
    }
    case 'draft-recalc': {
      const ft = feedTypeById(state.draft.feedTypeId);
      const batch = num(state.draft.batchSize);
      const items = state.draft.result.items.map(it => {
        const pctEl = document.querySelector('[data-edit-pct][data-ingredient="' + it.ingredientId + '"]');
        const pct = pctEl ? num(pctEl.value) : it.percentage;
        return { ingredientId: it.ingredientId, quantity: (pct / 100) * batch };
      });
      state.draft.result = computeResult(state.draft, items, ft);
      saveState(); render();
      showToast('Recalculated.');
      break;
    }
    case 'draft-save-scenario':
      setState({ modal: { type: 'save-scenario', defaultName: 'Scenario ' + (state.scenarios.length + 1) } });
      break;
    case 'draft-export-csv': {
      const tempScenario = buildScenarioFromDraft('Draft export');
      downloadText(slug(tempScenario.name) + '.csv', scenarioToCSV(tempScenario), 'text/csv');
      break;
    }
    case 'draft-print':
      printScenario(buildScenarioFromDraft('Formulation ' + fmtDate(nowISO())));
      break;
    case 'draft-email':
      emailScenario(buildScenarioFromDraft('Formulation ' + fmtDate(nowISO())));
      break;

    /* ---- Scenarios ---- */
    case 'scenario-open':
      setState({ activeTab: 'scenarios' });
      break;
    case 'scenario-duplicate': {
      const s = scenarioById(id);
      if (!s) break;
      state.draft = draftFromScenario(s);
      setState({ activeTab: 'formulate' });
      showToast('Loaded into Formulate — adjust conditions and generate again.');
      break;
    }
    case 'scenario-delete':
      setState({ modal: { type: 'confirm', title: 'Delete scenario?', body: 'This cannot be undone.', confirmLabel: 'Delete', onConfirm: 'delete-scenario', targetId: id } });
      break;
    case 'scenario-compare-toggle': {
      const idx = state.compareIds.indexOf(id);
      if (idx === -1) state.compareIds.push(id); else state.compareIds.splice(idx, 1);
      setState({});
      break;
    }
    case 'scenario-export-csv': {
      const s = scenarioById(id);
      if (s) downloadText(slug(s.name) + '.csv', scenarioToCSV(s), 'text/csv');
      break;
    }
    case 'scenario-print': {
      const s = scenarioById(id);
      if (s) printScenario(s);
      break;
    }
    case 'scenario-email': {
      const s = scenarioById(id);
      if (s) emailScenario(s);
      break;
    }

    /* ---- Compare ---- */
    case 'compare-clear':
      setState({ compareIds: [] });
      break;
  }
}

function onModalClick(e) {
  const el = e.target.closest('[data-action]');
  const backdrop = e.target.closest('[data-action="modal-backdrop"]');
  if (backdrop && backdrop === e.target) { setState({ modal: null }); return; }
  if (!el) return;
  const action = el.getAttribute('data-action');
  if (action === 'modal-cancel') { setState({ modal: null }); return; }
  if (action === 'modal-save-scenario') {
    const name = document.getElementById('modal-scenario-name').value.trim() || 'Untitled scenario';
    const desc = document.getElementById('modal-scenario-desc').value.trim();
    const sc = buildScenarioFromDraft(name, desc);
    state.scenarios.push(sc);
    setState({ modal: null, activeTab: 'scenarios' });
    showToast('Scenario saved.');
    return;
  }
  if (action === 'modal-confirm') {
    const m = state.modal;
    if (m && m.onConfirm === 'delete-scenario') {
      state.scenarios = state.scenarios.filter(s => s.id !== m.targetId);
      state.compareIds = state.compareIds.filter(cid => cid !== m.targetId);
    }
    setState({ modal: null });
    showToast('Deleted.');
    return;
  }
}

function buildScenarioFromDraft(name, description) {
  const d = state.draft;
  return {
    id: uid('scn'),
    name, description: description || '',
    feedTypeId: d.feedTypeId,
    batchSize: d.batchSize,
    objective: d.objective,
    targetPriceMin: d.targetPriceMin,
    targetPriceMax: d.targetPriceMax,
    rows: JSON.parse(JSON.stringify(d.rows)),
    result: d.result,
    createdAt: nowISO()
  };
}

function draftFromScenario(s) {
  return {
    name: s.name,
    feedTypeId: s.feedTypeId,
    batchSize: s.batchSize,
    objective: s.objective,
    targetPriceMin: s.targetPriceMin,
    targetPriceMax: s.targetPriceMax,
    rows: JSON.parse(JSON.stringify(s.rows)),
    result: null,
    manualMode: false
  };
}

function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'export'; }

/* --------------------------------- Init ---------------------------------- */
function init() {
  syncDraftRowsWithIngredients();
  initEvents();
  render();
}
init();

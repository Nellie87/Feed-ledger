/* -------------------------------- Rendering ------------------------------ */
const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'ingredients', label: 'Ingredients' },
  { id: 'feedtypes', label: 'Feed Types' },
  { id: 'formulate', label: 'Formulate' },
  { id: 'scenarios', label: 'Scenarios' },
  { id: 'compare', label: 'Compare' }
];

function render() {
  const app = document.getElementById('app');
  app.innerHTML = renderShell();
  renderModal();
  renderToast();
}

function renderShell() {
  return (
    '<div class="shell">' +
      renderSidebar() +
      '<div class="main"><div class="main-inner">' + renderTab() + '</div></div>' +
    '</div>'
  );
}

function renderSidebar() {
  const nav = TABS.map((t, i) =>
    '<button data-action="nav" data-tab="' + t.id + '" class="' + (state.activeTab === t.id ? 'active' : '') + '">' +
      '<span class="n">' + String(i + 1).padStart(2, '0') + '</span>' + esc(t.label) +
    '</button>'
  ).join('');
  return (
    '<div class="sidebar">' +
      '<div class="brand"><div class="mark">🌾 Feed Ledger</div><div class="sub">Formulation &amp; Optimization</div></div>' +
      '<div class="nav">' + nav + '</div>' +
      '<div class="sidebar-foot">' + state.ingredients.length + ' ingredients · ' + state.feedTypes.length + ' feed types · ' + state.scenarios.length + ' scenarios</div>' +
    '</div>'
  );
}

function renderTab() {
  switch (state.activeTab) {
    case 'dashboard': return renderDashboard();
    case 'ingredients': return renderIngredients();
    case 'feedtypes': return renderFeedTypes();
    case 'formulate': return renderFormulate();
    case 'scenarios': return renderScenarios();
    case 'compare': return renderCompare();
    default: return renderDashboard();
  }
}

/* -------------------------------- Dashboard ------------------------------ */
function renderDashboard() {
  const recent = state.scenarios.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 4);
  const feasible = state.scenarios.filter(s => s.result && s.result.status !== 'infeasible');
  const avgCost = feasible.length ? feasible.reduce((s, x) => s + x.result.costPerKg, 0) / feasible.length : null;

  return (
    '<div class="page-head">' +
      '<h1>Dashboard</h1>' +
      '<p>A feed formula should adapt to changing conditions, not sit fixed as a recipe. Start here, then head to Formulate when prices or stock move.</p>' +
    '</div>' +
    '<div class="grid-3">' +
      statCard('Ingredients on file', state.ingredients.length, '') +
      statCard('Saved scenarios', state.scenarios.length, '') +
      statCard('Avg. cost across scenarios', avgCost !== null ? 'KSh ' + fmt(avgCost, 2) : '—', avgCost !== null ? 'per kg' : '') +
    '</div>' +
    '<div class="panel">' +
      '<div class="panel-head"><h2>Recent scenarios</h2><button class="btn btn-primary btn-sm" data-action="nav" data-tab="formulate">New formulation</button></div>' +
      '<div class="panel-body' + (recent.length ? ' tight' : '') + '">' +
        (recent.length ? renderScenarioMiniList(recent) : emptyState('No scenarios yet', 'Generate your first formulation to see it appear here.', 'formulate', 'Go to Formulate')) +
      '</div>' +
    '</div>' +
    '<div class="panel">' +
      '<div class="panel-head"><h2>Current ingredient prices</h2><span class="hint">from the ingredient library</span></div>' +
      '<div class="panel-body tight table-wrap"><table><thead><tr><th>Ingredient</th><th>Category</th><th class="num">Price (KSh/kg)</th><th class="num">Stock (kg)</th></tr></thead><tbody>' +
        state.ingredients.map(i => '<tr><td>' + esc(i.name) + '</td><td>' + esc(i.category) + '</td><td class="num">' + fmt(i.price, 2) + '</td><td class="num">' + fmt(i.stock, 0) + '</td></tr>').join('') +
      '</tbody></table></div>' +
    '</div>'
  );
}

function statCard(label, value, suffix) {
  return '<div class="stat accent"><div class="k">' + esc(label) + '</div><div class="v">' + value + (suffix ? ' <small>' + esc(suffix) + '</small>' : '') + '</div></div>';
}

function emptyState(title, body, tab, cta) {
  return '<div class="empty"><h3>' + esc(title) + '</h3><p>' + esc(body) + '</p>' + (tab ? '<button class="btn btn-primary btn-sm" data-action="nav" data-tab="' + tab + '">' + esc(cta) + '</button>' : '') + '</div>';
}

function renderScenarioMiniList(list) {
  return '<table><thead><tr><th>Scenario</th><th>Feed type</th><th class="num">Cost/kg</th><th>Status</th><th></th></tr></thead><tbody>' +
    list.map(s => {
      const ft = feedTypeById(s.feedTypeId);
      const ok = s.result && s.result.status !== 'infeasible';
      return '<tr><td>' + esc(s.name) + '</td><td>' + esc(ft ? ft.name : '—') + '</td><td class="num">' + (ok ? 'KSh ' + fmt(s.result.costPerKg, 2) : '—') + '</td>' +
        '<td>' + (ok ? tag('ok', 'Feasible') : tag('danger', 'Infeasible')) + '</td>' +
        '<td><button class="btn btn-ghost btn-sm" data-action="scenario-open" data-id="' + s.id + '">View</button></td></tr>';
    }).join('') + '</tbody></table>';
}

function tag(kind, label) { return '<span class="tag tag-' + kind + '">' + esc(label) + '</span>'; }

/* -------------------------------- Ingredients ----------------------------- */
function renderIngredients() {
  const editing = state.editingIngredientId;
  const editObj = editing === 'new' ? null : (editing ? ingredientById(editing) : undefined);
  return (
    '<div class="page-head"><div class="row"><div>' +
      '<h1>Ingredient Library</h1><p>Prices, nutrient values and inclusion limits for every ingredient you can formulate with. The library ships with illustrative example values — replace them with your supplier prices and lab or reference nutrient data before relying on results.</p>' +
    '</div><button class="btn btn-primary" data-action="ing-new">+ Add ingredient</button></div></div>' +
    (editing ? renderIngredientForm(editObj) : '') +
    '<div class="panel">' +
      '<div class="panel-head"><h2>All ingredients</h2><span class="hint">' + state.ingredients.length + ' items</span></div>' +
      '<div class="panel-body tight table-wrap"><table><thead><tr>' +
        '<th>Name</th><th>Category</th><th class="num">Price</th><th class="num">Protein %</th><th class="num">Energy</th>' +
        '<th class="num">Fibre %</th><th class="num">Ca %</th><th class="num">P %</th><th class="num">Incl. %</th><th class="num">Stock kg</th><th></th></tr></thead><tbody>' +
        (state.ingredients.length ? state.ingredients.map(renderIngredientRow).join('') : '<tr><td colspan="11">' + emptyState('No ingredients yet', 'Add your first ingredient to begin.', '', '') + '</td></tr>') +
      '</tbody></table></div>' +
    '</div>'
  );
}

function renderIngredientRow(i) {
  return '<tr>' +
    '<td>' + esc(i.name) + (i.available ? '' : ' ' + tag('muted', 'Unavailable')) + '</td>' +
    '<td>' + esc(i.category) + '</td>' +
    '<td class="num">' + fmt(i.price, 2) + '</td>' +
    '<td class="num">' + fmt(i.protein, 1) + '</td>' +
    '<td class="num">' + fmt(i.energy, 0) + '</td>' +
    '<td class="num">' + fmt(i.fibre, 1) + '</td>' +
    '<td class="num">' + fmt(i.calcium, 2) + '</td>' +
    '<td class="num">' + fmt(i.phosphorus, 2) + '</td>' +
    '<td class="num">' + fmt(i.minPct, 1) + '–' + fmt(i.maxPct, 1) + '</td>' +
    '<td class="num">' + fmt(i.stock, 0) + '</td>' +
    '<td><button class="btn btn-ghost btn-sm" data-action="ing-edit" data-id="' + i.id + '">Edit</button> <button class="btn btn-ghost btn-sm" data-action="ing-delete" data-id="' + i.id + '">Delete</button></td>' +
    '</tr>';
}

function renderIngredientForm(ing) {
  const v = ing || { name: '', category: '', price: '', protein: '', energy: '', fibre: '', fat: '', calcium: '', phosphorus: '', minPct: 0, maxPct: 100, stock: '', available: true };
  const isNew = !ing;
  return (
    '<div class="panel"><div class="panel-head"><h2>' + (isNew ? 'Add ingredient' : 'Edit ' + esc(v.name)) + '</h2></div>' +
    '<div class="panel-body">' +
      '<div class="grid-3">' +
        field('text', 'ing-f-name', 'Name', v.name, '') +
        field('text', 'ing-f-category', 'Category', v.category, 'e.g. Energy source, Protein source, Mineral, Additive') +
        field('number', 'ing-f-price', 'Price (KSh/kg)', v.price, '') +
      '</div>' +
      '<div class="section-label">Nutritional value (per kg, as-fed basis)</div>' +
      '<div class="grid-3">' +
        field('number', 'ing-f-protein', 'Crude protein (%)', v.protein, '') +
        field('number', 'ing-f-energy', 'Energy (kcal/kg)', v.energy, '') +
        field('number', 'ing-f-fibre', 'Crude fibre (%)', v.fibre, '') +
        field('number', 'ing-f-fat', 'Fat (%)', v.fat, '') +
        field('number', 'ing-f-calcium', 'Calcium (%)', v.calcium, '') +
        field('number', 'ing-f-phosphorus', 'Phosphorus (%)', v.phosphorus, '') +
      '</div>' +
      '<div class="section-label">Formulation constraints</div>' +
      '<div class="grid-3">' +
        field('number', 'ing-f-min', 'Minimum inclusion (%)', v.minPct, '') +
        field('number', 'ing-f-max', 'Maximum inclusion (%)', v.maxPct, '') +
        field('number', 'ing-f-stock', 'Available stock (kg)', v.stock, 'Leave blank for unlimited') +
      '</div>' +
      '<div class="field" style="flex-direction:row;align-items:center;gap:8px;"><input type="checkbox" id="ing-f-available" ' + (v.available ? 'checked' : '') + '> <label for="ing-f-available" style="margin:0;">Available for formulation</label></div>' +
    '</div>' +
    '<div class="modal-foot">' +
      '<button class="btn btn-ghost" data-action="ing-cancel">Cancel</button>' +
      '<button class="btn btn-primary" data-action="ing-save" data-id="' + (ing ? ing.id : '') + '">Save ingredient</button>' +
    '</div></div>'
  );
}

function field(type, id, label, value, desc) {
  return '<div class="field"><label for="' + id + '">' + esc(label) + '</label>' +
    '<input type="' + type + '" id="' + id + '" value="' + esc(value) + '" ' + (type === 'number' ? 'step="any"' : '') + '>' +
    (desc ? '<span class="desc">' + esc(desc) + '</span>' : '') +
    '</div>';
}

/* -------------------------------- Feed Types ------------------------------ */
function renderFeedTypes() {
  const editing = state.editingFeedTypeId;
  const editObj = editing === 'new' ? null : (editing ? feedTypeById(editing) : undefined);
  return (
    '<div class="page-head"><div class="row"><div>' +
      '<h1>Feed Types</h1><p>Reusable nutritional specifications. The same feed type can be formulated many times as prices and stock change.</p>' +
    '</div><button class="btn btn-primary" data-action="feed-new">+ Add feed type</button></div></div>' +
    (editing ? renderFeedTypeForm(editObj) : '') +
    '<div class="grid-2">' +
      state.feedTypes.map(renderFeedTypeCard).join('') +
    '</div>' +
    (state.feedTypes.length === 0 ? emptyState('No feed types yet', 'Create a feed type to define its nutritional requirements.', '', '') : '')
  );
}

function renderFeedTypeCard(f) {
  const reqRows = NUTRIENTS.map(n => {
    const r = f.requirements[n.key];
    if (!r || (r.min === null && r.max === null)) return '';
    let spec = '';
    if (r.min !== null && r.min !== undefined) spec += '≥ ' + fmt(r.min, n.digits) + ' ' + n.unit;
    if (r.max !== null && r.max !== undefined) spec += (spec ? ', ' : '') + '≤ ' + fmt(r.max, n.digits) + ' ' + n.unit;
    return '<div class="req-pill"><span class="name">' + esc(n.label) + '</span><span class="spec">' + spec + '</span></div>';
  }).join('');
  return '<div class="panel"><div class="panel-head"><h2>' + esc(f.name) + '</h2><span class="hint">' + esc(f.animal) + '</span></div>' +
    '<div class="panel-body">' +
      '<p style="color:var(--ink-soft);font-size:12.5px;margin:0 0 10px;">' + esc(f.description || '') + '</p>' +
      reqRows +
      '<div style="margin-top:14px;display:flex;gap:8px;">' +
        '<button class="btn btn-ghost btn-sm" data-action="feed-edit" data-id="' + f.id + '">Edit</button>' +
        '<button class="btn btn-ghost btn-sm" data-action="feed-delete" data-id="' + f.id + '">Delete</button>' +
        '<button class="btn btn-grain btn-sm" data-action="feed-use" data-id="' + f.id + '">Use in Formulate →</button>' +
      '</div>' +
    '</div></div>';
}

function renderFeedTypeForm(f) {
  const isNew = !f;
  const v = f || { name: '', animal: '', description: '', requirements: {} };
  const reqFields = NUTRIENTS.map(n => {
    const r = v.requirements[n.key] || {};
    return '<div class="grid-2" style="margin-bottom:2px;">' +
      field('number', 'feed-f-min-' + n.key, n.label + ' min (' + n.unit + ')', r.min === null || r.min === undefined ? '' : r.min, '') +
      field('number', 'feed-f-max-' + n.key, n.label + ' max (' + n.unit + ')', r.max === null || r.max === undefined ? '' : r.max, '') +
    '</div>';
  }).join('');
  return '<div class="panel"><div class="panel-head"><h2>' + (isNew ? 'Add feed type' : 'Edit ' + esc(v.name)) + '</h2></div>' +
    '<div class="panel-body">' +
      '<div class="grid-2">' +
        field('text', 'feed-f-name', 'Feed type name', v.name, 'e.g. Chick Mash') +
        field('text', 'feed-f-animal', 'Animal / category', v.animal, 'e.g. Poultry, Dairy') +
      '</div>' +
      field('text', 'feed-f-description', 'Description', v.description, '') +
      '<div class="section-label">Nutritional requirements — leave blank for no constraint</div>' +
      reqFields +
    '</div>' +
    '<div class="modal-foot">' +
      '<button class="btn btn-ghost" data-action="feed-cancel">Cancel</button>' +
      '<button class="btn btn-primary" data-action="feed-save" data-id="' + (f ? f.id : '') + '">Save feed type</button>' +
    '</div></div>';
}

/* -------------------------------- Formulate -------------------------------- */
function renderFormulate() {
  const d = state.draft;
  const ft = feedTypeById(d.feedTypeId) || state.feedTypes[0];
  const feedOptions = state.feedTypes.map(f => '<option value="' + f.id + '" ' + (ft && f.id === ft.id ? 'selected' : '') + '>' + esc(f.name) + ' (' + esc(f.animal) + ')</option>').join('');

  const reqSummary = ft ? NUTRIENTS.map(n => {
    const r = ft.requirements[n.key];
    if (!r || (r.min === null && r.max === null)) return '';
    let spec = '';
    if (r.min !== null && r.min !== undefined) spec += '≥ ' + fmt(r.min, n.digits) + ' ' + n.unit;
    if (r.max !== null && r.max !== undefined) spec += (spec ? ', ' : '') + '≤ ' + fmt(r.max, n.digits) + ' ' + n.unit;
    return '<div class="req-pill"><span class="name">' + esc(n.label) + '</span><span class="spec">' + spec + '</span></div>';
  }).join('') : '';

  const rows = d.rows.map(r => {
    const ing = ingredientById(r.ingredientId);
    if (!ing) return '';
    return '<div class="checklist-row" data-row-ingredient="' + ing.id + '">' +
      '<input type="checkbox" data-field="selected" ' + (r.selected ? 'checked' : '') + '>' +
      '<span>' + esc(ing.name) + '<br><span style="color:var(--ink-faint);font-size:10.5px;">' + esc(ing.category) + '</span></span>' +
      '<input type="number" step="any" class="inline-num" data-field="price" value="' + esc(r.price) + '" title="Price KSh/kg">' +
      '<input type="number" step="any" class="inline-num cl-avail" data-field="stock" value="' + esc(r.stock) + '" title="Available stock kg">' +
      '<input type="number" step="any" class="inline-num cl-min" data-field="minPct" value="' + esc(r.minPct) + '" title="Min inclusion %">' +
      '<input type="number" step="any" class="inline-num" data-field="maxPct" value="' + esc(r.maxPct) + '" title="Max inclusion %">' +
      '<input type="checkbox" data-field="available" ' + (r.available ? 'checked' : '') + ' title="In stock / available">' +
    '</div>';
  }).join('');

  return (
    '<div class="page-head"><h1>Formulate</h1><p>Set today\'s conditions — batch size, prices, availability and target price — then generate the least-cost formulation that meets requirements.</p></div>' +

    '<div class="panel"><div class="panel-head"><h2>1 · Feed specification</h2></div><div class="panel-body">' +
      '<div class="grid-3">' +
        '<div class="field"><label for="draft-feedtype">Feed type</label><select id="draft-feedtype" data-action-change="feedtype">' + feedOptions + '</select></div>' +
        field('number', 'draft-batch', 'Batch size (kg)', d.batchSize, '') +
        '<div class="field"><label for="draft-objective">Optimization objective</label><select id="draft-objective">' +
          '<option value="least_cost" ' + (d.objective === 'least_cost' ? 'selected' : '') + '>Least cost (ignore price ceiling)</option>' +
          '<option value="target_price" ' + (d.objective === 'target_price' ? 'selected' : '') + '>Least cost within target price</option>' +
        '</select></div>' +
      '</div>' +
      '<div class="grid-2">' +
        field('number', 'draft-price-min', 'Target price — minimum (KSh/kg, optional)', d.targetPriceMin, '') +
        field('number', 'draft-price-max', 'Target price — maximum (KSh/kg)', d.targetPriceMax, 'Used as a hard ceiling when objective is "within target price"') +
      '</div>' +
      '<div class="section-label">Requirements for ' + esc(ft ? ft.name : '—') + '</div>' +
      (reqSummary || '<p style="color:var(--ink-faint);font-size:12.5px;">No requirements set for this feed type — edit it under Feed Types.</p>') +
    '</div></div>' +

    '<div class="panel"><div class="panel-head"><h2>2 · Ingredients — current prices &amp; availability</h2><span class="hint">Editing here only affects this run, not the ingredient library</span></div>' +
      '<div class="panel-body">' +
        '<div class="checklist-head"><span></span><span>Ingredient</span><span>Price/kg</span><span class="cl-avail">Stock kg</span><span class="cl-min">Min %</span><span>Max %</span><span>In stock</span></div>' +
        '<div id="draft-rows">' + rows + '</div>' +
      '</div>' +
    '</div>' +

    '<div style="display:flex;justify-content:flex-end;margin:16px 0;">' +
      '<button class="btn btn-primary" data-action="draft-generate">Generate Formula →</button>' +
    '</div>' +

    renderFormulateResult()
  );
}

function renderFormulateResult() {
  const d = state.draft;
  const r = d.result;
  if (!r) return '';

  if (r.status === 'infeasible' || r.status === 'error') {
    return '<div class="panel"><div class="panel-body">' +
      '<div class="banner banner-danger"><div>' +
        '<strong>No feasible formulation found</strong><br>The current ingredients cannot satisfy all nutritional requirements within the selected price range.' +
        '<div style="margin-top:8px;font-weight:600;">Possible reasons</div>' +
        '<ul>' + infeasibilityReasons().map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' +
      '</div></div>' +
    '</div></div>';
  }

  const itemsRows = r.items.map(it => (
    '<tr data-item-row="' + it.ingredientId + '">' +
      '<td>' + esc(it.name) + '</td>' +
      '<td class="num">' + fmt(it.quantity, 1) + '</td>' +
      '<td class="num">' + (d.manualMode ?
        '<input type="number" step="any" class="inline-num" data-edit-pct data-ingredient="' + it.ingredientId + '" value="' + fmt(it.percentage, 2) + '">' :
        fmt(it.percentage, 1) + '%') +
      '</td>' +
      '<td class="num">' + fmt(it.cost, 0) + '</td>' +
    '</tr>'
  )).join('');

  const nutRows = (r.nutrientChecks || []).map(c =>
    '<div class="req-pill"><span class="name">' + esc(c.label) + (c.pass ? '' : ' ⚠') + '</span><span class="spec num">' + fmt(c.value, c.digits) + ' ' + c.unit + ' <span style="color:var(--ink-faint);">(' + c.spec + ')</span> ' + (c.pass ? tag('ok', '✓') : tag('danger', '✗')) + '</span></div>'
  ).join('');

  const priceBlock = r.priceStatus ? (
    '<div class="req-pill"><span class="name">Target</span><span class="spec num">' + (r.priceStatus.min !== null ? 'KSh ' + fmt(r.priceStatus.min, 2) + ' – ' : '≤ ') + 'KSh ' + fmt(r.priceStatus.max, 2) + '/kg</span></div>' +
    '<div class="req-pill"><span class="name">Actual</span><span class="spec num">KSh ' + fmt(r.costPerKg, 2) + '/kg ' + (r.priceStatus.pass ? tag('ok', '✓ Within target') : tag('danger', '✗ Over target')) + '</span></div>'
  ) : '';

  const warnBanner = r.warnings && r.warnings.length ?
    '<div class="banner banner-warn" style="margin-top:14px;"><div><strong>⚠ ' + r.warnings.length + ' warning' + (r.warnings.length > 1 ? 's' : '') + '</strong><ul>' +
      r.warnings.map(w => '<li>' + esc(w.text) + '</li>').join('') + '</ul></div></div>' :
    '<div class="banner banner-ok" style="margin-top:14px;">✓ All requirements satisfied.</div>';

  return (
    '<div class="panel"><div class="panel-head"><h2>3 · Formulation result</h2>' +
      '<div style="display:flex;gap:8px;align-items:center;">' +
        '<label style="font-size:12px;display:flex;gap:6px;align-items:center;"><input type="checkbox" id="draft-manual" ' + (d.manualMode ? 'checked' : '') + '> Manual adjustment</label>' +
        (d.manualMode ? '<button class="btn btn-sm btn-grain" data-action="draft-recalc">Recalculate</button>' : '') +
      '</div>' +
    '</div>' +
    '<div class="panel-body">' +
      '<div class="grid-3" style="margin-bottom:18px;">' +
        statCard('Cost per kg', 'KSh ' + fmt(r.costPerKg, 2), '') +
        statCard('Batch total cost', 'KSh ' + fmt(r.totalCost, 0), fmt(d.batchSize, 0) + ' kg') +
        statCard('Total weight', fmt(r.totalQty, 1) + ' kg', '') +
      '</div>' +
      '<div class="table-wrap"><table><thead><tr><th>Ingredient</th><th class="num">Quantity (kg)</th><th class="num">%</th><th class="num">Cost (KSh)</th></tr></thead><tbody>' +
        itemsRows +
        '<tr class="row-total"><td>Total</td><td class="num">' + fmt(r.totalQty, 1) + '</td><td class="num">100%</td><td class="num">' + fmt(r.totalCost, 0) + '</td></tr>' +
      '</tbody></table></div>' +
      '<div class="grid-2" style="margin-top:18px;">' +
        '<div><div class="section-label">Nutritional analysis</div>' + nutRows + '</div>' +
        '<div><div class="section-label">Cost analysis</div>' + priceBlock + '</div>' +
      '</div>' +
      warnBanner +
      '<div style="display:flex;gap:8px;margin-top:18px;flex-wrap:wrap;">' +
        '<button class="btn btn-primary" data-action="draft-save-scenario">Save as scenario</button>' +
        '<button class="btn" data-action="draft-export-csv">Export CSV</button>' +
        '<button class="btn" data-action="draft-print">Print / Save as PDF</button>' +
        '<button class="btn" data-action="draft-email">Email formulation</button>' +
      '</div>' +
    '</div></div>'
  );
}

/* -------------------------------- Scenarios -------------------------------- */
function renderScenarios() {
  if (state.scenarios.length === 0) {
    return '<div class="page-head"><h1>Scenarios</h1><p>Save formulations under different conditions, then compare how they change.</p></div>' +
      emptyState('No scenarios saved', 'Generate a formulation and save it as a scenario to start tracking how conditions change.', 'formulate', 'Go to Formulate');
  }
  const list = state.scenarios.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return (
    '<div class="page-head"><div class="row"><div><h1>Scenarios</h1><p>Each scenario is a snapshot of prices, availability and the resulting formulation. Select a few and compare them side by side.</p></div>' +
      '<button class="btn btn-primary" data-action="nav" data-tab="compare" ' + (state.compareIds.length < 2 ? 'disabled' : '') + '>Compare selected (' + state.compareIds.length + ')</button>' +
    '</div></div>' +
    list.map(renderScenarioCard).join('')
  );
}

function renderScenarioCard(s) {
  const ft = feedTypeById(s.feedTypeId);
  const ok = s.result && s.result.status !== 'infeasible';
  const checked = state.compareIds.indexOf(s.id) !== -1;
  return '<div class="scenario-card">' +
    '<div class="top">' +
      '<div><label style="display:flex;gap:8px;align-items:flex-start;"><input type="checkbox" data-action="scenario-compare-toggle" data-id="' + s.id + '" ' + (checked ? 'checked' : '') + ' style="margin-top:3px;">' +
      '<span><h3 style="display:inline;">' + esc(s.name) + '</h3><div class="meta">' + esc(ft ? ft.name : '—') + ' · ' + fmt(s.batchSize, 0) + ' kg batch · saved ' + esc(fmtDate(s.createdAt)) + '</div></span></label></div>' +
      (ok ? tag('ok', 'Feasible') : tag('danger', 'Infeasible')) +
    '</div>' +
    (s.description ? '<p style="font-size:12.5px;color:var(--ink-soft);margin:8px 0 0;">' + esc(s.description) + '</p>' : '') +
    (ok ? (
      '<div class="figs">' +
        fig('Cost / kg', 'KSh ' + fmt(s.result.costPerKg, 2)) +
        fig('Batch cost', 'KSh ' + fmt(s.result.totalCost, 0)) +
        fig('Protein', fmt(s.result.nutrition.protein, 1) + '%') +
        fig('Energy', fmt(s.result.nutrition.energy, 0)) +
        fig('Warnings', String((s.result.warnings || []).length)) +
      '</div>'
    ) : '') +
    '<div class="actions">' +
      '<button class="btn btn-ghost btn-sm" data-action="scenario-duplicate" data-id="' + s.id + '">Duplicate into Formulate</button>' +
      '<button class="btn btn-ghost btn-sm" data-action="scenario-export-csv" data-id="' + s.id + '">Export CSV</button>' +
      '<button class="btn btn-ghost btn-sm" data-action="scenario-print" data-id="' + s.id + '">Print / PDF</button>' +
      '<button class="btn btn-ghost btn-sm" data-action="scenario-email" data-id="' + s.id + '">Email</button>' +
      '<button class="btn btn-danger btn-sm" data-action="scenario-delete" data-id="' + s.id + '">Delete</button>' +
    '</div>' +
  '</div>';
}
function fig(k, v) { return '<div class="f"><div class="k">' + esc(k) + '</div><div class="v">' + v + '</div></div>'; }

/* -------------------------------- Compare -------------------------------- */
function renderCompare() {
  const selected = state.compareIds.map(scenarioById).filter(Boolean).filter(s => s.result && s.result.status !== 'infeasible');
  if (selected.length < 2) {
    return '<div class="page-head"><h1>Compare Scenarios</h1><p>Pick two or more feasible scenarios from the Scenarios tab to compare them here.</p></div>' +
      emptyState('Select scenarios to compare', 'Go to Scenarios, tick the checkbox on at least two feasible scenarios, then come back here.', 'scenarios', 'Go to Scenarios');
  }

  const allIngredientIds = [];
  selected.forEach(s => s.result.items.forEach(it => { if (allIngredientIds.indexOf(it.ingredientId) === -1) allIngredientIds.push(it.ingredientId); }));

  const header = '<th>Metric</th>' + selected.map(s => '<th class="num">' + esc(s.name) + '</th>').join('');
  const rowsMeta = [
    ['Feed type', s => esc((feedTypeById(s.feedTypeId) || {}).name || '—')],
    ['Batch size', s => fmt(s.batchSize, 0) + ' kg'],
    ['Cost / kg', s => 'KSh ' + fmt(s.result.costPerKg, 2)],
    ['Batch cost', s => 'KSh ' + fmt(s.result.totalCost, 0)]
  ];
  const metaRows = rowsMeta.map(([label, fn]) => '<tr><td>' + esc(label) + '</td>' + selected.map(s => '<td class="num">' + fn(s) + '</td>').join('') + '</tr>').join('');

  const nutrientRows = NUTRIENTS.map(n => {
    const cells = selected.map(s => {
      const check = (s.result.nutrientChecks || []).find(c => c.key === n.key);
      if (!check) return '<td class="num">' + fmt(s.result.nutrition[n.key], n.digits) + ' ' + n.unit + '</td>';
      return '<td class="num">' + fmt(check.value, check.digits) + ' ' + check.unit + ' ' + (check.pass ? tag('ok', '✓') : tag('danger', '✗')) + '</td>';
    }).join('');
    return '<tr><td>' + esc(n.label) + '</td>' + cells + '</tr>';
  }).join('');

  const ingredientRows = allIngredientIds.map(id => {
    const ing = ingredientById(id);
    const cells = selected.map(s => {
      const it = s.result.items.find(x => x.ingredientId === id);
      return '<td class="num">' + (it ? fmt(it.percentage, 1) + '%' : '—') + '</td>';
    }).join('');
    return '<tr><td>' + esc(ing ? ing.name : '(removed)') + '</td>' + cells + '</tr>';
  }).join('');

  return (
    '<div class="page-head"><div class="row"><div><h1>Compare Scenarios</h1><p>How the formulation shifts under different market conditions.</p></div>' +
      '<button class="btn btn-ghost btn-sm" data-action="compare-clear">Clear selection</button></div></div>' +
    '<div class="panel"><div class="panel-head"><h2>Overview</h2></div><div class="panel-body tight compare-scroll table-wrap">' +
      '<table><thead><tr>' + header + '</tr></thead><tbody>' + metaRows + '</tbody></table>' +
    '</div></div>' +
    '<div class="panel"><div class="panel-head"><h2>Nutritional composition</h2></div><div class="panel-body tight compare-scroll table-wrap">' +
      '<table><thead><tr>' + header + '</tr></thead><tbody>' + nutrientRows + '</tbody></table>' +
    '</div></div>' +
    '<div class="panel"><div class="panel-head"><h2>Ingredient composition (% of batch)</h2></div><div class="panel-body tight compare-scroll table-wrap">' +
      '<table><thead><tr>' + header + '</tr></thead><tbody>' + ingredientRows + '</tbody></table>' +
    '</div></div>'
  );
}

/* -------------------------------- Modal & toast -------------------------------- */
function renderModal() {
  const root = document.getElementById('modal-root');
  if (!state.modal) { root.innerHTML = ''; return; }
  if (state.modal.type === 'save-scenario') {
    root.innerHTML =
      '<div class="modal-backdrop" data-action="modal-backdrop"><div class="modal">' +
        '<div class="modal-head"><h3 style="font-size:15px;">Save scenario</h3></div>' +
        '<div class="modal-body">' +
          field('text', 'modal-scenario-name', 'Scenario name', state.modal.defaultName || '', 'e.g. Current Market, High Maize Price') +
          field('text', 'modal-scenario-desc', 'Description (optional)', '', 'What changed in this scenario?') +
        '</div>' +
        '<div class="modal-foot"><button class="btn btn-ghost" data-action="modal-cancel">Cancel</button><button class="btn btn-primary" data-action="modal-save-scenario">Save</button></div>' +
      '</div></div>';
    setTimeout(() => { const el = document.getElementById('modal-scenario-name'); if (el) el.focus(); }, 0);
  } else if (state.modal.type === 'confirm') {
    root.innerHTML =
      '<div class="modal-backdrop" data-action="modal-backdrop"><div class="modal">' +
        '<div class="modal-head"><h3 style="font-size:15px;">' + esc(state.modal.title) + '</h3></div>' +
        '<div class="modal-body"><p style="font-size:13px;color:var(--ink-soft);margin:0;">' + esc(state.modal.body) + '</p></div>' +
        '<div class="modal-foot"><button class="btn btn-ghost" data-action="modal-cancel">Cancel</button><button class="btn btn-danger" data-action="modal-confirm">' + esc(state.modal.confirmLabel || 'Confirm') + '</button></div>' +
      '</div></div>';
  }
}

function renderToast() {
  const root = document.getElementById('toast-root');
  root.innerHTML = state.toast ? '<div class="toast">' + esc(state.toast) + '</div>' : '';
}

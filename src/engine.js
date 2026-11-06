/* --------------------------- Calculation engine -------------------------- */
/* items: [{ingredientId, quantity}] -> full result with % , nutrition, cost, warnings */
function computeResult(draft, items, feedType) {
  const batch = num(draft.batchSize, 0);
  const rowsById = {};
  draft.rows.forEach(r => rowsById[r.ingredientId] = r);

  let totalQty = 0, totalCost = 0;
  const nutrientTotals = { protein: 0, energy: 0, fibre: 0, fat: 0, calcium: 0, phosphorus: 0 };
  const outItems = items.map(it => {
    const ing = ingredientById(it.ingredientId);
    const runRow = rowsById[it.ingredientId] || {};
    const price = runRow.price !== undefined ? num(runRow.price) : (ing ? ing.price : 0);
    const qty = Math.max(0, num(it.quantity, 0));
    totalQty += qty;
    const cost = qty * price;
    totalCost += cost;
    NUTRIENTS.forEach(n => { nutrientTotals[n.key] += qty * (ing ? num(ing[n.key]) : 0); });
    return { ingredientId: it.ingredientId, name: ing ? ing.name : '(deleted ingredient)', quantity: qty, cost, price };
  }).sort((a, b) => b.quantity - a.quantity);

  outItems.forEach(it => { it.percentage = totalQty > 0 ? (it.quantity / totalQty) * 100 : 0; });

  const nutrition = {};
  NUTRIENTS.forEach(n => { nutrition[n.key] = totalQty > 0 ? nutrientTotals[n.key] / totalQty : 0; });

  const costPerKg = totalQty > 0 ? totalCost / totalQty : 0;

  const warnings = [];
  const nutrientChecks = [];
  if (feedType) {
    NUTRIENTS.forEach(n => {
      const req = feedType.requirements[n.key];
      if (!req) return;
      const val = nutrition[n.key];
      let pass = true, spec = '';
      if (req.min !== null && req.min !== undefined) { spec = '≥ ' + fmt(req.min, n.digits) + ' ' + n.unit; if (val < req.min - 1e-6) pass = false; }
      if (req.max !== null && req.max !== undefined) { spec = (spec ? spec + ', ' : '') + '≤ ' + fmt(req.max, n.digits) + ' ' + n.unit; if (val > req.max + 1e-6) pass = false; }
      if (!spec) return;
      nutrientChecks.push({ key: n.key, label: n.label, unit: n.unit, digits: n.digits, value: val, spec, pass, req });
      if (!pass) {
        warnings.push({
          type: 'nutrient',
          text: n.label + ' requirement not met — current ' + fmt(val, n.digits) + ' ' + n.unit + ', required ' + spec
        });
      }
    });
  }

  let priceStatus = null;
  if (draft.targetPriceMax !== '' && draft.targetPriceMax !== null && draft.targetPriceMax !== undefined) {
    const max = num(draft.targetPriceMax);
    const min = draft.targetPriceMin !== '' && draft.targetPriceMin !== null ? num(draft.targetPriceMin) : null;
    let pass = costPerKg <= max + 1e-6 && (min === null || costPerKg >= min - 1e-6);
    priceStatus = { min, max, pass };
    if (costPerKg > max + 1e-6) warnings.push({ type: 'price', text: 'Formula exceeds target price — current KSh ' + fmt(costPerKg) + '/kg, maximum KSh ' + fmt(max) + '/kg' });
  }

  outItems.forEach(it => {
    const runRow = rowsById[it.ingredientId];
    if (runRow && runRow.stock !== '' && runRow.stock !== null && runRow.stock !== undefined) {
      const stock = num(runRow.stock);
      if (it.quantity > stock + 1e-6) {
        warnings.push({ type: 'availability', text: it.name + ' exceeds available stock — required ' + fmt(it.quantity, 1) + ' kg, available ' + fmt(stock, 1) + ' kg' });
      }
    }
  });

  if (batch > 0 && Math.abs(totalQty - batch) > Math.max(0.5, batch * 0.005)) {
    warnings.push({ type: 'batch', text: 'Formula total is ' + fmt(totalQty, 1) + ' kg, which does not match the batch size of ' + fmt(batch, 1) + ' kg' });
  }

  return {
    status: 'computed',
    items: outItems,
    totalQty, totalCost, costPerKg,
    nutrition, nutrientChecks, priceStatus,
    warnings,
    computedAt: nowISO()
  };
}

/* Runs the LP optimizer against the current draft and feed type, returns a result object
   compatible with computeResult()'s shape, or an infeasible/error descriptor. */
function runOptimization(draft, feedType) {
  const activeRows = draft.rows.filter(r => r.selected && r.available);
  if (activeRows.length === 0) {
    return { status: 'infeasible', reason: 'no_ingredients', warnings: [] };
  }
  const batch = num(draft.batchSize, 0);
  if (batch <= 0) return { status: 'error', reason: 'bad_batch' };

  const n = activeRows.length;
  const ingredients = activeRows.map(r => ingredientById(r.ingredientId));
  const price = activeRows.map(r => num(r.price));

  const constraints = [];
  // Sum(x) = batch
  constraints.push({ coeffs: new Array(n).fill(1), rhs: batch, type: '=' });

  // Nutrient constraints
  if (feedType) {
    NUTRIENTS.forEach(nu => {
      const req = feedType.requirements[nu.key];
      if (!req) return;
      const coeffs = ingredients.map(ing => num(ing ? ing[nu.key] : 0));
      if (req.min !== null && req.min !== undefined) {
        constraints.push({ coeffs, rhs: req.min * batch, type: '>=' });
      }
      if (req.max !== null && req.max !== undefined) {
        constraints.push({ coeffs, rhs: req.max * batch, type: '<=' });
      }
    });
  }

  // Price ceiling as a hard constraint when objective is target_price and a max is set
  if (draft.objective === 'target_price' && draft.targetPriceMax !== '' && draft.targetPriceMax !== null && draft.targetPriceMax !== undefined) {
    const maxP = num(draft.targetPriceMax);
    constraints.push({ coeffs: price.slice(), rhs: maxP * batch, type: '<=' });
  }

  // Per-ingredient bounds: min%, max%, stock
  activeRows.forEach((r, i) => {
    const coeffs = new Array(n).fill(0); coeffs[i] = 1;
    const minPct = r.minPct !== '' && r.minPct !== null ? num(r.minPct) : 0;
    if (minPct > 0) constraints.push({ coeffs: coeffs.slice(), rhs: (minPct / 100) * batch, type: '>=' });

    let upper = null;
    if (r.maxPct !== '' && r.maxPct !== null && r.maxPct !== undefined) upper = (num(r.maxPct) / 100) * batch;
    if (r.stock !== '' && r.stock !== null && r.stock !== undefined) {
      const stockCap = num(r.stock);
      upper = upper === null ? stockCap : Math.min(upper, stockCap);
    }
    if (upper !== null) constraints.push({ coeffs: coeffs.slice(), rhs: upper, type: '<=' });
  });

  let lp;
  try {
    lp = solveLP(n, price.slice(), constraints);
  } catch (e) {
    return { status: 'error', reason: 'solver_error', message: String(e) };
  }

  if (lp.status !== 'optimal') {
    return { status: 'infeasible', reason: lp.status, warnings: [] };
  }

  const items = activeRows.map((r, i) => ({ ingredientId: r.ingredientId, quantity: lp.x[i] }));
  return computeResult(draft, items, feedType);
}

function infeasibilityReasons() {
  return [
    'A nutritional requirement (e.g. protein or energy) may be set too high for the selected ingredients.',
    'The selected ingredients may not provide enough of a required nutrient in combination.',
    'The price ceiling may be too low for what the requirements demand.',
    'Minimum/maximum inclusion limits or stock levels may be too restrictive.'
  ];
}

/* -------------------------------- Export -------------------------------- */
function scenarioToCSV(sc) {
  const lines = [];
  lines.push('Feed Ledger — Formulation Export');
  lines.push('Scenario,' + csvSafe(sc.name));
  const ft = feedTypeById(sc.feedTypeId);
  lines.push('Feed Type,' + csvSafe(ft ? ft.name : '—'));
  lines.push('Batch Size (kg),' + sc.batchSize);
  lines.push('Generated,' + fmtDate(sc.createdAt));
  lines.push('');
  lines.push('Ingredient,Quantity (kg),Percentage (%),Price (KSh/kg),Cost (KSh)');
  sc.result.items.forEach(it => {
    lines.push([csvSafe(it.name), fmt(it.quantity, 2), fmt(it.percentage, 2), fmt(it.price, 2), fmt(it.cost, 2)].join(','));
  });
  lines.push(['TOTAL', fmt(sc.result.totalQty, 2), '100.00', '', fmt(sc.result.totalCost, 2)].join(','));
  lines.push('');
  lines.push('Nutrient,Value,Requirement,Status');
  (sc.result.nutrientChecks || []).forEach(c => {
    lines.push([csvSafe(c.label), fmt(c.value, c.digits) + ' ' + c.unit, csvSafe(c.spec), c.pass ? 'OK' : 'NOT MET'].join(','));
  });
  lines.push('');
  lines.push('Cost per kg (KSh),' + fmt(sc.result.costPerKg, 2));
  lines.push('Total batch cost (KSh),' + fmt(sc.result.totalCost, 2));
  if (sc.result.priceStatus) {
    lines.push('Target price range (KSh/kg),' + (sc.result.priceStatus.min !== null ? fmt(sc.result.priceStatus.min, 2) : '—') + ' - ' + fmt(sc.result.priceStatus.max, 2));
    lines.push('Within target,' + (sc.result.priceStatus.pass ? 'Yes' : 'No'));
  }
  if (sc.result.warnings && sc.result.warnings.length) {
    lines.push('');
    lines.push('Warnings');
    sc.result.warnings.forEach(w => lines.push(csvSafe(w.text)));
  }
  return lines.join('\n');
}
function csvSafe(s) {
  s = String(s === undefined || s === null ? '' : s);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: mime || 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
function scenarioToPlainSummary(sc) {
  const ft = feedTypeById(sc.feedTypeId);
  const lines = [];
  lines.push('FEED FORMULATION — ' + sc.name);
  lines.push('Feed type: ' + (ft ? ft.name : '—') + '   Batch: ' + fmt(sc.batchSize, 0) + ' kg');
  lines.push('Generated: ' + fmtDate(sc.createdAt));
  lines.push('');
  lines.push('INGREDIENTS');
  sc.result.items.forEach(it => {
    lines.push('- ' + it.name + ': ' + fmt(it.quantity, 1) + ' kg (' + fmt(it.percentage, 1) + '%) — KSh ' + fmt(it.cost, 0));
  });
  lines.push('Total: ' + fmt(sc.result.totalQty, 1) + ' kg — KSh ' + fmt(sc.result.totalCost, 0));
  lines.push('');
  lines.push('NUTRITION');
  (sc.result.nutrientChecks || []).forEach(c => {
    lines.push('- ' + c.label + ': ' + fmt(c.value, c.digits) + ' ' + c.unit + ' (' + c.spec + ') ' + (c.pass ? 'OK' : 'NOT MET'));
  });
  lines.push('');
  lines.push('COST: KSh ' + fmt(sc.result.costPerKg, 2) + '/kg  |  Batch total: KSh ' + fmt(sc.result.totalCost, 0));
  if (sc.result.warnings && sc.result.warnings.length) {
    lines.push('');
    lines.push('WARNINGS');
    sc.result.warnings.forEach(w => lines.push('! ' + w.text));
  }
  return lines.join('\n');
}
function emailScenario(sc) {
  const subject = 'Feed formulation — ' + sc.name;
  const body = scenarioToPlainSummary(sc);
  const url = 'mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
  window.location.href = url;
}
function printScenario(sc) {
  const html = scenarioPrintHTML(sc);
  const w = window.open('', '_blank');
  if (!w) { showToast('Please allow pop-ups to print or save as PDF.'); return; }
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => { try { w.print(); } catch (e) {} }, 300);
}
function scenarioPrintHTML(sc) {
  const ft = feedTypeById(sc.feedTypeId);
  const rows = sc.result.items.map(it =>
    '<tr><td>' + esc(it.name) + '</td><td style="text-align:right">' + fmt(it.quantity, 1) + '</td><td style="text-align:right">' + fmt(it.percentage, 1) + '%</td><td style="text-align:right">' + fmt(it.cost, 0) + '</td></tr>'
  ).join('');
  const nutrRows = (sc.result.nutrientChecks || []).map(c =>
    '<tr><td>' + esc(c.label) + '</td><td style="text-align:right">' + fmt(c.value, c.digits) + ' ' + c.unit + '</td><td>' + esc(c.spec) + '</td><td>' + (c.pass ? 'OK' : 'NOT MET') + '</td></tr>'
  ).join('');
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + esc(sc.name) + '</title>' +
    '<style>body{font-family:Georgia,serif;padding:36px;color:#1F2B1E;}h1{font-size:20px;margin-bottom:2px;}p.meta{color:#555;font-size:12px;margin-top:0;}table{width:100%;border-collapse:collapse;margin-top:14px;}td,th{border-bottom:1px solid #ccc;padding:6px 8px;font-size:13px;text-align:left;}th{text-align:left;background:#f2f2f2;}h2{font-size:14px;margin-top:26px;border-bottom:2px solid #1F2B1E;padding-bottom:4px;}.totals{font-weight:bold;}</style>' +
    '</head><body>' +
    '<h1>' + esc(sc.name) + '</h1>' +
    '<p class="meta">' + esc(ft ? ft.name : '') + ' &middot; Batch ' + fmt(sc.batchSize, 0) + ' kg &middot; Generated ' + esc(fmtDate(sc.createdAt)) + '</p>' +
    '<h2>Formulation</h2>' +
    '<table><tr><th>Ingredient</th><th style="text-align:right">Qty (kg)</th><th style="text-align:right">%</th><th style="text-align:right">Cost (KSh)</th></tr>' + rows +
    '<tr class="totals"><td>Total</td><td style="text-align:right">' + fmt(sc.result.totalQty, 1) + '</td><td style="text-align:right">100%</td><td style="text-align:right">' + fmt(sc.result.totalCost, 0) + '</td></tr></table>' +
    '<h2>Nutritional Analysis</h2>' +
    '<table><tr><th>Nutrient</th><th style="text-align:right">Value</th><th>Requirement</th><th>Status</th></tr>' + nutrRows + '</table>' +
    '<h2>Cost</h2>' +
    '<p>Cost per kg: <b>KSh ' + fmt(sc.result.costPerKg, 2) + '</b> &nbsp; Batch total: <b>KSh ' + fmt(sc.result.totalCost, 0) + '</b></p>' +
    '</body></html>';
}

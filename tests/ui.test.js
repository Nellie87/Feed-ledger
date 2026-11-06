// End-to-end UI smoke test in jsdom. Run: node tests/ui.test.js (needs `npm install`)
const { JSDOM } = require('jsdom');
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'dist', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/' });
const w = dom.window, doc = w.document;
const S = e => w.eval(e);
const wait = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failed++; };
const click = async sel => { doc.querySelector(sel).click(); await wait(30); };
const nav = t => click('[data-action="nav"][data-tab="' + t + '"]');

(async () => {
  await wait(100);
  ok(S('state.ingredients.length') === 9, 'seed data loaded');
  await nav('formulate');
  await click('[data-action="draft-generate"]');
  ok(S('state.draft.result.status') === 'computed', 'generate formula');
  await click('[data-action="draft-save-scenario"]');
  await click('[data-action="modal-save-scenario"]');
  ok(S('state.scenarios.length') === 1, 'save scenario via modal');

  await nav('ingredients'); await click('[data-action="ing-new"]');
  doc.getElementById('ing-f-name').value = 'Cottonseed Cake';
  doc.getElementById('ing-f-price').value = '42';
  await click('[data-action="ing-save"]');
  ok(S('state.ingredients.length') === 10, 'add ingredient');

  await nav('formulate');
  doc.querySelectorAll('[data-row-ingredient]').forEach(r => {
    const ing = S('state.ingredients.find(i=>i.id==="' + r.getAttribute('data-row-ingredient') + '")');
    if (ing.name === 'Maize') r.querySelector('[data-field="price"]').value = '65';
  });
  await click('[data-action="draft-generate"]');
  ok(doc.body.innerHTML.includes('No feasible formulation found'), 'infeasible banner shown under price ceiling');
  const sel = doc.getElementById('draft-objective'); sel.value = 'least_cost';
  await click('[data-action="draft-generate"]');
  await click('[data-action="draft-save-scenario"]');
  doc.getElementById('modal-scenario-name').value = 'High Maize Price';
  await click('[data-action="modal-save-scenario"]');
  ok(S('state.scenarios.length') === 2, 'second scenario saved');

  for (const id of S('state.scenarios.map(s=>s.id)')) await click('[data-action="scenario-compare-toggle"][data-id="' + id + '"]');
  await nav('compare');
  ok(doc.body.innerHTML.includes('Nutritional composition') && doc.body.innerHTML.includes('High Maize Price'), 'compare screen renders');

  await nav('formulate'); await click('[data-action="draft-generate"]');
  const cb = doc.getElementById('draft-manual'); cb.checked = true;
  cb.dispatchEvent(new w.Event('change', { bubbles: true })); await wait(30);
  const p = doc.querySelector('[data-edit-pct]'); p.value = (parseFloat(p.value) - 10).toFixed(2);
  await click('[data-action="draft-recalc"]');
  ok(S('state.draft.result.warnings.length') > 0, 'manual adjustment raises warnings');
  ok(S('scenarioToCSV(state.scenarios[0])').includes('Ingredient,Quantity'), 'CSV export builds');

  console.log(failed ? failed + ' test(s) failed' : 'All UI tests passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('TEST ERROR', e); process.exit(1); });

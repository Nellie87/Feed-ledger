// Optimizer / calculation tests (no DOM). Run: node tests/logic.test.js
global.localStorage = { getItem: () => null, setItem: () => {} };
global.window = {};
const fs = require('fs'), path = require('path');
const src = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const test = `
let failed = 0;
function ok(c, m) { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failed++; }
state.ingredients = defaultIngredients();
state.feedTypes = defaultFeedTypes();
const chick = state.feedTypes[0];
const draft = makeDraft(chick, state.ingredients);
const clone = o => JSON.parse(JSON.stringify(o));
const row = (d, n) => d.rows.find(x => ingredientById(x.ingredientId).name === n);

const lp = solveLP(2,[50,100],[{coeffs:[1,1],type:'=',rhs:100},{coeffs:[8.5,44],type:'>=',rhs:2000}]);
ok(lp.status==='optimal' && Math.abs(lp.x[1]-32.394)<0.01, 'solver matches hand-calculated blend');
ok(solveLP(2,[50,100],[{coeffs:[1,1],type:'=',rhs:100},{coeffs:[8.5,44],type:'>=',rhs:9000}]).status==='infeasible', 'solver detects infeasible');

let r = runOptimization(draft, chick);
ok(r.status==='computed' && r.costPerKg>=50 && r.costPerKg<=60, 'default Chick Mash within KSh 50-60/kg (' + r.costPerKg.toFixed(2) + ')');
ok(r.warnings.length===0, 'default result has no warnings');
ok(Math.abs(r.totalQty-500)<0.01, 'total quantity equals batch size');

const d2 = clone(draft); row(d2,'Fish Meal').available = false;
r = runOptimization(d2, chick);
ok(r.status==='computed' && !r.items.some(i=>i.name==='Fish Meal' && i.quantity>0), 'unavailable ingredient excluded');

const d3 = clone(draft); row(d3,'Maize').price = 65;
ok(runOptimization(d3, chick).status==='infeasible', 'maize hike breaks hard price ceiling -> infeasible');
d3.objective = 'least_cost';
ok(runOptimization(d3, chick).status==='computed', 'same hike solvable under least-cost objective');

const d4 = clone(draft); row(d4,'Soybean Meal').stock = 30;
r = runOptimization(d4, chick);
ok(r.status!=='computed' || r.items.find(i=>i.name==='Soybean Meal').quantity<=30.0001, 'stock cap respected');

state.feedTypes.forEach(ft => { const d=makeDraft(ft,state.ingredients); d.objective='least_cost';
  ok(runOptimization(d, ft).status==='computed', ft.name+' solvable'); });

const items = runOptimization(draft, chick).items.map(i=>({ingredientId:i.ingredientId, quantity:i.quantity}));
items[0].quantity *= 0.9;
ok(computeResult(draft, items, chick).warnings.length>0, 'manual edit raises warnings');
if (failed) { console.log(failed+' test(s) failed'); process.exit(1); } else console.log('All logic tests passed');
`;
eval(src('core.js') + '\n' + src('engine.js') + '\n' + test);

# Feed Ledger — Project Handover

**Feed Formulation & Optimization Platform** · Handover document for the receiving developer

> ## ⚠️ REQUIRED: the full SQL setup must be run before anything else
>
> The working prototype delivered with this project (`feed-formulation-platform.html`) stores data in the
> browser (`localStorage`) so the concept could be demonstrated without a backend. **It has no database.**
> To take this project into production, the **complete SQL setup in [§8](#8-full-sql-setup-schemasql)** must be applied to a
> Supabase / PostgreSQL project. It creates the tables, constraints, indexes, views, row-level security,
> the atomic `save_scenario()` function, the system nutrient list and an optional demo-data seeder.
> Nothing else in this document works without it.

The same SQL is shipped as a standalone file: `schema.sql`.

---

## 1. Project in one paragraph

A feed formula should adapt to changing real-world conditions rather than be treated as a fixed recipe.
The app lets a feed maker enter ingredient prices, stock and nutrient values, define feed specifications
(e.g. Chick Mash: protein ≥ 20 %, energy ≥ 2,900 kcal/kg), set a batch size and price target, and then
solves a **linear program** (minimise cost subject to nutritional, availability and price constraints).
Conditions can be changed and re-solved, each result is saved as a **scenario**, and scenarios can be compared.
Full product requirements are in the original MVP README.

## 2. What exists today vs. what you must build

| Area | Status in prototype | What the handover needs |
|---|---|---|
| UI (Dashboard, Ingredients, Feed Types, Formulate, Scenarios, Compare) | ✅ Working, single HTML file | Port to Next.js + React + TypeScript (README §22) |
| Optimizer | ✅ Working, in-browser Big-M simplex (unit-tested) | Move to a Python service (`scipy.optimize.linprog` / HiGHS) behind `POST /optimize` |
| Manual adjust, warnings, infeasible handling | ✅ Working | Re-implement server-side validation (`POST /validate`, `POST /calculate`) |
| Export CSV / Print-PDF / Email (`mailto:`) | ✅ Working client-side | Optional: server-generated PDF + real email (Resend/SES) |
| **Database** | ❌ **None** (`localStorage` only) | **Run the SQL in §8** |
| **Authentication** | ❌ None | Supabase Auth (the SQL already wires `profiles` + RLS to `auth.users`) |
| Multi-user / roles | ❌ | Future (README §25); schema is per-user today |

## 3. Setup steps

1. **Create a Supabase project** (PostgreSQL 15+).
2. **Run `schema.sql`** in the SQL editor (or save it as your first migration, e.g. `supabase/migrations/0001_init.sql`). It is safe to re-run.
3. **Enable email auth** in Supabase Auth settings. The trigger `on_auth_user_created` creates a `profiles` row automatically on sign-up.
4. **(Optional) Load demo data** while signed in: `select public.seed_demo_data();` (or `supabase.rpc('seed_demo_data')`). It inserts the 9 example ingredients and 4 feed types from the prototype, and does nothing if the user already has ingredients.
5. **Configure the app** with `SUPABASE_URL` and `SUPABASE_ANON_KEY`. Keep the `service_role` key server-side only (the optimizer service).
6. **Build the optimizer service** (§6) and point the frontend at it.
7. Run the **verification checklist** (§9).

## 4. Data model

```
auth.users
 └─ profiles                      1:1, currency/unit preferences
 ├─ nutrients                     system rows (user_id NULL) + user-defined nutrients
 ├─ ingredients
 │    ├─ ingredient_nutrients     (ingredient × nutrient → value)   ← extensible, not fixed columns
 │    ├─ ingredient_prices        price HISTORY (latest = current; view v_current_prices)
 │    └─ inventory                current stock (NULL = unlimited)
 ├─ feed_types
 │    └─ feed_requirements        (feed type × nutrient → min / max / target)
 ├─ formulations                  working / manually-adjusted formula
 │    └─ formulation_items
 └─ scenarios                     immutable snapshot of conditions + result
      ├─ scenario_ingredients     price, stock, availability, limits, nutrient values AS THEY WERE
      ├─ scenario_results         status, cost/kg, nutrition, warnings, solver metadata
      └─ scenario_result_items    the resulting quantities
```

Design decisions worth knowing:

- **Nutrients are rows, not columns.** The original README (§20) used fixed columns (`protein`, `energy`, …) while also requiring that more nutrients be addable later. Fixed columns would force a migration per nutrient, so `ingredient_nutrients` / `feed_requirements` reference a `nutrients` table instead. Lysine, methionine and sodium are pre-seeded as examples.
- **Scenarios are snapshots.** `scenario_ingredients` freezes prices, stock, limits and nutrient values, and `scenarios.requirements_snapshot` freezes the specification. Editing the ingredient library or a feed type later never rewrites history, so scenario comparison stays truthful.
- **`scenario_ingredients` consolidates the README's `scenario_prices` + `scenario_inventory`** into one row per ingredient per scenario (they were always read together).
- **Names are copied into snapshot rows** (`ingredient_name`), and foreign keys use `ON DELETE SET NULL`, so deleting an ingredient never destroys saved scenarios.
- **Price history is append-only** (`ingredient_prices`, unique per ingredient per day); `v_current_prices` resolves the latest.
- **Row-level security is enabled on every table.** Each user sees only their own rows; system nutrients are readable by everyone; `anon` has no access.
- **`save_scenario(jsonb)`** writes the scenario, its conditions, result and result lines in a single transaction (§6.2).
- Views use `security_invoker = true` so RLS applies to the caller, not the view owner.

## 5. Prototype → database mapping

| Prototype field (localStorage) | Table.column |
|---|---|
| `ingredient.name / category` | `ingredients.name / category` |
| `ingredient.price` | `ingredient_prices.price_per_kg` (new row per change) |
| `ingredient.stock` | `inventory.quantity_available_kg` |
| `ingredient.minPct / maxPct` | `ingredients.min_inclusion_pct / max_inclusion_pct` |
| `ingredient.available` | `ingredients.is_available` |
| `ingredient.protein / energy / fibre / fat / calcium / phosphorus` | `ingredient_nutrients` rows (nutrient `key` = same names) |
| `feedType.requirements.<nutrient>.min / max` | `feed_requirements.min_value / max_value` |
| `scenario.rows[]` (price, stock, selected, available, minPct, maxPct) | `scenario_ingredients` |
| `scenario.result.items[]` | `scenario_result_items` |
| `scenario.result.costPerKg / totalCost / nutrition / nutrientChecks / priceStatus / warnings` | `scenario_results` |
| `draft.objective` (`least_cost` \| `target_price`) | `scenarios.objective` / `formulations.objective` |

## 6. API contracts

### 6.1 Optimizer service (Python) — `POST /optimize`

Keep the engine independent of the UI (README §17, §23). The service receives plain data and never touches the database.

```json
{
  "batch_size_kg": 500,
  "objective": "target_price",
  "target_price": { "min": 50, "max": 60 },
  "nutritional_constraints": {
    "protein": { "min": 20 },
    "energy":  { "min": 2900 },
    "fibre":   { "max": 6 }
  },
  "ingredients": [
    { "id": "uuid", "name": "Maize", "price_per_kg": 50, "stock_kg": 1000,
      "min_pct": 0, "max_pct": 65, "is_available": true,
      "nutrients": { "protein": 8.5, "energy": 3300, "fibre": 2.5 } }
  ]
}
```

Response:

```json
{
  "status": "feasible",
  "cost_per_kg": 58.65,
  "total_cost": 29327,
  "total_weight_kg": 500,
  "items": [ { "ingredient_id": "uuid", "name": "Maize", "quantity_kg": 310.6, "percentage": 62.1, "unit_price": 50, "cost": 15530 } ],
  "nutrition": { "protein": 20.0, "energy": 2900 },
  "nutrient_checks": [ { "key": "protein", "label": "Crude Protein", "value": 20.0, "spec": ">= 20", "pass": true } ],
  "price_status": { "min": 50, "max": 60, "pass": true },
  "warnings": [],
  "solver_meta": { "solver": "highs", "version": "x.y.z" }
}
```

`status` is `feasible`, `infeasible` or `error`. **Never fabricate a formula when infeasible** (README §16).

**LP formulation** (this is what the prototype solves; reproduce it exactly):

- Variables `x_i` = kg of ingredient *i*, only for selected **and** available ingredients.
- Minimise `Σ price_i · x_i`.
- `Σ x_i = batch_size`.
- For each nutrient with a minimum: `Σ nutrient_i · x_i ≥ min · batch_size`; with a maximum: `≤ max · batch_size`.
- Per ingredient: `x_i ≥ min_pct/100 · batch_size`, and `x_i ≤ min(max_pct/100 · batch_size, stock_kg)`.
- If `objective = target_price` and a maximum price is given: `Σ price_i · x_i ≤ max_price · batch_size` (hard ceiling). `least_cost` ignores the ceiling. These are the same objective with and without a price constraint, not two different objectives.

### 6.2 Saving a scenario — `rpc('save_scenario', { p })`

```json
{
  "name": "High Maize Price",
  "description": "Maize 50 -> 65",
  "feed_type_id": "uuid",
  "parent_scenario_id": null,
  "batch_size_kg": 500,
  "objective": "target_price",
  "target_price_min": 50,
  "target_price_max": 60,
  "requirements": [ { "key": "protein", "name": "Crude Protein", "unit": "%", "min": 20, "max": null } ],
  "ingredients": [
    { "ingredient_id": "uuid", "name": "Maize", "selected": true, "is_available": true,
      "price_per_kg": 65, "stock_kg": 1000, "min_pct": 0, "max_pct": 65,
      "nutrients": { "protein": 8.5, "energy": 3300 } }
  ],
  "result": { "...": "the /optimize response, with ingredient lines under result.items" }
}
```

Returns the new scenario `id`. An `infeasible` result with no `items` is valid and is stored.

## 7. Known gaps and recommended follow-ups

1. **Port the optimizer to Python (HiGHS).** The prototype's simplex is correct for this problem size but is a teaching-grade implementation; use a maintained solver in production.
2. **Infeasibility diagnostics / sensitivity analysis.** Today the user is only told *that* it is infeasible. LP duality gives shadow prices cheaply ("raising the fibre limit 1 % saves KSh X/kg"). Highest-value next feature.
3. **Manual adjustment semantics.** The prototype lets percentages drift from 100 % and warns; decide whether to auto-rebalance.
4. **Units and currency.** Only `kg` and `KES` are enforced today (`profiles.weight_unit` is constrained to `kg`). Real unit conversion needs design.
5. **Multi-user businesses.** Ownership is per user. Roles (Owner, Formulator, Storekeeper…) will need an `organizations` + `memberships` layer and RLS rewritten around org membership.
6. **Default privileges.** The SQL revokes `anon` access on existing tables. If you add tables later, repeat the `revoke`/RLS pattern or set default privileges in your migration tooling.
7. **Seed values are illustrative.** Prices and nutrient values in `seed_demo_data()` are example numbers, not lab or supplier data; replace before relying on results.

## 8. Full SQL setup (`schema.sql`)

Tested on PostgreSQL 16 using a Supabase-style harness (stubbed `auth` schema, `auth.uid()`, `anon`/`authenticated` roles). It was run twice to confirm it is re-runnable. It has **not** been run against a live Supabase project, so apply it to a development project first.

```sql
-- =============================================================================
-- FEED LEDGER — Formulation & Optimization Platform
-- Full database setup for Supabase / PostgreSQL 15+
-- Run top-to-bottom in the Supabase SQL editor (or as one migration).
-- Idempotent where practical (IF NOT EXISTS / CREATE OR REPLACE).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Shared helpers
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 1. Profiles (one row per auth user)
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text,
  business_name text,
  currency_code text not null default 'KES',
  weight_unit   text not null default 'kg' check (weight_unit in ('kg')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- 2. Nutrients (extensible: system rows have user_id NULL; users may add more)
-- -----------------------------------------------------------------------------
create table if not exists public.nutrients (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references auth.users(id) on delete cascade,  -- NULL = system nutrient
  key            text not null check (key ~ '^[a-z][a-z0-9_]*$'),
  name           text not null,
  unit           text not null,                 -- '%', 'kcal/kg', 'mg/kg', ...
  display_digits smallint not null default 1 check (display_digits between 0 and 6),
  sort_order     int not null default 100,
  created_at     timestamptz not null default now()
);
create unique index if not exists nutrients_key_system_uq on public.nutrients (key) where user_id is null;
create unique index if not exists nutrients_key_user_uq   on public.nutrients (user_id, key) where user_id is not null;

-- -----------------------------------------------------------------------------
-- 3. Ingredient library
-- -----------------------------------------------------------------------------
create table if not exists public.ingredients (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name              text not null,
  category          text,
  unit              text not null default 'kg',
  min_inclusion_pct numeric(6,3) not null default 0   check (min_inclusion_pct between 0 and 100),
  max_inclusion_pct numeric(6,3) not null default 100 check (max_inclusion_pct between 0 and 100),
  max_quantity_kg   numeric(14,3) check (max_quantity_kg is null or max_quantity_kg >= 0),
  is_available      boolean not null default true,
  notes             text,
  archived_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint ingredients_inclusion_order check (min_inclusion_pct <= max_inclusion_pct),
  constraint ingredients_user_name_uq unique (user_id, name)
);
create index if not exists ingredients_user_idx on public.ingredients (user_id) where archived_at is null;

create table if not exists public.ingredient_nutrients (
  ingredient_id uuid not null references public.ingredients(id) on delete cascade,
  nutrient_id   uuid not null references public.nutrients(id)   on delete restrict,
  value         numeric(14,4) not null check (value >= 0),        -- per kg, as-fed basis
  updated_at    timestamptz not null default now(),
  primary key (ingredient_id, nutrient_id)
);
create index if not exists ingredient_nutrients_nutrient_idx on public.ingredient_nutrients (nutrient_id);

-- Price history: append a new row whenever a price changes.
create table if not exists public.ingredient_prices (
  id             uuid primary key default gen_random_uuid(),
  ingredient_id  uuid not null references public.ingredients(id) on delete cascade,
  price_per_kg   numeric(14,4) not null check (price_per_kg >= 0),
  effective_date date not null default current_date,
  created_at     timestamptz not null default now(),
  constraint ingredient_prices_uq unique (ingredient_id, effective_date)
);
create index if not exists ingredient_prices_latest_idx on public.ingredient_prices (ingredient_id, effective_date desc);

-- Current stock: one row per ingredient. NULL quantity = unlimited / not tracked.
create table if not exists public.inventory (
  ingredient_id         uuid primary key references public.ingredients(id) on delete cascade,
  quantity_available_kg numeric(14,3) check (quantity_available_kg is null or quantity_available_kg >= 0),
  updated_at            timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 4. Feed types and reusable nutritional specifications
-- -----------------------------------------------------------------------------
create table if not exists public.feed_types (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  animal      text,
  description text,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint feed_types_user_name_uq unique (user_id, name)
);

create table if not exists public.feed_requirements (
  id           uuid primary key default gen_random_uuid(),
  feed_type_id uuid not null references public.feed_types(id) on delete cascade,
  nutrient_id  uuid not null references public.nutrients(id)  on delete restrict,
  min_value    numeric(14,4),
  max_value    numeric(14,4),
  target_value numeric(14,4),
  constraint feed_requirements_uq unique (feed_type_id, nutrient_id),
  constraint feed_requirements_has_bound check (min_value is not null or max_value is not null or target_value is not null),
  constraint feed_requirements_order check (min_value is null or max_value is null or min_value <= max_value)
);

-- -----------------------------------------------------------------------------
-- 5. Formulations (the working / manually adjusted formula)
-- -----------------------------------------------------------------------------
create table if not exists public.formulations (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  feed_type_id     uuid references public.feed_types(id) on delete set null,
  name             text,
  batch_size_kg    numeric(14,3) not null check (batch_size_kg > 0),
  objective        text not null default 'target_price' check (objective in ('least_cost','target_price')),
  target_price_min numeric(14,4) check (target_price_min is null or target_price_min >= 0),
  target_price_max numeric(14,4) check (target_price_max is null or target_price_max >= 0),
  status           text not null default 'draft' check (status in ('draft','optimized','adjusted','infeasible','archived')),
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists formulations_user_idx on public.formulations (user_id, created_at desc);

create table if not exists public.formulation_items (
  id                 uuid primary key default gen_random_uuid(),
  formulation_id     uuid not null references public.formulations(id) on delete cascade,
  ingredient_id      uuid references public.ingredients(id) on delete set null,
  ingredient_name    text not null,                       -- snapshot, survives ingredient deletion
  quantity_kg        numeric(14,3) not null check (quantity_kg >= 0),
  percentage         numeric(8,4)  not null check (percentage >= 0),
  unit_price         numeric(14,4) not null check (unit_price >= 0),
  cost               numeric(16,4) not null check (cost >= 0),
  is_manual_override boolean not null default false
);
create index if not exists formulation_items_formulation_idx on public.formulation_items (formulation_id);

-- -----------------------------------------------------------------------------
-- 6. Scenarios: immutable snapshots of real-world conditions + their result
--    (consolidates the README's scenario_prices + scenario_inventory into
--     scenario_ingredients: one row per ingredient per scenario)
-- -----------------------------------------------------------------------------
create table if not exists public.scenarios (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null default auth.uid() references auth.users(id) on delete cascade,
  formulation_id        uuid references public.formulations(id) on delete set null,
  parent_scenario_id    uuid references public.scenarios(id)    on delete set null,  -- "duplicate" lineage
  feed_type_id          uuid references public.feed_types(id)   on delete set null,
  name                  text not null,
  description           text,
  batch_size_kg         numeric(14,3) not null check (batch_size_kg > 0),
  objective             text not null default 'target_price' check (objective in ('least_cost','target_price')),
  target_price_min      numeric(14,4),
  target_price_max      numeric(14,4),
  requirements_snapshot jsonb not null default '[]'::jsonb,  -- [{key,name,unit,min,max,target}] frozen at save time
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists scenarios_user_idx on public.scenarios (user_id, created_at desc);

create table if not exists public.scenario_ingredients (
  id              uuid primary key default gen_random_uuid(),
  scenario_id     uuid not null references public.scenarios(id) on delete cascade,
  ingredient_id   uuid references public.ingredients(id) on delete set null,
  ingredient_name text not null,
  selected        boolean not null default true,
  is_available    boolean not null default true,
  price_per_kg    numeric(14,4) not null check (price_per_kg >= 0),
  stock_kg        numeric(14,3) check (stock_kg is null or stock_kg >= 0),   -- NULL = unlimited
  min_pct         numeric(6,3) not null default 0   check (min_pct between 0 and 100),
  max_pct         numeric(6,3) not null default 100 check (max_pct between 0 and 100),
  nutrients       jsonb not null default '{}'::jsonb,                        -- {"protein":44,"energy":2500,...} frozen
  constraint scenario_ingredients_uq unique (scenario_id, ingredient_name)
);
create index if not exists scenario_ingredients_scenario_idx on public.scenario_ingredients (scenario_id);

create table if not exists public.scenario_results (
  scenario_id     uuid primary key references public.scenarios(id) on delete cascade,
  status          text not null check (status in ('feasible','infeasible','error')),
  source          text not null default 'optimizer' check (source in ('optimizer','manual')),
  cost_per_kg     numeric(14,4),
  total_cost      numeric(16,4),
  total_weight_kg numeric(14,3),
  nutrition       jsonb not null default '{}'::jsonb,   -- {"protein":20.0,...}
  nutrient_checks jsonb not null default '[]'::jsonb,   -- [{key,label,value,spec,pass}]
  price_status    jsonb,                                -- {min,max,pass}
  warnings        jsonb not null default '[]'::jsonb,   -- [{type,text}]
  solver_meta     jsonb not null default '{}'::jsonb,   -- solver name/version, iterations, runtime
  computed_at     timestamptz not null default now()
);

create table if not exists public.scenario_result_items (
  id              uuid primary key default gen_random_uuid(),
  scenario_id     uuid not null references public.scenarios(id) on delete cascade,
  ingredient_id   uuid references public.ingredients(id) on delete set null,
  ingredient_name text not null,
  quantity_kg     numeric(14,3) not null check (quantity_kg >= 0),
  percentage      numeric(8,4)  not null check (percentage >= 0),
  unit_price      numeric(14,4) not null check (unit_price >= 0),
  cost            numeric(16,4) not null check (cost >= 0),
  constraint scenario_result_items_uq unique (scenario_id, ingredient_name)
);
create index if not exists scenario_result_items_scenario_idx on public.scenario_result_items (scenario_id);

-- -----------------------------------------------------------------------------
-- 7. updated_at triggers
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['profiles','ingredients','ingredient_nutrients','inventory','feed_types','formulations','scenarios']
  loop
    execute format('drop trigger if exists trg_%1$s_updated_at on public.%1$s', t);
    execute format('create trigger trg_%1$s_updated_at before update on public.%1$s
                    for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 8. Views
-- -----------------------------------------------------------------------------
create or replace view public.v_current_prices
with (security_invoker = true) as
select distinct on (p.ingredient_id)
       p.ingredient_id, p.price_per_kg, p.effective_date
from public.ingredient_prices p
order by p.ingredient_id, p.effective_date desc, p.created_at desc;

-- One-row-per-ingredient library view for the UI and for building /optimize payloads.
create or replace view public.v_ingredient_library
with (security_invoker = true) as
select i.id, i.user_id, i.name, i.category, i.unit,
       i.min_inclusion_pct, i.max_inclusion_pct, i.max_quantity_kg, i.is_available,
       cp.price_per_kg,
       inv.quantity_available_kg,
       coalesce(
         (select jsonb_object_agg(n.key, ingn.value)
            from public.ingredient_nutrients ingn
            join public.nutrients n on n.id = ingn.nutrient_id
           where ingn.ingredient_id = i.id), '{}'::jsonb) as nutrients
from public.ingredients i
left join public.v_current_prices cp on cp.ingredient_id = i.id
left join public.inventory inv       on inv.ingredient_id = i.id
where i.archived_at is null;

-- Flat summary used by the Scenarios list and Compare screen.
create or replace view public.v_scenario_summary
with (security_invoker = true) as
select s.id, s.user_id, s.name, s.description, s.feed_type_id, ft.name as feed_type_name,
       s.batch_size_kg, s.objective, s.target_price_min, s.target_price_max,
       r.status, r.cost_per_kg, r.total_cost, r.nutrition, r.warnings,
       jsonb_array_length(r.warnings) as warning_count,
       s.parent_scenario_id, s.created_at
from public.scenarios s
left join public.scenario_results r on r.scenario_id = s.id
left join public.feed_types ft      on ft.id = s.feed_type_id;

-- -----------------------------------------------------------------------------
-- 9. Atomic scenario save (scenario + conditions + result + result lines)
--    Payload shape is documented in HANDOVER.md §6.
-- -----------------------------------------------------------------------------
create or replace function public.save_scenario(p jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_res jsonb := p -> 'result';
begin
  insert into scenarios (user_id, formulation_id, parent_scenario_id, feed_type_id, name, description,
                         batch_size_kg, objective, target_price_min, target_price_max, requirements_snapshot)
  values (auth.uid(),
          nullif(p ->> 'formulation_id', '')::uuid,
          nullif(p ->> 'parent_scenario_id', '')::uuid,
          nullif(p ->> 'feed_type_id', '')::uuid,
          p ->> 'name',
          p ->> 'description',
          (p ->> 'batch_size_kg')::numeric,
          coalesce(p ->> 'objective', 'target_price'),
          nullif(p ->> 'target_price_min', '')::numeric,
          nullif(p ->> 'target_price_max', '')::numeric,
          coalesce(p -> 'requirements', '[]'::jsonb))
  returning id into v_id;

  insert into scenario_ingredients (scenario_id, ingredient_id, ingredient_name, selected, is_available,
                                    price_per_kg, stock_kg, min_pct, max_pct, nutrients)
  select v_id,
         nullif(i ->> 'ingredient_id', '')::uuid,
         i ->> 'name',
         coalesce((i ->> 'selected')::boolean, true),
         coalesce((i ->> 'is_available')::boolean, true),
         (i ->> 'price_per_kg')::numeric,
         nullif(i ->> 'stock_kg', '')::numeric,
         coalesce((i ->> 'min_pct')::numeric, 0),
         coalesce((i ->> 'max_pct')::numeric, 100),
         coalesce(i -> 'nutrients', '{}'::jsonb)
  from jsonb_array_elements(coalesce(p -> 'ingredients', '[]'::jsonb)) i;

  if v_res is not null and jsonb_typeof(v_res) = 'object' then
    insert into scenario_results (scenario_id, status, source, cost_per_kg, total_cost, total_weight_kg,
                                  nutrition, nutrient_checks, price_status, warnings, solver_meta)
    values (v_id,
            coalesce(v_res ->> 'status', 'feasible'),
            coalesce(v_res ->> 'source', 'optimizer'),
            nullif(v_res ->> 'cost_per_kg', '')::numeric,
            nullif(v_res ->> 'total_cost', '')::numeric,
            nullif(v_res ->> 'total_weight_kg', '')::numeric,
            coalesce(v_res -> 'nutrition', '{}'::jsonb),
            coalesce(v_res -> 'nutrient_checks', '[]'::jsonb),
            v_res -> 'price_status',
            coalesce(v_res -> 'warnings', '[]'::jsonb),
            coalesce(v_res -> 'solver_meta', '{}'::jsonb));

    insert into scenario_result_items (scenario_id, ingredient_id, ingredient_name, quantity_kg, percentage, unit_price, cost)
    select v_id,
           nullif(it ->> 'ingredient_id', '')::uuid,
           it ->> 'name',
           (it ->> 'quantity_kg')::numeric,
           (it ->> 'percentage')::numeric,
           (it ->> 'unit_price')::numeric,
           (it ->> 'cost')::numeric
    from jsonb_array_elements(coalesce(v_res -> 'items', '[]'::jsonb)) it;
  end if;

  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 10. Row Level Security — every user sees only their own data
-- -----------------------------------------------------------------------------
alter table public.profiles              enable row level security;
alter table public.nutrients             enable row level security;
alter table public.ingredients           enable row level security;
alter table public.ingredient_nutrients  enable row level security;
alter table public.ingredient_prices     enable row level security;
alter table public.inventory             enable row level security;
alter table public.feed_types            enable row level security;
alter table public.feed_requirements     enable row level security;
alter table public.formulations          enable row level security;
alter table public.formulation_items     enable row level security;
alter table public.scenarios             enable row level security;
alter table public.scenario_ingredients  enable row level security;
alter table public.scenario_results      enable row level security;
alter table public.scenario_result_items enable row level security;

-- profiles
drop policy if exists profiles_own on public.profiles;
create policy profiles_own on public.profiles for all
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- nutrients: read system + own; write own only
drop policy if exists nutrients_read   on public.nutrients;
drop policy if exists nutrients_insert on public.nutrients;
drop policy if exists nutrients_update on public.nutrients;
drop policy if exists nutrients_delete on public.nutrients;
create policy nutrients_read   on public.nutrients for select using (user_id is null or user_id = (select auth.uid()));
create policy nutrients_insert on public.nutrients for insert with check (user_id = (select auth.uid()));
create policy nutrients_update on public.nutrients for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy nutrients_delete on public.nutrients for delete using (user_id = (select auth.uid()));

-- tables that carry user_id directly
do $$
declare t text;
begin
  foreach t in array array['ingredients','feed_types','formulations','scenarios']
  loop
    execute format('drop policy if exists %1$s_own on public.%1$s', t);
    execute format('create policy %1$s_own on public.%1$s for all
                    using (user_id = (select auth.uid()))
                    with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;

-- child tables: ownership resolved through the parent
do $$
declare
  r record;
begin
  for r in select * from (values
    ('ingredient_nutrients','ingredient_id','ingredients'),
    ('ingredient_prices',   'ingredient_id','ingredients'),
    ('inventory',           'ingredient_id','ingredients'),
    ('feed_requirements',   'feed_type_id', 'feed_types'),
    ('formulation_items',   'formulation_id','formulations'),
    ('scenario_ingredients','scenario_id',  'scenarios'),
    ('scenario_results',    'scenario_id',  'scenarios'),
    ('scenario_result_items','scenario_id', 'scenarios')
  ) as v(child, fk, parent)
  loop
    execute format('drop policy if exists %1$s_own on public.%1$s', r.child);
    execute format('create policy %1$s_own on public.%1$s for all
                    using (exists (select 1 from public.%3$s p where p.id = %1$s.%2$s and p.user_id = (select auth.uid())))
                    with check (exists (select 1 from public.%3$s p where p.id = %1$s.%2$s and p.user_id = (select auth.uid())))',
                   r.child, r.fk, r.parent);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 11. Grants (Supabase roles). Anonymous users get nothing.
-- -----------------------------------------------------------------------------
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on function public.save_scenario(jsonb) to authenticated;
revoke all on all tables in schema public from anon;

-- -----------------------------------------------------------------------------
-- 12. System nutrients (global seed)
-- -----------------------------------------------------------------------------
insert into public.nutrients (user_id, key, name, unit, display_digits, sort_order) values
  (null, 'protein',    'Crude Protein', '%',       1, 10),
  (null, 'energy',     'Energy (ME)',   'kcal/kg', 0, 20),
  (null, 'fibre',      'Crude Fibre',   '%',       1, 30),
  (null, 'fat',        'Fat',           '%',       1, 40),
  (null, 'calcium',    'Calcium',       '%',       2, 50),
  (null, 'phosphorus', 'Phosphorus',    '%',       2, 60),
  (null, 'lysine',     'Lysine',        '%',       2, 70),
  (null, 'methionine', 'Methionine',    '%',       2, 80),
  (null, 'sodium',     'Sodium',        '%',       2, 90)
on conflict (key) where user_id is null do nothing;

-- -----------------------------------------------------------------------------
-- 13. Optional demo data for the signed-in user (matches the prototype defaults)
--     Call once from the app:  select public.seed_demo_data();
-- -----------------------------------------------------------------------------
create or replace function public.seed_demo_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid   uuid := auth.uid();
  rec   record;
  ing   uuid;
  ft    uuid;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if exists (select 1 from ingredients where user_id = uid) then
    return;  -- already seeded / user has data
  end if;

  for rec in
    select * from (values
      ('Maize',          'Energy source',  50,  8.5, 3300, 2.5, 3.8, 0.02, 0.28, 0,    65,  1000),
      ('Soybean Meal',   'Protein source', 78,  44,  2500, 5,   1.5, 0.3,  0.6,  0,    35,  300),
      ('Fish Meal',      'Protein source', 165, 60,  2900, 1,   8,   4,    2.5,  2,    8,   150),
      ('Sunflower Cake', 'Protein source', 38,  28,  1900, 22,  3,   0.3,  0.9,  0,    25,  400),
      ('Wheat Bran',     'Fibre / energy', 40,  15,  1300, 10,  4,   0.1,  1.0,  0,    15,  500),
      ('Limestone',      'Mineral',        15,  0,   0,    0,   0,   38,   0.02, 0,    10,  200),
      ('DCP',            'Mineral',        120, 0,   0,    0,   0,   24,   18,   0,    3,   100),
      ('Premix',         'Additive',       350, 0,   0,    0,   0,   0,    0,    0.25, 0.5, 50),
      ('Salt',           'Additive',       25,  0,   0,    0,   0,   0,    0,    0.25, 0.5, 50)
    ) as t(name, category, price, protein, energy, fibre, fat, calcium, phosphorus, min_pct, max_pct, stock)
  loop
    insert into ingredients (user_id, name, category, min_inclusion_pct, max_inclusion_pct)
    values (uid, rec.name, rec.category, rec.min_pct, rec.max_pct)
    returning id into ing;

    insert into ingredient_nutrients (ingredient_id, nutrient_id, value)
    select ing, n.id, v.val
    from (values ('protein', rec.protein), ('energy', rec.energy), ('fibre', rec.fibre),
                 ('fat', rec.fat), ('calcium', rec.calcium), ('phosphorus', rec.phosphorus)) as v(k, val)
    join nutrients n on n.key = v.k and n.user_id is null;

    insert into ingredient_prices (ingredient_id, price_per_kg) values (ing, rec.price);
    insert into inventory (ingredient_id, quantity_available_kg) values (ing, rec.stock);
  end loop;

  for rec in
    select * from (values
      ('Chick Mash',   'Poultry', 'Starter feed for day-old to ~4 week chicks.', 20, 2900, 6,  0.9, 0.4),
      ('Growers Mash', 'Poultry', 'Grower feed for 5-18 week birds.',            16, 2800, 7,  0.8, 0.35),
      ('Layers Mash',  'Poultry', 'Feed for laying hens in production.',         16, 2700, 7,  3.5, 0.4),
      ('Dairy Meal',   'Dairy',   'General dairy concentrate.',                  16, 2600, 12, 0.6, 0.4)
    ) as t(name, animal, description, protein_min, energy_min, fibre_max, calcium_min, phosphorus_min)
  loop
    insert into feed_types (user_id, name, animal, description)
    values (uid, rec.name, rec.animal, rec.description)
    returning id into ft;

    insert into feed_requirements (feed_type_id, nutrient_id, min_value, max_value)
    select ft, n.id, r.mn, r.mx
    from (values ('protein',    rec.protein_min::numeric,    null::numeric),
                 ('energy',     rec.energy_min::numeric,     null::numeric),
                 ('fibre',      null::numeric,               rec.fibre_max::numeric),
                 ('calcium',    rec.calcium_min::numeric,    null::numeric),
                 ('phosphorus', rec.phosphorus_min::numeric, null::numeric)) as r(k, mn, mx)
    join nutrients n on n.key = r.k and n.user_id is null;
  end loop;
end;
$$;

revoke all on function public.seed_demo_data() from public, anon;
grant execute on function public.seed_demo_data() to authenticated;

-- =============================================================================
-- END OF SETUP
-- =============================================================================
```

## 9. Verification checklist

Run after applying the SQL, signed in as a test user (SQL editor with a JWT, or via the client SDK):

```sql
-- 1. Tables exist with RLS enabled (expect 14 rows, all true)
select tablename, rowsecurity from pg_tables where schemaname = 'public' order by 1;

-- 2. System nutrients seeded (expect 9)
select count(*) from public.nutrients where user_id is null;

-- 3. Demo data (expect 9 ingredients, 4 feed types, 20 requirements)
select public.seed_demo_data();
select (select count(*) from public.ingredients)       as ingredients,
       (select count(*) from public.feed_types)        as feed_types,
       (select count(*) from public.feed_requirements) as requirements;

-- 4. Library view returns price, stock and nutrient JSON
select name, price_per_kg, quantity_available_kg, nutrients from public.v_ingredient_library;

-- 5. Isolation: sign in as a second user and confirm all counts above are 0.
-- 6. Anonymous access: a request with only the anon key must be denied on all tables.
```

Acceptance test for the whole product is README §26: a user can create an ingredient, set price and nutrients,
create a feed specification, set stock and a target price, generate a formula, see nutrition and cost,
change a condition, recalculate, save the new scenario and compare it with the original. All twelve steps
work in the prototype; your job is to make them work against this database.

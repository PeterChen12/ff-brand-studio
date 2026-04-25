-- FF Brand Studio — Postgres schema
-- Run once against ff_brand_studio database
-- psql -h 170.9.252.93 -p 5433 -U postgres -d ff_brand_studio -f scripts/schema.sql

create extension if not exists vector;

create table if not exists assets (
  id          uuid primary key default gen_random_uuid(),
  r2_key      text not null unique,
  asset_type  text not null,
  campaign    text,
  platform    text,
  locale      text,
  brand_score integer,
  metadata    jsonb,
  created_at  timestamptz default now()
);

create table if not exists brand_knowledge (
  id          uuid primary key default gen_random_uuid(),
  source_url  text not null,
  chunk_text  text not null,
  embedding   vector(1536),
  created_at  timestamptz default now()
);

create index if not exists brand_knowledge_embedding_idx
  on brand_knowledge using ivfflat (embedding vector_cosine_ops) with (lists = 50);

create table if not exists run_costs (
  id                    uuid primary key default gen_random_uuid(),
  campaign              text,
  run_at                timestamptz default now(),
  gpt_image_2_calls     integer default 0,
  flux_calls            integer default 0,
  kling_calls           integer default 0,
  claude_input_tokens   integer default 0,
  claude_output_tokens  integer default 0,
  total_cost_usd        numeric(10, 4)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- v2 ecommerce-imagery schema (Phase 1 — additive, no v1 changes)
-- See V2_INVENTORY.md and FF_BRAND_STUDIO_V2_ITERATION_PLAN.md §1.1
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists seller_profiles (
  id               uuid primary key default gen_random_uuid(),
  org_name_en      text not null,
  org_name_zh      text,
  contact_email    text,
  brand_voice      jsonb,
  amazon_seller_id text,
  created_at       timestamptz default now()
);

create table if not exists products (
  id              uuid primary key default gen_random_uuid(),
  seller_id       uuid not null references seller_profiles(id) on delete cascade,
  sku             text not null unique,
  name_en         text not null,
  name_zh         text,
  category        text not null,
  dimensions      jsonb,
  materials       text[],
  colors_hex      text[],
  lora_url        text,
  trigger_phrase  text,
  brand_config    jsonb,
  created_at      timestamptz default now(),
  -- P1 #8 fix: enforce category enum at the DB layer to catch typos.
  -- 'other' is the catch-all per plan §1.1.
  constraint products_category_chk check (category in
    ('apparel','drinkware','tech-acc','bag','hat','other'))
);

create index if not exists products_seller_idx on products(seller_id);

-- Add category CHECK constraint idempotently (CREATE TABLE IF NOT EXISTS
-- skips constraint addition when the table already existed).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'products_category_chk'
  ) then
    alter table products add constraint products_category_chk
      check (category in ('apparel','drinkware','tech-acc','bag','hat','other'));
  end if;
end$$;

-- Default refinement_history to '[]' on platform_assets idempotently.
alter table platform_assets alter column refinement_history set default '[]'::jsonb;

create table if not exists product_references (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references products(id) on delete cascade,
  r2_url       text not null,
  kind         text not null,
  uploaded_by  text,
  approved_at  timestamptz
);

create index if not exists product_references_product_idx on product_references(product_id);

create table if not exists product_variants (
  id              uuid primary key default gen_random_uuid(),
  product_id      uuid not null references products(id) on delete cascade,
  color           text,
  pattern         text,
  generated_count integer default 0
);

create index if not exists product_variants_product_idx on product_variants(product_id);

create table if not exists platform_assets (
  id                  uuid primary key default gen_random_uuid(),
  variant_id          uuid not null references product_variants(id) on delete cascade,
  platform            text not null,
  slot                text not null,
  r2_url              text not null,
  width               integer,
  height              integer,
  file_size_bytes     integer,
  format              text,
  compliance_score    text,
  compliance_issues   jsonb,
  -- P1 #7: default refinement_history to [] so Phase 4 evaluator-optimizer
  -- appends work without a null check on every iteration.
  refinement_history  jsonb default '[]'::jsonb,
  status              text not null default 'draft',
  model_used          text,
  cost_cents          integer,
  generation_params   jsonb,
  created_at          timestamptz default now()
);

create index if not exists platform_assets_variant_idx on platform_assets(variant_id);
create index if not exists platform_assets_platform_slot_idx on platform_assets(platform, slot);
-- P0 #3: enforce one row per (variant, platform, slot) so adapter upserts
-- are idempotent across re-runs.
create unique index if not exists platform_assets_uniq_variant_slot
  on platform_assets(variant_id, platform, slot);

create table if not exists platform_specs (
  platform            text not null,
  slot                text not null,
  min_width           integer,
  max_width           integer,
  min_height          integer,
  max_height          integer,
  aspect_ratio        text,
  file_size_min_bytes integer,
  file_size_max_bytes integer,
  color_profile       text,
  background_rule     text,
  allows_text         boolean,
  allows_props        boolean,
  format_allowlist    text[],
  notes               text,
  primary key (platform, slot)
);

create table if not exists launch_runs (
  id                  uuid primary key default gen_random_uuid(),
  product_id          uuid not null references products(id) on delete cascade,
  orchestrator_model  text not null,
  total_cost_cents    integer default 0,
  duration_ms         integer,
  hitl_interventions  integer default 0,
  status              text default 'pending',
  langfuse_trace_id   text,
  created_at          timestamptz default now()
);

create index if not exists launch_runs_product_idx on launch_runs(product_id);

-- ── Seed platform_specs (Phase 1 §1.2) ──────────────────────────────────────
-- Idempotent: ON CONFLICT DO NOTHING so re-running setup-db.mjs is safe.

insert into platform_specs (platform, slot, min_width, max_width, min_height, max_height,
  aspect_ratio, file_size_max_bytes, color_profile, background_rule,
  allows_text, allows_props, format_allowlist, notes)
values
  ('amazon', 'main', 1000, null, 1000, null, '1:1', 10485760, 'sRGB', 'rgb_255_255_255',
    false, false, array['JPEG'], '2000x2000 recommended; ≥85% product fill; no text/logos/props/borders'),
  ('amazon', 'a_plus_feature_1', 1464, 1464, 600, 600, '2.44:1', 2097152, 'sRGB', 'any',
    true, true, array['JPEG','PNG'], 'Hero banner with up to 3 callouts; text area ≤30%'),
  ('amazon', 'a_plus_feature_2', 300, 300, 300, 300, '1:1', 2097152, 'sRGB', 'any',
    true, true, array['JPEG','PNG'], 'Triple 300x300 module'),
  ('amazon', 'a_plus_feature_3_grid', 135, 135, 135, 135, '1:1', 2097152, 'sRGB', 'any',
    true, true, array['JPEG','PNG'], '4-up icon grid'),
  ('amazon', 'lifestyle', 2000, null, 2000, null, '1:1', 10485760, 'sRGB', 'any',
    true, true, array['JPEG','PNG'], 'Text overlay allowed but ≤30% of frame'),
  ('amazon', 'video', 1920, 1920, 1080, 1080, '16:9', 524288000, null, null,
    null, null, array['MP4'], 'H.264, 15-30s recommended, ≤500MB, slot review takes 24-72h'),
  ('shopify', 'main', 2048, 2048, 2048, 2048, '1:1', 20971520, 'sRGB', 'any',
    false, false, array['JPEG','PNG'], 'CDN auto-converts to WebP; q=85 JPEG ideal'),
  ('shopify', 'lifestyle', 2048, 2048, 2048, 2048, '1:1', 20971520, 'sRGB', 'any',
    true, true, array['JPEG','PNG'], 'Same dims as main for catalog consistency'),
  ('shopify', 'banner', 2880, 2880, 1000, 1000, '2.88:1', 20971520, 'sRGB', 'any',
    true, true, array['JPEG','PNG'], 'Full-width hero; alt text ≤100 chars'),
  ('shopify', 'detail', 1024, 2048, 1024, 2048, '1:1', 20971520, 'sRGB', 'any',
    true, true, array['JPEG','PNG'], 'Secondary detail/close-up images for product gallery')
-- P1 #4 fix: upsert so re-running the seed picks up spec edits (e.g.,
-- Amazon raises minimum zoom from 1000 to 1600). Without this, only
-- DELETE+INSERT could update a row.
on conflict (platform, slot) do update set
  min_width            = excluded.min_width,
  max_width            = excluded.max_width,
  min_height           = excluded.min_height,
  max_height           = excluded.max_height,
  aspect_ratio         = excluded.aspect_ratio,
  file_size_min_bytes  = excluded.file_size_min_bytes,
  file_size_max_bytes  = excluded.file_size_max_bytes,
  color_profile        = excluded.color_profile,
  background_rule      = excluded.background_rule,
  allows_text          = excluded.allows_text,
  allows_props         = excluded.allows_props,
  format_allowlist     = excluded.format_allowlist,
  notes                = excluded.notes;

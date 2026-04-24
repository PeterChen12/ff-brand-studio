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

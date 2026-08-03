-- JewelChain Studio v0.7.0
-- 在 Supabase Dashboard → SQL Editor 中整段执行一次。

create extension if not exists pgcrypto;

create table if not exists public.design_projects (
  id uuid primary key,
  local_design_id text not null unique,
  title text not null,
  current_version integer not null default 1 check (current_version >= 1),
  final_version_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.design_versions (
  id uuid primary key,
  project_id uuid not null references public.design_projects(id) on delete cascade,
  version_number integer not null check (version_number >= 1),
  parent_version_id uuid null references public.design_versions(id),
  parent_content_hash text not null,
  structured_requirement jsonb not null default '{}'::jsonb,
  change_request text not null default '',
  prompt_snapshot jsonb not null default '{}'::jsonb,
  image_url text,
  image_hash text,
  metadata_json jsonb,
  metadata_uri text,
  content_hash text,
  model_provider text,
  model_name text,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, version_number),
  unique(content_hash)
);

alter table public.design_projects
  drop constraint if exists design_projects_final_version_id_fkey;
alter table public.design_projects
  add constraint design_projects_final_version_id_fkey
  foreign key (final_version_id) references public.design_versions(id);

create table if not exists public.chain_records (
  id uuid primary key,
  version_id uuid not null references public.design_versions(id) on delete cascade,
  chain_id integer not null,
  contract_address text not null,
  wallet_address text not null,
  tx_hash text not null unique,
  transaction_kind text not null default 'register',
  block_number bigint,
  chain_status text not null,
  submitted_at timestamptz not null default now(),
  confirmed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists design_versions_project_idx on public.design_versions(project_id, version_number);
create index if not exists chain_records_version_idx on public.chain_records(version_id, submitted_at desc);

-- 业务表只允许后端 service_role 访问；前端绝不使用 service_role key。
alter table public.design_projects enable row level security;
alter table public.design_versions enable row level security;
alter table public.chain_records enable row level security;

-- 创建公开、只用于脱敏 Demo 图片和 Metadata 的 Bucket。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'jewelchain-public',
  'jewelchain-public',
  true,
  10485760,
  array['image/png','image/jpeg','image/webp','application/json','text/plain']
)
on conflict (id) do update set public = true;

-- 注意：完整客户原话、联系方式、预算、未授权参考图不要上传这个公开 Bucket。

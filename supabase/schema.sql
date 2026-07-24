-- Схема для реестра покупателей PlutosOil
-- Выполнить целиком в Supabase: Project -> SQL Editor -> New query -> вставить -> Run

create table if not exists registry_rows (
  id text primary key,
  no integer,
  name text default '',
  contact text default '',
  source text default '',
  phone text default '',
  fuel text default '',
  weekly_need numeric,
  update_date text default '',
  status text default '',
  stated_need text default '',
  purchased numeric,
  purchase_sum numeric,
  comment text default '',
  updated_by text default '',
  updated_at timestamptz default now()
);

-- Включаем Row Level Security: доступ к данным только у вошедших
-- в систему пользователей (Supabase Auth, email/пароль). Анонимный
-- посетитель (без входа) не может ни читать, ни менять таблицу.
alter table registry_rows enable row level security;

drop policy if exists "public read" on registry_rows;
drop policy if exists "public write" on registry_rows;
drop policy if exists "public update" on registry_rows;
drop policy if exists "public delete" on registry_rows;

drop policy if exists "authenticated read" on registry_rows;
create policy "authenticated read" on registry_rows for select to authenticated using (true);

drop policy if exists "authenticated insert" on registry_rows;
create policy "authenticated insert" on registry_rows for insert to authenticated with check (true);

drop policy if exists "authenticated update" on registry_rows;
create policy "authenticated update" on registry_rows for update to authenticated using (true);

drop policy if exists "authenticated delete" on registry_rows;
create policy "authenticated delete" on registry_rows for delete to authenticated using (true);

-- Включаем Realtime для мгновенной синхронизации между менеджерами
alter publication supabase_realtime add table registry_rows;

-- ============================================================
-- Карточки клиентов (этап 2): компания, контакты, реквизиты,
-- закреплённый менеджер, файл карточки предприятия. История
-- покупок — это существующие строки registry_rows, связанные
-- через client_id.
-- ============================================================
create extension if not exists pgcrypto;

create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  client_no integer,
  company text not null default '',
  contact_name text default '',
  phone text default '',
  source text default '',
  inn text default '',
  kpp text default '',
  ogrn text default '',
  legal_address text default '',
  bank_details text default '',
  comment text default '',
  company_file_url text,
  company_file_name text,
  assigned_to text default '',
  created_by text default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table clients enable row level security;

drop policy if exists "authenticated read" on clients;
create policy "authenticated read" on clients for select to authenticated using (true);

drop policy if exists "authenticated insert" on clients;
create policy "authenticated insert" on clients for insert to authenticated with check (true);

drop policy if exists "authenticated update" on clients;
create policy "authenticated update" on clients for update to authenticated using (true);

drop policy if exists "authenticated delete" on clients;
create policy "authenticated delete" on clients for delete to authenticated using (true);

alter publication supabase_realtime add table clients;

-- Связь строк реестра с карточкой клиента (не блокирует удаление
-- сделок при удалении клиента — просто отвязывает).
alter table registry_rows add column if not exists client_id uuid references clients(id) on delete set null;

-- Разовая миграция: одна карточка клиента на каждый существующий
-- номер (no) в реестре, с привязкой всех его строк.
insert into clients (client_no, company, contact_name, phone, source, created_by)
select distinct on (no) no, name, contact, phone, source, coalesce(nullif(updated_by, ''), 'система')
from registry_rows
where no is not null and not exists (select 1 from clients c where c.client_no = registry_rows.no)
order by no, id;

update registry_rows r
set client_id = c.id
from clients c
where c.client_no = r.no and r.client_id is null;

-- Хранилище для файлов карточки предприятия (приватный бакет,
-- доступ только вошедшим пользователям).
insert into storage.buckets (id, name, public)
values ('client-files', 'client-files', false)
on conflict (id) do nothing;

drop policy if exists "authenticated manage client-files" on storage.objects;
create policy "authenticated manage client-files" on storage.objects
  for all to authenticated
  using (bucket_id = 'client-files')
  with check (bucket_id = 'client-files');

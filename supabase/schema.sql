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

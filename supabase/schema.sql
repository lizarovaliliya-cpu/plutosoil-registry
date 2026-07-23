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

-- Включаем Row Level Security и открываем доступ на чтение/запись всем,
-- у кого есть ссылка + anon-ключ (ключ не даёт доступа ни к чему, кроме этой таблицы).
-- Это подходит для внутренней команды. Если нужен вход по логину/паролю —
-- скажите, добавим Supabase Auth и политики "только свои пользователи".
alter table registry_rows enable row level security;

drop policy if exists "public read" on registry_rows;
create policy "public read" on registry_rows for select using (true);

drop policy if exists "public write" on registry_rows;
create policy "public write" on registry_rows for insert with check (true);

drop policy if exists "public update" on registry_rows;
create policy "public update" on registry_rows for update using (true);

drop policy if exists "public delete" on registry_rows;
create policy "public delete" on registry_rows for delete using (true);

-- Включаем Realtime для мгновенной синхронизации между менеджерами
alter publication supabase_realtime add table registry_rows;

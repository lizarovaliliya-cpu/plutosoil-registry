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

-- ============================================================
-- Продажи (этап 3): отдельный журнал фактических продаж —
-- клиент, топливо, цена, объём, сумма, дата. Не путать с полями
-- "Куплено"/"Сумма" в registry_rows — те остаются как ручной
-- текущий срез по реестру; sales — это точный лог сделок для
-- карточки клиента и будущей аналитики.
-- ============================================================
create table if not exists sales (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete set null,
  fuel text default '',
  price numeric,
  volume numeric,
  sum numeric,
  sale_date date default current_date,
  payment_method text default '',
  comment text default '',
  created_by text default '',
  created_at timestamptz default now()
);

alter table sales add column if not exists payment_method text default '';

alter table sales enable row level security;

drop policy if exists "authenticated read" on sales;
create policy "authenticated read" on sales for select to authenticated using (true);

drop policy if exists "authenticated insert" on sales;
create policy "authenticated insert" on sales for insert to authenticated with check (true);

drop policy if exists "authenticated update" on sales;
create policy "authenticated update" on sales for update to authenticated using (true);

drop policy if exists "authenticated delete" on sales;
create policy "authenticated delete" on sales for delete to authenticated using (true);

alter publication supabase_realtime add table sales;

-- ============================================================
-- Тара (этап 4): при продаже клиент может привезти свою тару,
-- купить тару у нас или взять в аренду под залог. Залог просто
-- фиксируется суммой (без отдельного трекинга возврата) — это
-- не часть выручки (sum), а отдельная учётная сумма.
-- ============================================================
alter table sales add column if not exists container_mode text default '';
alter table sales add column if not exists container_price numeric;
alter table sales add column if not exists container_deposit numeric;

-- ============================================================
-- Текущие цены на топливо (этап 4): отдельная цена для наличной
-- и безналичной оплаты на каждый вид топлива. Обновляется вручную
-- менеджерами по мере изменения цен и автоматически подставляется
-- в форму продажи.
-- ============================================================
create table if not exists fuel_prices (
  fuel text primary key,
  price_cash numeric,
  price_cashless numeric,
  updated_by text default '',
  updated_at timestamptz default now()
);

alter table fuel_prices enable row level security;

drop policy if exists "authenticated read" on fuel_prices;
create policy "authenticated read" on fuel_prices for select to authenticated using (true);

drop policy if exists "authenticated insert" on fuel_prices;
create policy "authenticated insert" on fuel_prices for insert to authenticated with check (true);

drop policy if exists "authenticated update" on fuel_prices;
create policy "authenticated update" on fuel_prices for update to authenticated using (true);

alter publication supabase_realtime add table fuel_prices;

insert into fuel_prices (fuel) values ('АИ-92'), ('АИ-95'), ('ДТ К5')
on conflict (fuel) do nothing;

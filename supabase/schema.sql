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
alter table sales add column if not exists container_qty numeric;

-- ============================================================
-- Отгрузка (этап 5): оплаченная сделка может быть ещё не
-- отгружена клиенту. Отгрузка целиком по сделке — без частичных
-- объёмов — с датой, когда фактически отгрузили.
-- ============================================================
alter table sales add column if not exists shipped boolean default false;
alter table sales add column if not exists shipped_date date;

-- ============================================================
-- Агентское вознаграждение (этап 6): расход по сделке, не входит
-- в выручку (sum) — отдельная сумма для расчёта выплат агентам.
-- ============================================================
alter table sales add column if not exists agent_fee numeric;

-- ============================================================
-- Реквизиты компании (этап 7): наши данные как поставщика для
-- печати накладной на выдачу — одна строка-настройка.
-- ============================================================
create table if not exists company_profile (
  id text primary key default 'default',
  name text default '',
  inn text default '',
  kpp text default '',
  address text default '',
  released_by text default '',
  updated_by text default '',
  updated_at timestamptz default now()
);

alter table company_profile enable row level security;

drop policy if exists "authenticated read" on company_profile;
create policy "authenticated read" on company_profile for select to authenticated using (true);

drop policy if exists "authenticated insert" on company_profile;
create policy "authenticated insert" on company_profile for insert to authenticated with check (true);

drop policy if exists "authenticated update" on company_profile;
create policy "authenticated update" on company_profile for update to authenticated using (true);

alter publication supabase_realtime add table company_profile;

insert into company_profile (id) values ('default') on conflict (id) do nothing;

-- ============================================================
-- Склад (этап 8): приход топлива, чтобы считать актуальный
-- остаток = сумма прихода − сумма проданного (sales.volume).
-- ============================================================
create table if not exists stock_receipts (
  id uuid primary key default gen_random_uuid(),
  fuel text default '',
  volume numeric,
  price numeric,
  sum numeric,
  supplier text default '',
  receipt_date date default current_date,
  comment text default '',
  created_by text default '',
  created_at timestamptz default now()
);

alter table stock_receipts enable row level security;

drop policy if exists "authenticated read" on stock_receipts;
create policy "authenticated read" on stock_receipts for select to authenticated using (true);

drop policy if exists "authenticated insert" on stock_receipts;
create policy "authenticated insert" on stock_receipts for insert to authenticated with check (true);

drop policy if exists "authenticated update" on stock_receipts;
create policy "authenticated update" on stock_receipts for update to authenticated using (true);

drop policy if exists "authenticated delete" on stock_receipts;
create policy "authenticated delete" on stock_receipts for delete to authenticated using (true);

alter publication supabase_realtime add table stock_receipts;

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

-- ============================================================
-- Мульти-позиционные продажи (этап 9): одна продажа может
-- включать несколько видов топлива (несколько строк в sales),
-- объединённых в одну сделку и одну накладную. "Шапка" сделки
-- (клиент, дата, оплата, менеджер, отгрузка, комментарий,
-- агентское вознаграждение — одна сумма на всю сделку) переезжает
-- в отдельную таблицу sale_groups; sales остаётся таблицей строк-
-- позиций (топливо/цена/объём/тара), связанных через group_id.
-- ============================================================
create table if not exists sale_groups (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete set null,
  sale_date date default current_date,
  payment_method text default '',
  comment text default '',
  created_by text default '',
  shipped boolean default false,
  shipped_date date,
  agent_fee numeric,
  created_at timestamptz default now()
);

alter table sale_groups enable row level security;

drop policy if exists "authenticated read" on sale_groups;
create policy "authenticated read" on sale_groups for select to authenticated using (true);

drop policy if exists "authenticated insert" on sale_groups;
create policy "authenticated insert" on sale_groups for insert to authenticated with check (true);

drop policy if exists "authenticated update" on sale_groups;
create policy "authenticated update" on sale_groups for update to authenticated using (true);

drop policy if exists "authenticated delete" on sale_groups;
create policy "authenticated delete" on sale_groups for delete to authenticated using (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'sale_groups'
  ) then
    alter publication supabase_realtime add table sale_groups;
  end if;
end $$;

alter table sales add column if not exists group_id uuid references sale_groups(id) on delete cascade;

-- Разовая миграция: у каждой существующей строки sales — своя
-- "сделка" из одной позиции. Переиспользуем id строки sales как id
-- новой sale_groups, чтобы номер накладной (берётся из id) не
-- изменился для уже оформленных сделок.
insert into sale_groups (id, client_id, sale_date, payment_method, comment, created_by, shipped, shipped_date, agent_fee, created_at)
select id, client_id, sale_date, payment_method, comment, created_by, shipped, shipped_date, agent_fee, created_at
from sales
where not exists (select 1 from sale_groups g where g.id = sales.id);

update sales set group_id = id where group_id is null;

-- group_id намеренно оставлен nullable (без "set not null"): пока
-- на проде ещё может крутиться старая версия фронтенда, которая не
-- знает про эту колонку и не заполняет её при сохранении продажи —
-- NOT NULL здесь ломает старый код с ошибкой на insert. Новый код
-- всегда проставляет group_id сам.

-- ============================================================
-- Коэффициент перевода в тонны (этап 10): для отпуска топлива
-- по весу, помимо литров. Цена остаётся всегда за литр — тонны
-- лишь ещё один способ ввести/увидеть объём отпуска в форме
-- продажи (объём в литрах, л × коэффициент / 1000 = тонны).
-- ============================================================
alter table fuel_prices add column if not exists density numeric;

update fuel_prices set density = case fuel
  when 'ДТ К5' then 0.82
  when 'АИ-92' then 0.72
  when 'АИ-95' then 0.72
  else density
end
where density is null;

-- ============================================================
-- Несколько складов и АЗС (этап 11): точки хранения топлива —
-- склад или АЗС. Приход и продажа привязываются к точке, чтобы
-- знать остаток по каждой конкретно. Перемещение между точками —
-- отдельный журнал (не два прихода), уменьшает остаток одной точки
-- и увеличивает остаток другой в расчёте баланса.
--
-- Историчные приходы/продажи (созданные до этой доработки) не
-- привязаны ни к одной точке (location_id = null) — это осознанно:
-- мы не знаем, откуда физически шло топливо раньше, а гадать и
-- дописывать это в один "дефолтный" склад исказило бы остатки
-- (продажи без точки всё равно списывали бы неизвестно откуда).
-- Такие записи показываются в интерфейсе отдельным блоком "без
-- склада" — сумма остатков по всем точкам плюс "без склада" всегда
-- равна прежнему общему остатку, ничего не потерялось.
-- ============================================================
create table if not exists locations (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  type text default 'warehouse', -- 'warehouse' | 'station'
  created_by text default '',
  created_at timestamptz default now()
);

alter table locations enable row level security;

drop policy if exists "authenticated read" on locations;
create policy "authenticated read" on locations for select to authenticated using (true);

drop policy if exists "authenticated insert" on locations;
create policy "authenticated insert" on locations for insert to authenticated with check (true);

drop policy if exists "authenticated update" on locations;
create policy "authenticated update" on locations for update to authenticated using (true);

drop policy if exists "authenticated delete" on locations;
create policy "authenticated delete" on locations for delete to authenticated using (true);

alter publication supabase_realtime add table locations;

create table if not exists stock_transfers (
  id uuid primary key default gen_random_uuid(),
  from_location_id uuid references locations(id) on delete set null,
  to_location_id uuid references locations(id) on delete set null,
  fuel text default '',
  volume numeric,
  transfer_date date default current_date,
  comment text default '',
  created_by text default '',
  created_at timestamptz default now()
);

alter table stock_transfers enable row level security;

drop policy if exists "authenticated read" on stock_transfers;
create policy "authenticated read" on stock_transfers for select to authenticated using (true);

drop policy if exists "authenticated insert" on stock_transfers;
create policy "authenticated insert" on stock_transfers for insert to authenticated with check (true);

drop policy if exists "authenticated update" on stock_transfers;
create policy "authenticated update" on stock_transfers for update to authenticated using (true);

drop policy if exists "authenticated delete" on stock_transfers;
create policy "authenticated delete" on stock_transfers for delete to authenticated using (true);

alter publication supabase_realtime add table stock_transfers;

alter table stock_receipts add column if not exists location_id uuid references locations(id) on delete set null;
alter table sales add column if not exists location_id uuid references locations(id) on delete set null;

-- ============================================================
-- Оплата сделки (этап 12): факт оплаты — отдельно от отгрузки,
-- как булев флаг с датой, по тому же образцу, что shipped/shipped_date.
-- ============================================================
alter table sale_groups add column if not exists paid boolean default false;
alter table sale_groups add column if not exists paid_date date;

-- ============================================================
-- Адрес точки (этап 13): у каждого склада/АЗС свой адрес — чтобы
-- в накладной был адрес именно того места, откуда фактически
-- отпустили топливо, а не всегда один и тот же адрес компании.
-- ============================================================
alter table locations add column if not exists address text default '';

-- ============================================================
-- Частичная отгрузка (этап 14): купленный объём топлива может
-- храниться на складе и отгружаться клиенту по частям — за
-- несколько заездов машин, каждая со своим объёмом. sale_shipments
-- — журнал фактических отпусков топлива по сделке (одна строка =
-- один заезд/машина). Остаток по каждому виду топлива в сделке =
-- объём позиции (sales.volume) минус сумма отпусков этого вида
-- топлива по этой сделке (sale_shipments.volume). Когда остаток
-- по всем позициям сделки обнулился — сделка считается отгруженной
-- целиком, и sale_groups.shipped/shipped_date проставляются
-- автоматически последней датой отпуска (это не ломает старые
-- фильтры/отчёты/Excel-экспорт — они уже полагаются на эти поля).
-- Для сделок, где частичная отгрузка не используется, поведение
-- не меняется — shipped/shipped_date по-прежнему выставляются
-- вручную чекбоксом в карточке сделки.
-- ============================================================
create table if not exists sale_shipments (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references sale_groups(id) on delete cascade,
  fuel text default '',
  volume numeric,
  vehicle_plate text default '',
  driver text default '',
  ship_date date default current_date,
  comment text default '',
  created_by text default '',
  created_at timestamptz default now()
);

alter table sale_shipments enable row level security;

drop policy if exists "authenticated read" on sale_shipments;
create policy "authenticated read" on sale_shipments for select to authenticated using (true);

drop policy if exists "authenticated insert" on sale_shipments;
create policy "authenticated insert" on sale_shipments for insert to authenticated with check (true);

drop policy if exists "authenticated update" on sale_shipments;
create policy "authenticated update" on sale_shipments for update to authenticated using (true);

drop policy if exists "authenticated delete" on sale_shipments;
create policy "authenticated delete" on sale_shipments for delete to authenticated using (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'sale_shipments'
  ) then
    alter publication supabase_realtime add table sale_shipments;
  end if;
end $$;

-- ============================================================
-- Планируемая дата отгрузки (этап 15): дата, на которую логистика
-- планирует отгрузить (полностью или очередную часть) сделку —
-- отдельно от shipped_date (когда отгрузили по факту). Заполняется
-- вручную в карточке сделки. Используется для календаря отгрузок
-- в отчётах: "кого когда отгружать" по сделкам, у которых ещё
-- остался неотгруженный объём.
-- ============================================================
alter table sale_groups add column if not exists planned_ship_date date;

-- ============================================================
-- Заправка по лимитам (этап 16): отдельный от обычных продаж
-- механизм — компания-клиент получает лимит (квоту) литров на
-- каждый вид топлива, и её машины заправляются по мере приезда,
-- списывая литры с этого лимита, а не через разовую сделку с
-- фиксированным объёмом. client_vehicles — справочник машин
-- клиента (переиспользуется во всех его заправках). fuel_limits —
-- текущий выставленный лимит по каждому виду топлива на клиента
-- (остаток = лимит минус сумма заправок этого вида топлива по
-- fuel_limit_fills). fuel_limit_fills — журнал фактических
-- заправок (одна строка = одна машина в одном приезде), из
-- которого печатаются накладные.
-- ============================================================
create table if not exists client_vehicles (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  plate text not null default '',
  model text default '',
  phone text default '',
  note text default '',
  created_by text default '',
  created_at timestamptz default now()
);

alter table client_vehicles enable row level security;

drop policy if exists "authenticated read" on client_vehicles;
create policy "authenticated read" on client_vehicles for select to authenticated using (true);

drop policy if exists "authenticated insert" on client_vehicles;
create policy "authenticated insert" on client_vehicles for insert to authenticated with check (true);

drop policy if exists "authenticated update" on client_vehicles;
create policy "authenticated update" on client_vehicles for update to authenticated using (true);

drop policy if exists "authenticated delete" on client_vehicles;
create policy "authenticated delete" on client_vehicles for delete to authenticated using (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'client_vehicles'
  ) then
    alter publication supabase_realtime add table client_vehicles;
  end if;
end $$;

create table if not exists fuel_limits (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  fuel text not null default '',
  limit_volume numeric default 0,
  updated_by text default '',
  updated_at timestamptz default now(),
  unique (client_id, fuel)
);

alter table fuel_limits enable row level security;

drop policy if exists "authenticated read" on fuel_limits;
create policy "authenticated read" on fuel_limits for select to authenticated using (true);

drop policy if exists "authenticated insert" on fuel_limits;
create policy "authenticated insert" on fuel_limits for insert to authenticated with check (true);

drop policy if exists "authenticated update" on fuel_limits;
create policy "authenticated update" on fuel_limits for update to authenticated using (true);

drop policy if exists "authenticated delete" on fuel_limits;
create policy "authenticated delete" on fuel_limits for delete to authenticated using (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'fuel_limits'
  ) then
    alter publication supabase_realtime add table fuel_limits;
  end if;
end $$;

create table if not exists fuel_limit_fills (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  vehicle_id uuid references client_vehicles(id) on delete set null,
  vehicle_plate text default '',
  driver text default '',
  fuel text default '',
  volume numeric,
  price numeric,
  sum numeric,
  fill_date date default current_date,
  comment text default '',
  created_by text default '',
  created_at timestamptz default now()
);

alter table fuel_limit_fills enable row level security;

drop policy if exists "authenticated read" on fuel_limit_fills;
create policy "authenticated read" on fuel_limit_fills for select to authenticated using (true);

drop policy if exists "authenticated insert" on fuel_limit_fills;
create policy "authenticated insert" on fuel_limit_fills for insert to authenticated with check (true);

drop policy if exists "authenticated update" on fuel_limit_fills;
create policy "authenticated update" on fuel_limit_fills for update to authenticated using (true);

drop policy if exists "authenticated delete" on fuel_limit_fills;
create policy "authenticated delete" on fuel_limit_fills for delete to authenticated using (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'fuel_limit_fills'
  ) then
    alter publication supabase_realtime add table fuel_limit_fills;
  end if;
end $$;

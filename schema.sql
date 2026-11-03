-- Выполнить один раз: Supabase → SQL Editor → New query → вставить → Run

create table if not exists public.clients (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null,
  amount     numeric(12,2) not null check (amount > 0),
  date       date not null,
  type       text not null check (type in ('new', 'old')),
  created_at timestamptz not null default now()
);
create index if not exists clients_user_date_idx on public.clients (user_id, date);

create table if not exists public.settings (
  user_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  month     text not null check (month ~ '^\d{4}-\d{2}$'),
  salary    numeric(12,2) not null default 0,
  adv_share numeric(5,2)  not null default 50,
  plan_new  numeric(12,2) not null default 0,
  plan_old  numeric(12,2) not null default 0,
  bonus     numeric(12,2) not null default 0,
  rate_new  numeric(6,3)  not null default 10,
  rate_old  numeric(6,3)  not null default 2.5,
  primary key (user_id, month)
);

-- Каждый пользователь видит и меняет только свои строки
alter table public.clients  enable row level security;
alter table public.settings enable row level security;

drop policy if exists "own clients" on public.clients;
create policy "own clients" on public.clients
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own settings" on public.settings;
create policy "own settings" on public.settings
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

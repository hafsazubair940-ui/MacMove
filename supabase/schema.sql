-- MacMove database setup for Supabase.
-- Run this whole file once: Supabase dashboard -> SQL Editor -> New query -> paste -> Run.
-- It is safe to run on a brand-new project. It creates tables, security rules,
-- the photo storage bucket and live updates.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------
-- Public part of a profile: everyone signed in can see a student's name.
create table if not exists public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  full_name   text not null default '',
  is_agent    boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Private part: only the student (and agents) can see Mac ID and email.
create table if not exists public.profile_private (
  id      uuid primary key references public.profiles on delete cascade,
  mac_id  text,
  email   text
);

-- Create both rows automatically when someone signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
    values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''))
    on conflict (id) do nothing;
  insert into public.profile_private (id, mac_id, email)
    values (new.id, lower(new.raw_user_meta_data->>'mac_id'), new.email)
    on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_agent()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_agent from public.profiles where id = auth.uid()), false)
$$;

-- ---------------------------------------------------------------------------
-- Furniture condition scans (written only by the server's /api/scan)
-- ---------------------------------------------------------------------------
create table if not exists public.scans (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles on delete cascade,
  photo_path     text,
  is_furniture   boolean,
  item           text,
  category       text,
  estimated_age  text,
  condition      text,
  score          int,
  issues         jsonb not null default '[]',
  summary        text,
  verified       boolean not null default false,
  verified_by    text,               -- 'scan' or 'agent'
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Furniture listings
-- ---------------------------------------------------------------------------
create table if not exists public.listings (
  id           uuid primary key default gen_random_uuid(),
  seller_id    uuid not null default auth.uid() references public.profiles on delete cascade,
  scan_id      uuid references public.scans on delete set null,
  title        text not null check (char_length(title) between 1 and 120),
  category     text not null,
  age          text,
  mode         text not null check (mode in ('sell', 'rent', 'both')),
  price        numeric check (price is null or price >= 0),
  rent         numeric check (rent is null or rent >= 0),
  area         text,
  description  text check (description is null or char_length(description) <= 2000),
  photo_path   text,
  verified     boolean not null default false,
  verified_by  text,
  score        int,
  condition    text,
  status       text not null default 'active' check (status in ('active', 'sold')),
  created_at   timestamptz not null default now()
);

-- The verified badge always comes from the scan record, never from the browser.
create or replace function public.listing_verification()
returns trigger language plpgsql security definer set search_path = public as $$
declare s public.scans%rowtype;
begin
  new.verified := false; new.verified_by := null; new.score := null; new.condition := null;
  if new.scan_id is not null then
    select * into s from public.scans where id = new.scan_id and user_id = new.seller_id;
    if found then
      new.verified := s.verified;
      new.verified_by := s.verified_by;
      new.score := s.score;
      new.condition := s.condition;
      if new.photo_path is null then new.photo_path := s.photo_path; end if;
    else
      new.scan_id := null;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists listings_verification on public.listings;
create trigger listings_verification
  before insert or update of scan_id, verified, verified_by, score, condition, seller_id
  on public.listings
  for each row execute function public.listing_verification();

-- When an agent verifies a scan later, update any listing that uses it.
create or replace function public.scan_verified_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.verified is distinct from old.verified then
    update public.listings set scan_id = scan_id where scan_id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists scans_verified_sync on public.scans;
create trigger scans_verified_sync
  after update on public.scans
  for each row execute function public.scan_verified_sync();

-- ---------------------------------------------------------------------------
-- Textbooks
-- ---------------------------------------------------------------------------
create table if not exists public.textbooks (
  id          uuid primary key default gen_random_uuid(),
  seller_id   uuid not null default auth.uid() references public.profiles on delete cascade,
  course      text not null check (char_length(course) between 1 and 30),
  title       text not null check (char_length(title) between 1 and 160),
  edition     text,
  condition   text not null,
  area        text,
  mode        text not null check (mode in ('sell', 'rent', 'both')),
  price       numeric check (price is null or price >= 0),
  rent        numeric check (rent is null or rent >= 0),
  photo_path  text,
  status      text not null default 'active' check (status in ('active', 'sold')),
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Conversations: buyer <-> seller, and student <-> agent
-- ---------------------------------------------------------------------------
create table if not exists public.threads (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('listing', 'agent')),
  item_type   text check (item_type in ('listing', 'textbook')),
  item_id     uuid,
  title       text not null check (char_length(title) between 1 and 200),
  starter_id  uuid not null default auth.uid() references public.profiles on delete cascade,
  other_id    uuid references public.profiles on delete cascade,
  scan_id     uuid references public.scans on delete set null,
  verdict     text check (verdict in ('verified', 'rejected')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists threads_one_per_item
  on public.threads (item_id, starter_id) where kind = 'listing';

create table if not exists public.messages (
  id          bigint generated always as identity primary key,
  thread_id   uuid not null references public.threads on delete cascade,
  sender_id   uuid default auth.uid() references public.profiles on delete set null,
  role        text not null default 'user' check (role in ('user', 'agent', 'system')),
  body        text not null check (char_length(body) between 1 and 4000),
  created_at  timestamptz not null default now()
);
create index if not exists messages_thread_idx on public.messages (thread_id, created_at);

create or replace function public.touch_thread()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.threads set updated_at = now() where id = new.thread_id;
  return new;
end $$;

drop trigger if exists messages_touch_thread on public.messages;
create trigger messages_touch_thread
  after insert on public.messages
  for each row execute function public.touch_thread();

create or replace function public.can_see_thread(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.threads th
    where th.id = t
      and (auth.uid() in (th.starter_id, th.other_id) or (th.kind = 'agent' and public.is_agent()))
  )
$$;

-- Agents mark an item verified or not. Also updates the scan (and listings using it).
create or replace function public.agent_verdict(p_thread uuid, p_verdict text)
returns void language plpgsql security definer set search_path = public as $$
declare th public.threads%rowtype;
begin
  if not public.is_agent() then raise exception 'Only agents can do this'; end if;
  if p_verdict not in ('verified', 'rejected') then raise exception 'Unknown verdict'; end if;
  select * into th from public.threads where id = p_thread and kind = 'agent';
  if not found then raise exception 'Conversation not found'; end if;
  update public.threads set verdict = p_verdict where id = p_thread;
  if th.scan_id is not null then
    update public.scans
      set verified = (p_verdict = 'verified'),
          verified_by = case when p_verdict = 'verified' then 'agent' else verified_by end
      where id = th.scan_id;
  end if;
  insert into public.messages (thread_id, sender_id, role, body)
    values (p_thread, auth.uid(), 'system',
      case when p_verdict = 'verified'
        then 'An agent verified this item. You can list it as a verified seller.'
        else 'An agent could not verify this item. You can still list it as unverified.' end);
end $$;

-- ---------------------------------------------------------------------------
-- Move-in / move-out checklist progress
-- ---------------------------------------------------------------------------
create table if not exists public.move_progress (
  user_id     uuid primary key default auth.uid() references public.profiles on delete cascade,
  checks      jsonb not null default '{}',
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Usage log for the AI endpoints (server only, used for rate limits)
-- ---------------------------------------------------------------------------
create table if not exists public.api_usage (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles on delete cascade,
  kind        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists api_usage_idx on public.api_usage (user_id, kind, created_at);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.profile_private enable row level security;
alter table public.scans           enable row level security;
alter table public.listings        enable row level security;
alter table public.textbooks       enable row level security;
alter table public.threads         enable row level security;
alter table public.messages        enable row level security;
alter table public.move_progress   enable row level security;
alter table public.api_usage       enable row level security;   -- no policies: server only

-- profiles: signed-in users see names; students may change only their own name.
drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select to authenticated using (true);
drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from authenticated, anon;
grant update (full_name) on public.profiles to authenticated;

drop policy if exists "private read own" on public.profile_private;
create policy "private read own" on public.profile_private for select to authenticated
  using (id = auth.uid() or public.is_agent());
drop policy if exists "private update own" on public.profile_private;
create policy "private update own" on public.profile_private for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profile_private from authenticated, anon;
grant update (mac_id) on public.profile_private to authenticated;

-- scans: read own (agents read all). Writes happen on the server or through agent_verdict.
drop policy if exists "scans read" on public.scans;
create policy "scans read" on public.scans for select to authenticated
  using (user_id = auth.uid() or public.is_agent());

-- listings + textbooks: anyone can browse; sellers manage their own.
drop policy if exists "listings read" on public.listings;
create policy "listings read" on public.listings for select to anon, authenticated using (true);
drop policy if exists "listings insert own" on public.listings;
create policy "listings insert own" on public.listings for insert to authenticated with check (seller_id = auth.uid());
drop policy if exists "listings update own" on public.listings;
create policy "listings update own" on public.listings for update to authenticated
  using (seller_id = auth.uid()) with check (seller_id = auth.uid());
drop policy if exists "listings delete own" on public.listings;
create policy "listings delete own" on public.listings for delete to authenticated using (seller_id = auth.uid());

drop policy if exists "textbooks read" on public.textbooks;
create policy "textbooks read" on public.textbooks for select to anon, authenticated using (true);
drop policy if exists "textbooks insert own" on public.textbooks;
create policy "textbooks insert own" on public.textbooks for insert to authenticated with check (seller_id = auth.uid());
drop policy if exists "textbooks update own" on public.textbooks;
create policy "textbooks update own" on public.textbooks for update to authenticated
  using (seller_id = auth.uid()) with check (seller_id = auth.uid());
drop policy if exists "textbooks delete own" on public.textbooks;
create policy "textbooks delete own" on public.textbooks for delete to authenticated using (seller_id = auth.uid());

-- threads: the two people in it (and agents, for agent help threads).
drop policy if exists "threads read" on public.threads;
create policy "threads read" on public.threads for select to authenticated
  using (auth.uid() in (starter_id, other_id) or (kind = 'agent' and public.is_agent()));
drop policy if exists "threads insert" on public.threads;
create policy "threads insert" on public.threads for insert to authenticated
  with check (
    starter_id = auth.uid() and verdict is null and (
      (kind = 'agent' and other_id is null and
        (scan_id is null or exists (select 1 from public.scans s where s.id = scan_id and s.user_id = auth.uid())))
      or (kind = 'listing' and other_id is not null and other_id <> auth.uid() and scan_id is null)
    )
  );

-- messages: people in the thread. Only agents may post as 'agent' or 'system'.
drop policy if exists "messages read" on public.messages;
create policy "messages read" on public.messages for select to authenticated
  using (public.can_see_thread(thread_id));
drop policy if exists "messages insert" on public.messages;
create policy "messages insert" on public.messages for insert to authenticated
  with check (
    sender_id = auth.uid() and public.can_see_thread(thread_id)
    and (role = 'user' or (role = 'agent' and public.is_agent()))
  );

drop policy if exists "move own" on public.move_progress;
create policy "move own" on public.move_progress for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Photo storage: public bucket, each student uploads into their own folder.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('photos', 'photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do update set public = true;

drop policy if exists "photos upload own folder" on storage.objects;
create policy "photos upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "photos delete own folder" on storage.objects;
create policy "photos delete own folder" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- Live updates
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['listings', 'textbooks', 'threads', 'messages'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

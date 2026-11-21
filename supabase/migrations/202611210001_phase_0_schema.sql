create table public.books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) default auth.uid(),
  drive_file_id text not null,
  category text,
  title text,
  author text,
  filename text not null,
  size_bytes bigint,
  metadata_read boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, drive_file_id)
);

create table public.progress (
  book_id uuid primary key references public.books (id) on delete cascade,
  user_id uuid not null references auth.users (id) default auth.uid(),
  cfi text not null,
  percentage real not null check (percentage between 0 and 1),
  device_id text not null,
  updated_at timestamptz not null default now()
);

create table public.highlights (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books (id) on delete cascade,
  user_id uuid not null references auth.users (id) default auth.uid(),
  cfi_range text not null,
  text_excerpt text not null,
  color text not null default 'yellow',
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.books enable row level security;
alter table public.progress enable row level security;
alter table public.highlights enable row level security;

grant select, insert, update, delete on public.books to authenticated;
grant select, insert, update, delete on public.progress to authenticated;
grant select, insert, update, delete on public.highlights to authenticated;
grant select on public.books to anon;
grant select on public.progress to anon;
grant select on public.highlights to anon;

create policy "Users can access their own books"
  on public.books for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Users can access their own progress"
  on public.progress for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Users can access their own highlights"
  on public.highlights for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

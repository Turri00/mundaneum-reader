-- Run with: supabase test db
-- Each count must be zero when the request has no authenticated user.
begin;
set local role anon;
select 'books' as table_name, count(*) as visible_rows from public.books
union all
select 'progress', count(*) from public.progress
union all
select 'highlights', count(*) from public.highlights;
rollback;

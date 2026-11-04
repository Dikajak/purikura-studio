insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'purikura-photos',
  'purikura-photos',
  false,
  5242880,
  array['image/png']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = array['image/png'];

drop policy if exists purikura_photos_private_guard on storage.objects;
create policy purikura_photos_private_guard
  on storage.objects
  as restrictive
  for all
  to public
  using (bucket_id <> 'purikura-photos')
  with check (bucket_id <> 'purikura-photos');

create table public.purikura_shared_photos (
  id uuid primary key,
  object_path text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint purikura_shared_photos_object_path_check
    check (object_path = id::text || '.png'),
  constraint purikura_shared_photos_expiry_check
    check (expires_at > created_at)
);

create index purikura_shared_photos_expires_at_idx
  on public.purikura_shared_photos (expires_at);

alter table public.purikura_shared_photos enable row level security;
revoke all on table public.purikura_shared_photos from anon, authenticated;
grant all on table public.purikura_shared_photos to service_role;

create table public.purikura_share_rate_limits (
  client_key text primary key
    check (client_key ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0)
);

alter table public.purikura_share_rate_limits enable row level security;
revoke all on table public.purikura_share_rate_limits from anon, authenticated;
grant all on table public.purikura_share_rate_limits to service_role;

create or replace function public.consume_purikura_share_rate_limit(
  p_client_key text,
  p_max_requests integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_count integer;
begin
  if p_client_key !~ '^[0-9a-f]{64}$'
    or p_max_requests < 1
    or p_window_seconds < 1 then
    return false;
  end if;

  insert into public.purikura_share_rate_limits as limits (
    client_key,
    window_started_at,
    request_count
  )
  values (p_client_key, now(), 1)
  on conflict (client_key) do update
  set
    window_started_at = case
      when limits.window_started_at <= now() - make_interval(secs => p_window_seconds)
        then now()
      else limits.window_started_at
    end,
    request_count = case
      when limits.window_started_at <= now() - make_interval(secs => p_window_seconds)
        then 1
      else limits.request_count + 1
    end
  returning request_count into current_count;

  return current_count <= p_max_requests;
end;
$$;

revoke all on function public.consume_purikura_share_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_purikura_share_rate_limit(text, integer, integer)
  to service_role;

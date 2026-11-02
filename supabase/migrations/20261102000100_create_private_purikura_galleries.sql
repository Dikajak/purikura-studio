insert into storage.buckets (id, name, public)
values ('purikura-shares', 'purikura-shares', false)
on conflict (id) do update
set public = false;

create table public.purikura_share_galleries (
  gallery_id uuid primary key,
  token_hash text not null unique
    check (token_hash ~ '^[0-9a-f]{64}$'),
  png_path text not null,
  gif_path text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint purikura_share_galleries_expiry_check
    check (expires_at > created_at),
  constraint purikura_share_galleries_png_path_check
    check (png_path = gallery_id::text || '/photo.png'),
  constraint purikura_share_galleries_gif_path_check
    check (gif_path = gallery_id::text || '/photo.gif')
);

create index purikura_share_galleries_expires_at_idx
  on public.purikura_share_galleries (expires_at);

alter table public.purikura_share_galleries enable row level security;

revoke all on table public.purikura_share_galleries from anon, authenticated;
grant all on table public.purikura_share_galleries to service_role;

drop policy if exists purikura_shares_private_guard on storage.objects;
create policy purikura_shares_private_guard
  on storage.objects
  as restrictive
  for all
  to public
  using (bucket_id <> 'purikura-shares')
  with check (bucket_id <> 'purikura-shares');

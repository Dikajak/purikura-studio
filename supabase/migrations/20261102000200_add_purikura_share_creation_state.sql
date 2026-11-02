alter table public.purikura_share_galleries
  add column request_digest text,
  add column cleanup_started_at timestamptz,
  add column creation_status text not null default 'complete',
  add constraint purikura_share_galleries_creation_status_check
    check (creation_status in ('uploading', 'complete', 'failed', 'cleaning')),
  add constraint purikura_share_galleries_request_digest_check
    check (request_digest is null or request_digest ~ '^[0-9a-f]{64}$'),
  add constraint purikura_share_galleries_creation_digest_check
    check (creation_status = 'complete' or request_digest is not null),
  add constraint purikura_share_galleries_cleanup_started_check
    check ((creation_status = 'cleaning') = (cleanup_started_at is not null));

create index purikura_share_galleries_cleanup_idx
  on public.purikura_share_galleries (creation_status, expires_at, created_at);

revoke all on table public.purikura_share_galleries from anon, authenticated;
grant all on table public.purikura_share_galleries to service_role;

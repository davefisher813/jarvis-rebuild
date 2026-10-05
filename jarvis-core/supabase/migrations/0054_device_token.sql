-- Migration 0054: device_token. Where a phone's APNs token is kept so the
-- server can address a push to it (2026-10-05, iOS preparation).
--
-- The app registers for remote notifications on the phone (src/native/push.ts)
-- and hands the token here. NOTHING SENDS YET: the sender needs an Apple
-- Developer account's APNs key, which is Dave's, so until then this table
-- fills and no push goes out. The table is the half that can be built and
-- proven without Apple.
--
--   * A token belongs to one account at a time. Signing in on a phone that
--     another account used moves the token to the new account (the old
--     account must not be pushed to a phone it signed out of), so the write
--     is a function, not a table grant: register_device_token reassigns the
--     row to the caller, which a row-level policy alone could not do.
--   * No direct table access for the API roles: RLS is on, no policies, every
--     grant revoked. The two functions below are the only door, and each
--     answers only for auth.uid().
--   * Sign-out calls unregister_device_token so the account stops being
--     addressable at that phone at once.
--   * Deleting the account deletes its tokens (on delete cascade).

create table if not exists device_token (
  token text primary key check (length(token) between 32 and 512),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null default 'ios' check (platform in ('ios')),
  environment text not null default 'production' check (environment in ('development', 'production')),
  app_build text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists device_token_user_idx on device_token (user_id);

alter table device_token enable row level security;
revoke all on device_token from public, anon, authenticated;

create or replace function public.register_device_token(p_token text, p_environment text default 'production', p_build text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  insert into public.device_token (token, user_id, environment, app_build)
  values (p_token, uid, case when p_environment = 'development' then 'development' else 'production' end, left(p_build, 64))
  on conflict (token) do update
    set user_id = excluded.user_id,
        environment = excluded.environment,
        app_build = excluded.app_build,
        last_seen_at = now();
end;
$$;

create or replace function public.unregister_device_token(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  delete from public.device_token where token = p_token and user_id = uid;
end;
$$;

revoke all on function public.register_device_token(text, text, text) from public, anon;
revoke all on function public.unregister_device_token(text) from public, anon;
grant execute on function public.register_device_token(text, text, text) to authenticated;
grant execute on function public.unregister_device_token(text) to authenticated;

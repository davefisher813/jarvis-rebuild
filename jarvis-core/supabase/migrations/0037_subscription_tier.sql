-- UP-LAUNCH-13: Subscription tiers (god, paid, free) as a server-authoritative fact
-- Tracks the user's subscription level, which gates feature availability and AI cost limits.
-- Values: 'god' (unlimited), 'paid' (subscription active), 'free' (trial or unpaid).
-- Stored as a scalar_setting with key 'subscription_tier'. Defaults to 'free'.
--
-- Server sets this via admin API after payment processing or at signup.
-- Client reads via get_subscription_tier() RPC.

-- Ensure the scalar_setting table exists (created in 0001_core_data_model.sql).
-- This migration just documents the contract.

-- Optional: Add a comments-only validation to the schema to enforce tier values.
-- In practice, the RLS policies and API validation enforce this.
-- If you want database-level validation, uncomment the check domain:
--
-- create domain subscription_tier_enum as text
--   check (value in ('god', 'paid', 'free'));

-- Create an RPC to retrieve the user's subscription tier (read-only from client).
-- Defaults to 'free' if not set (new user or reset state).
create or replace function get_subscription_tier()
returns text
language sql
stable
security definer
as $$
  select coalesce(
    (scalar_setting.value ->> 'tier'),
    'free'
  )::text
  from scalar_setting
  where owner_id = auth.uid()
    and key = 'subscription_tier'
  limit 1;
$$;

-- Grant permission to any authenticated user to call this.
grant execute on function get_subscription_tier() to authenticated;

-- Optional: Create a helper RPC to bulk-read multiple scalar settings.
-- Useful for onboarding (theme, budget, subscription_tier in one call).
-- Not required for UP-LAUNCH-13 but useful foundation.
create or replace function get_user_settings()
returns jsonb
language sql
stable
security definer
as $$
  select jsonb_object_agg(key, value)
  from scalar_setting
  where owner_id = auth.uid();
$$;

grant execute on function get_user_settings() to authenticated;

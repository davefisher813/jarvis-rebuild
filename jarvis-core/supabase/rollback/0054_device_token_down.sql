-- Rollback of 0054: the device-token table and its two functions. Tokens are
-- re-registered by the app on the next launch, so nothing is lost for good.
drop function if exists public.register_device_token(text, text, text);
drop function if exists public.unregister_device_token(text);
drop table if exists device_token;

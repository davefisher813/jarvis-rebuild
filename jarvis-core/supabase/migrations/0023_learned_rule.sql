-- Migration 0023: register the learned_rule entity type (Uncertainty
-- Protocol, addendum item 25; unification law). Same commit as the type's
-- code, per the standing rule: an unregistered type rejects every insert.
insert into entity_type (key) values ('learned_rule') on conflict (key) do nothing;

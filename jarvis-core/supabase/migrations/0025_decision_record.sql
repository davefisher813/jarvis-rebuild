-- Migration 0025: register the decision_record entity type (brainstorm
-- shipment 1: Decision Record). Same commit as the type's code, per the
-- standing rule.
insert into entity_type (key) values ('decision_record') on conflict (key) do nothing;

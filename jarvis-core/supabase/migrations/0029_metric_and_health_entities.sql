-- Migration 0029: register the entity types the code has been writing
-- without a registry row (found 2026-09-02, Dave: "the metrics page
-- literally doesn't work. I can't select anything the button is broke").
--
-- item.entity_type references this registry, and an unregistered type
-- rejects every insert. D10-B's metric_def and metric_log (2026-08-31) never
-- got their row, so every switch on Add a Metric failed at the database and
-- the sheet swallowed it. The Student template's health module kinds are
-- registered here too, ahead of their first write, so the same mistake is
-- not waiting there.
insert into entity_type (key) values
  ('metric_def'), ('metric_log'),
  ('health_consent'), ('health_lights_out'), ('health_ate_before'), ('health_took_it'),
  ('health_call_it'), ('health_point_at_it'), ('health_med_refill'), ('health_bag_check'),
  ('health_locker_doc'), ('health_trusted_adult'), ('health_age_rule_shown')
on conflict (key) do nothing;

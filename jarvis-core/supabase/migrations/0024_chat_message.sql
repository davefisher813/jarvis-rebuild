-- Migration 0024: register the chat_message entity type (addendum item 23).
-- Same commit as the type's code, per the standing rule.
insert into entity_type (key) values ('chat_message') on conflict (key) do nothing;

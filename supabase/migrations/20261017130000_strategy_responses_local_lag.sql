-- Preserve the imported strategy responses while keeping derived local-team
-- labels separate from the redacted sender name.
alter table if exists public.strategy_responses
  add column if not exists local_lag text;

comment on column public.strategy_responses.local_lag is
  'Locallag derived only when the source sender address identifies it unambiguously.';

create index if not exists strategy_responses_local_lag_idx
  on public.strategy_responses(local_lag)
  where local_lag is not null;

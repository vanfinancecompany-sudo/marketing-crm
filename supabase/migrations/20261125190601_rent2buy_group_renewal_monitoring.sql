-- Extend the existing Conversations & AI monitor with a separate renewal channel.
alter table public.conversation_channel_status
  drop constraint if exists conversation_channel_status_channel_check;
alter table public.conversation_channel_status
  add constraint conversation_channel_status_channel_check check (channel in (
    'facebook_marketplace', 'facebook_page', 'whatsapp',
    'rent2buy_group_renewal', 'rent2buy_group_renewal_preview'
  ));

-- Compare a compact revision when publishing a queue update or reserving a group.
alter table public.rent2buy_group_renewal_runs
  add column if not exists revision integer not null default 0;

-- A service-role claim prevents overlapping checks from sending the same email.
alter table public.conversation_monitor_alerts
  add column if not exists email_claimed_at timestamptz;

grant select, insert, update on public.conversation_channel_status to service_role;
grant select, insert, update on public.conversation_monitor_alerts to service_role;

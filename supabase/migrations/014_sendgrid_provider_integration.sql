-- Additive SendGrid preview/test and signed webhook support.
-- Existing Brevo defaults and SMTP2GO compatibility behaviour remain unchanged.

alter table public.marketing_email_events
  drop constraint if exists marketing_email_events_provider_check;

alter table public.marketing_email_events
  add constraint marketing_email_events_provider_check
  check (provider in ('brevo', 'sendgrid')) not valid;

alter table public.marketing_email_events
  validate constraint marketing_email_events_provider_check;

alter table public.marketing_email_sends
  drop constraint if exists marketing_email_sends_provider_check;

alter table public.marketing_email_sends
  add constraint marketing_email_sends_provider_check
  check (provider in ('brevo', 'sendgrid')) not valid;

alter table public.marketing_email_sends
  validate constraint marketing_email_sends_provider_check;

-- Retain the existing five-argument contract while allowing the signed SendGrid
-- webhook to protect an older, verified recipient address after a card email change.
create or replace function public.marketing_apply_suppression(
  p_contact_id uuid,
  p_type text,
  p_reason text default '',
  p_added_by text default 'Marketing CRM',
  p_notes text default ''
)
returns setof public.marketing_contacts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contact public.marketing_contacts%rowtype;
  v_type text := lower(trim(coalesce(p_type, '')));
  v_now timestamptz := now();
  v_entry jsonb;
  v_history_entry jsonb;
  v_permanent_email boolean;
  v_campaign_text text;
  v_campaign_id uuid;
  v_note_email text;
  v_recipient_text text;
  v_recipient_id uuid;
  v_identity_email text;
begin
  if v_type not in ('email_unsubscribed', 'email_bounced', 'sms_opt_out', 'facebook_excluded', 'manual_suppression', 'global_do_not_contact') then
    raise exception 'Unsupported suppression type.';
  end if;

  select * into v_contact
  from public.marketing_contacts
  where id = p_contact_id
  for update;

  if not found then raise exception 'Contact not found.'; end if;

  v_permanent_email := v_type in ('email_unsubscribed', 'email_bounced', 'manual_suppression', 'global_do_not_contact');
  v_entry := jsonb_build_object(
    'type', v_type,
    'label', case v_type
      when 'email_unsubscribed' then 'Email Unsubscribed'
      when 'email_bounced' then 'Email Bounced'
      when 'sms_opt_out' then 'SMS Opt-out'
      when 'facebook_excluded' then 'Facebook Excluded'
      when 'manual_suppression' then 'Manual Suppression'
      when 'global_do_not_contact' then 'Global Do Not Contact'
    end,
    'reason', left(trim(coalesce(nullif(p_reason, ''), v_type)), 500),
    'added_at', v_now,
    'added_by', left(trim(coalesce(nullif(p_added_by, ''), 'Marketing CRM')), 500),
    'notes', left(trim(coalesce(p_notes, '')), 500),
    'active', true
  );
  v_history_entry := jsonb_build_object('action', 'suppressed') || v_entry;

  update public.marketing_contacts
  set suppression = coalesce(v_contact.suppression, '{}'::jsonb) || jsonb_build_object(v_type, v_entry),
      suppression_history = jsonb_build_array(v_history_entry) || coalesce(v_contact.suppression_history, '[]'::jsonb),
      lifecycle_status = case when v_permanent_email then 'suppressed' else lifecycle_status end,
      lifecycle_changed_at = case when v_permanent_email then v_now else lifecycle_changed_at end,
      updated_at = v_now
  where id = v_contact.id
  returning * into v_contact;

  -- Provider webhooks may be processing an event for an older recipient address
  -- after the customer card email changed. Only those trusted server callers may
  -- override the card's current email identity through the notes field.
  if p_added_by in ('Brevo webhook', 'SMTP2GO webhook', 'SendGrid webhook') then
    v_note_email := substring(coalesce(p_notes, '') from 'email:([^[:space:]]+)');
    v_recipient_text := substring(coalesce(p_notes, '') from 'recipient:([0-9a-fA-F-]{36})');
    if v_recipient_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_recipient_id := v_recipient_text::uuid;
    end if;
    if v_note_email is not null
      and lower(trim(v_note_email)) !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      v_note_email := null;
    end if;
    if v_note_email is not null
      and not exists (
        select 1
        from public.marketing_email_send_recipients recipient
        where recipient.id = v_recipient_id
          and recipient.customer_id = v_contact.customer_id
          and lower(trim(recipient.email)) = lower(trim(v_note_email))
      ) then
      v_note_email := null;
    end if;
  end if;
  v_identity_email := nullif(lower(trim(coalesce(nullif(v_note_email, ''), v_contact.email_normalized, v_contact.email))), '');
  if v_permanent_email and v_identity_email is not null then
    v_campaign_text := substring(coalesce(p_notes, '') from 'campaign:([0-9a-fA-F-]{36})');
    if v_campaign_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_campaign_id := v_campaign_text::uuid;
    end if;

    insert into public.marketing_suppression_identities (
      email_normalized, suppression_type, reason, provider, campaign_id, contact_id, suppressed_at, metadata
    ) values (
      v_identity_email,
      v_type,
      left(trim(coalesce(nullif(p_reason, ''), v_type)), 500),
      left(trim(coalesce(nullif(p_added_by, ''), 'Marketing CRM')), 500),
      v_campaign_id,
      v_contact.id,
      v_now,
      jsonb_build_object('notes', left(trim(coalesce(p_notes, '')), 500))
    )
    on conflict (email_normalized) do update
      set suppression_type = excluded.suppression_type,
          reason = excluded.reason,
          provider = excluded.provider,
          campaign_id = coalesce(excluded.campaign_id, marketing_suppression_identities.campaign_id),
          contact_id = coalesce(marketing_suppression_identities.contact_id, excluded.contact_id),
          suppressed_at = greatest(marketing_suppression_identities.suppressed_at, excluded.suppressed_at),
          metadata = marketing_suppression_identities.metadata || excluded.metadata;
  end if;

  return next v_contact;
end;
$$;

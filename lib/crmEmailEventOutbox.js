import { buildApplicationReceivedCrmEvent, sendCrmEmailEvent } from './applicationReceivedEventForwarder.js';

const TABLE = 'marketing_crm_email_event_outbox';

export async function enqueueCrmEmailEvent(supabase, payload, event) {
  const callback = buildApplicationReceivedCrmEvent(payload, event);
  if (!callback?.provider_event_id || !callback.provider_message_id) return false;
  const { error } = await supabase.from(TABLE).upsert({
    event_key: callback.provider_event_id, payload: callback,
  }, { onConflict: 'event_key', ignoreDuplicates: true });
  if (error) throw error;
  return true;
}

export async function dispatchCrmEmailEvent(supabase, options, eventKey = null) {
  const claimed = await supabase.rpc('marketing_claim_crm_email_event', { p_event_key: eventKey });
  if (claimed.error) throw claimed.error;
  const event = claimed.data?.[0];
  if (!event) return null;
  const delivery = await sendCrmEmailEvent(event.payload, options);
  const delay = Math.min(60, 2 ** (event.attempts - 1));
  const update = delivery.forwarded
    ? { status: 'complete', payload: {}, claim_id: null, last_error: null }
    : {
      status: event.attempts >= 12 ? 'needs_review' : 'pending',
      claim_id: null, last_error: delivery.reason,
      due_at: new Date(Date.now() + delay * 60000).toISOString(),
    };
  const { error } = await supabase.from(TABLE).update(update)
    .eq('event_key', event.event_key).eq('claim_id', event.claim_id);
  if (error) throw error;
  return delivery;
}

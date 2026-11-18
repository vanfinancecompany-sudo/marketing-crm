import { createHash } from 'node:crypto';

const TABLE = 'marketing_crm_contact_receipts';
const KEY = /^crm-intake-[1-9][0-9]{0,19}$/;

function fingerprint(values) {
  const canonical = JSON.stringify(values, (_key, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]))
      : value);
  return createHash('sha256').update(canonical).digest('hex');
}

export async function processCrmContactReceipt(supabase, key, values, apply) {
  if (!KEY.test(key)) return { status: 400, body: { ok: false, message: 'Invalid CRM delivery key.' } };
  const hash = fingerprint(values);
  const claim = await supabase.from(TABLE).upsert({ delivery_key: key, fingerprint: hash }, {
    onConflict: 'delivery_key', ignoreDuplicates: true
  }).select('delivery_key').maybeSingle();
  if (claim.error) throw claim.error;
  if (!claim.data) {
    const saved = await supabase.from(TABLE).select('fingerprint,receipt,created_at').eq('delivery_key', key).single();
    if (saved.error) throw saved.error;
    if (saved.data.fingerprint !== hash) {
      return { status: 409, body: { ok: false, message: 'CRM delivery key is already in use.' } };
    }
    if (saved.data.receipt) return { status: 200, body: { ok: true, ...saved.data.receipt } };
    const active = Date.now() - Date.parse(saved.data.created_at) < 120000;
    return { status: active ? 425 : 503, body: { ok: false, message: active
      ? 'CRM contact update is processing.' : 'CRM contact update requires reconciliation.' } };
  }

  // A crash after the contact write can leave this receipt pending. Never
  // repeat that write without reconciliation because the write may have committed.
  const result = await apply();
  const receipt = { mode: result.mode, eventType: result.eventType };
  const saved = await supabase.from(TABLE).update({ receipt }).eq('delivery_key', key).select('delivery_key').single();
  if (saved.error) throw saved.error;
  return { status: 200, body: { ok: true, ...receipt } };
}

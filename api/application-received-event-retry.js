import { timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { dispatchCrmEmailEvent } from '../lib/crmEmailEventOutbox.js';

function authorized(req) {
  const expected = Buffer.from(process.env.CRON_SECRET || '');
  const supplied = Buffer.from(String(req.headers?.authorization || '').replace(/^Bearer /, ''));
  return expected.length > 0 && expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method !== 'GET') return res.status(405).json({ ok: false });
  if (!authorized(req)) return res.status(401).json({ ok: false });
  if (process.env.CRM_EMAIL_EVENT_RETRY_ENABLED !== 'true') return res.status(503).json({ ok: false });
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false }
    });
    const options = {
      endpoint: process.env.MAIN_CRM_APPLICATION_EMAIL_EVENT_URL || undefined,
      apiKey: process.env.MARKETING_CUSTOMER_DATABASE_API_KEY,
    };
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => dispatchCrmEmailEvent(supabase, options)));
    const errors = results.filter(result => result.status === 'rejected').length;
    const forwarded = results.filter(result => result.value?.forwarded).length;
    const retrying = results.filter(result => result.value && !result.value.forwarded).length;
    return res.status(errors ? 503 : 200).json({ ok: errors === 0, forwarded, retrying, errors });
  } catch {
    return res.status(503).json({ ok: false });
  }
}

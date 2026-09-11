import { getSupabaseServiceAdmin, isMissingSupabaseObjectError } from './_vansco-cache-utils.js';

const ALLOWED_ORIGINS = new Set([
  'https://www.vanfinancecompany.co.uk',
  'https://vanfinancecompany.co.uk',
  'https://vanfinance.co',
  'https://www.vanfinance.co',
]);
const SITE_ORIGIN = 'https://www.vanfinancecompany.co.uk';
const EVENTS = new Set([
  'finance_application_reached',
  'finance_application_step_viewed',
  'finance_application_step_blocked',
  'finance_application_completed',
]);
const STEP_NAMES = new Set([
  'Application type',
  'Company',
  'About you',
  'Address history',
  'Work & income',
  'Part exchange',
  'How you found us',
  'Bank & consent',
]);
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 120;
const buckets = new Map();

function cleanId(value) {
  const id = String(value || '').trim();
  return /^[a-zA-Z0-9-]{16,100}$/.test(id) ? id : '';
}

function cleanEventId(value) {
  const id = String(value || '').trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id) ? id : '';
}

function cleanEnum(value, values) {
  const text = String(value || '').toLowerCase();
  return values.has(text) ? text : null;
}

function cleanAttribution(value, limit = 120) {
  const text = String(value || '').trim().slice(0, limit);
  if (!text || /@|%40|(?:\d[\s+().-]*){8,}/i.test(text)) return null;
  return text.replace(/[^a-z0-9._ /:-]/gi, '').trim() || null;
}

function cleanStep(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 10 ? number : null;
}

function cleanReferrer(value) {
  try {
    return new URL(String(value || '')).origin.slice(0, 300);
  } catch {
    return null;
  }
}

function rateLimited(key, now = Date.now()) {
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.startedAt >= RATE_WINDOW_MS) {
    buckets.set(key, { startedAt: now, count: 1 });
    if (buckets.size > 5000) {
      for (const [entry, item] of buckets) {
        if (now - item.startedAt > RATE_WINDOW_MS) buckets.delete(entry);
      }
    }
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT;
}

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.end(JSON.stringify(payload));
}

function setCors(request, response) {
  const origin = String(request.headers?.origin || '').replace(/\/$/, '');
  const allowed = ALLOWED_ORIGINS.has(origin) || (process.env.NODE_ENV !== 'production' && /^http:\/\/localhost(?::\d+)?$/.test(origin));
  if (allowed) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
  }
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Access-Control-Max-Age', '86400');
  return allowed;
}

function sanitize(body = {}) {
  const eventName = String(body.eventName || '').trim();
  const sessionId = cleanId(body.sessionId);
  const visitorId = cleanId(body.visitorId);
  const eventId = cleanEventId(body.eventId);
  if (!EVENTS.has(eventName) || !sessionId || !visitorId || !eventId) return null;

  const step = cleanStep(body.step);
  const totalSteps = cleanStep(body.totalSteps);
  const requestedStepName = String(body.stepName || '').trim();
  const stepName = STEP_NAMES.has(requestedStepName) ? requestedStepName : null;
  if ((eventName === 'finance_application_step_viewed' || eventName === 'finance_application_step_blocked') && (!step || !totalSteps || !stepName)) return null;

  const viewport = Number(body.viewportWidth);
  return {
    eventName,
    eventId,
    sessionId,
    visitorId,
    step,
    totalSteps,
    stepName,
    source: cleanAttribution(body.source),
    utmSource: cleanAttribution(body.utmSource),
    utmMedium: cleanAttribution(body.utmMedium),
    utmCampaign: cleanAttribution(body.utmCampaign, 160),
    referrer: cleanReferrer(body.referrer),
    deviceCategory: cleanEnum(body.deviceCategory, new Set(['desktop', 'mobile', 'tablet', 'unknown'])),
    browserCategory: cleanEnum(body.browserCategory, new Set(['chrome', 'safari', 'firefox', 'edge', 'other', 'unknown'])),
    viewportWidth: Number.isInteger(viewport) && viewport >= 0 && viewport <= 10000 ? viewport : null,
  };
}

export default async function handler(request, response) {
  const allowed = setCors(request, response);
  if (request.method === 'OPTIONS') {
    response.statusCode = allowed ? 204 : 403;
    response.end();
    return;
  }
  if (!allowed) return sendJson(response, 403, { ok: false, message: 'Origin not allowed.' });
  if (request.method !== 'POST') return sendJson(response, 405, { ok: false, message: 'Method not allowed.' });

  try {
    const payload = sanitize(request.body || {});
    if (!payload) return sendJson(response, 400, { ok: false, message: 'Invalid funnel event.' });
    if (rateLimited(payload.sessionId)) return sendJson(response, 429, { ok: false, message: 'Rate limit exceeded.' });

    const supabase = getSupabaseServiceAdmin();
    const rpc = await supabase.rpc('ingest_site_analytics_event', {
      p_event_id: payload.eventId,
      p_session_id: payload.sessionId,
      p_visitor_id: payload.visitorId,
      p_event_name: payload.eventName,
      p_occurred_at: new Date().toISOString(),
      p_path: '/apply',
      p_page_url: 'https://www.vanfinancecompany.co.uk/apply',
      p_landing_path: '/apply',
      p_site_origin: SITE_ORIGIN,
      p_referrer: payload.referrer,
      p_source: payload.source,
      p_utm_source: payload.utmSource,
      p_utm_medium: payload.utmMedium,
      p_utm_campaign: payload.utmCampaign,
      p_device_category: payload.deviceCategory,
      p_browser_category: payload.browserCategory,
      p_viewport_width: payload.viewportWidth,
      p_vehicle_registration: null,
      p_metadata: {
        product: 'finance',
        interaction: 'form',
        ...(payload.step ? { step: payload.step } : {}),
        ...(payload.totalSteps ? { total_steps: payload.totalSteps } : {}),
        ...(payload.stepName ? { step_name: payload.stepName } : {}),
      },
    });
    const missing = Boolean(rpc.error && isMissingSupabaseObjectError(rpc.error));
    if (rpc.error && !missing) throw rpc.error;
    return sendJson(response, 200, { ok: true, accepted: !missing, skipped: missing || undefined });
  } catch {
    return sendJson(response, 500, { ok: false, message: 'Funnel event was not accepted.' });
  }
}

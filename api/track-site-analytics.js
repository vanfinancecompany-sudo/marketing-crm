import { getSupabaseServiceAdmin, isMissingOptionalTableError, isMissingSupabaseObjectError, normalizeRegistration } from './_vansco-cache-utils.js';
import { ANALYTICS_SITE_ORIGINS, canonicalAnalyticsSiteOrigin } from '../lib/analyticsSiteOrigins.js';

export const ANALYTICS_EVENTS = new Set([
  'session_start', 'session_activity', 'session_end', 'page_view', 'engagement', 'vehicle_view',
  'finance_application_reached', 'finance_application_completed',
  'rent2buy_postcode_gate_reached', 'rent2buy_postcode_pass', 'rent2buy_postcode_fail',
  'rent2buy_full_application_opened', 'rent2buy_application_completed',
  'part_exchange_started', 'part_exchange_completed',
]);

const DEFAULT_ORIGINS = new Set([
  'https://www.vanfinancecompany.co.uk',
  'https://vanfinancecompany.co.uk',
  'https://www.rent2buyvans.co.uk',
  'https://rent2buyvans.co.uk',
]);
const DEFAULT_PAGE_ORIGIN = ANALYTICS_SITE_ORIGINS.vfc;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 120;
const IP_RATE_LIMIT = 300;
const MAX_BODY_BYTES = 16 * 1024;
const rateBuckets = new Map();

function clean(value, limit = 200) {
  const text = String(value || '').trim();
  return text ? text.slice(0, limit) : null;
}

function cleanPath(value) {
  const text = clean(value, 500) || '/';
  if (!text.startsWith('/') || /[\r\n]/.test(text)) return '/';
  return text.split(/[?#]/)[0] || '/';
}

function cleanOrigin(value) {
  const origin = String(value || '').trim().replace(/\/$/, '');
  return allowedOrigins().has(origin) ? origin : DEFAULT_PAGE_ORIGIN;
}

function cleanPageUrl(value, path, requestOrigin = '') {
  const origin = cleanOrigin(requestOrigin);
  let pagePath = path;
  try { if (value) pagePath = new URL(String(value), origin).pathname; } catch {}
  return `${origin}${cleanPath(pagePath)}`.slice(0, 800);
}

function cleanId(value) {
  const id = String(value || '').trim();
  return /^[a-zA-Z0-9-]{16,100}$/.test(id) ? id : '';
}

function cleanEventId(value) {
  const id = String(value || '').trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id) ? id : '';
}

function cleanOccurredAt(value, now = Date.now()) {
  const parsed = new Date(value || now);
  if (!Number.isFinite(parsed.getTime())) return new Date(now).toISOString();
  const bounded = Math.min(now + 5 * 60_000, Math.max(now - 24 * 60 * 60_000, parsed.getTime()));
  return new Date(bounded).toISOString();
}

function cleanEnum(value, allowed) {
  const text = String(value || '').toLowerCase();
  return allowed.has(text) ? text : null;
}

function cleanReferrer(value) {
  try {
    return new URL(String(value || '')).origin.slice(0, 300);
  } catch {
    return null;
  }
}

function cleanAttribution(value, limit) {
  const text = clean(value, limit);
  if (!text || /@|%40|(?:\d[\s+().-]*){8,}/i.test(text)) return null;
  return text.replace(/[^a-z0-9._ /:-]/gi, '').trim() || null;
}

export function sanitizeAnalyticsPayload(body = {}, now = Date.now(), requestOrigin = '') {
  const eventName = String(body.eventName || '').trim();
  const sessionId = cleanId(body.sessionId);
  const visitorId = cleanId(body.visitorId);
  const eventId = cleanEventId(body.eventId);
  if (!ANALYTICS_EVENTS.has(eventName) || !sessionId || !visitorId || !eventId) return null;
  const path = cleanPath(body.path);
  const viewport = Number(body.viewportWidth);
  const metadata = {};
  const product = cleanEnum(body.metadata?.product, new Set(['finance', 'rent2buy', 'part_exchange']));
  if (product) metadata.product = product;
  const interaction = cleanEnum(body.metadata?.interaction, new Set(['timer', 'scroll', 'form', 'route']));
  if (interaction) metadata.interaction = interaction;
  return {
    eventId,
    sessionId,
    visitorId,
    eventName,
    occurredAt: cleanOccurredAt(body.occurredAt, now),
    path,
    pageUrl: cleanPageUrl(body.pageUrl, path, requestOrigin),
    landingPath: cleanPath(body.landingPath),
    siteOrigin: canonicalAnalyticsSiteOrigin(requestOrigin),
    referrer: cleanReferrer(body.referrer),
    source: cleanAttribution(body.source, 120),
    utmSource: cleanAttribution(body.utmSource, 120),
    utmMedium: cleanAttribution(body.utmMedium, 120),
    utmCampaign: cleanAttribution(body.utmCampaign, 160),
    deviceCategory: cleanEnum(body.deviceCategory, new Set(['desktop', 'mobile', 'tablet', 'unknown'])),
    browserCategory: cleanEnum(body.browserCategory, new Set(['chrome', 'safari', 'firefox', 'edge', 'other', 'unknown'])),
    viewportWidth: Number.isInteger(viewport) && viewport >= 0 && viewport <= 10000 ? viewport : null,
    vehicleRegistration: body.vehicleRegistration ? normalizeRegistration(body.vehicleRegistration) || null : null,
    metadata,
  };
}

export function allowedOrigins(envValue = process.env.VFC_ANALYTICS_ALLOWED_ORIGINS) {
  const values = new Set(DEFAULT_ORIGINS);
  for (const origin of String(envValue || '').split(',')) {
    const value = origin.trim().replace(/\/$/, '');
    if (/^https?:\/\//i.test(value)) values.add(value);
  }
  if (process.env.NODE_ENV !== 'production') {
    values.add('http://localhost:3000');
    values.add('http://127.0.0.1:3000');
  }
  return values;
}

function setCors(request, response) {
  const origin = String(request.headers?.origin || '').replace(/\/$/, '');
  const allowed = !origin || allowedOrigins().has(origin);
  if (origin && allowed) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
  }
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Access-Control-Max-Age', '86400');
  return allowed;
}

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.end(JSON.stringify(payload));
}

async function readBody(request) {
  if (request.body && typeof request.body === 'object') return request.body;
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += value.length;
    if (bytes > MAX_BODY_BYTES) throw Object.assign(new Error('Payload too large.'), { status: 413 });
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw Object.assign(new Error('Invalid JSON.'), { status: 400 }); }
}

function clientIp(request) {
  const forwarded = String(request.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || request.socket?.remoteAddress || 'unknown';
}

export function rateLimited(key, now = Date.now(), limit = RATE_LIMIT) {
  const bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.startedAt >= RATE_WINDOW_MS) {
    rateBuckets.set(key, { startedAt: now, count: 1 });
    if (rateBuckets.size > 5000) for (const [entry, value] of rateBuckets) if (now - value.startedAt > RATE_WINDOW_MS) rateBuckets.delete(entry);
    return false;
  }
  bucket.count += 1;
  return bucket.count > limit;
}

export function shouldUpdateLegacyAnalytics(payload) {
  return payload?.siteOrigin === ANALYTICS_SITE_ORIGINS.vfc;
}

async function updateExistingAnalytics(supabase, payload) {
  if (!shouldUpdateLegacyAnalytics(payload)) return;
  const now = payload.occurredAt;
  const live = await supabase.from('site_live_sessions').upsert({
    session_id: payload.sessionId,
    last_seen_at: now,
  }, { onConflict: 'session_id' });
  if (live.error && !isMissingOptionalTableError(live.error)) throw live.error;

  if (payload.eventName === 'vehicle_view' && payload.vehicleRegistration) {
    const view = await supabase.from('vehicle_views').insert({
      registration: payload.vehicleRegistration,
    });
    if (view.error && !isMissingOptionalTableError(view.error)) throw view.error;
  }
}

export default async function handler(request, response) {
  const originAllowed = setCors(request, response);
  if (request.method === 'OPTIONS') {
    response.statusCode = originAllowed ? 204 : 403;
    response.end();
    return;
  }
  if (!originAllowed) return sendJson(response, 403, { ok: false, message: 'Origin not allowed.' });
  if (request.method !== 'POST') return sendJson(response, 405, { ok: false, message: 'Method not allowed.' });

  try {
    const requestOrigin = String(request.headers?.origin || '').replace(/\/$/, '');
    const payload = sanitizeAnalyticsPayload(await readBody(request), Date.now(), requestOrigin);
    if (!payload) return sendJson(response, 400, { ok: false, message: 'Invalid analytics event.' });
    const ip = clientIp(request);
    if (rateLimited(`ip:${ip}`, Date.now(), IP_RATE_LIMIT) || rateLimited(`session:${ip}:${payload.sessionId}`)) {
      return sendJson(response, 429, { ok: false, message: 'Rate limit exceeded.' });
    }

    const supabase = getSupabaseServiceAdmin();
    const rpc = await supabase.rpc('ingest_site_analytics_event', {
      p_event_id: payload.eventId,
      p_session_id: payload.sessionId,
      p_visitor_id: payload.visitorId,
      p_event_name: payload.eventName,
      p_occurred_at: payload.occurredAt,
      p_path: payload.path,
      p_page_url: payload.pageUrl,
      p_landing_path: payload.landingPath,
      p_site_origin: payload.siteOrigin,
      p_referrer: payload.referrer,
      p_source: payload.source,
      p_utm_source: payload.utmSource,
      p_utm_medium: payload.utmMedium,
      p_utm_campaign: payload.utmCampaign,
      p_device_category: payload.deviceCategory,
      p_browser_category: payload.browserCategory,
      p_viewport_width: payload.viewportWidth,
      p_vehicle_registration: payload.vehicleRegistration,
      p_metadata: payload.metadata,
    });
    const analyticsMissing = Boolean(rpc.error && isMissingSupabaseObjectError(rpc.error));
    if (rpc.error && !analyticsMissing) throw rpc.error;
    await updateExistingAnalytics(supabase, payload);
    return sendJson(response, 200, { ok: true, accepted: !analyticsMissing, skipped: analyticsMissing || undefined });
  } catch (error) {
    return sendJson(response, error.status || 500, { ok: false, message: error.status ? error.message : 'Analytics event was not accepted.' });
  }
}

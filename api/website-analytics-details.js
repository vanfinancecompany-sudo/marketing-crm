import { addDays, londonDateKey, londonMidnightUtcIso } from './website-analytics-summary.js';
import { getSupabaseServiceAdmin } from './_vansco-cache-utils.js';
import {
  ANALYTICS_CUTOVER_DATE,
  loadFirstPartyPeriod,
  mergeDetails,
  mergeFunnels,
  sourceForSegments,
  splitAnalyticsRange,
} from './_first-party-analytics.js';

const TRAFFIC_MODEL_ID = 'cad7fd34-2c8b-4dda-8296-3f9d47fb484d';
const USER_FLOW_MODEL_ID = '239e36da-d6a4-425b-9a7e-7955f8805889';
const FORMS_MODEL_ID = '88cf0797-ea27-43e2-9901-3080deca1d66';
const WIX_ANALYTICS_QUERY_URL = 'https://www.wixapis.com/analytics/semantic-model/v3/semantic-models/query-data';
const TIME_ZONE = 'Europe/London';

function clean(value, limit = 10000) {
  return String(value || '').trim().slice(0, limit);
}

function fieldValue(row, name) {
  const value = row?.fields?.[name];
  if (!value) return null;
  if (typeof value.numericValue === 'number') return value.numericValue;
  if (typeof value.stringValue === 'string') return value.stringValue;
  if (typeof value.booleanValue === 'boolean') return value.booleanValue;
  if (value.timestampValue) return value.timestampValue;
  return null;
}

function resultRows(payload = {}) {
  return Array.isArray(payload?.results) ? payload.results : [];
}

async function queryAnalytics({ apiKey, siteId, modelId, startDate, endDate, fields, filters, sort, limit = 20, totalsIncluded = false }) {
  const body = {
    semanticModelId: modelId,
    interval: {
      start: londonMidnightUtcIso(startDate),
      end: londonMidnightUtcIso(endDate),
      timezone: TIME_ZONE,
    },
    fields,
    formattingEnabled: false,
    totalsIncluded,
    paging: { limit, offset: 0 },
  };
  if (filters) body.filters = filters;
  if (sort) body.sort = { ...sort, nullsLast: true };

  const wixResponse = await fetch(WIX_ANALYTICS_QUERY_URL, {
    method: 'POST',
    headers: {
      Authorization: apiKey,
      'wix-site-id': siteId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const payload = await wixResponse.json().catch(() => ({}));
  if (!wixResponse.ok) {
    const message = clean(payload?.message || payload?.details?.applicationError?.description || 'Wix analytics request failed.', 500);
    const error = new Error(message);
    error.status = wixResponse.status;
    throw error;
  }
  return payload;
}

function mapPages(payload = {}) {
  return resultRows(payload).map((row) => ({
    url: fieldValue(row, 'traffic.page_url_from'),
    views: fieldValue(row, 'traffic.views_count'),
    exitRate: fieldValue(row, 'traffic.exit_ratio'),
    avgTimeSeconds: fieldValue(row, 'traffic.page_time_seconds_avg'),
    bounceRate: fieldValue(row, 'traffic.page_bounce_ratio'),
  }));
}

function mapLandingPages(payload = {}) {
  return resultRows(payload).map((row) => ({
    url: fieldValue(row, 'traffic.page_url_from'),
    sessions: fieldValue(row, 'traffic.sessions_count'),
    bounceRate: fieldValue(row, 'traffic.page_bounce_ratio'),
  }));
}

function mapExitPages(exitPayload = {}, pageRatePayload = {}) {
  const rateByUrl = new Map(resultRows(pageRatePayload).map((row) => [
    fieldValue(row, 'traffic.page_url_from'),
    fieldValue(row, 'traffic.exit_ratio'),
  ]));
  return resultRows(exitPayload).map((row) => {
    const url = fieldValue(row, 'traffic.page_url_from');
    return {
      url,
      sessions: fieldValue(row, 'traffic.sessions_count'),
      exitRate: rateByUrl.get(url) ?? null,
    };
  });
}

function mapDevices(payload = {}) {
  return resultRows(payload).map((row) => ({
    device: fieldValue(row, 'traffic.device_type'),
    sessions: fieldValue(row, 'traffic.sessions_count'),
    visitors: fieldValue(row, 'traffic.visitors_count'),
    bounceRate: fieldValue(row, 'traffic.site_bounce_ratio'),
  }));
}

function mapSources(payload = {}) {
  return resultRows(payload).map((row) => {
    const category = fieldValue(row, 'traffic.referrer_category_name');
    const sourceName = fieldValue(row, 'traffic.referrer_source_name');
    return {
      source: [category, sourceName].filter(Boolean).join(' · ') || 'Direct / unknown',
      sessions: fieldValue(row, 'traffic.sessions_count'),
      visitors: fieldValue(row, 'traffic.visitors_count'),
      bounceRate: fieldValue(row, 'traffic.site_bounce_ratio'),
    };
  });
}

function mapFlows(payload = {}) {
  return resultRows(payload).map((row) => ({
    entry: fieldValue(row, 'traffic.entry_page'),
    first: fieldValue(row, 'traffic.first_interaction'),
    second: fieldValue(row, 'traffic.second_interaction'),
    third: fieldValue(row, 'traffic.third_interaction'),
    fourth: fieldValue(row, 'traffic.forth_interaction'),
    sessions: fieldValue(row, 'traffic.sessions_count'),
  }));
}

function mapForms(payload = {}) {
  return resultRows(payload).map((row) => ({
    name: fieldValue(row, 'forms_actions.form_name'),
    url: fieldValue(row, 'forms_actions.form_url'),
    views: fieldValue(row, 'forms_actions.form_views_count'),
    starts: fieldValue(row, 'forms_actions.form_started_count'),
    submissions: fieldValue(row, 'forms_actions.form_submissions_count'),
    completionRate: fieldValue(row, 'forms_actions.form_completion_ratio'),
  }));
}

async function optionalQuery(loader) {
  try {
    return { ok: true, payload: await loader(), error: '' };
  } catch (error) {
    return { ok: false, payload: { results: [] }, error: clean(error?.message || 'Unavailable', 300) };
  }
}

async function loadCurrentDetails({ apiKey, siteId, startDate, endDate }) {
  const common = { apiKey, siteId, startDate, endDate };
  const [pagesPayload, landingPayload, exitPayload, pageRatesPayload, devicePayload, sourcePayload, flowsResult, formsResult] = await Promise.all([
    queryAnalytics({ ...common, modelId: TRAFFIC_MODEL_ID, fields: ['traffic.page_url_from', 'traffic.views_count', 'traffic.exit_ratio', 'traffic.page_time_seconds_avg', 'traffic.page_bounce_ratio'], sort: { fieldName: 'traffic.views_count', order: 'DESC' }, limit: 20 }),
    queryAnalytics({ ...common, modelId: TRAFFIC_MODEL_ID, fields: ['traffic.page_url_from', 'traffic.sessions_count', 'traffic.page_bounce_ratio'], filters: [{ field: 'traffic.landing_page_flag', values: ['true'], prefix: 'IS', condition: 'EQUAL' }], sort: { fieldName: 'traffic.sessions_count', order: 'DESC' }, limit: 20 }),
    queryAnalytics({ ...common, modelId: TRAFFIC_MODEL_ID, fields: ['traffic.page_url_from', 'traffic.sessions_count'], filters: [{ field: 'traffic.last_page_in_session_flag', values: ['true'], prefix: 'IS', condition: 'EQUAL' }], sort: { fieldName: 'traffic.sessions_count', order: 'DESC' }, limit: 20 }),
    queryAnalytics({ ...common, modelId: TRAFFIC_MODEL_ID, fields: ['traffic.page_url_from', 'traffic.sessions_count', 'traffic.exit_ratio'], sort: { fieldName: 'traffic.sessions_count', order: 'DESC' }, limit: 500 }),
    queryAnalytics({ ...common, modelId: TRAFFIC_MODEL_ID, fields: ['traffic.device_type', 'traffic.sessions_count', 'traffic.visitors_count', 'traffic.site_bounce_ratio'], sort: { fieldName: 'traffic.sessions_count', order: 'DESC' }, limit: 10 }),
    queryAnalytics({ ...common, modelId: TRAFFIC_MODEL_ID, fields: ['traffic.referrer_category_name', 'traffic.referrer_source_name', 'traffic.sessions_count', 'traffic.visitors_count', 'traffic.site_bounce_ratio'], sort: { fieldName: 'traffic.sessions_count', order: 'DESC' }, limit: 20 }),
    optionalQuery(() => queryAnalytics({ ...common, modelId: USER_FLOW_MODEL_ID, fields: ['traffic.entry_page', 'traffic.first_interaction', 'traffic.second_interaction', 'traffic.third_interaction', 'traffic.forth_interaction', 'traffic.sessions_count'], sort: { fieldName: 'traffic.sessions_count', order: 'DESC' }, limit: 20 })),
    optionalQuery(() => queryAnalytics({ ...common, modelId: FORMS_MODEL_ID, fields: ['forms_actions.form_name', 'forms_actions.form_url', 'forms_actions.form_views_count', 'forms_actions.form_started_count', 'forms_actions.form_submissions_count', 'forms_actions.form_completion_ratio'], sort: { fieldName: 'forms_actions.form_views_count', order: 'DESC' }, limit: 20 })),
  ]);

  return {
    pages: mapPages(pagesPayload),
    landingPages: mapLandingPages(landingPayload),
    exitPages: mapExitPages(exitPayload, pageRatesPayload),
    devices: mapDevices(devicePayload),
    sources: mapSources(sourcePayload),
    userFlows: mapFlows(flowsResult.payload),
    forms: mapForms(formsResult.payload),
    sectionStatus: {
      userFlows: flowsResult.ok ? 'ok' : 'error',
      forms: formsResult.ok ? 'ok' : 'error',
    },
  };
}

async function loadPreviousPages({ apiKey, siteId, startDate, endDate }) {
  const payload = await queryAnalytics({
    apiKey,
    siteId,
    modelId: TRAFFIC_MODEL_ID,
    startDate,
    endDate,
    fields: ['traffic.page_url_from', 'traffic.views_count', 'traffic.exit_ratio', 'traffic.page_time_seconds_avg', 'traffic.page_bounce_ratio'],
    sort: { fieldName: 'traffic.views_count', order: 'DESC' },
    limit: 20,
  });
  return mapPages(payload);
}

function aggregateFrom(payload = {}) {
  const row = payload?.totals || resultRows(payload)[0] || {};
  return {
    sessions: Number(fieldValue(row, 'traffic.sessions_count') || 0),
    visitors: Number(fieldValue(row, 'traffic.visitors_count') || 0),
  };
}

async function aggregateSessions({ apiKey, siteId, startDate, endDate, fragments }) {
  const payload = await queryAnalytics({
    apiKey,
    siteId,
    modelId: TRAFFIC_MODEL_ID,
    startDate,
    endDate,
    fields: ['traffic.sessions_count', 'traffic.visitors_count'],
    filters: [{ field: 'traffic.page_url_from', values: fragments, prefix: 'IS', condition: 'CONTAINS_ANY' }],
    totalsIncluded: true,
    limit: 5,
  });
  return aggregateFrom(payload);
}

async function loadFunnelPeriod({ apiKey, siteId, startDate, endDate }) {
  const common = { apiKey, siteId, startDate, endDate };
  const [financeReached, financeCompleted, rentGate] = await Promise.all([
    aggregateSessions({ ...common, fragments: ['/apply-by-reg-finance/', '/applynow'] }),
    aggregateSessions({ ...common, fragments: ['/finance-application-received'] }),
    aggregateSessions({ ...common, fragments: ['/rent2buy-application'] }),
  ]);
  return {
    finance: {
      reachedApplication: financeReached,
      completed: financeCompleted,
      completionRate: financeReached.sessions ? financeCompleted.sessions / financeReached.sessions : 0,
    },
    rent2buy: {
      reachedPostcodeGate: rentGate,
      postcodeSupplied: null,
      postcodePass: null,
      postcodeFail: null,
      fullApplicationOpened: null,
      completed: null,
      completionRate: null,
      note: 'Wix traffic analytics expose page paths, but not a reliable postcode query-state or Rent2Buy completion signal. Those stages are deliberately not claimed.',
    },
  };
}

async function loadDetailRange({ apiKey, siteId, startDate, endExclusive }) {
  const segments = splitAnalyticsRange(startDate, endExclusive);
  const needsWix = segments.some((segment) => segment.source === 'wix');
  const needsFirstParty = segments.some((segment) => segment.source === 'first_party');
  if (needsWix && (!apiKey || !siteId)) throw new Error('Wix analytics credentials are required for the historical portion of this date range.');
  const supabase = needsFirstParty ? getSupabaseServiceAdmin() : null;
  const periods = await Promise.all(segments.map(async (segment) => {
    if (segment.source === 'wix') {
      const [details, funnel] = await Promise.all([
        loadCurrentDetails({ apiKey, siteId, startDate: segment.startDate, endDate: segment.endExclusive }),
        loadFunnelPeriod({ apiKey, siteId, startDate: segment.startDate, endDate: segment.endExclusive }),
      ]);
      return { details, funnel };
    }
    return loadFirstPartyPeriod({ supabase, startDate: segment.startDate, endExclusive: segment.endExclusive });
  }));
  return {
    details: mergeDetails(periods.map((period) => period.details)),
    funnel: mergeFunnels(periods.map((period) => period.funnel)),
    segments,
    source: sourceForSegments(segments),
  };
}

export default async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ ok: false, message: 'Method not allowed.' });

  const apiKey = clean(process.env.WIX_API_KEY);
  const siteId = clean(process.env.WIX_SITE_ID, 500);

  const today = londonDateKey();
  const settledThrough = addDays(today, -1);
  const currentStart = addDays(settledThrough, -6);
  const previousStart = addDays(currentStart, -7);
  const previousEnd = addDays(currentStart, -1);

  try {
    const [currentPeriod, previousPeriod] = await Promise.all([
      loadDetailRange({ apiKey, siteId, startDate: currentStart, endExclusive: today }),
      loadDetailRange({ apiKey, siteId, startDate: previousStart, endExclusive: currentStart }),
    ]);
    const dashboardSource = sourceForSegments([...currentPeriod.segments, ...previousPeriod.segments]);

    response.setHeader('Cache-Control', 'no-store');
    return response.status(200).json({
      ok: true,
      settledThrough,
      cutoverDate: ANALYTICS_CUTOVER_DATE,
      source: dashboardSource,
      current: { startDate: currentStart, endDate: settledThrough, ...currentPeriod.details, source: currentPeriod.source, segments: currentPeriod.segments },
      previous: { startDate: previousStart, endDate: previousEnd, ...previousPeriod.details, source: previousPeriod.source, segments: previousPeriod.segments },
      funnel: {
        settledThrough,
        current: currentPeriod.funnel,
        previous: previousPeriod.funnel,
      },
    });
  } catch (error) {
    return response.status(error.status || 500).json({ ok: false, message: clean(error?.message || 'Website analytics detail request failed.', 500) });
  }
}

export { fieldValue, loadCurrentDetails, loadDetailRange, loadFunnelPeriod, mapExitPages, mapPages, resultRows };

import crypto from 'node:crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DATA_API_BASE = 'https://analyticsdata.googleapis.com/v1beta';
const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
const TIME_ZONE = 'Europe/London';
const SITES = [
  { key: 'vanFinance', label: 'Van Finance Company', propertyId: '553434975', propertyEnv: 'GA4_VFC_PROPERTY_ID' },
  { key: 'rent2buy', label: 'Rent2Buy Vans', propertyId: '553487068', propertyEnv: 'GA4_RENT2BUY_PROPERTY_ID' },
];
const APPLICATION_EVENTS = ['application_start', 'application_complete', 'generate_lead', 'proofs_received'];

function clean(value, limit = 10000) {
  return String(value || '').trim().slice(0, limit);
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizePrivateKey(value) {
  let raw = String(value || '').trim();
  if (!raw) return '';
  const begin = '-----BEGIN PRIVATE KEY-----';
  const end = '-----END PRIVATE KEY-----';
  const beginIndex = raw.indexOf(begin);
  const endIndex = raw.indexOf(end);
  if (beginIndex !== -1 && endIndex !== -1 && endIndex >= beginIndex) {
    raw = raw.slice(beginIndex, endIndex + end.length);
  } else if (raw.startsWith('"') && raw.endsWith('"')) {
    try { raw = JSON.parse(raw); } catch { raw = raw.slice(1, -1); }
  }
  return String(raw)
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '')
    .replace(/\r\n/g, '\n')
    .trim();
}

function propertyIdFor(site) {
  return clean(process.env[site.propertyEnv] || site.propertyId, 200).replace(/^properties\//, '');
}

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function buildJwt({ clientEmail, privateKey }) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = { iss: clientEmail, scope: SCOPE, aud: TOKEN_URL, exp: now + 3600, iat: now };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(privateKey);
  return `${unsigned}.${base64url(signature)}`;
}

async function getAccessToken() {
  const clientEmail = clean(process.env.GA4_SERVICE_ACCOUNT_EMAIL, 500);
  const privateKey = normalizePrivateKey(process.env.GA4_SERVICE_ACCOUNT_PRIVATE_KEY);
  if (!clientEmail || !privateKey) throw new Error('GA4 service account environment variables are not configured.');
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: buildJwt({ clientEmail, privateKey }),
  });
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(clean(payload?.error_description || payload?.error || 'Google OAuth token request failed.', 500));
  const token = clean(payload.access_token, 4000);
  if (!token) throw new Error('Google OAuth token response did not include an access token.');
  return token;
}

async function runReport({ accessToken, propertyId, body }) {
  const response = await fetch(`${DATA_API_BASE}/properties/${propertyId}:runReport`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(clean(payload?.error?.message || payload?.message || 'GA4 Data API request failed.', 500));
    error.status = response.status;
    throw error;
  }
  return payload;
}

function rowsByDimension(report) {
  const dimensionHeaders = (report.dimensionHeaders || []).map((item) => item.name);
  const metricHeaders = (report.metricHeaders || []).map((item) => item.name);
  return (report.rows || []).map((row) => ({
    dimensions: Object.fromEntries(dimensionHeaders.map((name, index) => [name, row.dimensionValues?.[index]?.value || ''])),
    metrics: Object.fromEntries(metricHeaders.map((name, index) => [name, number(row.metricValues?.[index]?.value)])),
  }));
}

function firstMetricRow(report) {
  return rowsByDimension(report)[0]?.metrics || {};
}

function londonDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days, 12)).toISOString().slice(0, 10);
}

function summaryFrom(report) {
  const metrics = firstMetricRow(report);
  const sessions = number(metrics.sessions);
  const pageViews = number(metrics.screenPageViews);
  return {
    sessions,
    activeUsers: number(metrics.activeUsers),
    pageViews,
    bounceRate: number(metrics.bounceRate),
    averageSessionDuration: number(metrics.averageSessionDuration),
    pagesPerSession: sessions ? pageViews / sessions : 0,
  };
}

function eventsFrom(report) {
  return Object.fromEntries(
    rowsByDimension(report).map((row) => [row.dimensions.eventName, number(row.metrics.eventCount)]),
  );
}

async function optionalReport(loader) {
  try {
    return { ok: true, report: await loader(), message: '' };
  } catch (error) {
    return { ok: false, report: { rows: [] }, message: clean(error?.message || 'GA4 section unavailable.', 300) };
  }
}

async function loadSite({ accessToken, site, currentStart, currentEnd, previousStart, previousEnd }) {
  const propertyId = propertyIdFor(site);
  const summaryMetrics = [
    { name: 'sessions' },
    { name: 'activeUsers' },
    { name: 'screenPageViews' },
    { name: 'bounceRate' },
    { name: 'averageSessionDuration' },
  ];
  const eventFilter = {
    filter: { fieldName: 'eventName', inListFilter: { values: APPLICATION_EVENTS } },
  };

  try {
    const [currentSummary, previousSummary, currentEvents, previousEvents, landingResult, pagesResult, sourcesResult, devicesResult] = await Promise.all([
      runReport({ accessToken, propertyId, body: { dateRanges: [{ startDate: currentStart, endDate: currentEnd }], metrics: summaryMetrics, keepEmptyRows: true } }),
      runReport({ accessToken, propertyId, body: { dateRanges: [{ startDate: previousStart, endDate: previousEnd }], metrics: summaryMetrics, keepEmptyRows: true } }),
      runReport({ accessToken, propertyId, body: { dateRanges: [{ startDate: currentStart, endDate: currentEnd }], dimensions: [{ name: 'eventName' }], metrics: [{ name: 'eventCount' }], dimensionFilter: eventFilter, keepEmptyRows: true } }),
      runReport({ accessToken, propertyId, body: { dateRanges: [{ startDate: previousStart, endDate: previousEnd }], dimensions: [{ name: 'eventName' }], metrics: [{ name: 'eventCount' }], dimensionFilter: eventFilter, keepEmptyRows: true } }),
      optionalReport(() => runReport({ accessToken, propertyId, body: {
        dateRanges: [{ startDate: currentStart, endDate: currentEnd }],
        dimensions: [{ name: 'landingPagePlusQueryString' }],
        metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'bounceRate' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 30,
      } })),
      optionalReport(() => runReport({ accessToken, propertyId, body: {
        dateRanges: [{ startDate: currentStart, endDate: currentEnd }],
        dimensions: [{ name: 'pagePath' }],
        metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }, { name: 'userEngagementDuration' }],
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }], limit: 30,
      } })),
      optionalReport(() => runReport({ accessToken, propertyId, body: {
        dateRanges: [{ startDate: currentStart, endDate: currentEnd }],
        dimensions: [{ name: 'sessionSourceMedium' }],
        metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'bounceRate' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 30,
      } })),
      optionalReport(() => runReport({ accessToken, propertyId, body: {
        dateRanges: [{ startDate: currentStart, endDate: currentEnd }],
        dimensions: [{ name: 'deviceCategory' }],
        metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'bounceRate' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 10,
      } })),
    ]);

    const currentEventMap = eventsFrom(currentEvents);
    const previousEventMap = eventsFrom(previousEvents);
    const mapEventSummary = (events) => {
      const starts = number(events.application_start);
      const completions = number(events.application_complete);
      return {
        applicationStarts: starts,
        applicationCompletions: completions,
        generateLead: number(events.generate_lead),
        proofsReceived: number(events.proofs_received),
        conversionRate: starts ? completions / starts : null,
      };
    };

    return {
      ...site,
      propertyId,
      configured: true,
      source: 'ga4',
      current: {
        summary: summaryFrom(currentSummary),
        events: mapEventSummary(currentEventMap),
        landingPages: rowsByDimension(landingResult.report).map((row) => ({
          path: row.dimensions.landingPagePlusQueryString || '/',
          sessions: number(row.metrics.sessions),
          activeUsers: number(row.metrics.activeUsers),
          bounceRate: number(row.metrics.bounceRate),
        })),
        pages: rowsByDimension(pagesResult.report).map((row) => {
          const activeUsers = number(row.metrics.activeUsers);
          const engagementSeconds = number(row.metrics.userEngagementDuration);
          return {
            path: row.dimensions.pagePath || '/',
            views: number(row.metrics.screenPageViews),
            activeUsers,
            avgEngagementSeconds: activeUsers ? engagementSeconds / activeUsers : 0,
          };
        }),
        sources: rowsByDimension(sourcesResult.report).map((row) => ({
          source: row.dimensions.sessionSourceMedium || 'Direct / unknown',
          sessions: number(row.metrics.sessions),
          activeUsers: number(row.metrics.activeUsers),
          bounceRate: number(row.metrics.bounceRate),
        })),
        devices: rowsByDimension(devicesResult.report).map((row) => ({
          device: row.dimensions.deviceCategory || 'unknown',
          sessions: number(row.metrics.sessions),
          activeUsers: number(row.metrics.activeUsers),
          bounceRate: number(row.metrics.bounceRate),
        })),
      },
      previous: {
        summary: summaryFrom(previousSummary),
        events: mapEventSummary(previousEventMap),
      },
      sectionStatus: {
        landingPages: landingResult.ok ? 'ok' : 'error',
        pages: pagesResult.ok ? 'ok' : 'error',
        sources: sourcesResult.ok ? 'ok' : 'error',
        devices: devicesResult.ok ? 'ok' : 'error',
      },
      sectionMessages: {
        landingPages: landingResult.message,
        pages: pagesResult.message,
        sources: sourcesResult.message,
        devices: devicesResult.message,
      },
    };
  } catch (error) {
    return {
      ...site,
      propertyId,
      configured: false,
      source: 'ga4',
      message: clean(error?.message || 'GA4 site report failed.', 500),
    };
  }
}

export default async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ ok: false, message: 'Method not allowed.' });
  response.setHeader('Cache-Control', 'no-store');

  const today = londonDateKey();
  const settledThrough = addDays(today, -1);
  const currentStart = addDays(settledThrough, -6);
  const previousStart = addDays(currentStart, -7);
  const previousEnd = addDays(currentStart, -1);

  try {
    const accessToken = await getAccessToken();
    const sites = await Promise.all(SITES.map((site) => loadSite({
      accessToken,
      site,
      currentStart,
      currentEnd: settledThrough,
      previousStart,
      previousEnd,
    })));
    return response.status(200).json({
      ok: true,
      configured: sites.some((site) => site.configured),
      source: 'ga4',
      settledThrough,
      current: { startDate: currentStart, endDate: settledThrough },
      previous: { startDate: previousStart, endDate: previousEnd },
      sites,
      checkedAt: new Date().toISOString(),
      note: 'Active users are property-specific; combined totals add the two properties and do not deduplicate a person who visits both websites.',
    });
  } catch (error) {
    return response.status(error.status || 500).json({
      ok: false,
      source: 'ga4',
      message: clean(error?.message || 'GA4 website analytics failed.', 500),
    });
  }
}

export { addDays, londonDateKey, summaryFrom };

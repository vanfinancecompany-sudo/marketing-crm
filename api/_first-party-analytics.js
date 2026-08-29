import { isMissingSupabaseObjectError } from './_vansco-cache-utils.js';

export const ANALYTICS_CUTOVER_DATE = '2026-08-29';
export const SESSION_TIMEOUT_SECONDS = 30 * 60;
export const SUMMARY_FIELDS = [
  'traffic.sessions_count',
  'traffic.visitors_count',
  'traffic.views_count',
  'traffic.site_bounce_ratio',
  'traffic.site_time_seconds_avg',
  'traffic.pages_per_session_avg',
];

const EMPTY_SUMMARY = Object.freeze(Object.fromEntries(SUMMARY_FIELDS.map((field) => [field, 0])));

export function londonBoundaryIso(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day, 12));
  const zonePart = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    timeZoneName: 'longOffset',
  }).formatToParts(probe).find((part) => part.type === 'timeZoneName')?.value || 'GMT';
  const match = zonePart.match(/GMT(?:(?<sign>[+-])(?<hours>\d{2}):(?<minutes>\d{2}))?/);
  const sign = match?.groups?.sign === '-' ? -1 : 1;
  const offsetMinutes = match?.groups?.hours ? sign * (Number(match.groups.hours) * 60 + Number(match.groups.minutes || 0)) : 0;
  return new Date(Date.UTC(year, month - 1, day) - offsetMinutes * 60_000).toISOString();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function durationSeconds(session) {
  const start = new Date(session.started_at).getTime();
  const end = new Date(session.last_activity_at || session.ended_at || session.started_at).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.min(SESSION_TIMEOUT_SECONDS, (end - start) / 1000));
}

function bounced(session) {
  return number(session.page_view_count) <= 1 && number(session.meaningful_event_count) === 0;
}

export function splitAnalyticsRange(startDate, endExclusive, cutoverDate = ANALYTICS_CUTOVER_DATE) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endExclusive) || startDate >= endExclusive) return [];
  if (endExclusive <= cutoverDate) return [{ source: 'wix', startDate, endExclusive }];
  if (startDate >= cutoverDate) return [{ source: 'first_party', startDate, endExclusive }];
  return [
    { source: 'wix', startDate, endExclusive: cutoverDate },
    { source: 'first_party', startDate: cutoverDate, endExclusive },
  ];
}

export function sourceForSegments(segments = []) {
  const sources = new Set(segments.map((segment) => segment.source));
  return sources.size > 1 ? 'mixed' : [...sources][0] || 'first_party';
}

export function summarizeFirstParty(sessions = [], events = []) {
  const sessionCount = sessions.length;
  const visitors = new Set(sessions.map((session) => session.visitor_id).filter(Boolean)).size;
  const pageViews = events.filter((event) => event.event_name === 'page_view').length;
  const bounces = sessions.filter(bounced).length;
  const duration = sessions.reduce((total, session) => total + durationSeconds(session), 0);
  return {
    'traffic.sessions_count': sessionCount,
    'traffic.visitors_count': visitors,
    'traffic.views_count': pageViews,
    'traffic.site_bounce_ratio': sessionCount ? bounces / sessionCount : 0,
    'traffic.site_time_seconds_avg': sessionCount ? duration / sessionCount : 0,
    'traffic.pages_per_session_avg': sessionCount ? pageViews / sessionCount : 0,
  };
}

export function combineSummaries(parts = []) {
  if (!parts.length) return { ...EMPTY_SUMMARY };
  const sessions = parts.reduce((sum, part) => sum + number(part['traffic.sessions_count']), 0);
  const visitors = parts.reduce((sum, part) => sum + number(part['traffic.visitors_count']), 0);
  const views = parts.reduce((sum, part) => sum + number(part['traffic.views_count']), 0);
  const weightedBounce = parts.reduce((sum, part) => sum + number(part['traffic.site_bounce_ratio']) * number(part['traffic.sessions_count']), 0);
  const weightedDuration = parts.reduce((sum, part) => sum + number(part['traffic.site_time_seconds_avg']) * number(part['traffic.sessions_count']), 0);
  return {
    'traffic.sessions_count': sessions,
    'traffic.visitors_count': visitors,
    'traffic.views_count': views,
    'traffic.site_bounce_ratio': sessions ? weightedBounce / sessions : 0,
    'traffic.site_time_seconds_avg': sessions ? weightedDuration / sessions : 0,
    'traffic.pages_per_session_avg': sessions ? views / sessions : 0,
  };
}

function stage(events, eventName) {
  const matching = events.filter((event) => event.event_name === eventName);
  return {
    sessions: new Set(matching.map((event) => event.session_id).filter(Boolean)).size,
    visitors: new Set(matching.map((event) => event.visitor_id).filter(Boolean)).size,
  };
}

export function buildFirstPartyFunnel(events = []) {
  const financeReached = stage(events, 'finance_application_reached');
  const financeCompleted = stage(events, 'finance_application_completed');
  const rentGate = stage(events, 'rent2buy_postcode_gate_reached');
  const rentPass = stage(events, 'rent2buy_postcode_pass');
  const rentFail = stage(events, 'rent2buy_postcode_fail');
  const rentOpened = stage(events, 'rent2buy_full_application_opened');
  const rentCompleted = stage(events, 'rent2buy_application_completed');
  return {
    finance: {
      reachedApplication: financeReached,
      completed: financeCompleted,
      completionRate: financeReached.sessions ? financeCompleted.sessions / financeReached.sessions : 0,
    },
    rent2buy: {
      reachedPostcodeGate: rentGate,
      postcodeSupplied: { sessions: rentPass.sessions + rentFail.sessions, visitors: rentPass.visitors + rentFail.visitors },
      postcodePass: rentPass,
      postcodeFail: rentFail,
      fullApplicationOpened: rentOpened,
      completed: rentCompleted,
      completionRate: rentOpened.sessions ? rentCompleted.sessions / rentOpened.sessions : 0,
      note: 'First-party explicit events; no stage is inferred from application answers.',
    },
  };
}

function aggregateRows(rows, keyOf, countOf, fields) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row) || 'Unknown';
    const current = groups.get(key) || { key, weight: 0, values: Object.fromEntries(fields.map((field) => [field, 0])) };
    const weight = Math.max(0, number(countOf(row)));
    current.weight += weight;
    for (const field of fields) current.values[field] += number(row[field]) * weight;
    groups.set(key, current);
  }
  return groups;
}

function pageKey(value) {
  try {
    const parsed = new URL(String(value), 'https://www.vanfinancecompany.co.uk');
    return parsed.pathname || '/';
  } catch { return String(value || 'Unknown'); }
}

function mergeRateRows(parts, arrayName, keyField, countField, rateFields, limit = 20) {
  const rows = parts.flatMap((part) => part?.[arrayName] || []);
  const groups = aggregateRows(rows, (row) => keyField === 'url' ? pageKey(row[keyField]) : row[keyField], (row) => row[countField], rateFields);
  return [...groups.values()].map((group) => ({
    [keyField]: group.key,
    [countField]: group.weight,
    ...Object.fromEntries(rateFields.map((field) => [field, group.weight ? group.values[field] / group.weight : 0])),
  })).sort((a, b) => number(b[countField]) - number(a[countField])).slice(0, limit);
}

function sessionEvents(events) {
  const groups = new Map();
  for (const event of events) {
    if (!groups.has(event.session_id)) groups.set(event.session_id, []);
    groups.get(event.session_id).push(event);
  }
  for (const rows of groups.values()) rows.sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at));
  return groups;
}

function pageDetails(sessions, events) {
  const sessionById = new Map(sessions.map((session) => [session.session_id, session]));
  const pageMap = new Map();
  const grouped = sessionEvents(events);
  for (const [sessionId, rows] of grouped) {
    const session = sessionById.get(sessionId);
    const pageViews = rows.filter((event) => event.event_name === 'page_view');
    for (let index = 0; index < pageViews.length; index += 1) {
      const event = pageViews[index];
      const url = event.path || event.page_url;
      const page = pageMap.get(url) || { url, views: 0, exits: 0, landingSessions: 0, landingBounces: 0, time: 0 };
      page.views += 1;
      if (event.path === session?.landing_path) {
        page.landingSessions += 1;
        if (session && bounced(session)) page.landingBounces += 1;
      }
      if (event.path === session?.last_path) page.exits += 1;
      const currentTime = new Date(event.occurred_at).getTime();
      const nextTime = pageViews[index + 1]
        ? new Date(pageViews[index + 1].occurred_at).getTime()
        : new Date(session?.last_activity_at || event.occurred_at).getTime();
      if (Number.isFinite(currentTime) && Number.isFinite(nextTime)) page.time += Math.max(0, Math.min(SESSION_TIMEOUT_SECONDS, (nextTime - currentTime) / 1000));
      pageMap.set(url, page);
    }
  }
  return [...pageMap.values()].map((page) => ({
    url: page.url,
    views: page.views,
    exitRate: page.views ? page.exits / page.views : 0,
    avgTimeSeconds: page.views ? page.time / page.views : 0,
    bounceRate: page.landingSessions ? page.landingBounces / page.landingSessions : 0,
  })).sort((a, b) => b.views - a.views).slice(0, 20);
}

function landingDetails(sessions) {
  const groups = new Map();
  for (const session of sessions) {
    const url = session.landing_path || '/';
    const row = groups.get(url) || { url, sessions: 0, bounces: 0 };
    row.sessions += 1;
    if (bounced(session)) row.bounces += 1;
    groups.set(url, row);
  }
  return [...groups.values()].map((row) => ({ url: row.url, sessions: row.sessions, bounceRate: row.sessions ? row.bounces / row.sessions : 0 }))
    .sort((a, b) => b.sessions - a.sessions).slice(0, 20);
}

function exitDetails(sessions, events) {
  const views = new Map();
  for (const event of events) {
    if (event.event_name !== 'page_view') continue;
    const url = event.path || event.page_url;
    views.set(url, (views.get(url) || 0) + 1);
  }
  const groups = new Map();
  for (const session of sessions) groups.set(session.last_path || '/', (groups.get(session.last_path || '/') || 0) + 1);
  return [...groups].map(([url, count]) => ({ url, sessions: count, exitRate: views.get(url) ? count / views.get(url) : null }))
    .sort((a, b) => b.sessions - a.sessions).slice(0, 20);
}

function breakdown(sessions, key, fallback) {
  const groups = new Map();
  for (const session of sessions) {
    const label = session[key] || fallback;
    const row = groups.get(label) || { label, sessions: 0, visitors: new Set(), bounces: 0 };
    row.sessions += 1;
    if (session.visitor_id) row.visitors.add(session.visitor_id);
    if (bounced(session)) row.bounces += 1;
    groups.set(label, row);
  }
  return [...groups.values()].map((row) => ({ label: row.label, sessions: row.sessions, visitors: row.visitors.size, bounceRate: row.sessions ? row.bounces / row.sessions : 0 }))
    .sort((a, b) => b.sessions - a.sessions);
}

function flowDetails(events) {
  const groups = new Map();
  for (const rows of sessionEvents(events).values()) {
    const pages = rows.filter((event) => event.event_name === 'page_view').map((event) => event.path || event.page_url).slice(0, 5);
    if (!pages.length) continue;
    const key = pages.join('\n');
    groups.set(key, (groups.get(key) || 0) + 1);
  }
  return [...groups].map(([key, sessions]) => {
    const [entry, first, second, third, fourth] = key.split('\n');
    return { entry, first, second, third, fourth, sessions };
  }).sort((a, b) => b.sessions - a.sessions).slice(0, 20);
}

function formDetails(events) {
  const funnel = buildFirstPartyFunnel(events);
  const partStarted = stage(events, 'part_exchange_started');
  const partCompleted = stage(events, 'part_exchange_completed');
  return [
    { name: 'Van Finance application', url: '/apply', views: funnel.finance.reachedApplication.sessions, starts: funnel.finance.reachedApplication.sessions, submissions: funnel.finance.completed.sessions, completionRate: funnel.finance.completionRate },
    { name: 'Rent2Buy application', url: '/rent2buy-application', views: funnel.rent2buy.reachedPostcodeGate.sessions, starts: funnel.rent2buy.fullApplicationOpened.sessions, submissions: funnel.rent2buy.completed.sessions, completionRate: funnel.rent2buy.completionRate },
    { name: 'Part exchange', url: '/part-exchange', views: partStarted.sessions, starts: partStarted.sessions, submissions: partCompleted.sessions, completionRate: partStarted.sessions ? partCompleted.sessions / partStarted.sessions : 0 },
  ];
}

export function buildFirstPartyDetails(sessions = [], events = []) {
  const pages = pageDetails(sessions, events);
  const sourceSessions = sessions.map((session) => ({
    ...session,
    source_label: [session.utm_source || session.source || 'Direct / unknown', session.utm_medium, session.utm_campaign].filter(Boolean).join(' · '),
  }));
  return {
    pages,
    landingPages: landingDetails(sessions),
    exitPages: exitDetails(sessions, events),
    devices: breakdown(sessions, 'device_category', 'unknown').map((row) => ({ device: row.label, sessions: row.sessions, visitors: row.visitors, bounceRate: row.bounceRate })),
    sources: breakdown(sourceSessions, 'source_label', 'Direct / unknown').map((row) => ({ source: row.label, sessions: row.sessions, visitors: row.visitors, bounceRate: row.bounceRate })),
    userFlows: flowDetails(events),
    forms: formDetails(events),
    sectionStatus: { userFlows: 'ok', forms: 'ok' },
  };
}

export function mergeDetails(parts = []) {
  const pages = mergeRateRows(parts, 'pages', 'url', 'views', ['exitRate', 'avgTimeSeconds', 'bounceRate']);
  const forms = mergeRateRows(parts, 'forms', 'name', 'views', ['completionRate']).map((row) => {
    const matching = parts.flatMap((part) => part.forms || []).filter((item) => item.name === row.name);
    const starts = matching.reduce((sum, item) => sum + number(item.starts), 0);
    const submissions = matching.reduce((sum, item) => sum + number(item.submissions), 0);
    return { ...row, url: matching.find((item) => item.url)?.url || '', starts, submissions, completionRate: starts ? submissions / starts : 0 };
  });
  const flowGroups = new Map();
  for (const flow of parts.flatMap((part) => part.userFlows || [])) {
    const normalized = Object.fromEntries(['entry', 'first', 'second', 'third', 'fourth'].map((field) => [field, flow[field] ? pageKey(flow[field]) : flow[field]]));
    const key = [normalized.entry, normalized.first, normalized.second, normalized.third, normalized.fourth].join('\n');
    const current = flowGroups.get(key) || { ...flow, ...normalized, sessions: 0 };
    current.sessions += number(flow.sessions);
    flowGroups.set(key, current);
  }
  return {
    pages,
    landingPages: mergeRateRows(parts, 'landingPages', 'url', 'sessions', ['bounceRate']),
    exitPages: mergeRateRows(parts, 'exitPages', 'url', 'sessions', ['exitRate']),
    devices: mergeRateRows(parts, 'devices', 'device', 'sessions', ['bounceRate']).map((row) => ({ ...row, visitors: parts.flatMap((part) => part.devices || []).filter((item) => item.device === row.device).reduce((sum, item) => sum + number(item.visitors), 0) })),
    sources: mergeRateRows(parts, 'sources', 'source', 'sessions', ['bounceRate']).map((row) => ({ ...row, visitors: parts.flatMap((part) => part.sources || []).filter((item) => item.source === row.source).reduce((sum, item) => sum + number(item.visitors), 0) })),
    userFlows: [...flowGroups.values()].sort((a, b) => b.sessions - a.sessions).slice(0, 20),
    forms,
    sectionStatus: {
      userFlows: parts.some((part) => part.sectionStatus?.userFlows === 'ok') ? 'ok' : 'error',
      forms: parts.some((part) => part.sectionStatus?.forms === 'ok') ? 'ok' : 'error',
    },
  };
}

export function mergeFunnels(parts = []) {
  const eventLike = (path) => parts.map((part) => path(part)).filter(Boolean);
  const sumStage = (stages) => ({ sessions: stages.reduce((sum, item) => sum + number(item.sessions), 0), visitors: stages.reduce((sum, item) => sum + number(item.visitors), 0) });
  const reached = sumStage(eventLike((part) => part.finance?.reachedApplication));
  const completed = sumStage(eventLike((part) => part.finance?.completed));
  const rentGate = sumStage(eventLike((part) => part.rent2buy?.reachedPostcodeGate));
  const rentOpenedValues = eventLike((part) => part.rent2buy?.fullApplicationOpened);
  const rentCompletedValues = eventLike((part) => part.rent2buy?.completed);
  const rentOpened = rentOpenedValues.length ? sumStage(rentOpenedValues) : null;
  const rentCompleted = rentCompletedValues.length ? sumStage(rentCompletedValues) : null;
  return {
    finance: { reachedApplication: reached, completed, completionRate: reached.sessions ? completed.sessions / reached.sessions : 0 },
    rent2buy: {
      reachedPostcodeGate: rentGate,
      postcodeSupplied: eventLike((part) => part.rent2buy?.postcodeSupplied).length ? sumStage(eventLike((part) => part.rent2buy?.postcodeSupplied)) : null,
      postcodePass: eventLike((part) => part.rent2buy?.postcodePass).length ? sumStage(eventLike((part) => part.rent2buy?.postcodePass)) : null,
      postcodeFail: eventLike((part) => part.rent2buy?.postcodeFail).length ? sumStage(eventLike((part) => part.rent2buy?.postcodeFail)) : null,
      fullApplicationOpened: rentOpened,
      completed: rentCompleted,
      completionRate: rentOpened?.sessions ? number(rentCompleted?.sessions) / rentOpened.sessions : null,
      note: parts.length > 1 ? 'Mixed Wix path-based history and explicit first-party events. Only compatible stages are added.' : parts[0]?.rent2buy?.note,
    },
  };
}

async function fetchRows(supabase, table, columns, timestampColumn, startDate, endExclusive, maxRows = 50000) {
  const output = [];
  const pageSize = 1000;
  for (let from = 0; from < maxRows; from += pageSize) {
    const result = await supabase.from(table).select(columns)
      .gte(timestampColumn, londonBoundaryIso(startDate)).lt(timestampColumn, londonBoundaryIso(endExclusive))
      .order(timestampColumn, { ascending: true }).range(from, from + pageSize - 1);
    if (result.error) throw result.error;
    output.push(...(result.data || []));
    if (!result.data || result.data.length < pageSize) break;
  }
  return output;
}

export async function loadFirstPartyPeriod({ supabase, startDate, endExclusive }) {
  try {
    const [sessions, events] = await Promise.all([
      fetchRows(supabase, 'site_analytics_sessions', 'session_id,visitor_id,started_at,last_activity_at,ended_at,landing_path,last_path,page_view_count,meaningful_event_count,referrer,source,utm_source,utm_medium,utm_campaign,device_category,browser_category,viewport_width', 'started_at', startDate, endExclusive),
      fetchRows(supabase, 'site_analytics_events', 'event_id,session_id,visitor_id,event_name,occurred_at,path,page_url,vehicle_registration,metadata', 'occurred_at', startDate, endExclusive),
    ]);
    return { ok: true, skipped: false, sessions, events, summary: summarizeFirstParty(sessions, events), details: buildFirstPartyDetails(sessions, events), funnel: buildFirstPartyFunnel(events) };
  } catch (error) {
    if (!isMissingSupabaseObjectError(error)) throw error;
    return { ok: true, skipped: true, reason: 'analytics tables missing', sessions: [], events: [], summary: { ...EMPTY_SUMMARY }, details: buildFirstPartyDetails([], []), funnel: buildFirstPartyFunnel([]) };
  }
}

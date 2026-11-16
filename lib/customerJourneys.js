// Aggregate-only customer journey summaries for the Marketing CRM.
// Never return visitor/session IDs or single-visit paths to the browser.
const SAFE_ROUTE_MIN_SESSIONS = 3;
const MAX_ROUTE_STEPS = 5;
const SITE_STAGES = Object.freeze({
  vanFinance: {
    start: 'finance_application_reached',
    deliberateStart: 'finance_application_started',
    complete: 'finance_application_completed',
    startLabel: 'Application page reached',
  },
  rent2buy: {
    start: 'rent2buy_full_application_opened',
    deliberateStart: 'rent2buy_full_application_opened',
    complete: 'rent2buy_application_completed',
    startLabel: 'Full application opened',
  },
});

function cleanPath(value) {
  const raw = String(value || '').trim();
  if (!raw || raw[0] !== '/') return null;
  return (raw.split('?')[0].split('#')[0] || '/').slice(0, 250);
}

function safeSource(session) {
  const named = String(session.utm_source || session.source || '').trim();
  if (named) return named.toLowerCase() === 'direct' ? 'Direct / unknown' : named.slice(0, 70);
  try {
    const host = new URL(String(session.referrer || '')).hostname.replace(/^www\./i, '').toLowerCase();
    if (host && !/(^|\.)vanfinancecompany\.co\.uk$|(^|\.)rent2buyvans\.co\.uk$/.test(host)) {
      if (host.includes('google.')) return 'Google referral';
      if (host.includes('bing.')) return 'Bing referral';
      if (host.includes('facebook.') || host === 'fb.com') return 'Facebook referral';
      if (host.includes('instagram.')) return 'Instagram referral';
      return 'Other referral';
    }
  } catch {}
  return 'Direct / unknown';
}

function topCounts(map, key, limit = 8, threshold = 1) {
  return [...map].filter(([, count]) => count >= threshold)
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, limit).map(([value, count]) => ({ [key]: value, count }));
}

function add(map, value) {
  map.set(value, (map.get(value) || 0) + 1);
}


function stockPageKind(siteKey, path) {
  if (!path) return null;
  if (siteKey === 'vanFinance') {
    if (/^\/(?:vans|cars)$/.test(path)) return 'listing';
    if (/^\/(?:vans|cars)\/[^/]+$/.test(path)) return 'vehicle';
  }
  if (siteKey === 'rent2buy') {
    if (/^\/view-(?:all-vans|small-vans|medium-vans|lwb-vans|crew-vans|pickups-4x4|tipper-luton-dropside|automatic-vans|electric-vans|cars)$/.test(path)) return 'listing';
    if (/^\/van-pages\/[^/]+$/.test(path)) return 'vehicle';
  }
  return null;
}

// Read-only, session-deduplicated observational funnel. Page transitions are not
// click events and cannot prove which link was tapped. Do not infer missing paths
// from heartbeat counters, landing paths or applications alone.
function mobileHomepageStockJourney({ sessionMap, events, siteKey, stage }) {
  const eligible = new Set([...sessionMap.values()]
    .filter((session) => String(session.device_category || '').toLowerCase() === 'mobile'
      && cleanPath(session.landing_path) === '/')
    .map((session) => session.session_id));
  const bySession = new Map();
  for (const event of events) {
    if (!eligible.has(event?.session_id)) continue;
    const name = String(event.event_name || '');
    if (name !== 'page_view' && name !== 'vehicle_view'
      && name !== stage.start && name !== stage.deliberateStart && name !== stage.complete) continue;
    const when = Date.parse(event.occurred_at || '');
    if (!Number.isFinite(when)) continue;
    const rows = bySession.get(event.session_id) || [];
    rows.push({ name, path: cleanPath(event.path), when });
    bySession.set(event.session_id, rows);
  }

  const counts = {
    capturedMobileHomepageSessions: eligible.size,
    observedMobileHomepageSessions: 0,
    stockListingSessions: 0,
    vehicleDetailSessions: 0,
    applicationEntrySessions: 0,
    deliberateApplicationStartSessions: 0,
    applicationCompletionSessions: 0,
  };
  for (const rows of bySession.values()) {
    rows.sort((a, b) => a.when - b.when);
    const firstHome = rows.findIndex((row) => row.name === 'page_view' && row.path === '/');
    if (firstHome < 0) continue;
    counts.observedMobileHomepageSessions += 1;
    const seen = new Set();
    for (const row of rows.slice(firstHome + 1)) {
      const kind = row.name === 'page_view' ? stockPageKind(siteKey, row.path) : null;
      if (kind === 'listing') seen.add('stockListingSessions');
      if (kind === 'vehicle' || row.name === 'vehicle_view') seen.add('vehicleDetailSessions');
      if (row.name === stage.start) seen.add('applicationEntrySessions');
      if (row.name === stage.deliberateStart) seen.add('deliberateApplicationStartSessions');
      if (row.name === stage.complete) seen.add('applicationCompletionSessions');
    }
    for (const key of seen) counts[key] += 1;
  }
  return {
    ...counts,
    observedHomepageCoveragePct: eligible.size
      ? Math.round(1000 * counts.observedMobileHomepageSessions / eligible.size) / 10
      : null,
    applicationEntryLabel: stage.startLabel,
    deliberateStartLabel: siteKey === 'vanFinance' ? 'Deliberate application start' : 'Full application opened',
    note: 'Same-session signals after an explicit mobile homepage page_view, not confirmed card clicks or a mandatory step-by-step path. Missing page events and cross-day sessions can undercount. Counted sessions are not verified people or confirmed Main CRM applications.',
  };
}

export function summariseCustomerJourneys({ sessions = [], events = [], siteKey = 'vanFinance' } = {}) {
  const stage = SITE_STAGES[siteKey];
  if (!stage) throw new Error('Unsupported website');
  const sessionMap = new Map(sessions.filter((row) => row?.session_id).map((row) => [row.session_id, row]));
  const pages = new Map();
  const landing = new Map();
  const sources = new Map();
  const devices = new Map();
  const vehicles = new Map();
  const eventSessions = { start: new Set(), complete: new Set(), vehicle: new Set() };
  const pageEventSessions = new Set();
  const pagesPerSession = new Map();
  const routeCounts = new Map();
  const seenPageSessions = new Set();
  const seenVehicleSessions = new Set();
  let recordedPageEvents = 0;
  let pageViewCounters = 0;
  let sessionsWithPageCounter = 0;

  for (const session of sessionMap.values()) {
    const counter = Math.max(0, Number(session.page_view_count || 0));
    pageViewCounters += counter;
    if (counter > 0) sessionsWithPageCounter += 1;
    const path = cleanPath(session.landing_path);
    if (path) add(landing, path);
    add(sources, safeSource(session));
    add(devices, String(session.device_category || 'unknown').slice(0, 20));
  }

  // Only accepted page_view events establish a route. Heartbeat counters alone
  // are not evidence of what intermediate pages a customer visited.
  for (const event of events) {
    if (!sessionMap.has(event?.session_id)) continue;
    const eventName = String(event.event_name || '');
    const id = event.session_id;
    if (eventName === stage.start) eventSessions.start.add(id);
    if (eventName === stage.complete) eventSessions.complete.add(id);
    if (eventName === 'vehicle_view') {
      eventSessions.vehicle.add(id);
      const registration = String(event.vehicle_registration || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
      if (/^[A-Z0-9]{2,12}$/.test(registration)) {
        const key = id + ':' + registration;
        if (!seenVehicleSessions.has(key)) {
          seenVehicleSessions.add(key);
          add(vehicles, registration);
        }
      }
    }
    if (eventName !== 'page_view') continue;
    const path = cleanPath(event.path);
    if (!path) continue;
    recordedPageEvents += 1;
    pageEventSessions.add(id);
    const pageKey = id + ':' + path;
    if (!seenPageSessions.has(pageKey)) {
      seenPageSessions.add(pageKey);
      add(pages, path);
    }
    if (!pagesPerSession.has(id)) pagesPerSession.set(id, []);
    pagesPerSession.get(id).push({
      path,
      when: Date.parse(event.occurred_at || '') || 0,
    });
  }

  for (const rows of pagesPerSession.values()) {
    rows.sort((a, b) => a.when - b.when);
    const route = [];
    for (const row of rows) {
      if (row.path !== route[route.length - 1]) route.push(row.path);
    }
    if (route.length < 2) continue;
    const steps = route.slice(0, MAX_ROUTE_STEPS);
    add(routeCounts, JSON.stringify(steps));
  }

  const routes = topCounts(routeCounts, 'encoded', 8, SAFE_ROUTE_MIN_SESSIONS)
    .map(({ encoded, count }) => ({ steps: JSON.parse(encoded), sessions: count }));
  const total = sessionMap.size;
  const withPageEvents = pageEventSessions.size;
  const missingPageEvents = total - withPageEvents;
  return {
    siteKey,
    source: 'first_party',
    status: total ? (missingPageEvents ? 'partial' : 'complete') : 'no_sessions',
    capturedSessions: total,
    sessionsWithPageEvent: withPageEvents,
    sessionsMissingPageEvent: missingPageEvents,
    pageEventCoveragePct: total ? Math.round((withPageEvents / total) * 1000) / 10 : null,
    recordedPageEvents,
    pageViewCounters,
    sessionsWithPageCounter,
    applicationStartLabel: stage.startLabel,
    applicationStartSessions: eventSessions.start.size,
    applicationCompletionEvents: eventSessions.complete.size,
    vehicleViewSessions: eventSessions.vehicle.size,
    mobileStockJourney: mobileHomepageStockJourney({ sessionMap, events, siteKey, stage }),
    topLandingPages: topCounts(landing, 'path', 8, SAFE_ROUTE_MIN_SESSIONS),
    topViewedPages: topCounts(pages, 'path', 8, SAFE_ROUTE_MIN_SESSIONS),
    topVehicles: topCounts(vehicles, 'registration', 8, SAFE_ROUTE_MIN_SESSIONS),
    sources: topCounts(sources, 'source', 8),
    devices: topCounts(devices, 'device', 6),
    routes,
    notes: [
      'First-party captured sessions are not verified human visits or GA4 sessions.',
      'Only explicit page_view events establish the ordered page journeys; heartbeat page counters do not.',
      'Routes and page/vehicle rankings require activity from at least three distinct sessions.',
      'Application signals are tracking events, not independently verified Main CRM applications.',
      'Sources labelled Direct / unknown cannot reliably distinguish direct visits from missing attribution.',
    ],
  };
}

function londonDay(now) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return map.year + '-' + map.month + '-' + map.day;
}
function plusDays(date, count) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + count, 12)).toISOString().slice(0, 10);
}

export function journeyPeriod(period = 'yesterday', now = new Date()) {
  if (!['today', 'yesterday', '7d', 'previous7d'].includes(period)) throw new Error('Unsupported period');
  const today = londonDay(now);
  if (period === 'today') return {
    key: period, startDate: today, endExclusive: plusDays(today, 1),
    label: 'Today · live and provisional', provisional: true,
  };
  if (period === 'yesterday') return {
    key: period, startDate: plusDays(today, -1), endExclusive: today,
    label: 'Yesterday · completed day', provisional: false,
  };
  if (period === 'previous7d') return {
    key: period, startDate: plusDays(today, -14), endExclusive: plusDays(today, -7),
    label: 'Prior 7 complete days', provisional: false,
  };
  return {
    key: period, startDate: plusDays(today, -7), endExclusive: today,
    label: 'Latest 7 complete days', provisional: false,
  };
}

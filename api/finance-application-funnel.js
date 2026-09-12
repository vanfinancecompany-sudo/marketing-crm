import { getSupabaseServiceAdmin } from './_vansco-cache-utils.js';
import { londonBoundaryIso } from './_first-party-analytics.js';

const SITE_ORIGIN = 'https://www.vanfinancecompany.co.uk';
const TIME_ZONE = 'Europe/London';
const EVENTS = [
  'finance_application_reached',
  'finance_application_started',
  'finance_application_step_viewed',
  'finance_application_step_blocked',
  'finance_application_completed',
];
const STEP_ORDER = [
  'Application type',
  'Company',
  'About you',
  'A little more about you',
  'Address history',
  'Work & income',
  'Part exchange',
  'How you found us',
  'Bank & consent',
];

function londonDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days, 12)).toISOString().slice(0, 10);
}

function uniqueSessions(rows = []) {
  return new Set(rows.map((row) => String(row?.session_id || '').trim()).filter(Boolean));
}

function groupCounts(rows = [], field) {
  const counts = new Map();
  for (const row of rows) {
    const key = String(row?.[field] || 'unknown').trim().toLowerCase() || 'unknown';
    if (!counts.has(key)) counts.set(key, new Set());
    counts.get(key).add(String(row?.session_id || '').trim());
  }
  return [...counts.entries()]
    .map(([name, sessions]) => ({ name, sessions: [...sessions].filter(Boolean).length }))
    .filter((item) => item.sessions > 0)
    .sort((a, b) => b.sessions - a.sessions);
}

export function buildFinanceApplicationFunnel(rows = []) {
  const reaches = uniqueSessions(rows.filter((row) => row.event_name === 'finance_application_reached'));
  const explicitStarts = uniqueSessions(rows.filter((row) => row.event_name === 'finance_application_started'));
  const starts = uniqueSessions(rows.filter((row) => (
    row.event_name === 'finance_application_started' ||
    row.event_name === 'finance_application_completed' ||
    (row.event_name === 'finance_application_step_viewed' && row?.metadata?.step_name !== 'Application type')
  )));
  const completions = uniqueSessions(rows.filter((row) => row.event_name === 'finance_application_completed'));
  const viewed = rows.filter((row) => row.event_name === 'finance_application_step_viewed');
  const blocked = rows.filter((row) => row.event_name === 'finance_application_step_blocked');

  const steps = STEP_ORDER.map((name) => {
    const viewedSessions = name === 'Application type'
      ? starts
      : uniqueSessions(viewed.filter((row) => row?.metadata?.step_name === name));
    const blockedSessions = uniqueSessions(blocked.filter((row) => row?.metadata?.step_name === name));
    return {
      name,
      viewed: viewedSessions.size,
      blocked: blockedSessions.size,
      reachedPct: starts.size ? viewedSessions.size / starts.size : 0,
    };
  }).filter((step) => step.viewed > 0 || step.blocked > 0);

  return {
    reaches: reaches.size,
    starts: starts.size,
    explicitStarts: explicitStarts.size,
    startRate: reaches.size ? starts.size / reaches.size : 0,
    completions: completions.size,
    conversionRate: starts.size ? completions.size / starts.size : 0,
    steps,
    blockedDevices: groupCounts(blocked, 'device_category'),
    blockedBrowsers: groupCounts(blocked, 'browser_category'),
  };
}

async function addSessionEnvironment(supabase, rows = []) {
  const blockedSessionIds = [...uniqueSessions(rows.filter((row) => row.event_name === 'finance_application_step_blocked'))];
  if (!blockedSessionIds.length) return rows;

  const { data, error } = await supabase
    .from('site_analytics_sessions')
    .select('session_id,device_category,browser_category')
    .in('session_id', blockedSessionIds)
    .limit(10000);

  // Device/browser is diagnostic only. Never break the funnel if the
  // supplemental session lookup is unavailable.
  if (error) return rows;

  const bySession = new Map((data || []).map((session) => [String(session.session_id || ''), session]));
  return rows.map((row) => {
    const session = bySession.get(String(row?.session_id || ''));
    return session ? {
      ...row,
      device_category: session.device_category || null,
      browser_category: session.browser_category || null,
    } : row;
  });
}

export default async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ ok: false, message: 'Method not allowed.' });
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  try {
    const date = londonDateKey();
    const startIso = londonBoundaryIso(date);
    const endIso = londonBoundaryIso(addDays(date, 1));
    const supabase = getSupabaseServiceAdmin();
    const { data, error } = await supabase
      .from('site_analytics_events')
      .select('session_id,event_name,metadata,occurred_at')
      .eq('site_origin', SITE_ORIGIN)
      .in('event_name', EVENTS)
      .gte('occurred_at', startIso)
      .lt('occurred_at', endIso)
      .order('occurred_at', { ascending: true })
      .limit(10000);
    if (error) throw error;

    const rows = await addSessionEnvironment(supabase, data || []);
    return response.status(200).json({
      ok: true,
      date,
      checkedAt: new Date().toISOString(),
      ...buildFinanceApplicationFunnel(rows),
    });
  } catch {
    return response.status(500).json({ ok: false, message: 'Finance application funnel could not be loaded.' });
  }
}

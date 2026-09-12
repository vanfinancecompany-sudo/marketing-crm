import { getSupabaseServiceAdmin } from './_vansco-cache-utils.js';
import { londonBoundaryIso } from './_first-party-analytics.js';
import { ANALYTICS_SITE_ORIGINS } from '../lib/analyticsSiteOrigins.js';

const TIME_ZONE = 'Europe/London';
const SITE_EVENTS = Object.freeze({
  vanFinance: {
    siteOrigin: ANALYTICS_SITE_ORIGINS.vfc,
    reachedEventName: 'finance_application_reached',
    startEventName: 'finance_application_started',
    completionEventName: 'finance_application_completed',
  },
  rent2buy: {
    siteOrigin: ANALYTICS_SITE_ORIGINS.rent2buy,
    startEventName: 'rent2buy_full_application_opened',
    completionEventName: 'rent2buy_application_completed',
  },
});

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

export function uniqueSessionCount(rows = []) {
  return new Set(rows.map((row) => String(row?.session_id || '').trim()).filter(Boolean)).size;
}

export function applicationSessionCounts(rows = [], { reachedEventName, startEventName, completionEventName } = {}) {
  const reachedRows = reachedEventName ? rows.filter((row) => row?.event_name === reachedEventName) : [];
  const startRows = rows.filter((row) => row?.event_name === startEventName);
  const completionRows = rows.filter((row) => row?.event_name === completionEventName);
  const applicationRows = rows.filter((row) => (
    row?.event_name === startEventName || row?.event_name === completionEventName
  ));

  return {
    reaches: uniqueSessionCount(reachedRows),
    // A completed session necessarily started the application. Including it here
    // prevents a delayed/missed explicit start event from producing completions > starts.
    starts: uniqueSessionCount(applicationRows),
    explicitStarts: uniqueSessionCount(startRows),
    completions: uniqueSessionCount(completionRows),
  };
}

async function loadSiteCounts({ supabase, siteOrigin, reachedEventName, startEventName, completionEventName, startIso, endIso }) {
  const eventNames = [reachedEventName, startEventName, completionEventName].filter(Boolean);
  const { data, error } = await supabase
    .from('site_analytics_events')
    .select('session_id,event_name')
    .eq('site_origin', siteOrigin)
    .in('event_name', eventNames)
    .gte('occurred_at', startIso)
    .lt('occurred_at', endIso)
    .limit(10000);
  if (error) throw error;
  return applicationSessionCounts(data || [], { reachedEventName, startEventName, completionEventName });
}

export async function loadLiveApplicationCompletions({ now = new Date(), supabase } = {}) {
  const client = supabase || getSupabaseServiceAdmin();
  const date = londonDateKey(now);
  const nextDate = addDays(date, 1);
  const startIso = londonBoundaryIso(date);
  const endIso = londonBoundaryIso(nextDate);
  const entries = await Promise.all(Object.entries(SITE_EVENTS).map(async ([key, config]) => {
    const counts = await loadSiteCounts({ supabase: client, ...config, startIso, endIso });
    return [key, {
      ...counts,
      reachedEventName: config.reachedEventName || null,
      startEventName: config.startEventName,
      eventName: config.completionEventName,
    }];
  }));
  return {
    source: 'first_party_live',
    date,
    sites: Object.fromEntries(entries),
  };
}

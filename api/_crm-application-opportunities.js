import { getSupabaseServiceAdmin } from './_vansco-cache-utils.js';
import { londonBoundaryIso } from './_first-party-analytics.js';

// Reporting only. Never mutate, archive, or suppress a customer application.
export const DUPLICATE_WINDOW_MS = 60 * 60 * 1000;
const SOURCES = [
  'Wix Finance Application',
  'VanFinance.co',
  'Rent2BuyVans.co.uk',
  'Van Finance Company Rent2Buy',
];
const EMPTY_PERIOD = Object.freeze({
  finance: 0, rent2buy: 0, total: 0, rawSubmissions: 0,
  duplicates: 0,
  sites: { vanFinance: 0, vanfinanceCo: 0, rent2buy: 0, vfcRent2Buy: 0 },
});

function normalizedText(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}
function applicantEmail(value) {
  return normalizedText(value);
}
function applicantPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('0044')) return '0' + digits.slice(4);
  if (digits.startsWith('44') && digits.length >= 12) return '0' + digits.slice(2);
  return digits;
}
function siteForSource(source) {
  const value = normalizedText(source);
  if (value === 'wix finance application') return 'vanFinance';
  if (value === 'vanfinance.co') return 'vanfinanceCo';
  if (value === 'rent2buyvans.co.uk') return 'rent2buy';
  if (value === 'van finance company rent2buy') return 'vfcRent2Buy';
  return null;
}
function pipelineForSite(site) {
  return site === 'vanFinance' || site === 'vanfinanceCo' ? 'finance' : 'rent2buy';
}
function londonDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function shiftLondonDate(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days, 12)).toISOString().slice(0, 10);
}
function blankPeriod() {
  return {
    ...EMPTY_PERIOD,
    sites: { ...EMPTY_PERIOD.sites },
  };
}
function sameApplicant(group, row) {
  // Shared telephone numbers cannot alone merge different named people.
  const namesCompatible = !group.names.size || !row.name || group.names.has(row.name);
  return namesCompatible && (
    (row.email && group.emails.has(row.email)) ||
    (row.phone && row.name && group.phones.has(row.phone) && group.names.has(row.name))
  );
}

export function groupApplicationOpportunities(rows = []) {
  const ordered = rows
    .map((row) => {
      const site = siteForSource(row?.source);
      const timestamp = new Date(row?.created_at).getTime();
      if (!site || !Number.isFinite(timestamp)) return null;
      return {
        site, pipeline: pipelineForSite(site), timestamp,
        email: applicantEmail(row.email),
        phone: applicantPhone(row.phone),
        name: normalizedText(row.name),
        id: row.id,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.timestamp - b.timestamp || String(a.id).localeCompare(String(b.id)));
  const groups = [];
  for (const row of ordered) {
    const matched = [...groups].reverse().find((group) =>
      group.pipeline === row.pipeline &&
      row.timestamp - group.firstAt <= DUPLICATE_WINDOW_MS &&
      row.timestamp >= group.firstAt &&
      sameApplicant(group, row));
    if (matched) {
      matched.rawSubmissions += 1;
      if (row.email) matched.emails.add(row.email);
      if (row.phone) matched.phones.add(row.phone);
      if (row.name) matched.names.add(row.name);
    } else {
      groups.push({
        pipeline: row.pipeline, site: row.site, firstAt: row.timestamp,
        firstId: row.id, rawSubmissions: 1,
        emails: new Set(row.email ? [row.email] : []),
        phones: new Set(row.phone ? [row.phone] : []),
        names: new Set(row.name ? [row.name] : []),
      });
    }
  }
  return groups;
}

export function buildApplicationOpportunitySummary(rows = [], { now = new Date() } = {}) {
  const instant = new Date(now);
  const today = londonDateKey(instant);
  const boundaries = {
    today: Date.parse(londonBoundaryIso(today)),
    sevenDays: Date.parse(londonBoundaryIso(shiftLondonDate(today, -6))),
    twentyEightDays: Date.parse(londonBoundaryIso(shiftLondonDate(today, -27))),
  };
  const groups = groupApplicationOpportunities(rows);
  const periods = {};
  for (const [name, start] of Object.entries(boundaries)) {
    const totals = blankPeriod();
    for (const group of groups) {
      if (group.firstAt < start || group.firstAt > instant.getTime()) continue;
      totals.sites[group.site] += 1;
      totals[group.pipeline] += 1;
      totals.total += 1;
      totals.rawSubmissions += group.rawSubmissions;
      totals.duplicates += group.rawSubmissions - 1;
    }
    periods[name] = totals;
  }
  return { date: today, duplicateWindowMinutes: 60, periods };
}

export async function loadCrmApplicationOpportunities({ now = new Date(), supabase } = {}) {
  const client = supabase || getSupabaseServiceAdmin();
  const today = londonDateKey(new Date(now));
  const firstDay = shiftLondonDate(today, -27);
  // Include the prior hour so near-midnight duplicates do not become a new day's application.
  const start = new Date(Date.parse(londonBoundaryIso(firstDay)) - DUPLICATE_WINDOW_MS).toISOString();
  const { data, error } = await client.from('manual_leads')
    .select('id,created_at,pipeline,source,email,phone,name')
    .in('source', SOURCES)
    .in('pipeline', ['vanFinance', 'rent2buy'])
    .gte('created_at', start)
    .lte('created_at', new Date(now).toISOString())
    .order('created_at', { ascending: true })
    .limit(5000);
  if (error) throw error;
  if ((data || []).length >= 5000) throw new Error('Too many applications to safely calculate the reporting period.');
  return buildApplicationOpportunitySummary(data || [], { now });
}

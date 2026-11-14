import { getSupabaseServiceAdmin } from './_vansco-cache-utils.js';
import { loadFirstPartyPeriod } from './_first-party-analytics.js';
import { ANALYTICS_SITE_ORIGINS } from '../lib/analyticsSiteOrigins.js';
import { journeyPeriod, summariseCustomerJourneys } from '../lib/customerJourneys.js';

// Read-only, aggregate-only reporting. Never send raw session or visitor rows
// or a single visitor's path to the public website-analytics dashboard.
export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'private, no-store');
  if (request.method !== 'GET') {
    return response.status(405).json({ ok: false, message: 'Method not allowed.' });
  }

  const key = String(request.query?.period || 'yesterday');
  let period;
  try {
    period = journeyPeriod(key);
  } catch {
    return response.status(400).json({ ok: false, message: 'Unsupported reporting period.' });
  }

  try {
    const supabase = getSupabaseServiceAdmin();
    const siteEntries = [
      ['vanFinance', ANALYTICS_SITE_ORIGINS.vfc],
      ['rent2buy', ANALYTICS_SITE_ORIGINS.rent2buy],
    ];
    const results = await Promise.allSettled(siteEntries.map(async ([siteKey, siteOrigin]) => {
      const data = await loadFirstPartyPeriod({
        supabase,
        startDate: period.startDate,
        endExclusive: period.endExclusive,
        siteOrigin,
      });
      if (data.skipped) throw new Error('First-party analytics tables are unavailable.');
      return summariseCustomerJourneys({ sessions: data.sessions, events: data.events, siteKey });
    }));
    const sites = {};
    for (let index = 0; index < siteEntries.length; index += 1) {
      const [siteKey] = siteEntries[index];
      const result = results[index];
      sites[siteKey] = result.status === 'fulfilled'
        ? { ok: true, ...result.value }
        : { ok: false, siteKey, message: 'Journey data temporarily unavailable for this site.' };
    }

    const available = Object.values(sites).some((site) => site.ok);
    return response.status(available ? 200 : 503).json({
      ok: available,
      period,
      source: 'first_party',
      sites,
      checkedAt: new Date().toISOString(),
      note: 'This supplemental first-party report is not equivalent to GA4. Both websites are kept separate and any combined figure adds sessions, not deduplicated people.',
    });
  } catch {
    return response.status(503).json({
      ok: false,
      message: 'Daily customer journey data is temporarily unavailable.',
    });
  }
}

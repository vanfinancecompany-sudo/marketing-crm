import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ANALYTICS_SITE_ORIGINS, canonicalAnalyticsSiteOrigin } from '../lib/analyticsSiteOrigins.js';
import { loadFirstPartyPeriod } from '../api/_first-party-analytics.js';
import { sanitizeAnalyticsPayload, shouldUpdateLegacyAnalytics } from '../api/track-site-analytics.js';

function emptySupabase(filters) {
  return {
    from(table) {
      return {
        select() { return this; },
        gte() { return this; },
        lt() { return this; },
        eq(field, value) { filters.push({ table, field, value }); return this; },
        order() { return this; },
        async range() { return { data: [], error: null }; },
      };
    },
  };
}

describe('site-separated first-party analytics', () => {
  it('canonicalises both public domains and their non-www aliases', () => {
    assert.equal(canonicalAnalyticsSiteOrigin('https://vanfinancecompany.co.uk'), ANALYTICS_SITE_ORIGINS.vfc);
    assert.equal(canonicalAnalyticsSiteOrigin('https://www.vanfinancecompany.co.uk/'), ANALYTICS_SITE_ORIGINS.vfc);
    assert.equal(canonicalAnalyticsSiteOrigin('https://rent2buyvans.co.uk'), ANALYTICS_SITE_ORIGINS.rent2buy);
    assert.equal(canonicalAnalyticsSiteOrigin('https://www.rent2buyvans.co.uk/'), ANALYTICS_SITE_ORIGINS.rent2buy);
  });

  it('derives site identity from the accepted request origin', () => {
    const payload = sanitizeAnalyticsPayload({
      eventId: 'f70df4b4-92a1-4c8c-b3b6-26d740f503fc',
      sessionId: 'session-abcdefghijklmnop',
      visitorId: 'visitor-abcdefghijklmnop',
      eventName: 'page_view',
      path: '/view-all-vans',
      pageUrl: 'https://www.vanfinancecompany.co.uk/view-all-vans',
      metadata: { product: 'rent2buy' },
    }, Date.parse('2026-09-01T12:00:00Z'), 'https://rent2buyvans.co.uk');

    assert.equal(payload.siteOrigin, ANALYTICS_SITE_ORIGINS.rent2buy);
    assert.equal(payload.pageUrl, 'https://rent2buyvans.co.uk/view-all-vans');
  });

  it('keeps existing VFC reporting VFC-only by default', async () => {
    const filters = [];
    const period = await loadFirstPartyPeriod({
      supabase: emptySupabase(filters),
      startDate: '2026-09-01',
      endExclusive: '2026-09-02',
    });

    assert.equal(period.siteOrigin, ANALYTICS_SITE_ORIGINS.vfc);
    assert.equal(filters.length, 2);
    assert.deepEqual(filters.map((item) => item.field), ['site_origin', 'site_origin']);
    assert.deepEqual(filters.map((item) => item.value), [ANALYTICS_SITE_ORIGINS.vfc, ANALYTICS_SITE_ORIGINS.vfc]);
  });

  it('can load Rent2Buy reporting without mixing VFC rows', async () => {
    const filters = [];
    const period = await loadFirstPartyPeriod({
      supabase: emptySupabase(filters),
      startDate: '2026-09-01',
      endExclusive: '2026-09-02',
      siteOrigin: 'https://rent2buyvans.co.uk',
    });

    assert.equal(period.siteOrigin, ANALYTICS_SITE_ORIGINS.rent2buy);
    assert.deepEqual(filters.map((item) => item.value), [ANALYTICS_SITE_ORIGINS.rent2buy, ANALYTICS_SITE_ORIGINS.rent2buy]);
  });

  it('keeps legacy live visitor and vehicle-view compatibility VFC-only', () => {
    assert.equal(shouldUpdateLegacyAnalytics({ siteOrigin: ANALYTICS_SITE_ORIGINS.vfc }), true);
    assert.equal(shouldUpdateLegacyAnalytics({ siteOrigin: ANALYTICS_SITE_ORIGINS.rent2buy }), false);
  });

  it('records the production site-origin migration and service-only RPC', () => {
    const migration = fs.readFileSync(new URL('../supabase/migrations/20260901144215_separate_site_analytics_by_origin.sql', import.meta.url), 'utf8');
    assert.match(migration, /add column if not exists site_origin text/i);
    assert.match(migration, /https:\/\/www\.vanfinancecompany\.co\.uk/);
    assert.match(migration, /https:\/\/www\.rent2buyvans\.co\.uk/);
    assert.match(migration, /p_site_origin text/);
    assert.match(migration, /site_analytics_sessions_site_started_idx/);
    assert.match(migration, /site_analytics_events_site_occurred_idx/);
    assert.match(migration, /revoke all on function public\.ingest_site_analytics_event[\s\S]+from public, anon, authenticated/i);
    assert.match(migration, /grant execute on function public\.ingest_site_analytics_event[\s\S]+to service_role/i);
  });
});

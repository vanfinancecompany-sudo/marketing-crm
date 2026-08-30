import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildFirstPartyDetails,
  buildFirstPartyFunnel,
  combineSummaries,
  londonBoundaryIso,
  loadFirstPartyPeriod,
  mergeDetails,
  splitAnalyticsRange,
  sourceForSegments,
  summarizeFirstParty,
} from '../api/_first-party-analytics.js';
import { allowedOrigins, rateLimited, sanitizeAnalyticsPayload } from '../api/track-site-analytics.js';

describe('first-party website analytics', () => {
  it('routes pre-cutover, post-cutover and mixed windows deterministically', () => {
    assert.deepEqual(splitAnalyticsRange('2026-08-20', '2026-08-29'), [
      { source: 'wix', startDate: '2026-08-20', endExclusive: '2026-08-29' },
    ]);
    assert.deepEqual(splitAnalyticsRange('2026-08-29', '2026-09-02'), [
      { source: 'first_party', startDate: '2026-08-29', endExclusive: '2026-09-02' },
    ]);
    assert.deepEqual(splitAnalyticsRange('2026-08-27', '2026-08-31'), [
      { source: 'wix', startDate: '2026-08-27', endExclusive: '2026-08-29' },
      { source: 'first_party', startDate: '2026-08-29', endExclusive: '2026-08-31' },
    ]);
    assert.equal(sourceForSegments([
      ...splitAnalyticsRange('2026-08-29', '2026-09-05'),
      ...splitAnalyticsRange('2026-08-22', '2026-08-29'),
    ]), 'mixed');
  });

  it('uses Europe/London day boundaries for first-party queries', () => {
    assert.equal(londonBoundaryIso('2026-08-29'), '2026-08-28T23:00:00.000Z');
    assert.equal(londonBoundaryIso('2026-12-01'), '2026-12-01T00:00:00.000Z');
  });

  it('uses the documented first-party session, bounce and duration definitions', () => {
    const sessions = [
      { session_id: 'a', visitor_id: 'v1', started_at: '2026-08-29T10:00:00Z', last_activity_at: '2026-08-29T10:03:00Z', page_view_count: 1, meaningful_event_count: 0 },
      { session_id: 'b', visitor_id: 'v1', started_at: '2026-08-29T11:00:00Z', last_activity_at: '2026-08-29T12:00:00Z', page_view_count: 2, meaningful_event_count: 1 },
    ];
    const events = [
      { session_id: 'a', event_name: 'page_view' },
      { session_id: 'b', event_name: 'page_view' },
      { session_id: 'b', event_name: 'page_view' },
    ];
    const summary = summarizeFirstParty(sessions, events);
    assert.equal(summary['traffic.sessions_count'], 2);
    assert.equal(summary['traffic.visitors_count'], 1);
    assert.equal(summary['traffic.views_count'], 3);
    assert.equal(summary['traffic.site_bounce_ratio'], 0.5);
    assert.equal(summary['traffic.site_time_seconds_avg'], 990);
    assert.equal(summary['traffic.pages_per_session_avg'], 1.5);
  });

  it('merges compatible summary metrics using session weighting', () => {
    const merged = combineSummaries([
      { 'traffic.sessions_count': 2, 'traffic.visitors_count': 2, 'traffic.views_count': 4, 'traffic.site_bounce_ratio': 0.5, 'traffic.site_time_seconds_avg': 100 },
      { 'traffic.sessions_count': 3, 'traffic.visitors_count': 3, 'traffic.views_count': 9, 'traffic.site_bounce_ratio': 0, 'traffic.site_time_seconds_avg': 200 },
    ]);
    assert.equal(merged['traffic.sessions_count'], 5);
    assert.equal(merged['traffic.views_count'], 13);
    assert.equal(merged['traffic.site_bounce_ratio'], 0.2);
    assert.equal(merged['traffic.site_time_seconds_avg'], 160);
    assert.equal(merged['traffic.pages_per_session_avg'], 2.6);
  });

  it('merges Wix absolute page URLs with first-party paths across the cutover', () => {
    const details = mergeDetails([
      { pages: [{ url: 'https://www.vanfinancecompany.co.uk/vans', views: 2, exitRate: 0.5, avgTimeSeconds: 10, bounceRate: 0.5 }] },
      { pages: [{ url: '/vans', views: 3, exitRate: 0, avgTimeSeconds: 20, bounceRate: 0 }] },
    ]);
    assert.deepEqual(details.pages, [{ url: '/vans', views: 5, exitRate: 0.2, avgTimeSeconds: 16, bounceRate: 0.2 }]);
  });

  it('builds explicit finance, Rent2Buy and part-exchange funnels without PII', () => {
    const events = [
      { session_id: 's1', visitor_id: 'v1', event_name: 'finance_application_reached', occurred_at: '2026-08-29T10:00:00Z', path: '/apply' },
      { session_id: 's1', visitor_id: 'v1', event_name: 'finance_application_completed', occurred_at: '2026-08-29T10:01:00Z', path: '/application-received' },
      { session_id: 's2', visitor_id: 'v2', event_name: 'rent2buy_postcode_gate_reached', occurred_at: '2026-08-29T10:00:00Z', path: '/rent2buy-application' },
      { session_id: 's2', visitor_id: 'v2', event_name: 'rent2buy_postcode_pass', occurred_at: '2026-08-29T10:01:00Z', path: '/rent2buy-application' },
      { session_id: 's2', visitor_id: 'v2', event_name: 'rent2buy_full_application_opened', occurred_at: '2026-08-29T10:02:00Z', path: '/rent2buy-application' },
      { session_id: 's2', visitor_id: 'v2', event_name: 'rent2buy_application_completed', occurred_at: '2026-08-29T10:03:00Z', path: '/rent2buy-application' },
      { session_id: 's3', visitor_id: 'v3', event_name: 'part_exchange_started', occurred_at: '2026-08-29T10:00:00Z', path: '/part-exchange' },
      { session_id: 's3', visitor_id: 'v3', event_name: 'part_exchange_completed', occurred_at: '2026-08-29T10:03:00Z', path: '/part-exchange' },
    ];
    const funnel = buildFirstPartyFunnel(events);
    const forms = buildFirstPartyDetails([], events).forms;
    assert.equal(funnel.finance.completionRate, 1);
    assert.equal(funnel.rent2buy.completionRate, 1);
    assert.equal(forms.find((form) => form.name === 'Part exchange').submissions, 1);
  });

  it('exposes source, UTM medium and campaign in the first-party source breakdown', () => {
    const details = buildFirstPartyDetails([
      { session_id: 's1', visitor_id: 'v1', source: 'facebook', utm_source: 'facebook', utm_medium: 'paid-social', utm_campaign: 'summer-vans', page_view_count: 1, meaningful_event_count: 0 },
    ], []);
    assert.equal(details.sources[0].source, 'facebook · paid-social · summer-vans');
  });

  it('returns an empty optional period when analytics tables have not been migrated yet', async () => {
    const supabase = { from: () => ({
      select() { return this; }, gte() { return this; }, lt() { return this; }, order() { return this; },
      async range() { return { data: null, error: { code: '42P01', message: 'relation does not exist' } }; },
    }) };
    const period = await loadFirstPartyPeriod({ supabase, startDate: '2026-08-29', endExclusive: '2026-08-30' });
    assert.equal(period.ok, true);
    assert.equal(period.skipped, true);
    assert.equal(period.summary['traffic.sessions_count'], 0);
  });

  it('sanitizes the public event envelope and drops arbitrary form data and referrer paths', () => {
    const payload = sanitizeAnalyticsPayload({
      eventId: 'f70df4b4-92a1-4c8c-b3b6-26d740f503fc',
      sessionId: 'session-abcdefghijklmnop', visitorId: 'visitor-abcdefghijklmnop', eventName: 'page_view',
      path: '/vans/AB12CDE?email=private@example.com#stock',
      pageUrl: 'https://www.vanfinancecompany.co.uk/vans/AB12CDE?email=private@example.com',
      referrer: 'https://google.com/customer/private@example.com?q=private',
      metadata: { product: 'finance', interaction: 'route', email: 'private@example.com', postcode: 'SO40 2NN' },
    }, Date.parse('2026-08-29T12:00:00Z'));
    assert.equal(payload.path, '/vans/AB12CDE');
    assert.equal(payload.pageUrl, 'https://www.vanfinancecompany.co.uk/vans/AB12CDE');
    assert.equal(payload.referrer, 'https://google.com');
    assert.deepEqual(payload.metadata, { product: 'finance', interaction: 'route' });
    assert.doesNotMatch(JSON.stringify(payload), /private@example|SO40/);
  });

  it('limits approved browser origins and obvious per-session abuse', () => {
    const origins = allowedOrigins('https://preview.example.test');
    assert.equal(origins.has('https://www.vanfinancecompany.co.uk'), true);
    assert.equal(origins.has('https://vanfinance.co'), false);
    assert.equal(origins.has('https://preview.example.test'), true);
    for (let count = 0; count < 120; count += 1) assert.equal(rateLimited('test-rate-key', 1_000), false);
    assert.equal(rateLimited('test-rate-key', 1_000), true);
  });

  it('locks ingestion to a service-only RPC and a strict event allowlist', () => {
    const migration = fs.readFileSync(new URL('../supabase/migrations/20260829190543_vfc_site_analytics.sql', import.meta.url), 'utf8');
    const endpoint = fs.readFileSync(new URL('../api/track-site-analytics.js', import.meta.url), 'utf8');
    assert.match(migration, /enable row level security/i);
    assert.match(migration, /revoke all on function public\.ingest_site_analytics_event[\s\S]+from public, anon, authenticated/i);
    assert.match(migration, /grant execute on function public\.ingest_site_analytics_event[\s\S]+to service_role/i);
    assert.doesNotMatch(endpoint, /email|phone|first_name|last_name/i);
    assert.match(endpoint, /VFC_ANALYTICS_ALLOWED_ORIGINS/);
    assert.match(endpoint, /MAX_BODY_BYTES = 16 \* 1024/);
    assert.match(endpoint, /from\('site_live_sessions'\)\.upsert/);
    assert.match(endpoint, /from\('vehicle_views'\)\.insert/);
    assert.match(fs.readFileSync(new URL('../api/live-visitor-count.js', import.meta.url), 'utf8'), /site_live_sessions/);
    assert.match(fs.readFileSync(new URL('../api/top-viewed-vans.js', import.meta.url), 'utf8'), /vehicle_views/);
  });
});

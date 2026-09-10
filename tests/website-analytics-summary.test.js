import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { addDays, londonMidnightUtcIso, summaryFrom } from '../api/website-analytics-summary.js';
import { mapExitPages } from '../api/website-analytics-details.js';
import { addDays as addGa4Days, summaryFrom as ga4SummaryFrom } from '../api/ga4-website-analytics.js';
import { uniqueSessionCount } from '../api/_live-application-completions.js';
import { withLiveApplicationCompletions } from '../api/ga4-pipeline-summary.js';

describe('Website Analytics fresh data', () => {
  it('builds rolling date keys safely', () => {
    assert.equal(addDays('2026-08-20', -6), '2026-08-14');
    assert.equal(addDays('2026-08-14', -7), '2026-08-07');
    assert.equal(addGa4Days('2026-09-09', -6), '2026-09-03');
  });

  it('converts London midnight to UTC across BST and winter', () => {
    assert.equal(londonMidnightUtcIso('2026-08-20'), '2026-08-19T23:00:00.000Z');
    assert.equal(londonMidnightUtcIso('2026-01-20'), '2026-01-20T00:00:00.000Z');
  });

  it('reads numeric totals from Wix semantic-model results', () => {
    const result = summaryFrom({ totals: { fields: {
      'traffic.sessions_count': { numericValue: 232 },
      'traffic.visitors_count': { numericValue: 213 },
      'traffic.views_count': { numericValue: 615 },
      'traffic.site_bounce_ratio': { numericValue: 0.5 },
      'traffic.site_time_seconds_avg': { numericValue: 363 },
      'traffic.pages_per_session_avg': { numericValue: 2.0 },
    } } });
    assert.equal(result['traffic.sessions_count'], 232);
    assert.equal(result['traffic.views_count'], 615);
  });

  it('maps GA4 headline metrics and derives pages per session', () => {
    const result = ga4SummaryFrom({
      metricHeaders: [
        { name: 'sessions' },
        { name: 'activeUsers' },
        { name: 'screenPageViews' },
        { name: 'bounceRate' },
        { name: 'averageSessionDuration' },
      ],
      rows: [{ metricValues: [
        { value: '20' },
        { value: '17' },
        { value: '55' },
        { value: '0.4' },
        { value: '92.5' },
      ] }],
    });
    assert.equal(result.sessions, 20);
    assert.equal(result.activeUsers, 17);
    assert.equal(result.pageViews, 55);
    assert.equal(result.pagesPerSession, 2.75);
    assert.equal(result.bounceRate, 0.4);
  });

  it('keeps exit-session ranking but restores the true page exit rate for the legacy supplemental feed', () => {
    const exitPayload = { results: [{ fields: {
      'traffic.page_url_from': { stringValue: '/' },
      'traffic.sessions_count': { numericValue: 468 },
    } }] };
    const pageRatePayload = { results: [{ fields: {
      'traffic.page_url_from': { stringValue: '/' },
      'traffic.exit_ratio': { numericValue: 0.54 },
    } }] };
    assert.deepEqual(mapExitPages(exitPayload, pageRatePayload), [{ url: '/', sessions: 468, exitRate: 0.54 }]);
  });

  it('deduplicates duplicate completion events from the same application session', () => {
    assert.equal(uniqueSessionCount([
      { session_id: 'session-a' },
      { session_id: 'session-a' },
      { session_id: 'session-b' },
      { session_id: '' },
    ]), 2);
  });

  it('uses a live first-party completion while GA4 event reporting catches up', () => {
    const result = withLiveApplicationCompletions({
      ok: true,
      sites: [{
        key: 'vanFinance',
        applicationStartsToday: 1,
        applicationCompletionsToday: 0,
        conversionRate: 0,
      }],
    }, {
      date: '2026-09-10',
      sites: { vanFinance: { completions: 1 } },
    });
    assert.equal(result.sites[0].ga4ApplicationCompletionsToday, 0);
    assert.equal(result.sites[0].liveApplicationCompletionsToday, 1);
    assert.equal(result.sites[0].applicationCompletionsToday, 1);
    assert.equal(result.sites[0].applicationCompletionSource, 'first_party_live');
    assert.equal(result.sites[0].effectiveConversionRate, 1);
  });

  it('uses GA4 as the Website Analytics source while retaining only supplemental journey details', () => {
    const source = fs.readFileSync(new URL('../public/website-analytics/app.js', import.meta.url), 'utf8');
    const html = fs.readFileSync(new URL('../public/website-analytics/index.html', import.meta.url), 'utf8');
    assert.match(source, /GA4_ENDPOINT = '\/api\/ga4-website-analytics'/);
    assert.match(source, /SUPPLEMENTAL_DETAILS_ENDPOINT = '\/api\/website-analytics-details'/);
    assert.doesNotMatch(source, /SUMMARY_ENDPOINT = '\/api\/website-analytics-summary'/);
    assert.match(source, /GA4 connected · Van Finance \+ Rent2Buy/);
    assert.match(html, /GA4 is the source of truth for settled website reporting/);
    assert.match(html, /Highest bounce landing pages/);
    assert.match(html, /GA4 application activity/);
  });

  it('restores the shared sidebar renderer and separates today live completions from settled GA4', () => {
    const html = fs.readFileSync(new URL('../public/website-analytics/index.html', import.meta.url), 'utf8');
    const liveStatus = fs.readFileSync(new URL('../public/website-analytics/live-status.js', import.meta.url), 'utf8');
    assert.match(html, /\/shared\/sidebar-renderer\.js/);
    assert.match(html, /\/website-analytics\/live-status\.js/);
    assert.match(liveStatus, /MarketingCrmSidebarRenderer\.render/);
    assert.match(liveStatus, /Today · live application confirmations/);
    assert.match(liveStatus, /settled seven-day GA4 counters above intentionally stop at yesterday/);
  });

  it('keeps the concise GA4 panel in Content Operations with live completion confirmation', () => {
    const source = fs.readFileSync(new URL('../pages/DashboardPage.jsx', import.meta.url), 'utf8');
    const panel = fs.readFileSync(new URL('../components/Ga4PipelinePanel.jsx', import.meta.url), 'utf8');
    assert.match(source, /import Ga4PipelinePanel from "\.\.\/components\/Ga4PipelinePanel\.jsx"/);
    assert.match(source, /<Ga4PipelinePanel \/>/);
    assert.match(panel, /applicationCompletionSource==='first_party_live'/);
    assert.match(panel, /live confirmed/);
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { addDays, londonMidnightUtcIso, summaryFrom } from '../api/website-analytics-summary.js';
import { mapExitPages } from '../api/website-analytics-details.js';
import { addDays as addGa4Days, summaryFrom as ga4SummaryFrom } from '../api/ga4-website-analytics.js';
import { applicationSessionCounts, uniqueSessionCount } from '../api/_live-application-completions.js';
import { withLiveApplicationCompletions, withCrmApplicationOpportunities } from '../api/ga4-pipeline-summary.js';
import { groupApplicationOpportunities, buildApplicationOpportunitySummary } from '../api/_crm-application-opportunities.js';

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

  it('counts each application session once across starts and completions', () => {
    assert.deepEqual(applicationSessionCounts([
      { session_id: 'session-a', event_name: 'finance_application_reached' },
      { session_id: 'session-a', event_name: 'finance_application_reached' },
      { session_id: 'session-b', event_name: 'finance_application_reached' },
      { session_id: 'session-a', event_name: 'finance_application_completed' },
      { session_id: 'session-c', event_name: 'finance_application_completed' },
    ], {
      startEventName: 'finance_application_reached',
      completionEventName: 'finance_application_completed',
    }), {
      starts: 3,
      explicitStarts: 2,
      completions: 2,
    });
  });

  it('uses live unique application sessions while retaining raw GA4 event counts', () => {
    const result = withLiveApplicationCompletions({
      ok: true,
      sites: [{
        key: 'vanFinance',
        applicationStartsToday: 10,
        applicationCompletionsToday: 2,
        conversionRate: 0.2,
      }],
    }, {
      date: '2026-09-10',
      sites: { vanFinance: { starts: 5, explicitStarts: 5, completions: 3 } },
    });
    assert.equal(result.sites[0].ga4ApplicationStartsToday, 10);
    assert.equal(result.sites[0].ga4ApplicationCompletionsToday, 2);
    assert.equal(result.sites[0].liveApplicationStartsToday, 5);
    assert.equal(result.sites[0].liveExplicitApplicationStartsToday, 5);
    assert.equal(result.sites[0].liveApplicationCompletionsToday, 3);
    assert.equal(result.sites[0].applicationStartsToday, 5);
    assert.equal(result.sites[0].applicationCompletionsToday, 3);
    assert.equal(result.sites[0].applicationStartSource, 'first_party_live');
    assert.equal(result.sites[0].applicationCompletionSource, 'first_party_live');
    assert.equal(result.sites[0].effectiveConversionRate, 0.6);
  });

  it('falls back to GA4 when first-party application activity is quiet', () => {
    const result = withLiveApplicationCompletions({
      ok: true,
      sites: [{
        key: 'vanFinance',
        applicationStartsToday: 4,
        applicationCompletionsToday: 1,
        conversionRate: 0.25,
      }],
    }, {
      date: '2026-09-10',
      sites: { vanFinance: { starts: 0, explicitStarts: 0, completions: 0 } },
    });
    assert.equal(result.sites[0].applicationStartsToday, 4);
    assert.equal(result.sites[0].applicationCompletionsToday, 1);
    assert.equal(result.sites[0].applicationStartSource, 'ga4');
    assert.equal(result.sites[0].applicationCompletionSource, 'ga4');
    assert.equal(result.sites[0].effectiveConversionRate, 0.25);
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

  it('keeps the concise GA4 panel in Content Operations with unique-session application metrics', () => {
    const source = fs.readFileSync(new URL('../pages/DashboardPage.jsx', import.meta.url), 'utf8');
    const panel = fs.readFileSync(new URL('../components/Ga4PipelinePanel.jsx', import.meta.url), 'utf8');
    assert.match(source, /import Ga4PipelinePanel from "\.\.\/components\/Ga4PipelinePanel\.jsx"/);
    assert.match(source, /<Ga4PipelinePanel \/>/);
    assert.match(panel, /applicationStartSource==='first_party_live'/);
    assert.match(panel, /Applications received/);
    assert.match(panel, /CRM-verified/);
  });
});

describe('CRM-confirmed applications, 60-minute reporting rule', () => {
  const lead = (id, created_at, options = {}) => ({
    id, created_at, pipeline: 'vanFinance', source: 'Wix Finance Application',
    email: 'buyer@example.com', name: 'Alex Buyer', phone: '07700 900123', ...options,
  });
  it('uses the first submission as the anchor rather than extending the duplicate window forever', () => {
    const records = [
      lead(1, '2026-10-16T10:00:00Z'),
      lead(2, '2026-10-16T10:59:00Z'),
      lead(3, '2026-10-16T11:01:00Z'),
    ];
    const opportunities = groupApplicationOpportunities(records);
    assert.equal(opportunities.length, 2);
    assert.equal(opportunities[0].rawSubmissions, 2);
    assert.equal(opportunities[1].rawSubmissions, 1);
  });
  it('matches applicant names with shared emails and can fall back to phone and name', () => {
    const opportunities = groupApplicationOpportunities([
      lead(1, '2026-10-16T10:00:00Z'),
      lead(2, '2026-10-16T10:02:00Z', { email: 'different@example.com' }),
      lead(3, '2026-10-16T10:03:00Z', { name: 'Different Buyer', phone: '07700 900555' }),
    ]);
    assert.equal(opportunities.length, 2);
    assert.equal(opportunities[0].rawSubmissions, 2);
  });
  it('does not conflate finance with Rent2Buy or silently count manually created leads', () => {
    const opportunities = groupApplicationOpportunities([
      lead(1, '2026-10-16T10:00:00Z'),
      lead(2, '2026-10-16T10:02:00Z', { source: 'Rent2BuyVans.co.uk', pipeline: 'rent2buy' }),
      lead(3, '2026-10-16T10:05:00Z', { source: 'Manual' }),
      lead(4, '2026-10-16T10:06:00Z', { source: 'VFC Website Reservation' }),
    ]);
    assert.equal(opportunities.length, 2);
  });
  it('retains a reapplication months later as a new opportunity', () => {
    const opportunities = groupApplicationOpportunities([
      lead(1, '2026-08-16T10:00:00Z'),
      lead(2, '2026-10-16T10:00:00Z'),
    ]);
    assert.equal(opportunities.length, 2);
  });
  it('does not double count a submission after midnight when the first was before midnight', () => {
    const rows = [
      lead(1, '2026-10-16T22:55:00Z'),
      lead(2, '2026-10-16T23:03:00Z'),
    ];
    const stats = buildApplicationOpportunitySummary(rows, { now: new Date('2026-10-16T23:09:00Z') });
    assert.equal(stats.date, '2026-10-17');
    assert.equal(stats.periods.today.total, 0);
    assert.equal(stats.periods.sevenDays.total, 1);
    assert.equal(stats.periods.sevenDays.duplicates, 1);
  });
  it('counts actual CRM source records and repeats without exposing applicant data', () => {
    const rows = [
      lead(1, '2026-10-16T12:00:00Z'),
      lead(2, '2026-10-16T12:10:00Z'),
      lead(3, '2026-10-16T14:00:00Z', { source: 'VanFinance.co', email: 'another@example.com' }),
      lead(4, '2026-10-16T14:05:00Z', { source: 'Rent2BuyVans.co.uk', pipeline: 'rent2buy' }),
    ];
    const stats = buildApplicationOpportunitySummary(rows, { now: new Date('2026-10-16T22:00:00Z') });
    assert.equal(stats.periods.today.total, 3);
    assert.equal(stats.periods.today.finance, 2);
    assert.equal(stats.periods.today.rent2buy, 1);
    assert.equal(stats.periods.today.sites.vanFinance, 1);
    assert.equal(stats.periods.today.sites.vanfinanceCo, 1);
    assert.equal(stats.periods.today.duplicates, 1);
    assert.doesNotMatch(JSON.stringify(stats), /buyer@example.com/);
  });
  it('returns unknown, not a fabricated zero, if CRM counts are unavailable', () => {
    const summary = {sites:[{key:'vanFinance',configured:true}]};
    const unavailable = withCrmApplicationOpportunities(summary, null);
    assert.equal(unavailable.sites[0].crmConfirmedApplicationsToday, null);
    assert.equal(unavailable.applicationStatsStatus,'unavailable');
    const verified = withCrmApplicationOpportunities(summary, {
      periods: {today: {sites:{vanFinance:7}},sevenDays:{sites:{vanFinance:45}},twentyEightDays:{sites:{vanFinance:160}}},
    });
    assert.equal(verified.sites[0].crmConfirmedApplicationsToday, 7);
    assert.equal(verified.sites[0].crmConfirmedApplications7Days, 45);
  });
});

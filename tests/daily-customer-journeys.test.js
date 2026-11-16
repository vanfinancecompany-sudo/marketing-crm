import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { journeyPeriod, summariseCustomerJourneys } from '../lib/customerJourneys.js';

const s = (id, more = {}) => ({
  session_id: id, visitor_id: 'visitor-' + id, landing_path: '/', page_view_count: 1,
  source: 'google', device_category: 'mobile', ...more,
});
const e = (id, name, path = '/', occurred_at = '2026-11-13T11:00:00Z', more = {}) => ({
  session_id: id, event_name: name, path, occurred_at, ...more,
});

test('London reporting periods include yesterday and seven settled days', () => {
  const now = new Date('2026-11-14T20:30:00Z');
  assert.deepEqual(journeyPeriod('yesterday', now), {
    key: 'yesterday', startDate: '2026-11-13', endExclusive: '2026-11-14',
    label: 'Yesterday · completed day', provisional: false,
  });
  assert.equal(journeyPeriod('7d', now).startDate, '2026-11-07');
  assert.equal(journeyPeriod('7d', now).endExclusive, '2026-11-14');
  assert.equal(journeyPeriod('previous7d', now).startDate, '2026-10-31');
  assert.equal(journeyPeriod('previous7d', now).endExclusive, '2026-11-07');
  assert.equal(journeyPeriod('today', now).provisional, true);
  assert.equal(journeyPeriod('today', new Date('2026-07-01T23:30:00Z')).startDate, '2026-07-02');
  assert.throws(() => journeyPeriod('year', now), /Unsupported period/);
});

test('a Rent2Buy heartbeat page counter does not invent detailed journeys', () => {
  const result = summariseCustomerJourneys({
    siteKey: 'rent2buy',
    sessions: [s('a', { page_view_count: 6 }), s('b', { page_view_count: 4 })],
    events: [e('a', 'rent2buy_full_application_opened'),
      e('a', 'rent2buy_application_completed'),
      e('a', 'rent2buy_application_completed'),
      e('b', 'rent2buy_full_application_opened')],
  });
  assert.equal(result.capturedSessions, 2);
  assert.equal(result.pageViewCounters, 10);
  assert.equal(result.recordedPageEvents, 0);
  assert.equal(result.pageEventCoveragePct, 0);
  assert.equal(result.sessionsMissingPageEvent, 2);
  assert.deepEqual(result.routes, []);
  assert.equal(result.applicationStartSessions, 2);
  assert.equal(result.applicationCompletionEvents, 1);
  assert.equal(result.status, 'partial');
});

test('Van Finance route sequences require three sessions and follow event times', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const sessions = ids.map((id) => s(id, { page_view_count: 3 }));
  const events = ids.flatMap((id) => [
    e(id, 'page_view', '/van/XYZ', '2026-11-13T11:02:00Z'),
    e(id, 'page_view', '/', '2026-11-13T11:00:00Z'),
    e(id, 'page_view', '/', '2026-11-13T11:01:00Z'),
    e(id, 'page_view', id === 'd' ? '/unique' : '/apply', '2026-11-13T11:03:00Z'),
  ]);
  events.push(e('b', 'finance_application_reached'));
  events.push(e('b', 'finance_application_reached'));
  events.push(e('c', 'finance_application_completed'));
  events.push(e('outsider', 'finance_application_completed'));
  const result = summariseCustomerJourneys({ sessions, events, siteKey: 'vanFinance' });
  assert.equal(result.capturedSessions, 4);
  assert.equal(result.sessionsWithPageEvent, 4);
  assert.equal(result.recordedPageEvents, 16);
  assert.equal(result.applicationStartSessions, 1);
  assert.equal(result.applicationCompletionEvents, 1);
  assert.equal(result.routes.length, 1);
  assert.deepEqual(result.routes[0], {
    steps: ['/', '/van/XYZ', '/apply'], sessions: 3,
  });
  assert.equal(JSON.stringify(result).includes('visitor-a'), false);
  assert.equal(JSON.stringify(result).includes('outsider'), false);
});

test('vehicle and landing-page rankings avoid single-observation publication', () => {
  const result = summariseCustomerJourneys({
    sessions: [s('a', { landing_path: '/van/a' }), s('b', { landing_path: '/van/a' }),
      s('c', { landing_path: '/van/a' }), s('d', { landing_path: '/one-off' })],
    events: [
      e('a', 'vehicle_view', '/', undefined, { vehicle_registration: 'AB12CDE' }),
      e('b', 'vehicle_view', '/', undefined, { vehicle_registration: 'AB12CDE' }),
      e('c', 'vehicle_view', '/', undefined, { vehicle_registration: 'AB12CDE' }),
      e('d', 'vehicle_view', '/', undefined, { vehicle_registration: 'ZZ10ZZZ' }),
    ],
  });
  assert.deepEqual(result.topLandingPages, [{ path: '/van/a', count: 3 }]);
  assert.deepEqual(result.topVehicles, [{ registration: 'AB12CDE', count: 3 }]);
});

test('daily journey panel is visible and GA4 headline reporting stays intact', () => {
  const html = fs.readFileSync(new URL('../public/website-analytics/index.html', import.meta.url), 'utf8');
  const js = fs.readFileSync(new URL('../public/website-analytics/customer-journeys.js', import.meta.url), 'utf8');
  const old = fs.readFileSync(new URL('../public/website-analytics/app.js', import.meta.url), 'utf8');
  const api = fs.readFileSync(new URL('../api/website-customer-journeys.js', import.meta.url), 'utf8');
  assert.match(html, /id="dailyJourneys"/);
  assert.match(html, /data-journey-period="today"/);
  assert.match(html, /data-journey-period="yesterday"/);
  assert.match(html, /data-journey-period="7d"/);
  assert.match(html, /\/website-analytics\/customer-journeys\.js/);
  assert.match(html, /GA4 is the source of truth/);
  assert.match(js, /api\/website-customer-journeys/);
  assert.match(js, /journeyQuality/);
  assert.match(old, /GA4_ENDPOINT = '\/api\/ga4-website-analytics'/);
  assert.match(api, /Promise\.allSettled/);
  assert.match(api, /ANALYTICS_SITE_ORIGINS\.vfc/);
  assert.match(api, /ANALYTICS_SITE_ORIGINS\.rent2buy/);
  assert.doesNotMatch(api, /response\.status\([^)]+\)\.json\(\{\s*events\s*,/);
});

test('mobile homepage stock journey uses explicit same-session events and excludes desktop or missing page routes', () => {
  const sessions = [
    s('a', { landing_path: '/', device_category: 'mobile', page_view_count: 4 }),
    s('b', { landing_path: '/', device_category: 'mobile', page_view_count: 10 }),
    s('c', { landing_path: '/', device_category: 'desktop' }),
    s('d', { landing_path: '/vans', device_category: 'mobile' }),
    s('e', { landing_path: '/', device_category: 'mobile', page_view_count: 10 }),
  ];
  const t = (minute) => '2026-11-13T11:' + String(minute).padStart(2, '0') + ':00Z';
  const events = [
    e('a', 'page_view', '/', t(0)),
    e('a', 'page_view', '/vans', t(1)),
    e('a', 'vehicle_view', '/vans/ab12cde', t(2)),
    e('a', 'page_view', '/vans/ab12cde', t(3)),
    e('a', 'finance_application_reached', '/apply', t(4)),
    e('a', 'finance_application_started', '/apply', t(5)),
    e('a', 'finance_application_completed', '/apply', t(6)),
    e('a', 'finance_application_completed', '/apply', t(6)),
    e('b', 'page_view', '/', t(0)),
    e('b', 'page_view', '/cars', t(2)),
    e('b', 'vehicle_view', '/vans/prehome', '2026-11-13T10:59:00Z'),
    e('c', 'page_view', '/', t(0)),
    e('c', 'page_view', '/vans', t(1)),
    e('d', 'page_view', '/vans', t(1)),
    e('e', 'finance_application_completed', '/apply', t(5)),
  ];
  const funnel = summariseCustomerJourneys({ sessions, events, siteKey: 'vanFinance' }).mobileStockJourney;
  assert.equal(funnel.capturedMobileHomepageSessions, 3);
  assert.equal(funnel.observedMobileHomepageSessions, 2);
  assert.equal(funnel.observedHomepageCoveragePct, 66.7);
  assert.equal(funnel.stockListingSessions, 2);
  assert.equal(funnel.vehicleDetailSessions, 1);
  assert.equal(funnel.applicationEntrySessions, 1);
  assert.equal(funnel.deliberateApplicationStartSessions, 1);
  assert.equal(funnel.applicationCompletionSessions, 1);
});

test('Rent2Buy category pages and vehicle pages contribute without inventing direct clicks', () => {
  const result = summariseCustomerJourneys({
    siteKey: 'rent2buy',
    sessions: [s('r', { device_category: 'mobile', landing_path: '/' })],
    events: [
      e('r', 'page_view', '/', '2026-11-13T09:00:00Z'),
      e('r', 'page_view', '/view-small-vans', '2026-11-13T09:01:00Z'),
      e('r', 'page_view', '/van-pages/ab12cde', '2026-11-13T09:02:00Z'),
      e('r', 'rent2buy_full_application_opened', '/apply-for-no-credit-check-rent2buy-vans', '2026-11-13T09:03:00Z'),
    ],
  }).mobileStockJourney;
  assert.equal(result.capturedMobileHomepageSessions, 1);
  assert.equal(result.observedMobileHomepageSessions, 1);
  assert.equal(result.stockListingSessions, 1);
  assert.equal(result.vehicleDetailSessions, 1);
  assert.equal(result.applicationEntrySessions, 1);
  assert.equal(result.deliberateApplicationStartSessions, 1);
  assert.equal(result.applicationCompletionSessions, 0);
});

test('mobile stock dashboard uses existing first-party events and keeps GA4 benchmark', () => {
  const html = fs.readFileSync(new URL('../public/website-analytics/index.html', import.meta.url), 'utf8');
  const dashboard = fs.readFileSync(new URL('../public/website-analytics/customer-journeys.js', import.meta.url), 'utf8');
  assert.match(html, /id="journeyMobileStock"/);
  assert.match(html, /data-journey-period="previous7d"/);
  assert.match(dashboard, /renderMobileStock/);
  assert.match(dashboard, /same-session observations/i);
  assert.match(html, /GA4 is the source of truth/);
});

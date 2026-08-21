import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { addDays, londonMidnightUtcIso, summaryFrom } from '../api/website-analytics-summary.js';
import { mapExitPages } from '../api/website-analytics-details.js';

describe('Website Analytics fresh data', () => {
  it('builds rolling date keys safely', () => {
    assert.equal(addDays('2026-08-20', -6), '2026-08-14');
    assert.equal(addDays('2026-08-14', -7), '2026-08-07');
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

  it('keeps exit-session ranking but restores the true page exit rate', () => {
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

  it('loads headline and detail data directly from Marketing CRM Wix API routes', () => {
    const source = fs.readFileSync(new URL('../public/website-analytics/app.js', import.meta.url), 'utf8');
    assert.match(source, /SUMMARY_ENDPOINT = '\/api\/website-analytics-summary'/);
    assert.match(source, /DETAILS_ENDPOINT = '\/api\/website-analytics-details'/);
    assert.doesNotMatch(source, /_functions\/marketingWebsiteAnalytics/);
    assert.doesNotMatch(source, /_functions\/marketingApplicationFunnel/);
    assert.match(source, /Postcode supplied<\/span><strong>Not measured/);
    assert.match(source, /renderWatchlist\(data, data\.funnel, summaryData\)/);
  });
});

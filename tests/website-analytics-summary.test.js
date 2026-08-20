import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { addDays, londonMidnightUtcIso, summaryFrom } from '../api/website-analytics-summary.js';

describe('Website Analytics fresh summary', () => {
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

  it('uses the fresh summary only for headline metrics and labels stale detail separately', () => {
    const source = fs.readFileSync(new URL('../public/website-analytics/app.js', import.meta.url), 'utf8');
    assert.match(source, /SUMMARY_ENDPOINT = '\/api\/website-analytics-summary'/);
    assert.match(source, /summaryData\?\.current\?\.summary/);
    assert.match(source, /Traffic through \$\{trafficDate\} · detailed tables through \$\{detailDate\}/);
    assert.match(source, /Promise\.all\(\[/);
  });
});

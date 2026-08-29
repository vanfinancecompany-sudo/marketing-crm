import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {effectiveAnalyticsCutoverDate,resolveAnalyticsCutoverDate,SAFE_WIX_ONLY_CUTOVER} from '../api/_analytics-rollout.js';
import {splitAnalyticsRange} from '../api/_first-party-analytics.js';

describe('first-party analytics rollout safeguards',()=>{
  it('fails safe to Wix when no real cutover date is configured',()=>{
    assert.equal(resolveAnalyticsCutoverDate(''),null);
    assert.equal(effectiveAnalyticsCutoverDate(''),SAFE_WIX_ONLY_CUTOVER);
    assert.deepEqual(splitAnalyticsRange('2026-08-29','2026-09-05',effectiveAnalyticsCutoverDate('')),[
      {source:'wix',startDate:'2026-08-29',endExclusive:'2026-09-05'},
    ]);
  });

  it('accepts only real YYYY-MM-DD cutover dates',()=>{
    assert.equal(resolveAnalyticsCutoverDate('2026-08-31'),'2026-08-31');
    assert.equal(resolveAnalyticsCutoverDate('2026-02-31'),null);
    assert.equal(resolveAnalyticsCutoverDate('31-08-2026'),null);
  });

  it('uses a configured cutover to split Wix and first-party periods',()=>{
    assert.deepEqual(splitAnalyticsRange('2026-08-29','2026-09-03',effectiveAnalyticsCutoverDate('2026-08-31')),[
      {source:'wix',startDate:'2026-08-29',endExclusive:'2026-08-31'},
      {source:'first_party',startDate:'2026-08-31',endExclusive:'2026-09-03'},
    ]);
  });

  it('does not assume source columns exist on legacy compatibility tables',()=>{
    const endpoint=fs.readFileSync(new URL('../api/track-site-analytics.js',import.meta.url),'utf8');
    const compatibility=endpoint.match(/async function updateExistingAnalytics[\s\S]+?\n}\n\nexport default/)?.[0]||'';
    assert.match(compatibility,/site_live_sessions/);
    assert.match(compatibility,/vehicle_views/);
    assert.doesNotMatch(compatibility,/source:\s*payload\.source/);
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applicationSessionCounts } from '../api/_live-application-completions.js';
import { buildFinanceApplicationFunnel } from '../api/finance-application-funnel.js';
import { withLiveApplicationCompletions } from '../api/ga4-pipeline-summary.js';

describe('true finance application start analytics', () => {
  it('keeps application page reaches separate from deliberate starts', () => {
    assert.deepEqual(applicationSessionCounts([
      { session_id: 'session-a', event_name: 'finance_application_reached' },
      { session_id: 'session-b', event_name: 'finance_application_reached' },
      { session_id: 'session-c', event_name: 'finance_application_reached' },
      { session_id: 'session-a', event_name: 'finance_application_started' },
      { session_id: 'session-a', event_name: 'finance_application_completed' },
    ], {
      reachedEventName: 'finance_application_reached',
      startEventName: 'finance_application_started',
      completionEventName: 'finance_application_completed',
    }), {
      reaches: 3,
      starts: 1,
      explicitStarts: 1,
      completions: 1,
    });
  });

  it('builds the live funnel from true starts and includes every live form stage', () => {
    const funnel = buildFinanceApplicationFunnel([
      { session_id: 'session-a', event_name: 'finance_application_reached', metadata: {} },
      { session_id: 'session-b', event_name: 'finance_application_reached', metadata: {} },
      { session_id: 'session-c', event_name: 'finance_application_reached', metadata: {} },
      { session_id: 'session-a', event_name: 'finance_application_step_viewed', metadata: { step_name: 'Application type' } },
      { session_id: 'session-b', event_name: 'finance_application_step_viewed', metadata: { step_name: 'Application type' } },
      { session_id: 'session-c', event_name: 'finance_application_step_viewed', metadata: { step_name: 'Application type' } },
      { session_id: 'session-a', event_name: 'finance_application_started', metadata: {} },
      { session_id: 'session-a', event_name: 'finance_application_step_viewed', metadata: { step_name: 'About you' } },
      { session_id: 'session-a', event_name: 'finance_application_step_viewed', metadata: { step_name: 'A little more about you' } },
      { session_id: 'session-a', event_name: 'finance_application_completed', metadata: {} },
    ]);

    assert.equal(funnel.reaches, 3);
    assert.equal(funnel.starts, 1);
    assert.equal(funnel.explicitStarts, 1);
    assert.equal(funnel.completions, 1);
    assert.equal(funnel.conversionRate, 1);
    assert.equal(funnel.steps.find((step) => step.name === 'Application type')?.viewed, 1);
    assert.equal(funnel.steps.find((step) => step.name === 'A little more about you')?.viewed, 1);
  });

  it('does not fall back to inflated GA4 starts when first-party page reaches exist but nobody truly started', () => {
    const result = withLiveApplicationCompletions({
      ok: true,
      sites: [{
        key: 'vanFinance',
        applicationStartsToday: 12,
        applicationCompletionsToday: 0,
        conversionRate: 0,
      }],
    }, {
      date: '2026-09-12',
      sites: { vanFinance: { reaches: 5, starts: 0, explicitStarts: 0, completions: 0 } },
    });

    assert.equal(result.sites[0].liveApplicationReachesToday, 5);
    assert.equal(result.sites[0].applicationStartsToday, 0);
    assert.equal(result.sites[0].applicationStartSource, 'first_party_live');
    assert.equal(result.sites[0].effectiveConversionRate, 0);
  });

  it('accepts the new start event and the previously missing application step without storing the selected answer', () => {
    const endpoint = fs.readFileSync(new URL('../api/track-finance-funnel.js', import.meta.url), 'utf8');
    const panel = fs.readFileSync(new URL('../components/Ga4PipelinePanel.jsx', import.meta.url), 'utf8');
    const liveFunnel = fs.readFileSync(new URL('../public/website-analytics/live-finance-funnel.js', import.meta.url), 'utf8');

    assert.match(endpoint, /finance_application_started/);
    assert.match(endpoint, /A little more about you/);
    assert.doesNotMatch(endpoint, /applicationType|application_type|Limited Company|Self Employed/);
    assert.match(panel, /page reaches/);
    assert.match(panel, /Unique app starts/);
    assert.match(liveFunnel, /A start begins when the customer chooses an application type/);
  });
});

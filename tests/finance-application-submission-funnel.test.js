import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildFinanceApplicationFunnel } from '../api/finance-application-funnel.js';
import trackFinanceFunnel from '../api/track-finance-funnel.js';

test('submission attempts, failures and the reconciliation queue are counted by unique session', () => {
  const funnel = buildFinanceApplicationFunnel([
    { session_id: 's1', event_name: 'finance_application_started' },
    { session_id: 's1', event_name: 'finance_application_submit_attempted' },
    { session_id: 's1', event_name: 'finance_application_submit_attempted' },
    { session_id: 's1', event_name: 'finance_application_submit_failed', metadata: { failure_reason: 'timeout' } },
    { session_id: 's1', event_name: 'finance_application_completed' },
    { session_id: 's2', event_name: 'finance_application_started' },
    { session_id: 's2', event_name: 'finance_application_submit_attempted' },
    { session_id: 's2', event_name: 'finance_application_submit_failed', metadata: { failure_reason: 'network' } },
    { session_id: 's3', event_name: 'finance_application_submit_attempted' },
    { session_id: 's3', event_name: 'finance_application_completed' },
    { session_id: 's3', event_name: 'finance_application_completed' },
  ]);
  assert.equal(funnel.submitAttempts, 3);
  assert.equal(funnel.submitFailures, 2);
  assert.equal(funnel.unresolvedFailures, 1);
  assert.equal(funnel.completions, 2);
  assert.equal(funnel.submitAttemptEvents, 4);
  assert.equal(funnel.submitFailureEvents, 2);
  assert.equal(funnel.completionEvents, 3);
  assert.deepEqual(funnel.failureReasons.map((r) => r.name).sort(), ['network', 'timeout']);
});

test('funnel intake persists attempt and failure events without accepting upstream text', async (t) => {
  const settings = { SUPABASE_URL: 'https://analytics.example.test', SUPABASE_SECRET_KEY: 'synthetic-key' };
  for (const [name, value] of Object.entries(settings)) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
  }
  const writes = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(String(url), 'https://analytics.example.test/rest/v1/rpc/ingest_site_analytics_event');
    writes.push(JSON.parse(options.body));
    return Response.json(null);
  });
  const origin = 'https://www.vanfinancecompany.co.uk';
  const sessionId = randomUUID();
  const visitorId = randomUUID();
  async function submit(eventName, extra = {}) {
    const headers = new Map();
    let result;
    const response = {
      setHeader(name, value) { headers.set(name, value); },
      end(body) { result = JSON.parse(body); },
    };
    await trackFinanceFunnel({
      method: 'POST', headers: { origin },
      body: { eventName, sessionId, visitorId, eventId: randomUUID(), ...extra },
    }, response);
    assert.equal(headers.get('Access-Control-Allow-Origin'), origin);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(result, { ok: true, accepted: true });
  }
  await submit('finance_application_submit_attempted');
  await submit('finance_application_submit_failed', { failureReason: 'timeout' });
  await submit('finance_application_submit_failed', { failureReason: 'synthetic@example.test', message: 'synthetic upstream error' });
  assert.deepEqual(writes.map(row => row.p_event_name), [
    'finance_application_submit_attempted', 'finance_application_submit_failed', 'finance_application_submit_failed',
  ]);
  assert.deepEqual(writes.map(row => row.p_metadata.failure_reason), [undefined, 'timeout', 'unconfirmed']);
  assert.equal(new Set(writes.map(row => row.p_event_id)).size, 3);
  assert.doesNotMatch(JSON.stringify(writes), /synthetic@example\.test|synthetic upstream error/);
});

test('Rent2Buy starts count postcode checks, not page opens', async () => {
  const { applicationSessionCounts } = await import('../api/_live-application-completions.js');
  const counts = applicationSessionCounts([
    { session_id: 'a', event_name: 'rent2buy_full_application_opened' },
    { session_id: 'b', event_name: 'rent2buy_full_application_opened' },
    { session_id: 'b', event_name: 'rent2buy_postcode_fail' },
    { session_id: 'c', event_name: 'rent2buy_full_application_opened' },
    { session_id: 'c', event_name: 'rent2buy_postcode_pass' },
    { session_id: 'c', event_name: 'rent2buy_application_completed' },
  ], {
    reachedEventName: 'rent2buy_full_application_opened',
    startEventName: 'rent2buy_postcode_pass',
    startEventNames: ['rent2buy_postcode_pass', 'rent2buy_postcode_fail', 'rent2buy_postcode_gate_reached'],
    completionEventName: 'rent2buy_application_completed',
  });
  assert.deepEqual(counts, { reaches: 3, starts: 2, explicitStarts: 2, completions: 1 });
});

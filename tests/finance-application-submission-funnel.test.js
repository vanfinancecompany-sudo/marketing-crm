import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildFinanceApplicationFunnel } from '../api/finance-application-funnel.js';

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
  assert.deepEqual(funnel.failureReasons.map((r) => r.name).sort(), ['network', 'timeout']);
});

test('funnel intake accepts only fixed failure categories, never upstream text', () => {
  const endpoint = fs.readFileSync(new URL('../api/track-finance-funnel.js', import.meta.url), 'utf8');
  assert.match(endpoint, /'finance_application_submit_attempted'/);
  assert.match(endpoint, /'finance_application_submit_failed'/);
  assert.match(endpoint, /FAILURE_REASONS = new Set\(\['timeout', 'network', 'unconfirmed', 'rejected', 'unavailable'\]\)/);
  assert.match(endpoint, /cleanEnum\(body\.failureReason, FAILURE_REASONS\)/);
  assert.doesNotMatch(endpoint, /body\.(?:error|message)/);
});

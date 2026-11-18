import test from 'node:test';
import assert from 'node:assert/strict';
import { processCrmContactReceipt } from '../lib/crmContactReceipt.js';
import { enqueueCrmEmailEvent, dispatchCrmEmailEvent } from '../lib/crmEmailEventOutbox.js';

test('contact delivery IDs isolate requests, serialize repeats and retain uncertain writes', async () => {
  const rows = new Map();
  const table = {
    upsert(value) { return { select: () => ({ maybeSingle: async () => {
      if (rows.has(value.delivery_key)) return { data: null };
      rows.set(value.delivery_key, { ...value, created_at: new Date().toISOString() });
      return { data: value };
    } }) }; },
    select() { return { eq: (_column, key) => ({ single: async () => ({ data: rows.get(key) }) }) }; },
    update(changes) { return { eq: (_column, key) => ({ select: () => ({ single: async () => {
      Object.assign(rows.get(key), changes);
      return { data: { delivery_key: key } };
    } }) }) }; }
  };
  const db = { from(name) { assert.equal(name, 'marketing_crm_contact_receipts'); return table; } };
  const value = { email: 'synthetic@example.test', source: 'test' };
  let entered, release;
  const executing = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let count = 0;
  async function apply() {
    count++;
    entered();
    await gate;
    return { mode: 'updated', eventType: 'customer_updated', contact: { private: 'synthetic' } };
  }
  const first = processCrmContactReceipt(db, 'crm-intake-1', value, apply);
  await executing;
  try {
    assert.equal((await processCrmContactReceipt(db, 'crm-intake-1', value, apply)).status, 425);
  } finally {
    release();
  }
  const receipt = await first;
  assert.deepEqual(receipt.body, { ok: true, mode: 'updated', eventType: 'customer_updated' });
  assert.deepEqual(await processCrmContactReceipt(db, 'crm-intake-1', { source: 'test', email: value.email }, apply), receipt);
  assert.equal((await processCrmContactReceipt(db, 'crm-intake-1', { ...value, source: 'different' }, apply)).status, 409);
  assert.equal(count, 1);
  assert.equal((await processCrmContactReceipt(db, 'crm-intake-2', value, apply)).status, 200);
  assert.equal(count, 2);

  await assert.rejects(processCrmContactReceipt(db, 'crm-intake-3', value, async () => { throw Error('write unknown'); }));
  rows.get('crm-intake-3').created_at = '2026-01-01T00:00:00Z';
  assert.equal((await processCrmContactReceipt(db, 'crm-intake-3', value, apply)).status, 503);
  assert.equal(count, 2);
});

test('provider event is stored before forwarding and retried with the same dispatch identity', async () => {
  const rows = new Map();
  const db = {
    from() { return {
      upsert: async row => { if (!rows.has(row.event_key)) rows.set(row.event_key, { ...row, attempts: 0 }); return {}; },
      update: changes => ({ eq: (_column, key) => ({ eq: async (_claimColumn, claim) => {
        const row = rows.get(key);
        assert.equal(row.claim_id, claim);
        Object.assign(row, changes);
        return {};
      } }) })
    }; },
    async rpc(_function, { p_event_key }) {
      const row = rows.get(p_event_key || 'event-one');
      if (!row || row.status === 'complete') return { data: [] };
      row.attempts++;
      row.claim_id = 'claim-' + row.attempts;
      return { data: [row] };
    }
  };
  const dispatchId = '03c33c0d-149a-4c6a-bcbf-27893e1c6047';
  const payload = { category: ['transactional', 'rent2buy-proof-link'], crm_proof_dispatch_id: dispatchId };
  const event = { provider_event_id: 'event-one', provider_message_id: 'message-one', event_type: 'delivered' };
  assert.equal(await enqueueCrmEmailEvent(db, payload, event), true);
  const calls = [];
  const options = { endpoint: 'https://isolated.example.test/events', apiKey:'synthetic',
    fetchImpl: async (url, input) => {
      calls.push({ url, body: JSON.parse(input.body) });
      return { ok: calls.length > 1, status: calls.length > 1 ? 200 : 503 };
    }
  };
  assert.equal((await dispatchCrmEmailEvent(db, options, 'event-one')).forwarded, false);
  assert.equal(rows.get('event-one').status, 'pending');
  assert.equal(await enqueueCrmEmailEvent(db, payload, event), true);
  assert.equal((await dispatchCrmEmailEvent(db, options)).forwarded, true);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0].body.proof_dispatch_id, dispatchId);
  assert.deepEqual(rows.get('event-one').payload, {});
});

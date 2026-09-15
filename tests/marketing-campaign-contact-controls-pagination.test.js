import test from "node:test";
import assert from "node:assert/strict";
import { loadCampaignContactExclusions } from "../lib/marketingCampaignContactControls.js";

function createSupabaseProbe() {
  const orders = [];

  return {
    orders,
    from(table) {
      assert.equal(table, "marketing_email_send_recipients");
      const state = { select: "" };
      const query = {
        select(value) {
          state.select = value;
          return query;
        },
        eq() {
          return query;
        },
        in() {
          return query;
        },
        not() {
          return query;
        },
        gt() {
          return query;
        },
        order(column, options) {
          orders.push({ select: state.select, column, options });
          return query;
        },
        async range() {
          return { data: [], error: null };
        },
      };
      return query;
    },
  };
}

test("campaign contact exclusions use immutable recipient ordering for every paginated read", async () => {
  const supabase = createSupabaseProbe();

  await loadCampaignContactExclusions(
    supabase,
    {
      recent_contact_days: 7,
      exclude_campaign_ids: ["11111111-1111-4111-8111-111111111111"],
    },
    "22222222-2222-4222-8222-222222222222",
    (result) => result,
    Date.UTC(2026, 8, 15, 18, 0, 0)
  );

  assert.deepEqual(supabase.orders, [
    {
      select: "customer_id,email",
      column: "id",
      options: { ascending: true },
    },
    {
      select: "email,first_sent_at,send_type",
      column: "id",
      options: { ascending: true },
    },
  ]);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_DAILY_TARGETS,
  aggregatePeriod,
  londonDateKey,
  londonDateRange,
  resolveTargetsForDate,
  summarizeDailyActivity,
} from "../lib/marketingDailyOperations.js";

test("London dates and day ranges respect summer and winter time", () => {
  assert.equal(londonDateKey(new Date("2026-07-19T23:30:00Z")), "2026-07-20");
  assert.deepEqual(londonDateRange("2026-07-19"), {
    start: "2026-07-18T23:00:00.000Z",
    end: "2026-07-19T23:00:00.000Z",
  });
  assert.deepEqual(londonDateRange("2026-01-19"), {
    start: "2026-01-19T00:00:00.000Z",
    end: "2026-01-20T00:00:00.000Z",
  });
});

test("effective schedules preserve history and a one-day override wins", () => {
  const schedules = [
    { effective_from: "2026-01-01", weekday: 1, ...DEFAULT_DAILY_TARGETS },
    { effective_from: "2026-07-01", weekday: 1, ...DEFAULT_DAILY_TARGETS, emails_sent: 250 },
  ];
  const overrides = [{ activity_date: "2026-07-20", ...DEFAULT_DAILY_TARGETS, emails_sent: 50 }];
  assert.equal(resolveTargetsForDate({ dateKey: "2026-06-29", weekday: 1, schedules, overrides }).emails_sent, 200);
  assert.equal(resolveTargetsForDate({ dateKey: "2026-07-13", weekday: 1, schedules, overrides }).emails_sent, 250);
  assert.equal(resolveTargetsForDate({ dateKey: "2026-07-20", weekday: 1, schedules, overrides }).emails_sent, 50);
});

test("off days have no shortfall and count as complete", () => {
  const summary = summarizeDailyActivity({ targets: { ...DEFAULT_DAILY_TARGETS, off_day: true } });
  assert.equal(summary.remaining_total, 0);
  assert.equal(summary.completion_percentage, 100);
  assert.equal(summary.complete, true);
});

test("daily activity counts durable social events and production submissions once", () => {
  const summary = summarizeDailyActivity({
    targets: DEFAULT_DAILY_TARGETS,
    events: [
      { activity_type: "van_finance_facebook_post", quantity: 2 },
      { activity_type: "rent2buy_reel", quantity: 99 },
    ],
    generatedReels: [
      { id: "finance-reel", pipeline: "vanFinance" },
      { id: "rent-reel", pipeline: "rent2buy" },
      { id: "rent-reel", pipeline: "rent2buy" },
    ],
    emailRecipients: [
      { id: "one", send_type: "production", first_sent_at: "2026-07-19T10:00:00Z" },
      { id: "one", send_type: "production", first_sent_at: "2026-07-19T10:00:00Z" },
      { id: "two", send_type: "production", provider_message_id: "sg-2" },
      { id: "test", send_type: "test", provider_message_id: "sg-test" },
      { id: "draft", send_type: "production", status: "pending" },
    ],
  });
  assert.equal(summary.metrics.van_finance_facebook_post.completed, 2);
  assert.equal(summary.metrics.van_finance_reel.completed, 1);
  assert.equal(summary.metrics.rent2buy_reel.completed, 1);
  assert.equal(summary.metrics.emails_sent.completed, 2);
});

test("overall completion gives each active target equal weight", () => {
  const recipients = Array.from({ length: 200 }, (_, index) => ({ id: `email-${index}`, send_type: "production", first_sent_at: "2026-07-19T10:00:00Z" }));
  const summary = summarizeDailyActivity({ targets: DEFAULT_DAILY_TARGETS, emailRecipients: recipients });
  assert.equal(summary.metrics.emails_sent.percentage, 100);
  assert.equal(summary.completion_percentage, 20);
});

test("completed production send batches provide the automatic email total", () => {
  const summary = summarizeDailyActivity({
    targets: DEFAULT_DAILY_TARGETS,
    emailSends: [
      { id: "batch-one", send_type: "production", status: "completed", sent_count: 100 },
      { id: "batch-one", send_type: "production", status: "completed", sent_count: 100 },
      { id: "batch-two", send_type: "production", status: "partially_failed", sent_count: 25 },
      { id: "test", send_type: "test", status: "completed", sent_count: 99 },
      { id: "failed", send_type: "production", status: "failed", sent_count: 50 },
    ],
  });
  assert.equal(summary.metrics.emails_sent.completed, 125);
});

test("period totals expose completed, target, shortfall, average and percentage", () => {
  const first = summarizeDailyActivity({ targets: { ...DEFAULT_DAILY_TARGETS, emails_sent: 2 }, emailRecipients: [{ id: "one", send_type: "production", status: "accepted" }] });
  const second = summarizeDailyActivity({ targets: { ...DEFAULT_DAILY_TARGETS, emails_sent: 2 }, emailRecipients: [{ id: "two", send_type: "production", status: "accepted" }, { id: "three", send_type: "production", status: "delivered" }] });
  const totals = aggregatePeriod([first, second]);
  assert.deepEqual(totals.emails_sent, { completed: 3, target: 4, shortfall: 1, daily_average: 1.5, completion_percentage: 75 });
});

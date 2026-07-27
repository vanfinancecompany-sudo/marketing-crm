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
  assert.equal(
    londonDateKey(new Date("2026-07-19T23:30:00Z")),
    "2026-07-20",
  );
  assert.deepEqual(londonDateRange("2026-07-19"), {
    start: "2026-07-18T23:00:00.000Z",
    end: "2026-07-19T23:00:00.000Z",
  });
  assert.deepEqual(londonDateRange("2026-01-19"), {
    start: "2026-01-19T00:00:00.000Z",
    end: "2026-01-20T00:00:00.000Z",
  });
});

test("Knowledge Hub target defaults to 2 and participates in completion", () => {
  assert.equal(DEFAULT_DAILY_TARGETS.knowledge_hub_article, 2);
  const summary = summarizeDailyActivity({
    targets: DEFAULT_DAILY_TARGETS,
    events: [{ activity_type: "knowledge_hub_article", quantity: 1 }],
  });
  assert.equal(summary.metrics.knowledge_hub_article.completed, 1);
  assert.equal(summary.metrics.knowledge_hub_article.target, 2);
  assert.equal(summary.metrics.knowledge_hub_article.percentage, 50);
});

test("effective schedules preserve history and a one-day override wins", () => {
  const schedules = [
    { effective_from: "2026-01-01", weekday: 1, ...DEFAULT_DAILY_TARGETS },
    {
      effective_from: "2026-07-01",
      weekday: 1,
      ...DEFAULT_DAILY_TARGETS,
      emails_sent: 250,
    },
  ];
  const overrides = [
    {
      activity_date: "2026-07-20",
      ...DEFAULT_DAILY_TARGETS,
      emails_sent: 50,
    },
  ];
  assert.equal(
    resolveTargetsForDate({
      dateKey: "2026-06-29",
      weekday: 1,
      schedules,
      overrides,
    }).emails_sent,
    200,
  );
  assert.equal(
    resolveTargetsForDate({
      dateKey: "2026-07-13",
      weekday: 1,
      schedules,
      overrides,
    }).emails_sent,
    250,
  );
  assert.equal(
    resolveTargetsForDate({
      dateKey: "2026-07-20",
      weekday: 1,
      schedules,
      overrides,
    }).emails_sent,
    50,
  );
});

test("off days have no shortfall and count as complete", () => {
  const summary = summarizeDailyActivity({
    targets: { ...DEFAULT_DAILY_TARGETS, off_day: true },
  });
  assert.equal(summary.remaining_total, 0);
  assert.equal(summary.completion_percentage, 100);
  assert.equal(summary.complete, true);
});

test("legacy creative reels and explicit YouTube reel events are counted without creative overlap", () => {
  const summary = summarizeDailyActivity({
    targets: DEFAULT_DAILY_TARGETS,
    events: [
      { activity_type: "van_finance_facebook_post", quantity: 2 },
      {
        activity_type: "rent2buy_reel",
        quantity: 1,
        source: "youtube_generator",
      },
      {
        activity_type: "van_finance_reel",
        quantity: 1,
        metadata: { creative_id: "finance-reel" },
      },
    ],
    generatedReels: [
      { id: "finance-reel", pipeline: "vanFinance" },
      { id: "rent-legacy", pipeline: "rent2buy" },
      { id: "rent-legacy", pipeline: "rent2buy" },
    ],
    emailRecipients: [
      {
        id: "one",
        send_type: "production",
        first_sent_at: "2026-07-19T10:00:00Z",
      },
      {
        id: "one",
        send_type: "production",
        first_sent_at: "2026-07-19T10:00:00Z",
      },
      {
        id: "two",
        send_type: "production",
        provider_message_id: "sg-2",
      },
      {
        id: "test",
        send_type: "test",
        provider_message_id: "sg-test",
      },
    ],
  });
  assert.equal(summary.metrics.van_finance_facebook_post.completed, 2);
  assert.equal(summary.metrics.van_finance_reel.completed, 1);
  assert.equal(summary.metrics.rent2buy_reel.completed, 2);
  assert.equal(summary.metrics.emails_sent.completed, 2);
});

test("period totals include Knowledge Hub articles", () => {
  const first = summarizeDailyActivity({
    targets: DEFAULT_DAILY_TARGETS,
    events: [{ activity_type: "knowledge_hub_article", quantity: 1 }],
  });
  const second = summarizeDailyActivity({
    targets: DEFAULT_DAILY_TARGETS,
    events: [{ activity_type: "knowledge_hub_article", quantity: 2 }],
  });
  const totals = aggregatePeriod([first, second]);
  assert.equal(totals.knowledge_hub_article.completed, 3);
  assert.equal(totals.knowledge_hub_article.target, 4);
  assert.equal(totals.knowledge_hub_article.completion_percentage, 75);
});

test("completed production send batches keep existing email totals", () => {
  const summary = summarizeDailyActivity({
    targets: DEFAULT_DAILY_TARGETS,
    emailSends: [
      {
        id: "batch-one",
        send_type: "production",
        status: "completed",
        sent_count: 100,
      },
      {
        id: "batch-one",
        send_type: "production",
        status: "completed",
        sent_count: 100,
      },
      {
        id: "batch-two",
        send_type: "production",
        status: "partially_failed",
        sent_count: 25,
      },
    ],
  });
  assert.equal(summary.metrics.emails_sent.completed, 125);
});

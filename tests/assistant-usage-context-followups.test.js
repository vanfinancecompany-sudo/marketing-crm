import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAssistantActiveUserWindows } from "../lib/aiAssistantTelemetry.js";
import { orchestrateConversationTurn } from "../lib/conversationKnowledgeOrchestrator.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const controlCentreApi = fs.readFileSync(path.join(root, "api/marketing-ai-control-centre.js"), "utf8");
const controlCentrePage = fs.readFileSync(path.join(root, "public/ai-control-centre/index.html"), "utf8");

function event(event_type, created_at, overrides = {}) {
  return { event_type, created_at, visitor_hash: null, customer_session_id: null, ...overrides };
}

function baseIntent() {
  return {
    product_context: "rent2buy",
    primary_intent: "incomplete_business_question",
    secondary_intents: [],
    retrieval_required: false,
    clarification_required: true,
    suggested_clarification_question: "Could you clarify?",
  };
}

function baseHuman(previousAssistant, overrides = {}) {
  return {
    message_type: "clarification",
    recovery_required: false,
    contextual_anchor: "",
    contextual_requires_knowledge: false,
    previous_assistant_message: previousAssistant,
    objection: { objection: "none" },
    ...overrides,
  };
}

test("assistant active-user windows show rolling 24-hour 7-day and 30-day unique usage", () => {
  const now = new Date("2026-08-14T12:00:00Z");
  const events = [
    event("launcher_open", "2026-08-14T02:00:00Z", { visitor_hash: "visitor-a" }),
    event("conversation_start", "2026-08-14T02:05:00Z", { visitor_hash: "visitor-a", customer_session_id: "session-a" }),
    event("launcher_open", "2026-08-12T12:00:00Z", { visitor_hash: "visitor-b" }),
    event("customer_message", "2026-08-04T12:00:00Z", { customer_session_id: "session-c" }),
    event("launcher_open", "2026-07-13T12:00:00Z", { visitor_hash: "visitor-old" }),
  ];
  const result = buildAssistantActiveUserWindows(events, now);
  assert.equal(result.last_24_hours.active_users, 1);
  assert.equal(result.last_7_days.active_users, 2);
  assert.equal(result.last_30_days.active_users, 3);
  assert.equal(result.last_24_hours.unique_open_users, 1);
  assert.equal(result.last_30_days.customer_messages, 1);
});

test("active-user counting falls back to anonymous session ID when visitor ID is unavailable", () => {
  const now = new Date("2026-08-14T12:00:00Z");
  const events = [
    event("conversation_start", "2026-08-14T11:00:00Z", { customer_session_id: "session-a" }),
    event("customer_message", "2026-08-14T11:01:00Z", { customer_session_id: "session-a" }),
  ];
  assert.equal(buildAssistantActiveUserWindows(events, now).last_24_hours.active_users, 1);
});

test("Rent2Buy company reply inherits the immediately preceding documents choice", () => {
  const previous = "If you’d like, tell me whether you’re applying as an individual or a company and I can outline exactly which documents you should prepare first.";
  const intent = baseIntent();
  const human = baseHuman(previous);
  const result = orchestrateConversationTurn({ message: "company", intent, human });
  assert.equal(result.contextual_turn, true);
  assert.equal(result.contextual_anchor_used, previous);
  assert.equal(result.retrieval_required, true);
  assert.equal(result.recovery_required, false);
  assert.equal(intent.primary_intent, "knowledge_question");
  assert.equal(intent.clarification_required, false);
  assert.match(intent.normalised_message, /individual or a company/i);
  assert.match(intent.normalised_message, /company$/i);
});

test("short company variants and personal answers remain anchored to an explicit choice", () => {
  const previous = "Are you applying personally or through a company?";
  for (const message of ["company", "limited company", "personal"]) {
    const intent = baseIntent();
    const human = baseHuman(previous);
    const result = orchestrateConversationTurn({ message, intent, human });
    assert.equal(result.contextual_turn, true, message);
    assert.equal(result.contextual_anchor_used, previous, message);
    assert.equal(result.retrieval_required, true, message);
  }
});

test("a standalone company word does not inherit unrelated previous assistant text", () => {
  const previous = "Your Rent2Buy enquiry is open and we can carry on whenever you are ready.";
  const intent = baseIntent();
  const human = baseHuman(previous);
  const result = orchestrateConversationTurn({ message: "company", intent, human });
  assert.equal(result.contextual_turn, false);
  assert.equal(result.contextual_anchor_used, "");
  assert.equal(result.retrieval_required, false);
});

test("AI Control Centre visibly exposes daily weekly monthly assistant-user counts", () => {
  assert.match(controlCentreApi, /buildAssistantActiveUserWindows/);
  assert.match(controlCentreApi, /Math\.max\(days, 30\)/);
  assert.match(controlCentreApi, /assistant_active_users/);
  assert.match(controlCentrePage, /AI users · 24h/);
  assert.match(controlCentrePage, /AI users · 7 days/);
  assert.match(controlCentrePage, /AI users · 30 days/);
  assert.match(controlCentrePage, /anonymous visitor IDs with session fallback/);
});

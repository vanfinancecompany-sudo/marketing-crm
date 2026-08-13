import test from "node:test";
import assert from "node:assert/strict";
import { prepareJasminLinkDecision } from "../api/jasmin-knowledge-links.js";

const pendingSuggestion = {
  id: "suggestion-1",
  status: "pending",
  anchor_text: "credit profile",
  decided_at: null,
};

test("accept requires anchor wording that exists in the current article", () => {
  const prepared = prepareJasminLinkDecision({
    suggestion: pendingSuggestion,
    articleMarkdown: "A lender may consider your wider credit profile when assessing the application.",
    decision: "accept",
    anchorText: "credit profile",
    now: "2026-08-13T10:00:00.000Z",
  });

  assert.equal(prepared.update.status, "accepted");
  assert.equal(prepared.update.anchor_text, "credit profile");
  assert.equal(prepared.eventAction, "accepted");
  assert.equal(prepared.validation.found, true);
});

test("accept blocks anchor wording that is absent from the saved article", () => {
  assert.throws(
    () => prepareJasminLinkDecision({
      suggestion: pendingSuggestion,
      articleMarkdown: "A lender considers the application as a whole.",
      decision: "accept",
      anchorText: "credit profile",
    }),
    /not present in the current saved article/i
  );
});

test("accepted suggestion anchor can be edited only when the new wording exists", () => {
  const prepared = prepareJasminLinkDecision({
    suggestion: {
      ...pendingSuggestion,
      status: "accepted",
      decided_at: "2026-08-13T09:00:00.000Z",
    },
    articleMarkdown: "Read more about how credit scores affect van finance applications.",
    decision: "edit_anchor",
    anchorText: "credit scores",
    now: "2026-08-13T10:00:00.000Z",
  });

  assert.equal(prepared.update.status, "accepted");
  assert.equal(prepared.update.anchor_text, "credit scores");
  assert.equal(prepared.update.decided_at, "2026-08-13T09:00:00.000Z");
  assert.equal(prepared.eventAction, "anchor_edited");
});

test("rejection keeps the current anchor and records rejected status", () => {
  const prepared = prepareJasminLinkDecision({
    suggestion: pendingSuggestion,
    articleMarkdown: "The article body does not need the rejected anchor to be validated.",
    decision: "reject",
    now: "2026-08-13T10:00:00.000Z",
  });

  assert.equal(prepared.update.status, "rejected");
  assert.equal(prepared.update.anchor_text, "credit profile");
  assert.equal(prepared.eventAction, "rejected");
  assert.equal(prepared.validation, null);
});

test("decided suggestions cannot be accepted or rejected again", () => {
  assert.throws(
    () => prepareJasminLinkDecision({
      suggestion: { ...pendingSuggestion, status: "accepted" },
      articleMarkdown: "credit profile",
      decision: "accept",
      anchorText: "credit profile",
    }),
    /Only pending internal-link suggestions/i
  );
});

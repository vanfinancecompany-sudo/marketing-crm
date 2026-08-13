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
  assert.equal(prepared.retiredAcceptedLink, false);
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
  assert.equal(prepared.previousStatus, "accepted");
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
  assert.equal(prepared.previousStatus, "pending");
  assert.equal(prepared.retiredAcceptedLink, false);
});

test("accepted suggestion can be rejected to retire a legacy editorial decision", () => {
  const prepared = prepareJasminLinkDecision({
    suggestion: {
      ...pendingSuggestion,
      status: "accepted",
      anchor_text: "VIEW VANS | VAN FINANCE",
      decided_at: "2026-07-01T09:00:00.000Z",
    },
    articleMarkdown: "Current article copy no longer contains the legacy anchor label.",
    decision: "reject",
    now: "2026-08-13T10:00:00.000Z",
  });

  assert.equal(prepared.update.status, "rejected");
  assert.equal(prepared.update.anchor_text, "VIEW VANS | VAN FINANCE");
  assert.equal(prepared.update.decided_at, "2026-08-13T10:00:00.000Z");
  assert.equal(prepared.eventAction, "rejected");
  assert.equal(prepared.validation, null);
  assert.equal(prepared.previousStatus, "accepted");
  assert.equal(prepared.retiredAcceptedLink, true);
});

test("accepted suggestion cannot be accepted again", () => {
  assert.throws(
    () => prepareJasminLinkDecision({
      suggestion: { ...pendingSuggestion, status: "accepted" },
      articleMarkdown: "credit profile",
      decision: "accept",
      anchorText: "credit profile",
    }),
    /Only pending internal-link suggestions can be accepted/i
  );
});

test("rejected and superseded suggestions cannot be rejected again", () => {
  for (const status of ["rejected", "superseded"]) {
    assert.throws(
      () => prepareJasminLinkDecision({
        suggestion: { ...pendingSuggestion, status },
        articleMarkdown: "credit profile",
        decision: "reject",
      }),
      /Only pending or accepted internal-link suggestions can be rejected/i
    );
  }
});

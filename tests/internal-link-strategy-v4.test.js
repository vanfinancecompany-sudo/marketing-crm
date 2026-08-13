import test from "node:test";
import assert from "node:assert/strict";
import { hasStrongKnowledgeTopicOverlap } from "../lib/internalLinkStrategy.js";

test("remote buying does not link to first-time finance or self-employed income proof", () => {
  const source = {
    title: "Can You Buy a Used Van Without Seeing It First? A Guide for UK Buyers",
    content_markdown: "## What to check before reserving remotely\nConfirm condition, mileage and paperwork before buying unseen.",
  };
  assert.equal(hasStrongKnowledgeTopicOverlap({
    sourceArticle: source,
    linkedArticle: { title: "Top Tips for First-Time Van Buyers Applying for Finance" },
  }), false);
  assert.equal(hasStrongKnowledgeTopicOverlap({
    sourceArticle: source,
    linkedArticle: { title: "How Self-Employed Applicants Can Demonstrate Income for Van Finance" },
  }), false);
});

test("dealer versus private keeps the closely related another-dealer article and rejects CIS", () => {
  const source = {
    title: "Buying a Used Van From a Dealer vs a Private Seller: What Should You Consider?",
    content_markdown: "## Dealer purchase\nCompare dealer preparation with a private seller.",
  };
  assert.equal(hasStrongKnowledgeTopicOverlap({
    sourceArticle: source,
    linkedArticle: { title: "Can I Use Van Finance Company Finance to Buy a Van From Another Dealer?" },
  }), true);
  assert.equal(hasStrongKnowledgeTopicOverlap({
    sourceArticle: source,
    linkedArticle: { title: "Van Finance for CIS Subcontractors: What Should You Prepare Before Applying?" },
  }), false);
});

test("payload guide can link to a vehicle-types guide when type is present in a source heading", () => {
  const source = {
    title: "Van Payload, Load Space and Gross Vehicle Weight Explained for Buyers",
    content_markdown: "## Why vehicle type affects payload and load space\nDifferent bodies have different practical limits.",
  };
  assert.equal(hasStrongKnowledgeTopicOverlap({
    sourceArticle: source,
    linkedArticle: { title: "A Complete Guide to Vehicle Types for UK Van Buyers" },
  }), true);
});

test("diesel versus electric does not link to CIS finance", () => {
  assert.equal(hasStrongKnowledgeTopicOverlap({
    sourceArticle: {
      title: "Diesel or Electric Van: Which Makes More Sense for Your Business?",
      content_markdown: "## Charging access and working time\nCompare electric charging with diesel refuelling.",
    },
    linkedArticle: { title: "Van Finance for CIS Subcontractors: What Should You Prepare Before Applying?" },
  }), false);
});

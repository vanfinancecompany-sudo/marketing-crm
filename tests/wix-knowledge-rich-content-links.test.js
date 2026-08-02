import test from "node:test";
import assert from "node:assert/strict";
import {
  applyKnowledgeLinkSuggestions,
  buildKnowledgeWixRichContent,
  resolveKnowledgeRichContentField,
  sanitizeKnowledgeMarkdownLinks,
} from "../lib/wixKnowledgeRichContentPublishing.js";

function textNodes(content) {
  return (content.nodes || []).flatMap((node) => node.nodes || []).filter((node) => node.type === "TEXT");
}

function links(content) {
  return textNodes(content).flatMap((node) => (node.textData?.decorations || [])
    .filter((decoration) => decoration.type === "LINK")
    .map((decoration) => ({ text: node.textData.text, url: decoration.linkData?.link?.url, decorations: node.textData.decorations })));
}

function build(markdown, suggestions = []) { return buildKnowledgeWixRichContent(markdown, suggestions); }

test("resolves the existing Rich Content field instead of the Text content field", () => {
  const schema = { dataCollection: { fields: [{ key: "content", type: "TEXT" }, { key: "richContent", type: "RICH_CONTENT" }] } };
  assert.equal(resolveKnowledgeRichContentField(schema), "richContent");
});

test("requires an explicit field when more than one Rich Content field exists", () => {
  const schema = { dataCollection: { fields: [{ key: "articleBody", type: "RICH_CONTENT" }, { key: "summaryRich", type: "RICH_CONTENT" }] } };
  assert.throws(() => resolveKnowledgeRichContentField(schema), /WIX_KNOWLEDGE_RICH_CONTENT_FIELD_ID/);
  assert.equal(resolveKnowledgeRichContentField(schema, "articleBody"), "articleBody");
});

test("accepted suggestion is inserted into plain Markdown and becomes a Wix LINK decoration", () => {
  const suggestion = { id: "link-1", status: "accepted", anchor_text: "van finance guide", destination_url: "/van-finance-guide" };
  const result = build("Read our van finance guide before applying.", [suggestion]);
  assert.match(result.diagnostics.markdown, /\[van finance guide\]\(\/van-finance-guide\)/);
  assert.deepEqual(result.diagnostics.suggestions_successfully_inserted, [{ id: "link-1", anchor_text: "van finance guide", destination_url: "/van-finance-guide", method: "inserted_into_markdown" }]);
  assert.equal(result.diagnostics.final_link_decoration_count, 1);
  assert.deepEqual(links(result.richContent).map(({ text, url }) => ({ text, url })), [{ text: "van finance guide", url: "/van-finance-guide" }]);
});

test("multiple accepted suggestions are inserted and preserved", () => {
  const suggestions = [
    { id: "a", anchor_text: "available vans", destination_url: "/vans-on-finance" },
    { id: "b", anchor_text: "Vansco", destination_url: "https://www.vansco.co.uk/" },
  ];
  const result = build("See available vans supplied by Vansco.", suggestions);
  assert.equal(result.diagnostics.suggestions_successfully_inserted.length, 2);
  assert.equal(result.diagnostics.final_link_decoration_count, 2);
});

test("anchor text not found is skipped with a clear reason", () => {
  const applied = applyKnowledgeLinkSuggestions("A paragraph without the requested phrase.", [{ id: "missing", anchor_text: "available vans", destination_url: "/vans-on-finance" }]);
  assert.equal(applied.suggestions_successfully_inserted.length, 0);
  assert.deepEqual(applied.suggestions_skipped, [{ id: "missing", anchor_text: "available vans", destination_url: "/vans-on-finance", reason: "anchor_text_not_found" }]);
});

test("existing Markdown hyperlink remains a Wix link", () => {
  const result = build("Read our [van finance guide](/van-finance-guide).");
  assert.deepEqual(links(result.richContent).map(({ text, url }) => ({ text, url })), [{ text: "van finance guide", url: "/van-finance-guide" }]);
});

test("bold linked text keeps both BOLD and LINK decorations", () => {
  const result = build("[**Apply online**](https://www.vanfinancecompany.co.uk/apply)");
  const [link] = links(result.richContent);
  assert.equal(link.text, "Apply online");
  assert.ok(link.decorations.some((decoration) => decoration.type === "BOLD"));
});

test("accepted hyperlink inside a bullet point remains clickable", () => {
  const result = build("- View available vans", [{ id: "bullet", anchor_text: "available vans", destination_url: "/vans-on-finance" }]);
  assert.equal(result.diagnostics.final_link_decoration_count, 1);
  assert.ok(result.richContent.nodes.some((node) => node.type === "PARAGRAPH"));
});

test("headings, paragraphs, bullet lists and numbered lists remain formatted", () => {
  const result = build("## Heading\n\nParagraph with **bold** and *italic*.\n\n- Bullet\n- Second\n\n1. First\n2. Second");
  assert.ok(result.richContent.nodes.some((node) => node.type === "HEADING"));
  const rendered = textNodes(result.richContent).map((node) => node.textData.text).join(" ");
  assert.match(rendered, /Paragraph/);
  assert.match(rendered, /• Bullet/);
  assert.match(rendered, /1\. First/);
});

test("unsafe suggestions are rejected without stripping valid suggestions", () => {
  const result = build("Use unsafe and safe destinations.", [
    { id: "unsafe", anchor_text: "unsafe", destination_url: "javascript:alert(1)" },
    { id: "safe", anchor_text: "safe", destination_url: "https://www.vanfinancecompany.co.uk/example" },
  ]);
  assert.equal(result.diagnostics.final_link_decoration_count, 1);
  assert.equal(result.diagnostics.suggestions_skipped[0].reason, "unsafe_or_malformed_url");
  assert.deepEqual(links(result.richContent).map(({ text, url }) => ({ text, url })), [{ text: "safe", url: "https://www.vanfinancecompany.co.uk/example" }]);
  assert.doesNotMatch(sanitizeKnowledgeMarkdownLinks("[unsafe](javascript:alert(1))"), /javascript:/);
});

test("articles without links keep their existing content", () => {
  const result = build("## Heading\n\nA normal paragraph.\n\n- One\n- Two");
  assert.equal(result.diagnostics.final_link_decoration_count, 0);
  assert.match(textNodes(result.richContent).map((node) => node.textData.text).join(" "), /A normal paragraph/);
});

test("republishing produces identical suggestion diagnostics and link metadata", () => {
  const suggestions = [{ id: "repeat", anchor_text: "the guide", destination_url: "https://www.vanfinancecompany.co.uk/example" }];
  const first = build("Read the guide.", suggestions);
  const second = build("Read the guide.", suggestions);
  assert.deepEqual(first.diagnostics, second.diagnostics);
  assert.deepEqual(links(first.richContent).map(({ text, url }) => ({ text, url })), links(second.richContent).map(({ text, url }) => ({ text, url })));
});

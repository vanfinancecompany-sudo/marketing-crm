import test from "node:test";
import assert from "node:assert/strict";
import {
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

test("resolves the existing Rich Content field instead of the Text content field", () => {
  const schema = { dataCollection: { fields: [
    { key: "content", type: "TEXT" },
    { key: "richContent", type: "RICH_CONTENT" },
  ] } };
  assert.equal(resolveKnowledgeRichContentField(schema), "richContent");
});

test("requires an explicit field when more than one Rich Content field exists", () => {
  const schema = { dataCollection: { fields: [
    { key: "articleBody", type: "RICH_CONTENT" },
    { key: "summaryRich", type: "RICH_CONTENT" },
  ] } };
  assert.throws(() => resolveKnowledgeRichContentField(schema), /WIX_KNOWLEDGE_RICH_CONTENT_FIELD_ID/);
  assert.equal(resolveKnowledgeRichContentField(schema, "articleBody"), "articleBody");
});

test("one internal hyperlink inside a paragraph contains Wix link metadata", () => {
  const content = buildKnowledgeWixRichContent("Read our [van finance guide](/van-finance-guide).");
  assert.deepEqual(links(content).map(({ text, url }) => ({ text, url })), [{ text: "van finance guide", url: "/van-finance-guide" }]);
});

test("multiple internal and external hyperlinks are preserved", () => {
  const content = buildKnowledgeWixRichContent("See [stock](/vans-on-finance) and [Vansco](https://www.vansco.co.uk/).");
  assert.deepEqual(links(content).map(({ text, url }) => ({ text, url })), [
    { text: "stock", url: "/vans-on-finance" },
    { text: "Vansco", url: "https://www.vansco.co.uk/" },
  ]);
});

test("bold linked text keeps both BOLD and LINK decorations", () => {
  const content = buildKnowledgeWixRichContent("[**Apply online**](https://www.vanfinancecompany.co.uk/apply)");
  const [link] = links(content);
  assert.equal(link.text, "Apply online");
  assert.equal(link.url, "https://www.vanfinancecompany.co.uk/apply");
  assert.ok(link.decorations.some((decoration) => decoration.type === "BOLD"));
});

test("a hyperlink inside a bullet point remains clickable", () => {
  const content = buildKnowledgeWixRichContent("- View [available vans](/vans-on-finance)");
  assert.deepEqual(links(content).map(({ text, url }) => ({ text, url })), [{ text: "available vans", url: "/vans-on-finance" }]);
  assert.ok(content.nodes.some((node) => node.type === "PARAGRAPH"));
});

test("headings, paragraphs, bullet lists and numbered lists remain formatted", () => {
  const content = buildKnowledgeWixRichContent("## Heading\n\nParagraph with **bold** and *italic*.\n\n- Bullet\n- Second\n\n1. First\n2. Second");
  assert.ok(content.nodes.some((node) => node.type === "HEADING"));
  const rendered = textNodes(content).map((node) => node.textData.text).join(" ");
  assert.match(rendered, /Paragraph/);
  assert.match(rendered, /• Bullet/);
  assert.match(rendered, /1\. First/);
  assert.ok(textNodes(content).some((node) => node.textData.decorations.some((item) => item.type === "BOLD")));
  assert.ok(textNodes(content).some((node) => node.textData.decorations.some((item) => item.type === "ITALIC")));
});

test("unsafe links are rejected without stripping valid links", () => {
  const markdown = "[unsafe](javascript:alert(1)) and [safe](https://www.vanfinancecompany.co.uk/example)";
  const sanitized = sanitizeKnowledgeMarkdownLinks(markdown);
  assert.doesNotMatch(sanitized, /javascript:/);
  const content = buildKnowledgeWixRichContent(markdown);
  assert.deepEqual(links(content).map(({ text, url }) => ({ text, url })), [{ text: "safe", url: "https://www.vanfinancecompany.co.uk/example" }]);
});

test("articles without links keep their existing content", () => {
  const content = buildKnowledgeWixRichContent("## Heading\n\nA normal paragraph.\n\n- One\n- Two");
  assert.equal(links(content).length, 0);
  assert.match(textNodes(content).map((node) => node.textData.text).join(" "), /A normal paragraph/);
});

test("republishing produces the same valid hyperlink metadata", () => {
  const markdown = "Read [the guide](https://www.vanfinancecompany.co.uk/example).";
  assert.deepEqual(links(buildKnowledgeWixRichContent(markdown)).map(({ text, url }) => ({ text, url })), links(buildKnowledgeWixRichContent(markdown)).map(({ text, url }) => ({ text, url })));
});

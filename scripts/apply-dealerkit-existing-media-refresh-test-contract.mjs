import fs from "node:fs";
import { fileURLToPath } from "node:url";

const path = fileURLToPath(new URL("../tests/dealerkit-controlled-publish.test.js", import.meta.url));
let source = fs.readFileSync(path, "utf8");

if (!source.includes('["publish_new_vehicle", "update_existing_vehicle"].includes(action)')) {
  const beforeTitle = 'test("final publisher requires confirmation, inserts only new rows, verifies and rolls back", async () => {';
  const afterTitle = 'test("final publisher requires confirmation, supports safe create or image-only update, verifies and rolls back", async () => {';
  const beforeAssertion = '  assert.match(source, /action !== "publish_new_vehicle"/);';
  const afterAssertion = '  assert.match(source, /\\["publish_new_vehicle", "update_existing_vehicle"\\]\\.includes\\(action\\)/);';
  if (!source.includes(beforeTitle) || !source.includes(beforeAssertion)) throw new Error("Controlled publish test contract anchors changed.");
  source = source.replace(beforeTitle, afterTitle).replace(beforeAssertion, afterAssertion);
  fs.writeFileSync(path, source);
}

console.log("Updated controlled publish test contract for safe existing-vehicle image refresh.");

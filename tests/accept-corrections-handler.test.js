import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("the only Accept Corrections button is owned by PublishingSafetyCorrections", async () => {
  const correction = await read("../components/PublishingSafetyCorrections.jsx");
  const panels = await read("../components/KnowledgeHubV5Panels.jsx");
  const domFix = await read("../components/KnowledgeHubApprovalDomFixes.js");
  assert.equal((correction.match(/>Accept Corrections</g) || []).length, 1);
  assert.doesNotMatch(panels, />Accept Corrections</);
  assert.doesNotMatch(domFix, /Accept Corrections/);
  assert.match(correction, /data-knowledge-accept-corrections="true"/);
});

test("actual rendered button is type button and uses a native handler on its React-owned node", async () => {
  const source = await read("../components/PublishingSafetyCorrections.jsx");
  assert.match(source, /ref=\{acceptButtonRef\}[\s\S]{0,100}type="button"/);
  assert.match(source, /button\.addEventListener\("click", listener\)/);
  assert.match(source, /button\.removeEventListener\("click", listener\)/);
  assert.match(source, /handleAcceptCorrections\(event\)/);
});

test("handler prevents form and propagation behaviour before state or API work", async () => {
  const source = await read("../components/PublishingSafetyCorrections.jsx");
  const handler = source.slice(source.indexOf("async function handleAcceptCorrections"), source.indexOf("useEffect(() => {\n    const button"));
  assert.ok(handler.indexOf("event?.preventDefault()") < handler.indexOf('setStatus("accepting")'));
  assert.ok(handler.indexOf("event?.stopPropagation()") < handler.indexOf('setStatus("accepting")'));
});

test("accepting and progress state are rendered before the acceptance API", async () => {
  const source = await read("../components/PublishingSafetyCorrections.jsx");
  const stateIndex = source.indexOf('setStatus("accepting")');
  const progressIndex = source.indexOf('setProgressMessage("Saving and verifying corrections…")');
  const paintIndex = source.indexOf("await afterTwoFrames()");
  const apiIndex = source.indexOf("await acceptPublishingCorrection");
  assert.ok(stateIndex >= 0 && progressIndex > stateIndex && paintIndex > progressIndex && apiIndex > paintIndex);
  assert.match(source, /accepting \? "Accepting…" : "Accept Corrections"/);
});

test("synchronous and asynchronous handler errors are visible and restore controls", async () => {
  const source = await read("../components/PublishingSafetyCorrections.jsx");
  assert.match(source, /try \{[\s\S]*await afterTwoFrames\(\)/);
  assert.match(source, /catch \(error\)[\s\S]*setStatus\("ready"\)/);
  assert.match(source, /setAcceptError\(message\)/);
  assert.match(source, /role="alert"/);
});

test("acceptance API is invoked once and proposal clears only after verification", async () => {
  const source = await read("../components/PublishingSafetyCorrections.jsx");
  assert.equal((source.match(/await acceptPublishingCorrection\(/g) || []).length, 1);
  assert.ok(source.indexOf("verifyAcceptedCorrection") < source.indexOf("setProposal(null)"));
  assert.match(source, /correction_save_verified: true/);
});

test("root manager prevents duplicate correction roots and unmounts orphaned roots", async () => {
  const source = await read("../components/PublishingSafetyCorrections.jsx");
  assert.match(source, /const roots = new Map\(\)/);
  assert.match(source, /entry\.root\.unmount\(\)/);
  assert.match(source, /data-knowledge-correction-root/);
  assert.match(source, /const key = `article:\$\{title \|\| "unknown"\}:\$\{index\}`/);
  assert.match(source, /if \(existing\?\.host === host\) return/);
});

test("DOM fix does not replace, clone, listen to, or reload the correction button", async () => {
  const source = await read("../components/KnowledgeHubApprovalDomFixes.js");
  assert.doesNotMatch(source, /Accept Corrections/);
  assert.doesNotMatch(source, /cloneNode/);
  assert.doesNotMatch(source, /addEventListener\(["']click/);
  assert.doesNotMatch(source, /location\.reload/);
});

test("preview diagnostics trace click, handler, API, response, verification and completion", async () => {
  const source = await read("../components/PublishingSafetyCorrections.jsx");
  for (const step of ["Click received", "Handler started", "API request started", "API response received", "Verification started", "Complete"]) assert.match(source, new RegExp(step));
  assert.match(source, /data-acceptance-diagnostics="true"/);
});

test("no automatic approval or live Wix publication was introduced", async () => {
  const correction = await read("../components/PublishingSafetyCorrections.jsx");
  const wix = await read("../components/KnowledgeHubWixPublishing.jsx");
  assert.doesNotMatch(correction, /approveAndCreateWixDraft|publishLive|livePublish/);
  assert.match(wix, /It never publishes live/);
});

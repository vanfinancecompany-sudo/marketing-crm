import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const payloadSource = fs.readFileSync(new URL("../public/campaigns/campaign-send-payload.js", import.meta.url), "utf8");
const sendingSource = fs.readFileSync(new URL("../public/campaigns/sending-foundation.js", import.meta.url), "utf8");
const campaignsSource = fs.readFileSync(new URL("../public/campaigns/index.html", import.meta.url), "utf8");

function loadPayloadBuilder() {
  let networkCalls = 0;
  const context = {
    fetch() {
      networkCalls += 1;
      throw new Error("UI payload tests must not use the network.");
    },
  };
  context.globalThis = context;
  vm.runInNewContext(payloadSource, context);
  return {
    build: context.CampaignTestSendPayload.build,
    networkCalls: () => networkCalls,
  };
}

const input = (testFirstName, email = "internal@vanfinancecompany.co.uk") => ({
  id: "11111111-1111-4111-8111-111111111111",
  email,
  testFirstName,
});

test("campaign test send submits an explicitly supplied Stuart first name", () => {
  const { build } = loadPayloadBuilder();
  assert.equal(build(input("Stuart")).test_first_name, "Stuart");
});

test("campaign test send trims whitespace around the test first name", () => {
  const { build } = loadPayloadBuilder();
  assert.equal(build(input("  Jane  ")).test_first_name, "Jane");
});

test("campaign test send leaves a blank first name empty for the backend Stuart fallback", () => {
  const { build } = loadPayloadBuilder();
  assert.equal(build(input("   ")).test_first_name, "");
});

test("campaign test send accepts Alex as a genuine supplied test first name", () => {
  const { build } = loadPayloadBuilder();
  assert.equal(build(input("Alex")).test_first_name, "Alex");
});

test("campaign test destination email remains independent from the first name", () => {
  const { build } = loadPayloadBuilder();
  const jane = build(input("Jane", "jane@vanfinancecompany.co.uk"));
  const john = build(input("John", "john@vanfinancecompany.co.uk"));
  assert.deepEqual({ ...jane }, {
    id: "11111111-1111-4111-8111-111111111111",
    email: "jane@vanfinancecompany.co.uk",
    test_first_name: "Jane",
  });
  assert.deepEqual({ ...john }, {
    id: "11111111-1111-4111-8111-111111111111",
    email: "john@vanfinancecompany.co.uk",
    test_first_name: "John",
  });
});

test("campaign test-send UI exposes the optional Stuart field and uses the existing endpoint", () => {
  assert.match(sendingSource, /Test first name[\s\S]*id="testSendFirstName"[\s\S]*placeholder="Stuart"/);
  assert.match(sendingSource, /Optional\. Leave blank to use Stuart\./);
  assert.match(sendingSource, /CampaignTestSendPayload\.build\([\s\S]*testFirstName: \$\("testSendFirstName"\)\.value/);
  assert.match(sendingSource, /sendApi\("sendTest", payload\)/);
  assert.doesNotMatch(sendingSource, /sendApi\("sendTest",[\s\S]*Alex/);
  assert.ok(campaignsSource.indexOf("/campaigns/campaign-send-payload.js") < campaignsSource.indexOf("/campaigns/sending-foundation.js"));
});

test("production campaign-send preparation and confirmation remain independent of test first name", () => {
  const productionSource = sendingSource.slice(sendingSource.indexOf("async function prepareSend()"));
  assert.match(productionSource, /sendApi\("prepareProductionSend", \{ id, batch_size: batchSize \}\)/);
  assert.match(productionSource, /sendApi\("confirmProductionSend", \{/);
  assert.doesNotMatch(productionSource, /test_first_name|testSendFirstName/);
});

test("campaign UI payload tests make no provider or external network call", () => {
  const { build, networkCalls } = loadPayloadBuilder();
  build(input("Stuart"));
  build(input(""));
  build(input("Alex"));
  assert.equal(networkCalls(), 0);
  assert.doesNotMatch(payloadSource, /fetch\(|SendGrid|Brevo|SMTP2GO|smtp2go/i);
});

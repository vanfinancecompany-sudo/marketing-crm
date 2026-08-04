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

const input = (email = "internal@vanfinancecompany.co.uk") => ({
  id: "11111111-1111-4111-8111-111111111111",
  email,
});

test("campaign test send payload contains no first-name value", () => {
  const { build } = loadPayloadBuilder();
  assert.deepEqual({ ...build(input()) }, {
    id: "11111111-1111-4111-8111-111111111111",
    email: "internal@vanfinancecompany.co.uk",
  });
  assert.doesNotMatch(payloadSource, /first_name|firstName/i);
});

test("campaign test destination email remains configurable", () => {
  const { build } = loadPayloadBuilder();
  const payload = build(input("internal-test@vanfinancecompany.co.uk"));
  assert.deepEqual({ ...payload }, {
    id: "11111111-1111-4111-8111-111111111111",
    email: "internal-test@vanfinancecompany.co.uk",
  });
});

test("campaign test-send UI removes the unused first-name field and uses the existing endpoint", () => {
  assert.doesNotMatch(sendingSource, /Test first name|testSendFirstName|Leave blank to use Stuart/);
  assert.match(sendingSource, /CampaignTestSendPayload\.build\([\s\S]*email: \$\("testSendEmail"\)\.value/);
  assert.match(sendingSource, /sendApi\("sendTest", payload\)/);
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
  build(input());
  assert.equal(networkCalls(), 0);
  assert.doesNotMatch(payloadSource, /fetch\(|SendGrid|Brevo|SMTP2GO|smtp2go/i);
});

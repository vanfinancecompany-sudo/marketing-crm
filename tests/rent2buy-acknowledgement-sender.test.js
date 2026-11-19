import assert from "node:assert/strict";
import test from "node:test";
import handler from "../api/transactional-application-received.js";
test("only Rent2Buy acknowledgements override the default SendGrid display name", async () => {
  const originalFetch = globalThis.fetch;
  const oldKey = process.env.MARKETING_CUSTOMER_DATABASE_API_KEY;
  const oldSend = process.env.SENDGRID_API_KEY;
  const requests = [];
  process.env.MARKETING_CUSTOMER_DATABASE_API_KEY = "test-only";
  process.env.SENDGRID_API_KEY = "test-only";
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.sendgrid.com/v3/mail/send");
    requests.push(JSON.parse(options.body));
    return new Response("", {status:202, headers:{"x-message-id":"test-id"}});
  };
  try {
    for (const application_type of ["rent2buy","finance"]) {
      const res={setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}};
      await handler({method:"POST",headers:{"x-marketing-customer-database-key":"test-only"},body:{lead_id:"1",application_type,application_ref:"R2B-TEST01",customer_name:"Alex Example",customer_email:"alex@example.com"}},res);
      assert.equal(res.code,200);
      assert.equal(res.body.ok,true);
    }
    assert.deepEqual(requests.map(r=>r.from),[{email:"sales@vanfinancecompany.co.uk",name:"Rent2Buy Vans"},{email:"sales@vanfinancecompany.co.uk",name:"Van Finance Company"}]);
    assert.match(requests[0].content[0].value,/Upload my documents securely/);
    assert.doesNotMatch(requests[1].content[0].value,/Upload my documents securely/);
  } finally {
    globalThis.fetch=originalFetch;
    if(oldKey===undefined)delete process.env.MARKETING_CUSTOMER_DATABASE_API_KEY;else process.env.MARKETING_CUSTOMER_DATABASE_API_KEY=oldKey;
    if(oldSend===undefined)delete process.env.SENDGRID_API_KEY;else process.env.SENDGRID_API_KEY=oldSend;
  }
});

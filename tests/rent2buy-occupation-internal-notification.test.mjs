import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/transactional-rent2buy-application.js";

async function runNotification(occupation) {
  const previous={key:process.env.MARKETING_CUSTOMER_DATABASE_API_KEY,sendgrid:process.env.SENDGRID_API_KEY};
  const previousFetch=globalThis.fetch;
  let providerBody,providerCalls=0,statusCode,responseBody;
  process.env.MARKETING_CUSTOMER_DATABASE_API_KEY="test-application-internal-key";
  process.env.SENDGRID_API_KEY="mock-sendgrid-no-network";
  globalThis.fetch=async (_url,options)=>{
    providerCalls++;
    providerBody=JSON.parse(options.body);
    return new Response("",{status:202,headers:{"x-message-id":"mock-email-id"}});
  };
  const request={method:"POST",headers:{"x-marketing-customer-database-key":"test-application-internal-key"},body:{
    applicationRef:"R2B-ABC123",submittedAt:"02 Nov 2026 22:39:25",source:"Rent2BuyVans.co.uk",
    applicant:{fullName:"Test Applicant",email:"test@example.com",phone:"07000000000"},
    occupation,businessType:"Delivery or logistics",monthlyMileage:"2,000 to 3,000",
    vehicle:{registration:"ZZ25XYZ",title:"Example test van",type:"Medium van"}
  }};
  const response={setHeader(){},status(x){statusCode=x;return this;},json(x){responseBody=x;return this;}};
  try {await handler(request,response);}
  finally {
    globalThis.fetch=previousFetch;
    if(previous.key===undefined)delete process.env.MARKETING_CUSTOMER_DATABASE_API_KEY;
    else process.env.MARKETING_CUSTOMER_DATABASE_API_KEY=previous.key;
    if(previous.sendgrid===undefined)delete process.env.SENDGRID_API_KEY;
    else process.env.SENDGRID_API_KEY=previous.sendgrid;
  }
  return {providerBody,providerCalls,statusCode,responseBody};
}

test("internal application SendGrid payload includes occupation in both email formats without touching van use",async()=>{
  const r=await runNotification("Landscape gardener");
  assert.equal(r.statusCode,200);
  assert.equal(r.responseBody.ok,true);
  assert.equal(r.providerCalls,1);
  const html=r.providerBody.content.find(x=>x.type==="text/html").value;
  const plain=r.providerBody.content.find(x=>x.type==="text/plain").value;
  assert.match(html,/Job or occupation/);
  assert.match(html,/Landscape gardener/);
  assert.match(plain,/Job or occupation: Landscape gardener/);
  assert.match(plain,/Business \/ use: Delivery or logistics/);
  assert.match(html,/Business \/ use/);
  assert.equal(r.providerBody.personalizations[0].to[0].email,"sales@vanfinancecompany.co.uk");
  assert.match(r.providerBody.subject,/R2B-ABC123/);
});

test("historical application without occupation remains email compatible",async()=>{
  const r=await runNotification(undefined);
  assert.equal(r.statusCode,200);
  assert.equal(r.providerCalls,1);
  const plain=r.providerBody.content.find(x=>x.type==="text/plain").value;
  assert.match(plain,/Job or occupation: —/);
  assert.match(plain,/Business \/ use: Delivery or logistics/);
});

test("occupation is HTML-escaped in the staff email",async()=>{
  const r=await runNotification("<script>alert(1)</script>");
  assert.equal(r.statusCode,200);
  const html=r.providerBody.content.find(x=>x.type==="text/html").value;
  assert.doesNotMatch(html,/<script>/);
  assert.match(html,/&lt;script&gt;/);
});

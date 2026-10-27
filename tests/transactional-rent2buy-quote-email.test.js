import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/transactional-rent2buy-proof-link.js";

async function invoke(body,fetchResult){
  const old={...process.env},oldFetch=globalThis.fetch;let submitted;
  process.env.MARKETING_CUSTOMER_DATABASE_API_KEY="test-relay-key";process.env.SENDGRID_API_KEY="test-provider-key";
  globalThis.fetch=async(url,options)=>{submitted=JSON.parse(options.body);return fetchResult();};
  const response={setHeader(){},status(v){this.code=v;return this;},json(v){this.body=v;return this;}};
  try{await handler({method:"POST",headers:{authorization:"Bearer test-relay-key"},body},response);return {response,submitted};}
  finally{process.env=old;globalThis.fetch=oldFetch;}
}
const accepted=()=>new Response("",{status:202,headers:{"x-message-id":"provider-quote-123"}});
test("new acknowledgement and staff notifications preserve professional HTML through the established sender",async()=>{
 for(const message of [
  {emailType:"rent2buy-quote-acknowledgement",email:"matched@example.com",subject:"We've received your updated Rent2Buy quote"},
  {emailType:"rent2buy-quote-staff",email:"sales@vanfinancecompany.co.uk",subject:"UPDATED RENT2BUY QUOTE – Test Applicant – DK22CYA"},
 ]){
  const html='<html><body style="background:white"><h1 style="color:black">UPDATED RENT2BUY QUOTATION</h1><strong style="color:#d71920">£650 + VAT</strong></body></html>';
  const {response,submitted}=await invoke({...message,plain:"Verified quote details",html},accepted);
  assert.equal(response.code,200);assert.equal(submitted.subject,message.subject);
  assert.equal(submitted.personalizations[0].to[0].email,message.email);
  assert.equal(submitted.content.find(item=>item.type==="text/html").value,html);
 }
});
test("new acknowledgement rejects missing branded HTML or the wrong subject",async()=>{
 for(const edit of [{html:""},{subject:"Confirm your quote"}]){
  const {response}=await invoke({emailType:"rent2buy-quote-acknowledgement",email:"matched@example.com",subject:"We've received your updated Rent2Buy quote",plain:"Quote received",html:"<p>Received</p>",...edit},()=>assert.fail("Invalid acknowledgement must not send"));
  assert.equal(response.code,400);
 }
});
const quote=(base)=>{
  const confirmationUrl=base+"/rent2buy-confirm-update?token=r2bqc1.test.signature";
  return {emailType:"rent2buy-quote-confirmation",email:"matched@example.com",subject:"Confirm your updated Rent2Buy quotation",confirmationUrl,plain:"Confirm your updated quote: "+confirmationUrl};
};
test("both quote confirmation hosts reuse the proof sender with the correct subject and provider receipt",async()=>{
  for(const base of ["https://www.rent2buyvans.co.uk","https://www.vanfinancecompany.co.uk"]){
    const {response,submitted}=await invoke(quote(base),accepted);
    assert.equal(response.code,200);assert.equal(response.body.provider_message_id,"provider-quote-123");
    assert.equal(submitted.subject,"Confirm your updated Rent2Buy quotation");
    assert.deepEqual(submitted.from,{email:"sales@vanfinancecompany.co.uk",name:"Rent2Buy Vans"});
    assert.equal(submitted.personalizations[0].to[0].email,"matched@example.com");
    assert.match(submitted.content[0].value,/rent2buy-confirm-update\?token=/);
  }
});
test("quote relay rejects foreign hosts, wrong routes, unsigned links and arbitrary staff recipients",async()=>{
  for(const edit of [
    {confirmationUrl:"https://example.com/rent2buy-confirm-update?token=r2bqc1.test.signature"},
    {confirmationUrl:"https://www.rent2buyvans.co.uk/upload-your-documents?token=r2bqc1.test.signature"},
    {confirmationUrl:"https://www.rent2buyvans.co.uk/rent2buy-confirm-update?token=unsigned"},
    {emailType:"rent2buy-quote-staff",email:"outside@example.com",subject:"Confirmed updated Rent2Buy quote - Test"},
  ]){
    const {response,submitted}=await invoke({...quote("https://www.rent2buyvans.co.uk"),...edit},()=>assert.fail("Invalid payload must not send"));
    assert.equal(response.code,400);assert.equal(submitted,undefined);
  }
});
test("staff notification uses the same proven sender and goes only to sales",async()=>{
  const {response,submitted}=await invoke({emailType:"rent2buy-quote-staff",email:"sales@vanfinancecompany.co.uk",subject:"Confirmed updated Rent2Buy quote - Test - DK22CYA",plain:"Awaiting staff confirmation"},accepted);
  assert.equal(response.code,200);assert.equal(submitted.personalizations[0].to[0].email,"sales@vanfinancecompany.co.uk");
});
test("proof-link email contract remains unchanged",async()=>{
  const {response,submitted}=await invoke({applicationRef:"R2B-ABC123",fullName:"Test",email:"matched@example.com",uploadUrl:"https://www.rent2buyvans.co.uk/upload-your-documents?proofToken=test"},accepted);
  assert.equal(response.code,200);assert.equal(submitted.subject,"Complete your Rent2Buy application – upload your documents");
  assert.deepEqual(submitted.categories,["transactional","rent2buy-proof-link"]);
});
test("provider rejection logs status and sanitized category/message, and does not return acceptance",async()=>{
  const logs=[],oldError=console.error;console.error=(...args)=>logs.push(args);
  try{
    const {response}=await invoke(quote("https://www.rent2buyvans.co.uk"),()=>Response.json({errors:[{field:"from",message:"Rejected test-provider-key r2bqc1.test.signature"}]},{status:403}));
    assert.equal(response.code,502);assert.equal(response.body.ok,false);assert.equal(response.body.provider_message_id,undefined);
    assert.equal(logs[0][1].status,403);assert.equal(logs[0][1].category,"from");
    assert.doesNotMatch(JSON.stringify(logs),/test-provider-key|r2bqc1/);
  }finally{console.error=oldError;}
});

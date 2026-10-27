import test from "node:test";
import assert from "node:assert/strict";
import handler, {issuedQuotePreviewResponse} from "../api/rent2buy-quote-preview.js";

const keys=[
 "VERCEL_ENV","RENT2BUY_QUOTE_PREVIEW_ENDPOINT_ENABLED","RENT2BUY_QUOTE_ENDPOINT_ENABLED",
 "RENT2BUY_QUOTE_VERIFY_KEY"
];
function response(){
 return {
  headers:{},statusCode:200,body:null,
  setHeader(k,v){this.headers[k]=v;return this},
  status(n){this.statusCode=n;return this},
  json(value){this.body=value;return this},
 };
}
async function withPreviewEnv(values,callback){
 const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 try {
  for(const key of keys){
   if(key in values)process.env[key]=values[key];
   else delete process.env[key];
  }
  return await callback();
 } finally {
  for(const key of keys){
   if(old[key]===undefined)delete process.env[key];
   else process.env[key]=old[key];
  }
 }
}
const validKey="test-only-private-quote-verifier-key-36-characters";

test("production refuses quote issuance without its separate production flag",async()=>{
 await withPreviewEnv({VERCEL_ENV:"production",RENT2BUY_QUOTE_PREVIEW_ENDPOINT_ENABLED:"true",RENT2BUY_QUOTE_VERIFY_KEY:validKey},async()=>{
  const res=response();
  await handler({method:"POST",headers:{"x-rent2buy-quote-verifier-key":validKey},
    body:{action:"choices",registration:"ZZ25XYZ"}},res);
  assert.equal(res.statusCode,503);
  assert.equal(res.body.error,"preview_service_off");
  assert.match(res.headers["Cache-Control"],/no-store/);
 });
});
test("production flag still requires a valid server-only verification key",async()=>{
 await withPreviewEnv({VERCEL_ENV:"production",RENT2BUY_QUOTE_ENDPOINT_ENABLED:"true",RENT2BUY_QUOTE_VERIFY_KEY:validKey},async()=>{
  const res=response();
  await handler({method:"POST",headers:{"x-rent2buy-quote-verifier-key":"invalid"},
    body:{action:"choices",registration:"ZZ25XYZ"}},res);
  assert.equal(res.statusCode,401);
 });
});

test("missing flag and unauthorised callers fail before any source read",async()=>{
 await withPreviewEnv({VERCEL_ENV:"preview",RENT2BUY_QUOTE_VERIFY_KEY:validKey},async()=>{
  const res=response();
  await handler({method:"POST",headers:{"x-rent2buy-quote-verifier-key":validKey},
    body:{action:"choices",registration:"ZZ25XYZ"}},res);
  assert.equal(res.statusCode,503);
 });
 await withPreviewEnv({VERCEL_ENV:"preview",RENT2BUY_QUOTE_PREVIEW_ENDPOINT_ENABLED:"true",RENT2BUY_QUOTE_VERIFY_KEY:validKey},async()=>{
  const res=response();
  await handler({method:"POST",headers:{"x-rent2buy-quote-verifier-key":"wrong"},
    body:{action:"choices",registration:"ZZ25XYZ"}},res);
  assert.equal(res.statusCode,401);
 });
});
test("malformed or unsupported term, mileage and upfront selections never fetch DealerKit",async()=>{
 await withPreviewEnv({VERCEL_ENV:"preview",RENT2BUY_QUOTE_PREVIEW_ENDPOINT_ENABLED:"true",RENT2BUY_QUOTE_VERIFY_KEY:validKey},async()=>{
  const invalids=[
    {action:"choices",registration:"NOTREG"},
    {action:"issue",registration:"ZZ25XYZ",selection:{termMonths:40,milesPerMonth:1000,initialExVat:1000}},
    ...[18,30,42].map(termMonths=>({action:"issue",registration:"ZZ25XYZ",selection:{termMonths,milesPerMonth:1000,initialExVat:1000}})),
    ...[1500,2500,3500].map(milesPerMonth=>({action:"issue",registration:"ZZ25XYZ",selection:{termMonths:36,milesPerMonth,initialExVat:1000}})),
    {action:"issue",registration:"ZZ25XYZ",selection:{termMonths:36,milesPerMonth:4500,initialExVat:1000}},
    {action:"issue",registration:"ZZ25XYZ",selection:{termMonths:36,milesPerMonth:1000,initialExVat:999}},
    {action:"issue",registration:"ZZ25XYZ",selection:{termMonths:36,milesPerMonth:1000,initialExVat:null}},
    {action:"issue",registration:"ZZ25XYZ",selection:{termMonths:36,milesPerMonth:1000,initialExVat:""}},
    {action:"delete",registration:"ZZ25XYZ"},
  ];
  for(const body of invalids){
   const res=response();
   await handler({method:"POST",headers:{"x-rent2buy-quote-verifier-key":validKey},body},res);
   assert.equal(res.statusCode,400,JSON.stringify(body));
   assert.equal(res.body.error,"invalid_selection");
  }
 });
});


test("signed quote has the same top-level registration required by both website proxies",()=>{
 const issued={
  ok:true,
  token:"r2bq1.signed-token.test",
  quote:{registration:"ZZ25XYZ",termMonths:36,milesPerMonth:1000,initialExVat:2000,monthlyExVat:545},
 };
 const result=issuedQuotePreviewResponse(issued,"ZZ25XYZ");
 assert.equal(result.ok,true);
 assert.equal(result.registration,"ZZ25XYZ");
 assert.equal(result.quote.registration,result.registration);
 assert.equal(result.token,issued.token);
 assert.equal(issuedQuotePreviewResponse(issued,"BT25LVK"),null);
 assert.equal(issuedQuotePreviewResponse({...issued,token:""},"ZZ25XYZ"),null);
 assert.equal(issuedQuotePreviewResponse({ok:false,...issued,token:""},"ZZ25XYZ"),null);
});

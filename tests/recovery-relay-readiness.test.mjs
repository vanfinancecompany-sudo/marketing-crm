import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/archived-application-recovery.js';
function request(method,secret){return {method,headers:{authorization:'Bearer '+secret}}}
function response(){return {statusCode:200,setHeader(){return this},status(code){this.statusCode=code;return this},json(value){this.data=value;return this}}}
const settingKeys=['MARKETING_CUSTOMER_DATABASE_API_KEY','RECOVERY_RELAY_ENABLED','SENDGRID_API_KEY'];
async function configured(settings,fn){
 const before=Object.fromEntries(settingKeys.map(key=>[key,process.env[key]]));
 try{
  for(const [k,v] of Object.entries(settings))process.env[k]=v;
  return await fn();
 }finally{
  for(const [k,v] of Object.entries(before))if(v===undefined)delete process.env[k];else process.env[k]=v;
 }
}
test('authenticated relay GET confirms readiness without sending a customer email',async()=>{
 await configured({MARKETING_CUSTOMER_DATABASE_API_KEY:'private-test-key',RECOVERY_RELAY_ENABLED:'true',SENDGRID_API_KEY:'synthetic-key'},async()=>{
  const res=response();await handler(request('GET','private-test-key'),res);
  assert.equal(res.statusCode,200);assert.deepEqual(res.data,{ok:true,ready:true,delivery:'configured'});
 });
});
test('readiness never claims enabled while relay disabled',async()=>{
 await configured({MARKETING_CUSTOMER_DATABASE_API_KEY:'private-test-key',RECOVERY_RELAY_ENABLED:'false',SENDGRID_API_KEY:'synthetic-key'},async()=>{
  const res=response();await handler(request('GET','private-test-key'),res);
  assert.equal(res.statusCode,503);
 });
});
test('invalid relay credential denied even for readiness GET',async()=>{
 await configured({MARKETING_CUSTOMER_DATABASE_API_KEY:'private-test-key',RECOVERY_RELAY_ENABLED:'true',SENDGRID_API_KEY:'synthetic-key'},async()=>{
  const res=response();await handler(request('GET','wrong-key'),res);
  assert.equal(res.statusCode,401);
 });
});
test('missing email service blocks readiness',async()=>{
 await configured({MARKETING_CUSTOMER_DATABASE_API_KEY:'private-test-key',RECOVERY_RELAY_ENABLED:'true',SENDGRID_API_KEY:''},async()=>{
  const res=response();await handler(request('GET','private-test-key'),res);
  assert.equal(res.statusCode,503);
 });
});

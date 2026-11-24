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
test('optional branded html must carry the unsubscribe link; plain text fallback unchanged',async()=>{
 const {recoveryHtml}=await import('../api/archived-application-recovery.js');
 const link='https://www.rent2buyvans.co.uk/api/customer-recovery-unsubscribe?token=abc';
 assert.equal(recoveryHtml({},'Hi <b>\n'+link).html,'<div style="white-space:pre-line;font-family:Arial,sans-serif">Hi &lt;b&gt;\n'+link+'</div>');
 assert.equal(recoveryHtml({html:'<p>Explore</p><a href="'+link+'">Unsubscribe</a>'},'x').ok,true);
 assert.equal(recoveryHtml({html:'<p>No opt-out</p>'},'x').ok,false);
 assert.equal(recoveryHtml({html:'x'.repeat(200001)+link},'x').ok,false);
});
test('POST with html lacking unsubscribe link is refused before any send',async()=>{
 await configured({MARKETING_CUSTOMER_DATABASE_API_KEY:'private-test-key',RECOVERY_RELAY_ENABLED:'true',SENDGRID_API_KEY:'synthetic-key'},async()=>{
  const res=response();
  await handler({method:'POST',headers:{authorization:'Bearer private-test-key'},body:{to:'a@example.com',subject:'s',text:'t https://x/api/customer-recovery-unsubscribe?token=1',send_id:'recovery:rent2buy:a@example.com',html:'<p>no link</p>'}},res);
  assert.equal(res.statusCode,400);assert.equal(res.data.message,'Invalid recovery html');
 });
});

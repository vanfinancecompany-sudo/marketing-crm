import crypto from 'node:crypto';
import {sendSendGridEmail} from '../lib/emailProviders/sendgrid.js';
const TEST_TO='sales@vanfinancecompany.co.uk';
const clean=v=>String(v??'').trim();
const same=(a,b)=>{const x=Buffer.from(clean(a)),y=Buffer.from(clean(b));return !!(x.length&&x.length===y.length&&crypto.timingSafeEqual(x,y));};
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method not allowed'});
 if(!process.env.MARKETING_CUSTOMER_DATABASE_API_KEY||!same(clean(req.headers?.authorization).replace(/^Bearer /i,''),process.env.MARKETING_CUSTOMER_DATABASE_API_KEY))return res.status(401).json({ok:false});
 if(process.env.RECOVERY_TEST_EMAIL_ENABLED!=='true')return res.status(503).json({ok:false,error:'Test email disabled'});
 if(!process.env.SENDGRID_API_KEY)return res.status(503).json({ok:false,error:'Email provider unavailable'});
 const body=typeof req.body==='object'&&req.body?req.body:{};
 if(Object.keys(body).some(key=>key!=='confirm')||body.confirm!=='single-recovery-test')return res.status(400).json({ok:false,error:'Invalid test confirmation'});
 const subject='TEST ONLY: Van Finance archived application follow-up';
 const text='This is a TEST ONLY of the Van Finance Company archived applicant recovery email route. No customer was contacted.\n\nThis test does not activate the recovery campaign or change any existing CRM reminders.\n\nVan Finance Company';
 try{
  const sent=await sendSendGridEmail({apiKey:process.env.SENDGRID_API_KEY,to:TEST_TO,subject,text,fromEmail:'sales@vanfinancecompany.co.uk',fromName:'Van Finance Company',categories:['archived-application-recovery-test'],customArgs:{recovery_test:'true'}});
  if(!sent?.messageId)throw new Error('Provider did not confirm acceptance');
  return res.status(200).json({ok:true,recipient:TEST_TO,provider_message_id:sent.messageId});
 }catch(error){
  console.error('Recovery test delivery failed',String(error?.message||error).slice(0,160));
  return res.status(502).json({ok:false,error:'Test delivery failed or could not be confirmed'});
 }
}

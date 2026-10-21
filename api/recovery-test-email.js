import crypto from 'node:crypto';
import {sendSendGridEmail} from '../lib/emailProviders/sendgrid.js';

const TEST_TO='sales@vanfinancecompany.co.uk';
const clean=v=>String(v??'').trim();
const same=(a,b)=>{
 const x=Buffer.from(clean(a)),y=Buffer.from(clean(b));
 return Boolean(x.length&&x.length===y.length&&crypto.timingSafeEqual(x,y));
};

// The Marketing CRM .vercel.app host is behind Vercel Authentication.
// Browser access is restricted to that production host and same-origin POST.
// No client-side SendGrid or shared API keys are ever required or exposed.
const PROTECTED_MARKETING_HOSTS=new Set([
 'marketing-crm-six.vercel.app',
 'marketing-crm-stuart-westons-projects.vercel.app',
 'marketing-crm-git-main-stuart-westons-projects.vercel.app'
]);
export function isAuthenticatedMarketingBrowserRequest(req,env=process.env){
 const host=clean(req.headers?.host).toLowerCase().split(':')[0];
 const origin=clean(req.headers?.origin).toLowerCase();
 const fetchSite=clean(req.headers?.['sec-fetch-site']).toLowerCase();
 return env.VERCEL==='1'&&env.VERCEL_ENV==='production'
  &&PROTECTED_MARKETING_HOSTS.has(host)
  &&origin==='https://'+host
  &&fetchSite==='same-origin';
}
export function canSendRecoveryTest(req,env=process.env){
 const bearer=clean(req.headers?.authorization).replace(/^Bearer /i,'');
 return Boolean(env.MARKETING_CUSTOMER_DATABASE_API_KEY&&same(bearer,env.MARKETING_CUSTOMER_DATABASE_API_KEY))
  ||isAuthenticatedMarketingBrowserRequest(req,env);
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method not allowed'});
 if(!canSendRecoveryTest(req))return res.status(403).json({ok:false,error:'Unauthorised test request'});
 if(process.env.RECOVERY_TEST_EMAIL_ENABLED!=='true')return res.status(503).json({ok:false,error:'Test email disabled'});
 if(!process.env.SENDGRID_API_KEY)return res.status(503).json({ok:false,error:'Email provider unavailable'});
 const body=typeof req.body==='object'&&req.body?req.body:{};
 if(Object.keys(body).some(key=>key!=='confirm')||body.confirm!=='single-recovery-test')
  return res.status(400).json({ok:false,error:'Invalid test confirmation'});
 const subject='TEST ONLY: Van Finance archived application follow-up';
 const text=[
  'TEST EMAIL ONLY — no customers contacted.',
  '',
  'Hi there,',
  '',
  'You previously enquired about van finance with Van Finance Company.',
  'If you are still looking, we have a wide choice of vans. Good or poor credit is welcome, deposits start from £99, and we offer free UK delivery.',
  '',
  'Browse our vans and make a fresh application:',
  'https://www.vanfinancecompany.co.uk',
  '',
  'This is an internal delivery test. It does not start the archived customer campaign.',
  '',
  'Van Finance Company'
 ].join('\n');
 const html='<div style="background:#f5f5f5;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#181818">'
 +'<div style="max-width:560px;margin:auto;background:white;padding:28px;border-radius:12px">'
 +'<strong style="color:#ba1522">TEST ONLY — INTERNAL RECOVERY EMAIL</strong>'
 +'<h2>Still looking for a van?</h2>'
 +'<p>Hi there,</p>'
 +'<p>You previously enquired about van finance with Van Finance Company.</p>'
 +'<p>If you are still looking, we have a wide choice of vans. Good or poor credit is welcome, deposits start from £99, and we offer free UK delivery.</p>'
 +'<p><a href="https://www.vanfinancecompany.co.uk" style="display:inline-block;padding:12px 22px;background:#c41322;color:white;text-decoration:none;border-radius:5px;font-weight:bold">View Vans</a></p>'
 +'<p style="font-size:12px;color:#666">Internal delivery test. No customer campaign has started.</p>'
 +'</div></div>';
 try{
  const sent=await sendSendGridEmail({
   apiKey:process.env.SENDGRID_API_KEY,to:TEST_TO,
   subject,text,html,fromEmail:'sales@vanfinancecompany.co.uk',
   fromName:'Van Finance Company',
   categories:['archived-application-recovery-test'],
   customArgs:{recovery_test:'true'}
  });
  if(!sent?.messageId)throw new Error('Provider did not confirm acceptance');
  return res.status(200).json({ok:true,recipient:TEST_TO,provider_message_id:sent.messageId,provider:'sendgrid',delivery:'accepted_not_inbox_verified'});
 }catch(error){
  console.error('Recovery test delivery failed',String(error?.message||error).slice(0,160));
  return res.status(502).json({ok:false,error:'Test delivery failed or could not be confirmed'});
 }
}

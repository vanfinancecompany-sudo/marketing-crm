import crypto from 'node:crypto';
import {sendSendGridEmail} from '../lib/emailProviders/sendgrid.js';
const clean=v=>String(v??'').trim();
const UNSUBSCRIBE=/\/api\/customer-recovery-unsubscribe\?token=/;
// Optional branded HTML (Rent2Buy decline recovery). It must carry the same
// unsubscribe link and stay small; otherwise the plain text is wrapped as before.
export function recoveryHtml(body,text){
 const html=typeof body?.html==='string'?body.html.trim():'';
 if(!html)return {ok:true,html:'<div style="white-space:pre-line;font-family:Arial,sans-serif">'+text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</div>'};
 if(html.length>200000||!UNSUBSCRIBE.test(html))return {ok:false};
 return {ok:true,html};
}
const equal=(a,b)=>{const x=Buffer.from(clean(a)),y=Buffer.from(clean(b));return !!(x.length&&x.length===y.length&&crypto.timingSafeEqual(x,y));};
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(!['GET','POST'].includes(req.method))return res.status(405).json({ok:false});
 if(!process.env.MARKETING_CUSTOMER_DATABASE_API_KEY||!equal(req.headers?.authorization?.replace(/^Bearer /i,''),process.env.MARKETING_CUSTOMER_DATABASE_API_KEY))
  return res.status(401).json({ok:false});
 if(process.env.RECOVERY_RELAY_ENABLED!=='true')return res.status(503).json({ok:false,message:'Recovery relay disabled'});
 if(!process.env.SENDGRID_API_KEY)return res.status(503).json({ok:false,message:'Provider unavailable'});
 // Authenticated read-only preflight: CRM checks the *actual* relay before it
 // claims an address. GET never calls SendGrid or accepts a recipient.
 if(req.method==='GET')return res.status(200).json({ok:true,ready:true,delivery:'configured'});
 let body;
 try{body=typeof req.body==='string'?JSON.parse(req.body):req.body||{};}catch{return res.status(400).json({ok:false,message:'Invalid JSON'});}
 const to=clean(body.to).toLowerCase(),subject=clean(body.subject),text=clean(body.text),sendId=clean(body.send_id);
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)||!subject||!text||!/^recovery:(vanFinance|rent2buy):[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sendId)||sendId.split(':').slice(2).join(':').toLowerCase()!==to||text.length>30000)
  return res.status(400).json({ok:false,message:'Invalid recovery payload'});
 if(!UNSUBSCRIBE.test(text))
  return res.status(400).json({ok:false,message:'Missing unsubscribe link'});
 const content=recoveryHtml(body,text);
 if(!content.ok)return res.status(400).json({ok:false,message:'Invalid recovery html'});
 if(!process.env.SENDGRID_API_KEY)return res.status(503).json({ok:false,message:'Provider unavailable'});
 const rent2buy=sendId.startsWith('recovery:rent2buy:');
 try{
  const provider=await sendSendGridEmail({apiKey:process.env.SENDGRID_API_KEY,to,subject,text,html:content.html,
   fromEmail:'sales@vanfinancecompany.co.uk',
   fromName:rent2buy?'Rent2Buy Vans':'Van Finance Company',
   categories:['archived-application-recovery'],customArgs:{recovery_send_id:sendId}});
  return res.status(200).json({ok:true,provider_message_id:provider.messageId});
 }catch(error){
  console.error('RECOVERY RELAY FAILURE',{ambiguous:!!error?.ambiguous});
  return res.status(error?.statusCode||502).json({ok:false,ambiguous:!!error?.ambiguous});
 }
}

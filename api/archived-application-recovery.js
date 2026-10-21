import crypto from 'node:crypto';
import {sendSendGridEmail} from '../lib/emailProviders/sendgrid.js';
const clean=v=>String(v??'').trim();
const equal=(a,b)=>{const x=Buffer.from(clean(a)),y=Buffer.from(clean(b));return !!(x.length&&x.length===y.length&&crypto.timingSafeEqual(x,y));};
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({ok:false});
 if(!process.env.MARKETING_CUSTOMER_DATABASE_API_KEY||!equal(req.headers?.authorization?.replace(/^Bearer /i,''),process.env.MARKETING_CUSTOMER_DATABASE_API_KEY))
  return res.status(401).json({ok:false});
 if(process.env.RECOVERY_RELAY_ENABLED!=='true')return res.status(503).json({ok:false,message:'Recovery relay disabled'});
 const body=typeof req.body==='string'?JSON.parse(req.body):req.body||{};
 const to=clean(body.to).toLowerCase(),subject=clean(body.subject),text=clean(body.text),sendId=clean(body.send_id);
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)||!subject||!text||!sendId.startsWith('recovery:')||text.length>30000)
  return res.status(400).json({ok:false,message:'Invalid recovery payload'});
 if(!/\/api\/customer-recovery-unsubscribe\?token=/.test(text))
  return res.status(400).json({ok:false,message:'Missing unsubscribe link'});
 if(!process.env.SENDGRID_API_KEY)return res.status(503).json({ok:false,message:'Provider unavailable'});
 const rent2buy=/rent2buy/i.test(sendId)||/rent2buy/i.test(subject);
 try{
  const provider=await sendSendGridEmail({apiKey:process.env.SENDGRID_API_KEY,to,subject,text,
   fromEmail:rent2buy?'sales@rent2buyvans.co.uk':'sales@vanfinancecompany.co.uk',
   fromName:rent2buy?'Rent2Buy Vans':'Van Finance Company',
   categories:['archived-application-recovery'],customArgs:{recovery_send_id:sendId}});
  return res.status(200).json({ok:true,provider_message_id:provider.messageId});
 }catch(error){
  console.error('RECOVERY RELAY FAILURE',{ambiguous:!!error?.ambiguous});
  return res.status(error?.statusCode||502).json({ok:false,ambiguous:!!error?.ambiguous});
 }
}

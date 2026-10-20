// Invoked only inside the existing SendGrid endpoint AFTER its Ed25519 signature check.
// Strictly separates Vansco email event correlation from VFC/Rent2Buy provider events.
const uuid=v=>/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(String(v||""));
export function isVanscoWebhookPayload(payload={}){
 return payload?.vansco_brand==="vansco"&&uuid(payload.vansco_email_send_id)&&uuid(payload.vansco_email_campaign_id);
}
const get=(result,msg)=>{if(result.error)throw Error(msg+": "+result.error.message);return result.data};
export async function recordVanscoEmailEvent(db,payload,event) {
 const sendId=String(payload.vansco_email_send_id||""),campaignId=String(payload.vansco_email_campaign_id||"");
 const row=get(await db.from("marketing_vansco_email_sends").select("*").eq("id",sendId).eq("campaign_id",campaignId).maybeSingle(),"Vansco event recipient lookup");
 if(!row||row.email_normalized!==event.email_normalized)return {ignored:true};
 // SendGrid signs provider event callbacks; dedupe independently of VFC reporting.
 const inserted=await db.from("marketing_vansco_email_events").insert({
  send_id:sendId,provider_event_id:event.provider_event_id,event_type:event.event_type,event_at:event.event_at,
 });
 if(inserted.error?.code==="23505")return {duplicate:true};
 if(inserted.error)throw Error(inserted.error.message);
 const updates={updated_at:new Date().toISOString(),last_event_at:event.event_at};
 if(event.event_type==="delivered"){updates.delivered_at=event.event_at;updates.status="delivered";}
 if(event.event_type==="opened"){updates.opened_at=event.event_at;updates.delivered_at=row.delivered_at||event.event_at;updates.status="opened";}
 if(event.event_type==="clicked"){updates.clicked_at=event.event_at;updates.delivered_at=row.delivered_at||event.event_at;updates.status="clicked";}
 if(["hard_bounce","invalid_email","soft_bounce","blocked"].includes(event.event_type))updates.status="bounced";
 if(event.event_type==="unsubscribed")updates.status="unsubscribed";
 if(event.event_type==="complaint")updates.status="complained";
 if(["accepted","unknown","deferred"].includes(event.event_type))return {recorded:true};
 // Keep already stronger positive engagement and any complaint/suppression state.
 if(["clicked","unsubscribed","complained","bounced"].includes(row.status)&&["delivered","opened"].includes(updates.status))updates.status=row.status;
 if(row.status==="opened"&&updates.status==="delivered")updates.status=row.status;
 const update=get(await db.from("marketing_vansco_email_sends").update(updates).eq("id",sendId).select("id").single(),"Could not update Vansco delivery state");
 if(!update?.id)throw Error("Vansco event update did not match a send.");
 if(row.send_type==="production"&&["hard_bounce","invalid_email","unsubscribed","complaint"].includes(event.event_type)) {
  const existing=get(await db.from("marketing_suppression_identities").select("id").eq("email_normalized",row.email_normalized).limit(1),"Vansco suppression check");
  if(!existing.length){
   const p=event.event_type==="unsubscribed"?"email_unsubscribed":event.event_type==="complaint"?"global_do_not_contact":"email_bounced";
   const insert=await db.from("marketing_suppression_identities").insert({
    email_normalized:row.email_normalized,suppression_type:p,reason:"Vansco SendGrid "+event.event_type,
    provider:"Vansco SendGrid webhook",suppressed_at:event.event_at,metadata:{vansco_send_id:sendId},
   });
   if(insert.error&&insert.error.code!=="23505")throw Error(insert.error.message);
  }
  const blocked=await db.from("marketing_vansco_email_contacts").update({status:"suppressed",suppression_reason:"SendGrid "+event.event_type,updated_at:new Date().toISOString()}).eq("id",row.contact_id);
  if(blocked.error)throw Error(blocked.error.message);
 }
 return {recorded:true};
}

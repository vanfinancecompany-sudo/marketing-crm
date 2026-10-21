import {useState} from "react";

const TEST_RECIPIENT="sales@vanfinancecompany.co.uk";

export default function RecoveryCampaignTestPanel(){
 const [sending,setSending]=useState(false);
 const [result,setResult]=useState(null);
 async function sendTest(){
  if(sending)return;
  setSending(true);setResult(null);
  try{
   const response=await fetch("/api/recovery-test-email",{
    method:"POST",credentials:"same-origin",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({confirm:"single-recovery-test"})
   });
   const data=await response.json().catch(()=>({}));
   if(!response.ok||data.ok!==true||!data.provider_message_id)
    throw new Error(data.error||"The test email was not confirmed by SendGrid.");
   setResult({ok:true,id:data.provider_message_id});
  }catch(error){
   setResult({ok:false,error:error.message||"Could not send the test email."});
  }finally{setSending(false);}
 }
 return (
  <section className="panel" id="recovery-email-test">
   <div className="panel__header">
    <div>
     <div className="eyebrow">Archived customer recovery</div>
     <h3>Recovery Email Test</h3>
     <p>One internal test to confirm the sending route. Customer campaign sending remains switched off.</p>
    </div>
    <span className="status-pill stat-card--amber">Customer sends OFF</span>
   </div>
   <div className="simple-list" style={{marginBottom:14}}>
    <div className="simple-list__item"><span>Test recipient</span><strong>{TEST_RECIPIENT}</strong></div>
    <div className="simple-list__item"><span>Provider</span><strong>SendGrid</strong></div>
   </div>
   <div className="card-actions">
    <button type="button" className="button button--primary" disabled={sending} onClick={sendTest}>
     {sending?"Sending test…":"Send Recovery Test Email"}
    </button>
   </div>
   {result?.ok ? (
    <div role="status" className="notice knowledge-notice-success" style={{marginTop:14}}>
     SendGrid accepted the test email for {TEST_RECIPIENT}. Check the inbox to confirm delivery.
     <div style={{marginTop:7,overflowWrap:"anywhere",fontSize:12}}>Provider message ID: {result.id}</div>
    </div>
   ) : null}
   {result&&!result.ok ? <div role="alert" className="notice notice--error" style={{marginTop:14}}>{result.error}</div> : null}
  </section>
 );
}

// Temporary preview-only consultation. No production effect or customer data access.
const TOKEN = 'askme-design-sol62-20261121-3f4e1c8a704a';
export default async function handler(req, res) {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Robots-Tag','noindex');
  if (process.env.VERCEL_ENV !== 'preview' || req.method !== 'GET' || req.query.token !== TOKEN) return res.status(404).json({ok:false});
  const key = process.env.OPENAI_API_KEY;
  if (!key) return res.status(503).json({ok:false,reason:'key_unconfigured'});
  const prompt = `You are advising a UK used-van retailer on redesigning their website AI assistant called "Ask Me", shared by Van Finance Company and Rent2Buy Vans. Your job is to propose practical, specific, tasteful conversion improvements that use NO extra screen space outside the existing Ask Me chat, obeying these non-negotiable constraints:

- Mobile layouts already have too many prominent buttons. Do NOT suggest another floating button, longer label, new banner, toast, pop-up, animated attention-grabber, auto-open, or any additional on-page text.
- Keep the existing mobile scroll-to-reveal behavior (on Rent2Buy the existing three-button bottom bar is Chat, Call, Ask Me; appears after about 96 px scrolling; desktop has a compact Ask Me launcher). Do NOT change this.
- Existing Ask Me button externally remains the same size, text, and general location.
- Speed matters more than using the newest model. Existing GPT-6 Sol should remain unchanged.
- Inside-chat improvements ARE allowed. Use current context including vehicle registration/finance vs Rent2Buy, but do not invent live vehicle pricing or approval promises.
- Need low-risk preview experiments and measurement. No changes to production without user approval.

Facts from Marketing CRM:
* Across August–September, roughly 27,891 launcher_impression events and 121 launcher_open events were recorded, but these event types stopped being logged after September. The counts may not reflect unique persons or complete instrumented clicks.
* For Nov 1–20, 2026: VFC 15,900 website sessions, Ask Me 15 opened conversations, 5 with actual customer questions; Rent2Buy 6,482 website sessions, Ask Me 18 conversations, 3 with actual questions. Total 25 of 33 opened conversations resulted in no user-submitted question. Some may be tests.
* Both current website chat components render only response text and do not render structured application CTA when supplied by the backend. There is an unused backend capability for application CTAs; button should only appear when policy and verified eligibility support it.
* The current website widget has a plain text greeting, typing box and send button, with no inside-chat quick answers. Mobile screen space is tight.

Direct question from owner: "I don't want Ask Me visible until the customer starts scrolling. There is enough clutter already with the two other buttons. Making the label more clear adds text and there is no space. What is the alternative?"

Give 4-6 original, ranked ideas that respect every constraint, including a simple inside-chat ASCII/text mockup, low-cost instrumentation design, and a small A/B test strategy. Flag any ideas that likely reduce conversion or annoy customers. Avoid generic 'make the button bigger/change the label' advice, and avoid overstating that historical click rate is valid today. Be concise, business-minded, and specific.`;
  const started = performance.now();
  try {
    const r = await fetch('https://api.openai.com/v1/responses',{
      method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},
      body:JSON.stringify({
        model:'gpt-6.2-sol',
        reasoning:{effort:'medium'},
        input:[{role:'system',content:'You are a careful UX and conversion specialist. Respect all constraints. Provide a practical independent recommendation.'},{role:'user',content:prompt}],
        max_output_tokens:2200
      }),
      signal:AbortSignal.timeout(65000)
    });
    const payload = await r.json().catch(()=>({}));
    if (!r.ok) return res.status(200).json({ok:false,model:'gpt-6.2-sol',status:r.status,error:payload.error?.message?.slice(0,250)||'request_failed'});
    const answer = payload.output_text || (payload.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('\n');
    return res.status(200).json({ok:true,model:'gpt-6.2-sol',ms:Math.round(performance.now()-started),answer,usage:payload.usage});
  } catch(e){return res.status(200).json({ok:false,model:'gpt-6.2-sol',error:String(e.message||e).slice(0,250)});}
}

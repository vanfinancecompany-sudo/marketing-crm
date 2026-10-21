// Customer-facing HTML for the isolated archived applicant follow-up.
// Mirrors the approved dark email card and red CTA, not the old plain-text
// pre-line wrapper. Never modify other campaigns or transactional email.
const escapeHtml=value=>String(value??'')
 .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
 .replace(/"/g,'&quot;').replace(/'/g,'&#39;');

export function renderArchivedRecoveryHtml({text,brand}={}){
 if(!['vanFinance','rent2buy'].includes(brand))throw new Error('Invalid recovery email brand');
 const raw=String(text||'');
 const unsubscribe=raw.match(/https:\/\/www\.rent2buyvans\.co\.uk\/api\/customer-recovery-unsubscribe\?token=[^\s<>"']+/i)?.[0];
 if(!unsubscribe)throw new Error('Missing recovery opt-out link');
 const firstLine=raw.split(/\r?\n/,1)[0].trim();
 const nameGreeting=/^Hi [^\r\n<>]{1,73},$/.test(firstLine)?firstLine:'Hi there,';
 const finance=brand==='vanFinance';
 const title=finance?'Still looking for a van?':'Still looking for a Rent2Buy van?';
 const label=finance?'VAN FINANCE COMPANY':'RENT2BUY VANS';
 const question=finance
  ?'You previously enquired about van finance with Van Finance Company.'
  :'You previously enquired about a Rent2Buy van. Are you still looking?';
 const offer=finance
  ?'If you are still looking, we have a wide choice of vans. Good or poor credit is welcome, deposits start from £99, and we offer free UK delivery.'
  :'No credit check. Rent it, Drive it, Own it. Take a look at our current vans, and apply again if you find something suitable so we can review eligibility and affordability.';
 const href=finance?'https://www.vanfinancecompany.co.uk':'https://www.rent2buyvans.co.uk';
 const button=finance?'View Vans':'View Rent2Buy Vans';
 // Tables and inline styles preserve formatting in Outlook and webmail.
 const paragraph=s=>'<p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#f5f5f5;">'+escapeHtml(s)+'</p>';
 return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>'
 +'<body style="margin:0;padding:0;background-color:#292929;color:#f5f5f5;">'
 +'<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#292929" style="width:100%;background-color:#292929;">'
 +'<tr><td align="center" style="padding:30px 16px;">'
 +'<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" bgcolor="#222222" style="width:100%;max-width:560px;background-color:#222222;border-radius:12px;">'
 +'<tr><td style="padding:29px 28px 28px;">'
 +'<p style="margin:0 0 13px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.3;font-weight:700;letter-spacing:0.4px;color:#ff6868;">'+escapeHtml(label)+'</p>'
 +'<h1 style="margin:0 0 20px;font-family:Arial,Helvetica,sans-serif;font-size:23px;line-height:1.3;font-weight:700;color:#ffffff;">'+escapeHtml(title)+'</h1>'
 +paragraph(nameGreeting)+paragraph(question)+paragraph(offer)
 +'<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 19px;"><tr>'
 +'<td bgcolor="#c60024" style="border-radius:5px;background-color:#c60024;">'
 +'<a href="'+escapeHtml(href)+'" style="display:inline-block;padding:13px 22px;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.2;font-weight:700;text-decoration:none;">'+escapeHtml(button)+'</a>'
 +'</td></tr></table>'
 +'<p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;color:#c6c6c6;">Kind regards,<br>'+escapeHtml(finance?'Van Finance Company':'Rent2Buy Vans')+'</p>'
 +'<p style="margin:0;padding-top:12px;border-top:1px solid #454545;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.6;color:#ababab;">'
 +'You are receiving this one-off follow-up because you previously applied with us. '
 +'<a href="'+escapeHtml(unsubscribe)+'" style="color:#c9c9c9;text-decoration:underline;">Unsubscribe</a></p>'
 +'</td></tr></table></td></tr></table></body></html>';
}

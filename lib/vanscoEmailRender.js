import crypto from "node:crypto";

const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const lineBreaks = value => escape(value).replace(/\r?\n/g, "<br>");
const pounds = value => "£" + Number(value || 0).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const palettes = {
  standard: { dark: "#191b1f", accent: "#ca2638", light: "#f5f5f6" },
  halloween: { dark: "#261e2b", accent: "#e4a858", light: "#f7efe7" },
  black_friday: { dark: "#151515", accent: "#cc283a", light: "#f4f4f4" },
  christmas: { dark: "#233e38", accent: "#bd9c5c", light: "#f6f3eb" },
};
export function makeVanscoUnsubscribeToken({ email, contactId, sendId, secret, now = Date.now() }) {
  if (!secret) throw new Error("Marketing unsubscribe secret is not configured.");
  const encoded = Buffer.from(JSON.stringify({
    brand: "vansco", email, contact_id: contactId, send_id: sendId, exp: now + 180 * 86400_000,
  })).toString("base64url");
  return encoded + "." + crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
}
export function checkVanscoUnsubscribeToken(token, secret, now = Date.now()) {
  const [encoded, signature] = String(token || "").split(".");
  if (!secret || !encoded || !signature || encoded.length > 2000) throw new Error("Invalid unsubscribe link.");
  const expected = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature.length === expected.length ? signature : expected.slice(0, 0).padEnd(expected.length, ".")))) throw new Error("Invalid unsubscribe link.");
  const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  if (parsed.brand !== "vansco" || !parsed.contact_id || !parsed.email || !parsed.send_id || parsed.exp < now) throw new Error("Unsubscribe link invalid or expired.");
  return parsed;
}

export function renderVanscoContactFooter(footerNote = "") {
  const branches = [
    { name: "333 Showroom", line1: "333 Millbrook Road West", line2: "Southampton, Hampshire SO15 0HW", phone: "02380 333 777", tel: "+442380333777" },
    { name: "New Forest", line1: "Senior Service Station, Romsey Road", line2: "Cadnam, Hampshire SO40 2NN", phone: "02380 813 119", tel: "+442380813119" },
    { name: "Southampton Airport", line1: "201 Wide Lane, Spitfire Roundabout", line2: "Southampton, Hampshire SO18 2RZ", phone: "02381 780 300", tel: "+442381780300" },
  ];
  // Old saved Halloween templates had contact information embedded in a plain-text note.
  // Remove those legacy lines from the legal note to avoid duplicate branch listings.
  const legalNote = String(footerNote || "").split(/\r?\n/).filter(line =>
    !/^(?:contact vansco|333 showroom\s*:|new forest\s*:|southampton airport\s*:|email\s*:\s*sales@vansco\.co\.uk)/i.test(line.trim())
  ).join("\n").trim();
  const branchRows = '<tr>' + branches.map((branch, index) =>
    '<td class="vansco-branch ' + (index===2 ? 'vansco-branch-last':'') + '" width="33%" valign="top" style="width:33.33%;padding:13px 12px 12px;' + (index<2 ? 'border-right:1px solid #504b53;' : '') + '">' +
    '<strong style="display:block;color:#f0bf55;font:700 13px/20px Arial,sans-serif;margin-bottom:7px">' + escape(branch.name) + '</strong>' +
    '<span style="display:block;color:#e5e2e9;font:12px/18px Arial,sans-serif">' + escape(branch.line1) + '<br>' + escape(branch.line2) + '</span>' +
    '<a href="tel:' + escape(branch.tel) + '" style="display:block;margin-top:10px;color:#fff;text-decoration:none;font:700 13px/20px Arial,sans-serif;white-space:nowrap">' + escape(branch.phone) + '</a>' +
    '</td>'
  ).join("") + '</tr>';
  return '<tr><td style="padding:25px 27px 22px;background:#25232a;color:#fff;font-family:Arial,sans-serif">' +
    '<h2 style="font:bold 19px/25px Arial,sans-serif;margin:0 0 7px;color:#fff">Contact Vansco</h2>' +
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse">' + branchRows + '</table>' +
    '<p style="margin:17px 0 0;color:#e5e2e9;font:13px/20px Arial,sans-serif">Email: <a href="mailto:sales@vansco.co.uk" style="color:#f0bf55;font-weight:bold;text-decoration:underline">sales@vansco.co.uk</a></p>' +
    (legalNote ? '<p style="margin:20px 0 0;padding-top:15px;border-top:1px solid #504b53;color:#aca8b2;font:11px/18px Arial,sans-serif">' + lineBreaks(legalNote) + '</p>' : "") +
    '</td></tr>';
}

export function renderVanscoEmail({ settings = {}, vehicles = [], unsubscribeUrl = "", testMode = false }) {
  const p = palettes[settings.theme] || palettes.standard;
  const halloween = settings.theme === "halloween";
  const headerArt = halloween ? '<span aria-hidden="true" style="white-space:nowrap;font-size:17px"> 👻 🎃</span>' : "";
  const logo = settings.logo_url
    ? '<img src="' + escape(settings.logo_url) + '" alt="Vansco" style="display:block;border:0;max-height:68px;max-width:194px;height:auto;width:auto">'
    : '<strong style="color:#fff;font:900 26px Arial,sans-serif;letter-spacing:2px">VANSCO<span style="color:'+p.accent+'">.</span></strong>';
  const textPara = (value, style = "") => value
    ? '<tr><td style="padding:14px 28px;font:14px/23px Arial,sans-serif;color:#393b40;' + style + '">' + lineBreaks(value) + '</td></tr>' : "";
  const card = vehicle => {
    const sale = settings.sale_prices?.[vehicle.key] || vehicle.sale_prices || {};
    const was = Number(sale.was), now = Number(sale.now);
    const saleValid = was > now && now > 0 && (!sale.save || Math.abs(Number(sale.save) - (was - now)) < 0.01);
    const vat = vehicle.vat_label ? '<span style="font:600 12px Arial,sans-serif;color:#636972;white-space:nowrap;margin-left:5px">'+escape(vehicle.vat_label)+'</span>' : "";
    const price = saleValid
      ? '<div style="margin:10px 0 3px;color:#767676;font:12px Arial,sans-serif">WAS <span style="text-decoration:line-through">' + pounds(was) + '</span></div><div style="font:bold 20px Arial,sans-serif;color:#17191c;white-space:nowrap">NOW ' + pounds(now) + vat + '</div><div style="margin-top:6px;color:#c32239;font:bold 14px Arial,sans-serif">SAVE ' + pounds(was-now) + '</div>'
      : '<div style="margin-top:12px;color:#141518;font:bold 20px Arial,sans-serif;white-space:nowrap">' + escape(vehicle.price || "") + vat + '</div>';
    const mileage = Number(String(vehicle.mileage || "").replace(/[^0-9]/g, ""));
    const detail = String(vehicle.detail || "").trim();
    return '<td class="van" valign="top" width="50%" style="width:50%;padding:7px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;border:1px solid #e6e6e8;background:#fff"><tr><td style="background:#f3f3f3;text-align:center"><a href="' + escape(vehicle.url) + '"><img src="' + escape(vehicle.image) + '" alt="' + escape(vehicle.title) + '" width="290" style="display:block;width:100%;max-width:290px;height:auto;border:0"></a></td></tr><tr><td style="padding:12px;font-family:Arial,sans-serif"><strong style="display:block;color:#202126;font-size:15px;line-height:20px">' + escape(vehicle.title) + '</strong>' +
      (detail ? '<p style="font-size:12px;line-height:17px;color:#555b62;margin:7px 0">' + escape(detail) + '</p>' : "") +
      (vehicle.registration ? '<p style="font-size:12px;color:#737982;margin:7px 0">Reg: '+escape(vehicle.registration)+'</p>':"") +
      (mileage ? '<p style="font-size:12px;color:#33383e;margin:7px 0">Mileage: <strong>'+mileage.toLocaleString("en-GB")+' miles</strong></p>':"") +
      price +
      '<p style="margin:15px 0 2px"><a href="'+escape(vehicle.url)+'" style="color:#222;text-decoration:underline;font-size:12px;font-weight:bold">VIEW VEHICLE</a></p></td></tr></table></td>';
  };
  let rows = "";
  for (let i=0;i<vehicles.length;i+=2) {
    rows+='<tr><td style="padding:3px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'+card(vehicles[i])+(vehicles[i+1]?card(vehicles[i+1]):'<td width="50%" class="van"></td>')+'</tr></table></td></tr>';
  }
  const body = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escape(settings.subject)+'</title><style>@media(max-width:600px){.van{display:block!important;width:100%!important}.vansco-branch{display:block!important;box-sizing:border-box!important;width:100%!important;border-right:0!important;border-bottom:1px solid #504b53!important;padding:14px 5px!important}.vansco-branch-last{border-bottom:0!important}}</style></head>'+
    '<body style="margin:0;background:#e9e9e9"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#e9e9e9"><tr><td align="center" style="padding:18px 7px"><table role="presentation" width="650" cellspacing="0" cellpadding="0" style="width:100%;max-width:650px;background:#fff">'+
    '<tr><td style="padding:20px 25px;background:'+p.dark+'"><table role="presentation" width="100%"><tr><td valign="middle">'+logo+'</td><td valign="middle" align="right" style="color:'+p.accent+';font:700 11px Arial,sans-serif;letter-spacing:1px">'+escape(settings.eyebrow||"VANSCO")+headerArt+'</td></tr></table></td></tr>'+
    '<tr><td style="padding:32px 28px;background:'+p.dark+';border-top:2px solid '+p.accent+'"><table role="presentation" width="100%"><tr><td valign="top"><h1 style="margin:0 0 15px;color:#fff;font:bold 34px/39px Arial,sans-serif">'+escape(settings.heading)+'</h1>'+(settings.subheading?'<p style="margin:0 0 14px;color:'+p.accent+';font:bold 17px/23px Arial,sans-serif">'+escape(settings.subheading)+'</p>':"")+'</td></tr></table><p style="margin:0;color:#f4f4f4;font:15px/24px Arial,sans-serif">'+lineBreaks(settings.introduction||"")+'</p></td></tr>'+
    (settings.offer?'<tr><td style="padding:20px 28px;background:'+p.light+';font:bold 19px/26px Arial,sans-serif;color:'+p.dark+'">'+lineBreaks(settings.offer)+'</td></tr>':"")+
    textPara(settings.brand_description)+
    '<tr><td style="padding:19px 28px 6px;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse"><tr><td valign="middle"><h2 style="margin:0;color:#202124;font:bold 19px Arial,sans-serif">Featured Vans</h2></td><td valign="middle" align="right">'+(settings.stock_count?'<span style="display:inline-block;padding:6px 8px;background:#f1f1f1;color:#202124;font:700 12px/16px Arial,sans-serif;white-space:nowrap">'+escape(settings.stock_count)+' vehicles in stock</span>':"")+'</td></tr></table><p style="margin:8px 0 0;color:#70777d;font:13px/19px Arial,sans-serif">'+escape(settings.stock_location||"Browse our selected used vans")+'</p></td></tr>'+rows+textPara(settings.extra_text)+
    '<tr><td align="center" style="padding:29px"><a href="'+escape(settings.cta_url)+'" style="display:inline-block;background:'+p.accent+';color:#161616;padding:15px 24px;text-decoration:none;font:bold 13px Arial,sans-serif">'+escape(settings.cta_label)+'</a></td></tr>'+
    renderVanscoContactFooter(settings.footer_note)+
    '<tr><td style="padding:18px 27px;background:#f1f2f2;color:#51565e;font:11px/18px Arial,sans-serif">Vansco Limited · <a href="https://www.vansco.co.uk/" style="color:#303030">www.vansco.co.uk</a><p style="margin:9px 0">Vehicle availability, pricing and VAT status subject to confirmation.</p>'+

    (testMode?'<p>INTERNAL TEST EMAIL. NOT FOR CUSTOMER DISTRIBUTION.</p>':'<p><a href="'+escape(unsubscribeUrl)+'" style="color:#32363b">Unsubscribe from marketing emails</a></p>')+
    '</td></tr></table></td></tr></table></body></html>';
  return body;
}

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normaliseSettings, mappedVehicle, normaliseSalePrices, normalisePrice } from "../api/vansco-email-studio.js";
import { isPermittedVanscoTestDestination } from "../api/vansco-email-delivery.js";
import { verifyLogoBytes } from "../api/vansco-email-logo.js";
import { renderVanscoEmail, renderVanscoContactFooter, makeVanscoUnsubscribeToken, checkVanscoUnsubscribeToken } from "../lib/vanscoEmailRender.js";
import { isVanscoWebhookPayload } from "../lib/vanscoEmailEvent.js";

const base = {
  theme: "halloween",
  subject: "Halloween Sale",
  preview_text: "Explore Vansco offers",
  heading: "HALLOWEEN VAN SALE",
  introduction: "Browse our featured vans.",
  offer: "Seasonal deals",
  cta_label: "VIEW VANS",
  cta_url: "https://www.vansco.co.uk/all-stock/",
  selected_keys: ["dk:sample"],
};

test("seasonal master normalisation supports four themes and only Vansco links", () => {
  for (const theme of ["standard", "halloween", "black_friday", "christmas"]) {
    const result = normaliseSettings({ ...base, theme });
    assert.equal(result.theme, theme);
    assert.equal(result.selected_keys[0], "dk:sample");
  }
  assert.throws(() => normaliseSettings({ ...base, theme: "vfc" }), /theme/i);
  assert.throws(() => normaliseSettings({ ...base, cta_url: "https://www.vanfinancecompany.co.uk/" }), /Vansco/i);
  assert.throws(() => normaliseSettings({ ...base, cta_url: "javascript:alert(1)" }), /valid/i);
  assert.throws(() => normaliseSettings({ ...base, selected_keys: ["abc", "abc"] }), /six different/i);
  assert.throws(() => normaliseSettings({ ...base, selected_keys: Array(7).fill(0).map((_, i) => String(i)) }), /six different/i);
});

test("vehicle selector enforces source availability, Vansco host, photographs and van classification", () => {
  const van = {
    vehicleKey: "dk:abc", availability: "AVAILABLE", vehicleUrl: "https://www.vansco.co.uk/vehicle-details/abc",
    imageUrl: "https://cdn.dealerkit.uk/abc.jpg", title: "Ford Transit Custom", price: "£15,995",
    bodyStyle: "Panel Van",
  };
  assert.equal(mappedVehicle(van)?.key, "dk:abc");
  assert.equal(mappedVehicle({ ...van, availability: "SOLD" }), null);
  assert.equal(mappedVehicle({ ...van, imageUrl: "" }), null);
  assert.equal(mappedVehicle({ ...van, vehicleUrl: "https://example.com/vehicle-details/abc" }), null);
});

test("new Vansco studio cannot alter automatic transactional sends or dispatch campaigns", () => {
  const api = readFileSync(new URL("../api/vansco-email-studio.js", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../public/vansco-email-studio/index.html", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../supabase/migrations/20261020_vansco_email_studio_foundation.sql", import.meta.url), "utf8");
  assert.match(api, /NO|NEVER invokes an email provider/i);
  assert.doesNotMatch(api, /sendSendGridEmail|callEmailProvider|sendgrid\.com\/v3\/mail\/send|api\.brevo\.com\/v3\/smtp\/email/);
  assert.doesNotMatch(api, /from\(["']marketing_campaigns["']\)|from\(["']marketing_email_sends["']\)/);
  assert.match(ui, /id="sendCustomerBatch" disabled/);
  assert.match(readFileSync(new URL("../api/vansco-email-delivery.js", import.meta.url), "utf8"), /VANSCO_EMAIL_PRODUCTION_ENABLED/);
  assert.match(ui, /Send new campaign draft|Save new campaign draft/);
  assert.match(migration, /marketing_vansco_email_contacts/);
  assert.doesNotMatch(migration, /alter table public\.marketing_contacts|update public\.marketing_contacts|delete from public\.marketing_contacts/i);
});

test("more template fields persist without breaking legacy master settings", () => {
  const settings = normaliseSettings({
    ...base, eyebrow: "HALLOWEEN EDITION", subheading: "Autumn Vansco sale",
    brand_description: "Vansco serves Southampton and the New Forest.",
    extra_text: "Offers available while stock lasts.", footer_note: "Subject to availability.",
    logo_url: "https://static.wixstatic.com/media/real-vansco-logo.png",
  });
  assert.equal(settings.eyebrow, "HALLOWEEN EDITION");
  assert.equal(settings.brand_description, "Vansco serves Southampton and the New Forest.");
  assert.equal(settings.footer_note, "Subject to availability.");
  assert.match(settings.logo_url, /wixstatic/);
  assert.equal(normaliseSettings(base).logo_url, "");
  const previous = process.env.SUPABASE_URL;
  try {
    process.env.SUPABASE_URL = "https://vansco-test.supabase.co";
    const logoUrl = "https://vansco-test.supabase.co/storage/v1/object/public/template-files/vansco-email-studio/logos/logo.png";
    assert.equal(normaliseSettings({ ...base, logo_url: logoUrl }).logo_url, logoUrl);
    assert.throws(() => normaliseSettings({ ...base, logo_url: "https://vansco-test.supabase.co/storage/v1/object/public/customer-docs/private.png" }), /Logo must use/);
  } finally {
    if (previous === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previous;
  }
  assert.throws(() => normaliseSettings({ ...base, logo_url: "https://example.com/malicious.svg" }), /Logo must use/);
});

test("sale pricing is isolated by selected van and mathematically consistent", () => {
  assert.equal(normalisePrice("£15,995"), "15995.00");
  assert.equal(normalisePrice("12999.50"), "12999.50");
  assert.equal(normaliseSalePrices({ van1: { was: "15995", now: "13995", save: "2000" }, other: { was: "999", now: "1" } }, ["van1"]).van1.save, "2000.00");
  assert.equal(normaliseSalePrices({ van1: { was: "15995", now: "13995" } }, ["van1"]).van1.save, "2000.00");
  assert.deepEqual(normaliseSalePrices({ van1: { was: "15995", now: "13995" } }, ["van2"]), {});
  assert.throws(() => normaliseSalePrices({ van1: { was: "15995", now: "13995", save: "1000" } }, ["van1"]), /must equal/);
  assert.throws(() => normaliseSalePrices({ van1: { was: "100", now: "120" } }, ["van1"]), /exceed/);
  assert.throws(() => normalisePrice("one thousand"), /valid amount/);
});

test("logo upload validates actual PNG/JPEG/WebP signatures and size", () => {
  const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), Buffer.alloc(50)]);
  assert.equal(verifyLogoBytes(png, "image/png"), "image/png");
  assert.throws(() => verifyLogoBytes(Buffer.alloc(40), "image/png"), /genuine/);
  assert.throws(() => verifyLogoBytes(png, "image/jpeg"), /genuine/);
  assert.throws(() => verifyLogoBytes(Buffer.alloc(1_500_001), "image/png"), /1.5 MB/);
});

test("seasonal email renderer preserves complete source image and promotion controls", () => {
  const ui = readFileSync(new URL("../public/vansco-email-studio/index.html", import.meta.url), "utf8");
  const api = readFileSync(new URL("../api/vansco-email-studio.js", import.meta.url), "utf8");
  assert.match(ui, /id="saleEditors"/);
  assert.match(ui, /id="logoFile"/);
  const upload = readFileSync(new URL("../api/vansco-email-logo.js", import.meta.url), "utf8");
  assert.match(upload, /storage\.from\("template-files"\)/);
  assert.doesNotMatch(upload, /BLOB_READ_WRITE_TOKEN/);
  assert.match(ui, /id="brandDescription"/);
  assert.match(ui, /id="extraText"/);
  assert.match(ui, /text-decoration:line-through/);
  assert.match(ui, /SAVE /);
  assert.match(ui, /🎃/);
  assert.doesNotMatch(ui, /max-height:200px;object-fit:cover/);
  assert.match(ui, /width:100%;max-width:290px;height:auto/);
  assert.match(api, /selected_vehicles: priceSnapshots/);
  assert.match(api, /normaliseSalePrices/);
});

test("Vansco branded HTML includes ghost, description, mileage, and manual discounts", () => {
  const html = renderVanscoEmail({
    settings: {
      ...base, brand_description: "A trusted regional van dealer.",
      subheading: "Halloween offers", sale_prices: { van1: { was: "15995.00", now: "13995.00", save: "2000.00" } },
    },
    vehicles: [{ key:"van1", url:"https://www.vansco.co.uk/v/van1", image:"https://example.com/van1.jpg", title:"2021 Ford Transit L3 Dropside", registration:"AB21 CDE", detail:"350 L3 Dropside", mileage:"72450", price:"£15,995", vat_label:"+ VAT" }],
    unsubscribeUrl:"https://marketing-crm-six.vercel.app/api/vansco-email-unsubscribe?token=stub",
  });
  assert.match(html,/👻/);
  assert.match(html,/350 L3 Dropside/);
  assert.match(html,/72,450 miles/);
  assert.match(html,/WAS/);
  assert.match(html,/NOW/);
  assert.match(html,/SAVE/);
  assert.match(html,/text-decoration:line-through/);
  assert.match(html,/unsubscribe from marketing emails/i);
  assert.doesNotMatch(html,/object-fit:cover|max-height:200px/);
  assert.match(html,/height:auto/);
});

test("signed Vansco opt-out token verifies only matching content and valid lifetime", () => {
  const secret="test-secret-vansco-marketing";
  const params={email:"buyer@example.com",contactId:"11111111-1111-4111-8111-111111111111",sendId:"22222222-2222-4222-8222-222222222222",secret,now:0};
  const token=makeVanscoUnsubscribeToken(params);
  assert.equal(checkVanscoUnsubscribeToken(token,secret,1000).email,params.email);
  assert.throws(()=>checkVanscoUnsubscribeToken(token+"x",secret,1000),/Invalid/);
  assert.throws(()=>checkVanscoUnsubscribeToken(token,secret,181*86400_000),/expired/);
});

test("Vansco provider event routing requires separate matching brand and send identifiers", () => {
  const ids={vansco_email_send_id:"11111111-1111-4111-8111-111111111111",vansco_email_campaign_id:"22222222-2222-4222-8222-222222222222"};
  assert.equal(isVanscoWebhookPayload({vansco_brand:"vansco",...ids}),true);
  assert.equal(isVanscoWebhookPayload({...ids}),false);
  assert.equal(isVanscoWebhookPayload({vansco_brand:"vansco",vansco_email_send_id:"bad",vansco_email_campaign_id:ids.vansco_email_campaign_id}),false);
});

test("live Vansco email customer sends have separate ledger, a locked production gate and no automations", () => {
  const delivery=readFileSync(new URL("../api/vansco-email-delivery.js",import.meta.url),"utf8");
  const migration=readFileSync(new URL("../supabase/migrations/20261020_vansco_email_manual_sends.sql",import.meta.url),"utf8");
  const webhook=readFileSync(new URL("../api/sendgrid-email-webhook.js",import.meta.url),"utf8");
  assert.match(delivery,/VANSCO_EMAIL_PRODUCTION_ENABLED/);
  assert.match(delivery,/ids\.length>5/);
  assert.match(delivery,/checkVanscoTestRateLimit\(supabase\)/);
  assert.match(delivery,/marketing_vansco_email_sends/);
  assert.doesNotMatch(delivery,/marketing_email_send_recipients|marketing_email_sends|transactional-rent2buy/);
  assert.match(migration,/one_production_send_per_contact_campaign/);
  assert.match(webhook,/isVanscoWebhookPayload/);
  assert.match(webhook,/continue;/);
});

test("Vansco Halloween copy and all three branch contact details appear in real email HTML", () => {
  const studioApi=readFileSync(new URL("../api/vansco-email-studio.js",import.meta.url),"utf8");
  const ui=readFileSync(new URL("../public/vansco-email-studio/index.html",import.meta.url),"utf8");
  for(const text of ["333 Millbrook Road West","Senior Service Station","Spitfire Roundabout","02380 333 777","02380 813 119","02381 780 300","sales@vansco.co.uk"]){
    assert.ok(ui.includes(text),"Missing Vansco preview contact: "+text);
  }
  const footer=["CONTACT VANSCO","333 Showroom: 333 Millbrook Road West, Southampton, Hampshire SO15 0HW | 02380 333 777","New Forest: Senior Service Station, Romsey Road, Cadnam, Hampshire SO40 2NN | 02380 813 119","Southampton Airport: 201 Wide Lane, Spitfire Roundabout, Southampton, Hampshire SO18 2RZ | 02381 780 300","Email: sales@vansco.co.uk"].join("\n");
  const html=renderVanscoEmail({settings:{...base,heading:"HALLOWEEN VAN SALE",eyebrow:"HALLOWEEN EDITION",footer_note:footer},vehicles:[],testMode:true});
  for(const value of ["02380 333 777","02380 813 119","02381 780 300","sales@vansco.co.uk","👻","🎃"])assert.ok(html.includes(value),value);
  assert.doesNotMatch(html,/🦇|🧙/);
  assert.doesNotMatch(ui,/🦇|🧙/);
  assert.match(ui,/var footer=[\s\S]*?Contact Vansco/);
  assert.match(studioApi,/footer_note: "Vehicle prices and availability/);
  assert.match(studioApi,/FREE nationwide delivery/);
});

test("Vansco footer has three separated showroom sections and no duplicated legacy text", () => {
  const legacy=[
    "Contact Vansco",
    "333 Showroom: 333 Millbrook Road West, Southampton, Hampshire SO15 0HW | 02380 333 777",
    "New Forest: Senior Service Station, Romsey Road, Cadnam, Hampshire SO40 2NN | 02380 813 119",
    "Southampton Airport: 201 Wide Lane, Spitfire Roundabout, Southampton, Hampshire SO18 2RZ | 02381 780 300",
    "Email: sales@vansco.co.uk",
    "",
    "Vehicle prices and availability are subject to confirmation.",
  ].join("\n");
  for (const note of [legacy, "Vehicle prices and availability are subject to confirmation."]) {
    const rendered=renderVanscoContactFooter(note);
    for(const [place,phone,tel] of [
      ["333 Showroom","02380 333 777","+442380333777"],
      ["New Forest","02380 813 119","+442380813119"],
      ["Southampton Airport","02381 780 300","+442381780300"],
    ]) {
      assert.equal(rendered.split(place).length - 1, 1,place+" repeated");
      assert.equal(rendered.split(phone).length - 1, 1,phone+" repeated");
      assert.match(rendered,new RegExp("tel:\\+"+tel.slice(1)));
    }
    assert.equal(rendered.split("sales@vansco.co.uk").length - 1, 2,"one clickable email address");
    assert.equal(rendered.split("border-right:1px solid #504b53").length - 1, 2);
    assert.match(rendered, /class="vansco-branch /);
    assert.equal((rendered.match(/width="33%"/g) || []).length, 3);
    assert.match(rendered, /<tr><td class="vansco-branch/);
    assert.match(rendered,/mailto:sales@vansco\.co\.uk/);
    assert.equal(rendered.split("Vehicle prices and availability are subject to confirmation.").length-1,1);
    assert.doesNotMatch(rendered,/\| 02380/);
  }
});

test("VAT label follows NOW amount on the same price line in actual Vansco emails", () => {
  const ui = readFileSync(new URL("../public/vansco-email-studio/index.html",import.meta.url),"utf8");
  const renderer = readFileSync(new URL("../lib/vanscoEmailRender.js",import.meta.url),"utf8");
  const vehicle={key:"testvan",title:"Ford Transit Custom",url:"https://www.vansco.co.uk/v/one",image:"https://example.com/one.jpg",mileage:"35000",price:"£15,995",vat_label:"+ VAT"};
  const html=renderVanscoEmail({
    settings:{...base,stock_count:"278",stock_location:"Used Vehicles in Southampton, Hampshire",sale_prices:{testvan:{was:"15995",now:"13995",save:"2000"}}},
    vehicles:[vehicle],testMode:true
  });
  assert.match(html,/NOW £13,995<span[^>]*>\+ VAT<\/span>/);
  assert.match(html,/278 vehicles in stock/);
  assert.match(html,/Used Vehicles in Southampton, Hampshire/);
  assert.match(ui,/stockCount:"stock_count",stockLocation:"stock_location"/);
  assert.match(ui,/class="vansco-branch /);
  assert.match(renderer,/\.vansco-branch\{display:block!important/);
  assert.doesNotMatch(ui,/item\.vat_label\?'<div/);
  assert.doesNotMatch(renderer,/vehicle\.vat_label \? '<p style/);
});

test("unsale vehicle prices also display VAT inline", () => {
  const html=renderVanscoEmail({
    settings:{...base,stock_count:"278",stock_location:"Used Vehicles in Southampton, Hampshire"},
    vehicles:[{key:"van",title:"Ford Transit",url:"https://www.vansco.co.uk/v/van",image:"https://example.com/van.jpg",price:"£15,995",vat_label:"+ VAT"}],
    testMode:true
  });
  assert.match(html,/£15,995<span[^>]*>\+ VAT<\/span>/);
  assert.doesNotMatch(html,/<p style="font-size:11px;color:#686e75/);
});

test("stock count settings accept an editable positive integer only", () => {
  assert.equal(normaliseSettings({...base,stock_count:"278",stock_location:"Used Vehicles in Southampton, Hampshire"}).stock_count,"278");
  assert.equal(normaliseSettings({...base,stock_count:""}).stock_count,"");
  for(const invalid of ["-1","278 vehicles","23.5","0","1,000"]) {
    assert.throws(()=>normaliseSettings({...base,stock_count:invalid}),/stock count/i);
  }
});

test("Gmail and authorised staff inboxes support frictionless manual testing", () => {
  assert.equal(isPermittedVanscoTestDestination("vanfinancecompany@gmail.com"), true);
  assert.equal(isPermittedVanscoTestDestination("My.Test+promo@googlemail.com"), true);
  assert.equal(isPermittedVanscoTestDestination("someone@yahoo.com"), false);
  assert.equal(isPermittedVanscoTestDestination("mytest@gmail.com.example.org"), false);
  assert.equal(isPermittedVanscoTestDestination("sales@vanfinancecompany.co.uk"), true);
  assert.equal(isPermittedVanscoTestDestination("staff@vansco.co.uk"), true);
  assert.equal(isPermittedVanscoTestDestination("authorised@example.org", {configured:"authorised@example.org"}), true);
});

test("internal tests need no checkbox or phrase and customer sends remain locked", () => {
  const ui=readFileSync(new URL("../public/vansco-email-studio/index.html",import.meta.url),"utf8");
  const delivery=readFileSync(new URL("../api/vansco-email-delivery.js",import.meta.url),"utf8");
  assert.doesNotMatch(ui,/id="ownTestInbox"|id="testConfirmation"|own_inbox:/);
  assert.doesNotMatch(delivery,/body\.own_inbox|three test attempts|recipient\.count\|\|0\)>=3/);
  assert.match(ui,/if\(!confirm\("Send a REAL INTERNAL TEST/);
  assert.match(ui,/delivery\("testSend",\{campaign_id:state\.activeCampaign,to:to\}\)/);
  assert.match(delivery,/checkVanscoTestRateLimit\(supabase\)/);
  assert.match(delivery,/result\.count\|\|0\)>=100/);
  assert.match(delivery,/VANSCO_EMAIL_PRODUCTION_ENABLED!=="true"/);
  assert.match(delivery,/send_type","test"/);
});

test("Vansco showroom addresses use branded directions links instead of Gmail blue auto-links", () => {
  const html=renderVanscoContactFooter("Vehicle prices subject to confirmation.");
  const ui=readFileSync(new URL("../public/vansco-email-studio/index.html",import.meta.url),"utf8");
  assert.equal((html.match(/www\.google\.com\/maps\/search/g)||[]).length,3);
  assert.equal((html.match(/color:#e5e2e9!important;text-decoration:none!important/g)||[]).length,6);
  assert.equal((html.match(/href="tel:/g)||[]).length,3);
  assert.match(ui,/google\.com\/maps\/search/);
  assert.match(html,/mailto:sales@vansco\.co\.uk/);
});

test("Vansco 500-email sending uses separate atomic queue and protects recent contact frequency", () => {
  const sql=readFileSync(new URL("../supabase/migrations/20261020_vansco_email_500_batches.sql",import.meta.url),"utf8");
  const api=readFileSync(new URL("../api/vansco-email-delivery.js",import.meta.url),"utf8");
  assert.match(sql,/p_limit>500/);
  assert.match(sql,/for update of c skip locked/i);
  assert.match(sql,/on conflict do nothing/i);
  assert.match(sql,/attempted_7d=0/);
  assert.match(sql,/attempted_30d<4/);
  assert.match(sql,/attempted_this_month<4/);
  assert.match(sql,/send_type='production'/);
  assert.match(sql,/s\.status <> 'skipped'/);
  assert.match(sql,/marketing_vansco_email_contacts/);
  assert.match(sql,/vansco_only_one_active_customer_batch/);
  assert.match(sql,/revoke all on function public\.vansco_email_reserve_batch/);
  assert.doesNotMatch(sql,/update\s+public\.marketing_contacts/i);
  assert.match(api,/vansco_email_reserve_batch/);
  assert.match(api,/action==="reserveBatch"/);
  assert.match(api,/action==="processBatch"/);
  assert.match(api,/action==="batchStatus"/);
  assert.match(api,/\.eq\("status","queued"\)\.select\("\*"\)/);
  assert.match(api,/action==="sendBatch"\)fail\("Use the frequency-protected/);
  assert.match(api,/id,eligible,attempted_7d,attempted_30d/);
});

test("Vansco batch progress interface has 500 limit, progress bar and pause/resume controls", () => {
  const ui=readFileSync(new URL("../public/vansco-email-studio/index.html",import.meta.url),"utf8");
  assert.match(ui,/id="batchSize" type="number" min="1" max="500" value="500"/);
  assert.match(ui,/id="batchProgress"/);
  assert.match(ui,/aria-valuemax="100"/);
  assert.match(ui,/id="startVanscoBatch"/);
  assert.match(ui,/id="resumeVanscoBatch"/);
  assert.match(ui,/id="pauseVanscoBatch"/);
  assert.match(ui,/id="aEligible"/);
  assert.match(ui,/id="aLocked"/);
  assert.match(ui,/id="aMonthly"/);
  assert.match(ui,/id="aRemaining"/);
  assert.match(ui,/SEND VANSCO /);
  assert.match(ui,/id="sourceReviewNotes"/);
  assert.match(ui,/APPROVE VANSCO SOURCE/);
  assert.doesNotMatch(ui,/id="sendCustomerBatch"/);
  assert.doesNotMatch(ui,/id="batchConfirmation"/);
});

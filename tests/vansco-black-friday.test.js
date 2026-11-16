import test from 'node:test';
import assert from 'node:assert/strict';
import { renderVanscoEmail, renderVanscoContactFooter } from '../lib/vanscoEmailRender.js';
import { renderBlackFriday, blackFridayDefaults } from '../public/vansco-email-studio/black-friday.js';
import { normaliseSettings } from '../api/vansco-email-studio.js';
const vehicle = {key:'van',title:'Ford Transit <Custom>',detail:'Limited',price:'£20,995',vat_label:'+VAT',url:'https://www.vansco.co.uk/van',image:'https://images.example.com/van.jpg',mileage:32050};
const settings={...blackFridayDefaults,theme:'black_friday',selected_keys:['van'],sale_prices:{van:{was:20995,now:18000}}};
test('Black Friday has exclusive equal offers and the inclusive deadline',()=>{const html=renderVanscoEmail({settings,vehicles:[vehicle]});assert.match(html,/OPTION 01/);assert.match(html,/OPTION 02/);assert.match(html,/2-YEAR AUTOGUARD<br>EXTENDED WARRANTY/);assert.match(html,/Choose one offer only/);assert.match(html,/30 November 2026, inclusive/);assert.equal((html.match(/height="216"/g)||[]).length,2)});
test('screen price and VAT remain intact, manual sale state is never mutated',()=>{const before=JSON.stringify({settings,vehicle});const html=renderVanscoEmail({settings,vehicles:[vehicle]});assert.match(html,/£20,995/);assert.match(html,/\+VAT/);assert.doesNotMatch(html,/18,000|SAVE £|WAS /);assert.equal(JSON.stringify({settings,vehicle}),before);assert.match(html,/Ford Transit &lt;Custom&gt;/);assert.match(html,/32,050 miles/)});
test('server and editor use the identical Black Friday composition',()=>{const args={settings,vehicles:[vehicle],unsubscribeUrl:'https://example.com/unsubscribe?token=abc'};assert.equal(renderVanscoEmail(args),renderBlackFriday({...args,footer:renderVanscoContactFooter(settings.footer_note)}));assert.match(renderVanscoEmail(args),/unsubscribe\?token=abc/);assert.doesNotMatch(renderVanscoEmail({...args,testMode:true}),/Unsubscribe from marketing/)});
test('saved campaign settings and order survive normalisation',()=>{const saved=normaliseSettings(JSON.parse(JSON.stringify({...settings,selected_keys:['second','van']})));assert.deepEqual(saved.selected_keys,['second','van']);assert.equal(saved.sale_prices.van.now,"18000.00");const html=renderVanscoEmail({settings:saved,vehicles:[{...vehicle,title:'FIRST'},vehicle]});assert.ok(html.indexOf('FIRST')<html.indexOf('Ford Transit'));assert.equal(saved.heading,settings.heading)});
test('new Black Friday theme clears previous seasonal promotional text',()=>{const changed={brand_description:'OLD WARRANTY',extra_text:'FREE DELIVERY',footer_note:'OLD TERMS',...blackFridayDefaults};assert.equal(changed.brand_description,'');assert.equal(changed.footer_note,'');assert.doesNotMatch(changed.extra_text,/FREE DELIVERY/);assert.doesNotMatch(renderVanscoEmail({settings:{...changed,theme:'black_friday'}}),/OLD WARRANTY|FREE DELIVERY|OLD TERMS/)});

test('Black Friday header is dark and the headline, intro and brand labels remain legible',()=>{
  const html=renderVanscoEmail({settings,vehicles:[vehicle]});
  assert.match(html,/padding:26px 36px;background:#151515/);
  assert.match(html,/padding:38px 36px 32px;background:#151515/);
  assert.match(html,/class="hero" style="margin:0;color:#ffffff/);
  assert.match(html,/max-width:500px;color:#e5e5e5/);
});
test('Black Friday vehicle prices are sterling with thousands separators, not GBP suffixes',()=>{
  const sample={...vehicle,price:'18495 GBP'};
  const html=renderVanscoEmail({settings,vehicles:[sample]});
  assert.match(html,/£18,495/);
  assert.doesNotMatch(html,/18495 GBP|£18495|GBP/);
  assert.match(html,/\+VAT/);
  const numeric=renderVanscoEmail({settings,vehicles:[{...vehicle,price:18495}]});
  assert.match(numeric,/£18,495/);
  const formatted=renderVanscoEmail({settings,vehicles:[{...vehicle,price:'£20,995'}]});
  assert.match(formatted,/£20,995/);
});

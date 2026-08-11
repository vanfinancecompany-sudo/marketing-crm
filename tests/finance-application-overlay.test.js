import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('finance overlay preserves the current Wix message contract and vehicle context', async () => {
  const app = await read('../public/finance-application-overlay/app.js');
  const html = await read('../public/finance-application-overlay/index.html');
  assert.match(app, /type:'finance-submit',payload/);
  assert.match(app, /finance-submit-result/);
  assert.match(app, /type:'iframe-ready'/);
  assert.match(app, /type:'request-parent-page-data'/);
  assert.match(app, /type:'finance-form-submitted'/);
  assert.match(html, /name="vehicle_info"/);
  assert.match(html, /name="vehicle_title"/);
  assert.match(html, /name="vehicle_page_url"/);
  assert.match(html, /name="total_address_months"/);
});

test('finance overlay retains conditional company, address-history and part-exchange routes', async () => {
  const app = await read('../public/finance-application-overlay/app.js');
  assert.match(app, /state\.applicationType === 'Limited Company'/);
  assert.match(app, /current \+ p1 < 36/);
  assert.match(app, /current \+ p1 \+ p2 < 36/);
  assert.match(app, /state\.partExchange === 'Yes'/);
  assert.match(app, /previous3_full_address/);
  assert.match(app, /vehicle_registration/);
});

test('finance overlay is responsive and launcher is opt-in only', async () => {
  const css = await read('../public/finance-application-overlay/styles.css');
  const loader = await read('../public/finance-application-overlay/site-loader.js');
  assert.match(css, /@media\(min-width:760px\)/);
  assert.match(css, /@media\(max-width:600px\)/);
  assert.match(css, /position:sticky;bottom:0/);
  assert.match(loader, /window\.VFCFinanceApplication = \{ open, close \}/);
  assert.match(loader, /display:none/);
  assert.match(loader, /height:100dvh/);
});

test('finance bank inputs are hard-limited and sort code is formatted as 12-34-56', async () => {
  const html = await read('../public/finance-application-overlay/index.html');
  const guards = await read('../public/finance-application-overlay/bank-input-guards.js');
  const app = await read('../public/finance-application-overlay/app.js');
  assert.match(html, /bank-input-guards\.js/);
  assert.match(guards, /slice\(0, 6\)/);
  assert.match(guards, /join\('-'\)/);
  assert.match(guards, /slice\(0, 8\)/);
  assert.match(app, /digitsOnly\(state\.bank_sort_code\)\.length!==6/);
  assert.match(app, /digitsOnly\(state\.bank_account_number\)\.length!==8/);
});

test('vehicle and general Finance routes remain explicit', async () => {
  const html = await read('../public/finance-application-overlay/index.html');
  const routeContext = await read('../public/finance-application-overlay/route-context.js');
  assert.match(html, /route-context\.js/);
  assert.match(routeContext, /General Finance Application/);
  assert.match(routeContext, /applicationRoute/);
  assert.match(routeContext, /Apply before choosing your van/);
});

test('secure live mode posts only when a Wix launch token is present', async () => {
  const html = await read('../public/finance-application-overlay/index.html');
  const liveSubmit = await read('../public/finance-application-overlay/live-submit.js');
  assert.match(html, /live-submit\.js/);
  assert.match(liveSubmit, /launchToken/);
  assert.match(liveSubmit, /if \(!launchToken \|\| isPreview\) return/);
  assert.match(liveSubmit, /Authorization.*Bearer/);
  assert.match(liveSubmit, /_functions\/financeOverlaySubmit/);
  assert.match(liveSubmit, /finance-application-received/);
});

test('successful legacy overlay submission retains the existing thank-you route', async () => {
  const app = await read('../public/finance-application-overlay/app.js');
  const loader = await read('../public/finance-application-overlay/site-loader.js');
  assert.match(app, /finance-form-submitted/);
  assert.match(app, /redirectUrl:THANK_YOU_URL/);
  assert.match(loader, /finance-form-submitted/);
  assert.match(loader, /window\.location\.assign\(target\)/);
  assert.match(loader, /finance-application-received/);
});

test('prototype does not recreate Wix CMS, email, Meta or CRM submission logic', async () => {
  const app = await read('../public/finance-application-overlay/app.js');
  const liveSubmit = await read('../public/finance-application-overlay/live-submit.js');
  assert.doesNotMatch(app, /wixData/);
  assert.doesNotMatch(app, /sendgrid/i);
  assert.doesNotMatch(app, /create-finance-lead/);
  assert.doesNotMatch(app, /sendMetaLead/);
  assert.doesNotMatch(liveSubmit, /wixData/);
  assert.doesNotMatch(liveSubmit, /sendgrid/i);
  assert.doesNotMatch(liveSubmit, /create-finance-lead/);
  assert.doesNotMatch(liveSubmit, /sendMetaLead/);
});

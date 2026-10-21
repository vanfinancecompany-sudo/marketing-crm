import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isAuthenticatedMarketingBrowserRequest,canSendRecoveryTest} from '../api/recovery-test-email.js';

const env={
 VERCEL:'1',VERCEL_ENV:'production',MARKETING_CUSTOMER_DATABASE_API_KEY:'fake-test-key'
};
const request=(host='marketing-crm-six.vercel.app')=>({
 headers:{host,origin:'https://'+host,'sec-fetch-site':'same-origin'}
});
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('marketing recovery test requires protected production hostname and same-origin POST',()=>{
 assert.equal(isAuthenticatedMarketingBrowserRequest(request(),env),true);
 assert.equal(isAuthenticatedMarketingBrowserRequest(request('marketing-crm-stuart-westons-projects.vercel.app'),env),true);
 assert.equal(isAuthenticatedMarketingBrowserRequest(request('marketing-crm-six.vercel.app'),{...env,VERCEL_ENV:'preview'}),false);
 assert.equal(isAuthenticatedMarketingBrowserRequest(request('marketing-crm-six.vercel.app'),{...env,VERCEL:'0'}),false);
 assert.equal(isAuthenticatedMarketingBrowserRequest(request('unprotected.example.com'),env),false);
 assert.equal(isAuthenticatedMarketingBrowserRequest({headers:{...request().headers,origin:'https://evil.example'}},env),false);
 assert.equal(isAuthenticatedMarketingBrowserRequest({headers:{...request().headers,'sec-fetch-site':'cross-site'}},env),false);
});
test('legacy server-to-server API-key route remains available without browser token',()=>{
 assert.equal(canSendRecoveryTest({headers:{authorization:'Bearer fake-test-key',host:'unprotected.example'}},env),true);
 assert.equal(canSendRecoveryTest({headers:{authorization:'Bearer wrong-key',host:'unprotected.example'}},env),false);
 assert.equal(canSendRecoveryTest(request(),env),true);
});
test('test endpoint cannot send customer mail or activate recovery relay',()=>{
 const endpoint=read('api/recovery-test-email.js');
 const panel=read('components/RecoveryCampaignTestPanel.jsx');
 const page=read('pages/MarketingCentrePage.jsx');
 assert.match(endpoint,/const TEST_TO='sales@vanfinancecompany\.co\.uk'/);
 assert.match(endpoint,/RECOVERY_TEST_EMAIL_ENABLED/);
 assert.match(endpoint,/text,html,fromEmail:/);
 assert.doesNotMatch(endpoint,/RECOVERY_RELAY_ENABLED|customer_recovery_delivery|request\.body\.to/);
 assert.match(panel,/Send Recovery Test Email/);
 assert.match(panel,/provider_message_id/);
 assert.match(panel,/delivery/);
 assert.match(page,/<RecoveryCampaignTestPanel\s*\/>/);
});

import crypto from 'node:crypto';

const TOKEN_URL='https://oauth2.googleapis.com/token';
const DATA_API_BASE='https://analyticsdata.googleapis.com/v1beta';
const SCOPE='https://www.googleapis.com/auth/analytics.readonly';

export const GA4_SITE_CONFIGS=[
 {key:'vanFinance',label:'Van Finance Company',propertyEnv:'GA4_VFC_PROPERTY_ID',defaultPropertyId:'553434975'},
 {key:'rent2buy',label:'Rent2Buy Vans',propertyEnv:'GA4_RENT2BUY_PROPERTY_ID',defaultPropertyId:'553487068'},
];

function clean(value,limit=10000){return String(value||'').trim().slice(0,limit);}
function normalizePrivateKey(value){
 let raw=String(value||'').trim();
 if(!raw)return '';
 const begin='-----BEGIN PRIVATE KEY-----';
 const end='-----END PRIVATE KEY-----';
 const beginIndex=raw.indexOf(begin);
 const endIndex=raw.indexOf(end);
 if(beginIndex!==-1&&endIndex!==-1&&endIndex>=beginIndex){
  raw=raw.slice(beginIndex,endIndex+end.length);
 }else if(raw.startsWith('"')&&raw.endsWith('"')){
  try{raw=JSON.parse(raw);}catch{raw=raw.slice(1,-1);}
 }
 return String(raw).replace(/\\r\\n/g,'\n').replace(/\\n/g,'\n').replace(/\\r/g,'').replace(/\r\n/g,'\n').trim();
}
function normalizePropertyId(value){return clean(value,200).replace(/^properties\//,'');}
function propertyIdFor(site){return normalizePropertyId(process.env[site.propertyEnv]||site.defaultPropertyId);}
function base64url(input){return Buffer.from(input).toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');}
function number(value){const parsed=Number(value);return Number.isFinite(parsed)?parsed:0;}

function buildJwt({clientEmail,privateKey}){
 const now=Math.floor(Date.now()/1000);
 const header={alg:'RS256',typ:'JWT'};
 const claim={iss:clientEmail,scope:SCOPE,aud:TOKEN_URL,exp:now+3600,iat:now};
 const unsigned=`${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
 const signature=crypto.createSign('RSA-SHA256').update(unsigned).sign(privateKey);
 return `${unsigned}.${base64url(signature)}`;
}

async function getAccessToken(){
 const clientEmail=clean(process.env.GA4_SERVICE_ACCOUNT_EMAIL,500);
 const privateKey=normalizePrivateKey(process.env.GA4_SERVICE_ACCOUNT_PRIVATE_KEY);
 if(!clientEmail||!privateKey){
  const error=new Error('GA4 service account environment variables are not configured.');
  error.missingServiceAccount=true;
  throw error;
 }
 const body=new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:buildJwt({clientEmail,privateKey})});
 const response=await fetch(TOKEN_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
 const payload=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(clean(payload?.error_description||payload?.error||'Google OAuth token request failed.',500));
 const token=clean(payload.access_token,4000);
 if(!token)throw new Error('Google OAuth token response did not include an access token.');
 return token;
}

export function ga4EnvironmentStatus(){
 const hasServiceAccount=Boolean(clean(process.env.GA4_SERVICE_ACCOUNT_EMAIL)&&clean(process.env.GA4_SERVICE_ACCOUNT_PRIVATE_KEY));
 return {
  hasServiceAccount,
  sites:GA4_SITE_CONFIGS.map((site)=>({
   ...site,
   propertyId:propertyIdFor(site),
   configured:Boolean(hasServiceAccount&&propertyIdFor(site)),
  })),
 };
}

async function runReport({accessToken,propertyId,body}){
 const response=await fetch(`${DATA_API_BASE}/properties/${propertyId}:runReport`,{
  method:'POST',
  headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},
  body:JSON.stringify(body),
 });
 const payload=await response.json().catch(()=>({}));
 if(!response.ok){
  const message=clean(payload?.error?.message||payload?.message||'GA4 Data API request failed.',500);
  const error=new Error(message);
  error.status=response.status;
  throw error;
 }
 return payload;
}

function rowsByDimension(report){
 const dimensionHeaders=(report.dimensionHeaders||[]).map((item)=>item.name);
 const metricHeaders=(report.metricHeaders||[]).map((item)=>item.name);
 return (report.rows||[]).map((row)=>({
  dimensions:Object.fromEntries(dimensionHeaders.map((name,index)=>[name,row.dimensionValues?.[index]?.value||''])),
  metrics:Object.fromEntries(metricHeaders.map((name,index)=>[name,number(row.metricValues?.[index]?.value)])),
 }));
}

function firstMetricRow(report){return rowsByDimension(report)[0]?.metrics||{};}
function pctChange(today,average){return average>0?Math.round(((today-average)/average)*100):null;}

async function loadSiteSummary({accessToken,site}){
 const propertyId=propertyIdFor(site);
 if(!propertyId){
  return {...site,configured:false,source:'ga4',message:`Missing ${site.propertyEnv}.`,propertyId:''};
 }
 const [todayReport,dailyReport,eventReport,pageReport,sourceReport]=await Promise.all([
  runReport({accessToken,propertyId,body:{dateRanges:[{startDate:'today',endDate:'today'}],metrics:[{name:'activeUsers'},{name:'sessions'},{name:'screenPageViews'}],keepEmptyRows:true}}),
  runReport({accessToken,propertyId,body:{dateRanges:[{startDate:'7daysAgo',endDate:'yesterday'}],dimensions:[{name:'date'}],metrics:[{name:'activeUsers'}],keepEmptyRows:true}}),
  runReport({accessToken,propertyId,body:{dateRanges:[{startDate:'today',endDate:'today'}],dimensions:[{name:'eventName'}],metrics:[{name:'eventCount'}],dimensionFilter:{filter:{fieldName:'eventName',inListFilter:{values:['application_start','application_complete','generate_lead','proofs_received']}}},keepEmptyRows:true}}),
  runReport({accessToken,propertyId,body:{dateRanges:[{startDate:'today',endDate:'today'}],dimensions:[{name:'pagePath'}],metrics:[{name:'screenPageViews'}],orderBys:[{metric:{metricName:'screenPageViews'},desc:true}],limit:8}}),
  runReport({accessToken,propertyId,body:{dateRanges:[{startDate:'today',endDate:'today'}],dimensions:[{name:'sessionSourceMedium'}],metrics:[{name:'sessions'}],orderBys:[{metric:{metricName:'sessions'},desc:true}],limit:8}}),
 ]);
 const today=firstMetricRow(todayReport);
 const dailyRows=rowsByDimension(dailyReport);
 const observedDaily=dailyRows.map((row)=>number(row.metrics.activeUsers));
 const sevenDayAverageUsers=observedDaily.length?Math.round((observedDaily.reduce((sum,value)=>sum+value,0)/observedDaily.length)*10)/10:0;
 const eventRows=rowsByDimension(eventReport);
 const events=Object.fromEntries(eventRows.map((row)=>[row.dimensions.eventName,number(row.metrics.eventCount)]));
 const applicationStartsToday=number(events.application_start);
 const applicationCompletionsToday=number(events.application_complete);
 const leadEventsToday=number(events.generate_lead);
 return {
  ...site,
  configured:true,
  source:'ga4',
  propertyId,
  usersToday:number(today.activeUsers),
  sessionsToday:number(today.sessions),
  pageViewsToday:number(today.screenPageViews),
  applicationStartsToday,
  applicationCompletionsToday,
  leadEventsToday,
  proofsReceivedToday:number(events.proofs_received),
  conversionRate:applicationStartsToday?applicationCompletionsToday/applicationStartsToday:null,
  sevenDayAverageUsers,
  usersVsSevenDayPct:pctChange(number(today.activeUsers),sevenDayAverageUsers),
  topPages:rowsByDimension(pageReport).map((row)=>({path:row.dimensions.pagePath||'/',views:number(row.metrics.screenPageViews)})),
  sources:rowsByDimension(sourceReport).map((row)=>({source:row.dimensions.sessionSourceMedium||'Direct / unknown',sessions:number(row.metrics.sessions)})),
 };
}

export async function loadGa4PipelineSummary(){
 const status=ga4EnvironmentStatus();
 if(!status.hasServiceAccount){
  return {ok:true,configured:false,source:'ga4',message:'GA4 service account is not configured in Vercel.',sites:status.sites.map((site)=>({...site,source:'ga4',message:'Waiting for GA4 service account credentials.'})),checkedAt:new Date().toISOString()};
 }
 const accessToken=await getAccessToken();
 const sites=await Promise.all(status.sites.map(async(site)=>{
  try{return await loadSiteSummary({accessToken,site});}
  catch(error){return {...site,configured:false,source:'ga4',message:clean(error?.message||'GA4 report failed.',500),propertyId:site.propertyId||''};}
 }));
 return {ok:true,configured:sites.some((site)=>site.configured),source:'ga4',sites,checkedAt:new Date().toISOString()};
}

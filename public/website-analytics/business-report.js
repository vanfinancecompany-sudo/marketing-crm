const status = document.getElementById('businessReportStatus');
const rows = document.getElementById('businessReportRows');
const warnings = document.getElementById('businessReportWarnings');
const names = {vanFinance:'Van Finance Company',rent2buy:'Rent2Buy Vans'};
const periods = [['today','Today (partial)'],['sevenDays','Last 7 completed days'],['previousSevenDays','Previous 7 days'],['twentyEightDays','Last 28 completed days'],['previousTwentyEightDays','Previous 28 days']];
let report = null, generation = 0;
const fmt = new Intl.NumberFormat('en-GB');
const count = value => Number.isSafeInteger(value) && value >= 0 ? fmt.format(value) : 'Unavailable';
const pct = value => Number.isFinite(value) ? ' ('+(value>=0?'+':'')+(value*100).toFixed(1)+'%)' : '';
function textNode(tag,value){const el=document.createElement(tag);el.textContent=value;return el;}
function render(){
 if(!report||!rows||!warnings)return;
 rows.replaceChildren();warnings.replaceChildren();
 const selected=document.querySelector('.site-tab.is-active')?.dataset?.site||'all';
 for(const [site,label] of Object.entries(names)){
  if(selected!=='all'&&selected!==site)continue;
  const data=report.sites?.[site];if(!data)continue;
  for(const [key,title] of periods){
   const row=document.createElement('tr'),p=data.periods?.[key]||{},range=report.periods?.[key]||{},c=data.comparisons?.[key];
   const periodTitle=range.partial?title+' · '+range.startDate:title+' · '+range.startDate+' to '+new Date(Date.parse(range.endExclusive+'T12:00:00Z')-86400000).toISOString().slice(0,10);
   for(const value of [label,periodTitle,count(p.sessions)+pct(c?.sessionChange),count(p.sourceLabelledSessions),count(p.crmApplications)+pct(c?.applicationChange)])row.append(textNode('td',value));
   rows.append(row);
  }
  const messages=[...new Set(Object.values(data.comparisons||{}).map(x=>x.warning).filter(Boolean))];
  for(const message of messages){const p=textNode('p',label+': '+message+' Traffic percentage comparison withheld; CRM application comparisons remain separate.');p.className='quiet-note';warnings.append(p);}
 }
 status.textContent='As of '+new Date(report.checkedAt).toLocaleString('en-GB',{timeZone:'Europe/London'})+' UK time · percentages compare equal completed periods.';
}
async function load(){
 if(!status||!rows||!warnings)return;
 const token=++generation;
 status.textContent='Loading business performance…';rows.replaceChildren();warnings.replaceChildren();report=null;
 try{
  const response=await fetch('/api/ga4-pipeline-summary?businessReport=1',{cache:'no-store',headers:{Accept:'application/json'}});
  const payload=await response.json();if(!response.ok||payload.ok!==true||!payload.businessReport)throw Error('unavailable');
  if(token!==generation)return;report=payload.businessReport;render();
 }catch{if(token===generation)status.textContent='Business reporting unavailable. Refresh to retry; no zero totals have been substituted.';}
}
document.getElementById('refreshButton')?.addEventListener('click',load);
document.getElementById('siteTabs')?.addEventListener('click',()=>window.setTimeout(render,0));
load();

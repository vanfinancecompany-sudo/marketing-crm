export const WORKERS = [
  {
    "key": "/api/application-received-event-retry",
    "label": "Application event retry",
    "schedule": "* * * * *"
  },
  {
    "key": "/api/stock-watch-monitor-agent",
    "label": "DealerKit stock watch monitor",
    "schedule": "*/15 * * * *"
  },
  {
    "key": "/api/marketing-template-campaign-send-orphan-worker",
    "label": "Campaign orphan recovery",
    "schedule": "* * * * *"
  },
  {
    "key": "/api/marketing-template-campaign-send-worker",
    "label": "Campaign send worker",
    "schedule": "* * * * *"
  },
  {
    "key": "/api/ai-assistant-learning-worker",
    "label": "Ask Me learning worker",
    "schedule": "* * * * *"
  },
  {
    "key": "/api/sync-finance-stock",
    "label": "Finance stock sync",
    "schedule": "1 * * * *"
  },
  {
    "key": "/api/sync-rent2buy-stock",
    "label": "Rent2Buy stock sync",
    "schedule": "3 * * * *"
  },
  {
    "key": "/api/sync-cars-stock",
    "label": "Cars stock sync",
    "schedule": "7 * * * *"
  },
  {
    "key": "/api/buffer-facebook-automation-cron",
    "label": "Facebook / Google Business publishing",
    "schedule": "5 6-22 * * *"
  },
  {
    "key": "/api/buffer-instagram-mirror",
    "label": "Instagram mirror",
    "schedule": "40 6-22 * * *"
  },
  {
    "key": "/api/marketing-editorial-automation-worker-routed",
    "label": "Editorial automation",
    "schedule": "17 * * * *"
  },
  {
    "key": "/api/buffer-facebook-story-automation",
    "label": "Facebook Stories",
    "schedule": "25 6-22 * * *"
  },
  {
    "key": "/api/rent2buy-monthly-price-sync",
    "label": "Rent2Buy price sync",
    "schedule": "23 * * * *"
  },
  {
    "key": "/api/buffer-publish-status",
    "label": "Buffer publication reconciliation",
    "schedule": "5,25,45 6-22 * * *"
  },
  {
    "key": "/api/carslink-auto-sync",
    "label": "CarsLink sync",
    "schedule": "47 * * * *"
  },
  {
    "key": "/api/vansco-facebook-automation-worker",
    "label": "Vansco Facebook publishing",
    "schedule": "11 6-22 * * *"
  },
  {
    "key": "/api/vansco-facebook-story-automation-worker",
    "label": "Vansco Facebook Stories",
    "schedule": "31 6-22 * * *"
  },
  {
    "key": "/api/vansco-instagram-automation-worker",
    "label": "Vansco Instagram publishing",
    "schedule": "15 6-22 * * *"
  },
  {
    "key": "/api/vansco-google-business-automation-worker",
    "label": "Vansco Google Business publishing",
    "schedule": "51 6-22 * * *"
  },
  {
    "key": "/api/vansco-buffer-image-cleanup",
    "label": "Vansco image cleanup",
    "schedule": "43 4 * * *"
  },
  {
    "key": "/api/vansco-email-worker",
    "label": "Vansco email worker",
    "schedule": "* * * * *"
  },
  {
    "key": "/api/conversations-monitor",
    "label": "Conversations & AI monitor",
    "schedule": "*/10 * * * *"
  },
  {
    "key": "/api/rent2buy-group-renewals",
    "label": "Rent2Buy daily renewal queue",
    "schedule": "0 7 * * *"
  }
];

export const LEVELS=["critical","warning","unverified","healthy","running","idle","disabled","manual"];
const REPLACED_SERVICE_ROWS = new Set(["vansco_stock_refresh", "rent2buy_price_sync", "email_orphan_worker", "facebook_story"]);
export const isCurrentServiceRow = item => !REPLACED_SERVICE_ROWS.has(item.key);

export function approvalMonitorHealth(value, now = new Date()) {
 const item = {key:"group-approval-monitor",label:"Facebook approval monitor",category:"Browser extensions",
  source:"Groups Helper alarm and Facebook outcome receipts",href:"/rent2buy-groups",lastAt:value?.lastCheckAt||value?.lastAlarmAt||null};
 if (!value) return {...item,state:"warning",detail:"The signed-in Edge profile has no approval-monitor evidence. Reload Groups Helper 1.2.32 or later and open Rent2Buy Groups."};
 if (!value.scheduled) return {...item,state:"warning",detail:"The extension alarm is missing. Reload the Groups Helper in the signed-in Edge profile."};
 if (value.unresolvedCount > 0) return {...item,state:"warning",detail:`${value.unresolvedCount} adverts remain unconfirmed after repeated checks. Review those adverts in Facebook before retrying.`};
 if (["timeout","navigation_failed","unknown"].includes(value.outcome)) return {...item,state:"warning",detail:"The last Facebook check could not confirm the advert. Check the signed-in Facebook profile and review that submission."};
 const age = now.getTime() - Date.parse(value.lastAlarmAt || "");
 if (!Number.isFinite(age)) return {...item,state:"unverified",detail:"The approval alarm is registered. Waiting for its first recorded execution."};
 if (age > 75 * 60000) return {...item,state:"warning",detail:"The hourly approval alarm has not executed for over 75 minutes. Keep Edge running in the signed-in profile."};
 if (!value.pendingCount) return {...item,state:"idle",detail:"The approval alarm ran. There are no adverts waiting for a check."};
 if (!value.lastCheckAt) return {...item,state:"unverified",detail:`${value.pendingCount} adverts are queued. Waiting for the first Facebook result.`};
 if (now.getTime() - Date.parse(value.lastCheckAt) > 75 * 60000) return {...item,state:"warning",detail:`${value.pendingCount} adverts are waiting and the last Facebook result is over 75 minutes old.`};
 return {...item,state:"healthy",detail:`Latest Facebook result: ${value.outcome || "recorded"}. ${value.pendingCount} adverts remain in the approval queue.`};
}
export function healthCounts(items){
 const c=Object.fromEntries(LEVELS.map(k=>[k,0]));
 for(const i of items)c[LEVELS.includes(i.state)?i.state:"unverified"]++;
 return {...c,total:items.length,level:c.critical?"critical":c.warning?"warning":c.unverified?"unverified":"healthy"};
}
function matches(value,field,max){
 return field.split(",").some(part=>{
  const [span,step]=part.split("/");const [min,end]=span==="*"?[0,max]:span.includes("-")?span.split("-").map(Number):[Number(span),step?max:Number(span)];
  return value>=min&&value<=end&&(value-min)%Number(step||1)===0;
 });
}
export function previousDue(schedule,now){
 const [minute,hour,day,month,weekday]=schedule.split(" ");
 if([day,month,weekday].some(x=>x!=="*"))return null;
 const start=Math.floor(now.getTime()/60000)*60000;
 for(let i=0;i<1441;i++){const t=new Date(start-i*60000);if(matches(t.getUTCMinutes(),minute,59)&&matches(t.getUTCHours(),hour,23))return t;}
 return null;
}
export function workerHealth(worker,row,now=new Date()){
 const item={key:worker.key,label:worker.label,category:"Scheduled workers",schedule:worker.schedule+" UTC",source:"Scheduled execution receipt",lastAt:row?.completed_at||null};
 if(!row)return {...item,state:"unverified",detail:"No scheduled execution receipt recorded. Check the worker's Vercel cron and telemetry table."};
 const due=previousDue(worker.schedule,new Date(now.getTime()-10*60000));
 const started=Date.parse(row.started_at||"");
 if(!Number.isFinite(started))return {...item,state:"unverified",detail:"Missing execution timestamp."};
 if(row.outcome!=="disabled"&&due&&started<due.getTime())return {...item,state:"critical",detail:"No receipt for the expected scheduled run. Check the worker's Vercel cron logs.",expectedAt:due.toISOString()};
 const state=({failed:"critical",warning:"warning",disabled:"disabled",idle:"idle",success:"healthy"})[row.outcome]||"unverified";
 return {...item,state,detail:row.detail||"Latest scheduled execution recorded.",lastSuccessAt:row.last_success_at||null};
}
export function normaliseExisting(item){
 const status=String(item.status||"").toLowerCase();
 const state=["failed","error"].includes(status)?"critical":status==="running"?"running":["disabled","paused"].includes(status)?"disabled":status==="waiting"?"idle":status==="healthy"&&item.telemetry!=="schedule_only"&&item.telemetry!=="shared"?"healthy":"unverified";
 return {key:item.key,label:item.label,category:"Existing service checks",state,lastAt:item.last_attempt_at||item.last_success_at||null,source:item.telemetry==="schedule_only"?"Schedule only":item.telemetry==="shared"?"Shared evidence":"Existing monitor",detail:[item.last_error,item.detail].filter(Boolean).join(" · ")};
}

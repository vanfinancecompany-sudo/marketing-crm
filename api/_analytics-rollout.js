const SAFE_WIX_ONLY_CUTOVER='9999-12-31';

export function resolveAnalyticsCutoverDate(value=process.env.VFC_ANALYTICS_CUTOVER_DATE){
  const candidate=String(value||'').trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(candidate))return null;
  const parsed=new Date(`${candidate}T00:00:00Z`);
  if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==candidate)return null;
  return candidate;
}

export function effectiveAnalyticsCutoverDate(value=process.env.VFC_ANALYTICS_CUTOVER_DATE){
  return resolveAnalyticsCutoverDate(value)||SAFE_WIX_ONLY_CUTOVER;
}

export {SAFE_WIX_ONLY_CUTOVER};

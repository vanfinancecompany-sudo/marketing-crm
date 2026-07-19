import { useEffect, useState } from "react";
import { londonDateKey } from "../lib/marketingDailyOperations.js";
import { getDailyOperationsOverview } from "../services/marketingDailyOperations.js";
import { getStoredMarketingAccessKey } from "../services/marketingAccess.js";

export default function DailyTargetBanner({ currentView, onNavigate }) {
  const [day, setDay] = useState(null);
  useEffect(() => {
    if (!getStoredMarketingAccessKey()) return undefined;
    let active = true;
    const load = () => getDailyOperationsOverview(londonDateKey()).then((result) => { if (active) setDay(result.day); }).catch(() => {});
    load();
    const timer = window.setInterval(load, 60000);
    return () => { active = false; window.clearInterval(timer); };
  }, [currentView]);
  if (!day || day.complete || day.off_day || currentView === "Dashboard") return null;
  return <button className="daily-target-banner" type="button" onClick={() => onNavigate("Dashboard")}><strong>TODAY&apos;S MARKETING TARGET IS INCOMPLETE</strong><span>{day.remaining_total} actions remaining · {day.completion_percentage}% complete</span><b>OPEN CONTENT OPERATIONS</b></button>;
}

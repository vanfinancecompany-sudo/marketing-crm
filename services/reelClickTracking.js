import { supabase } from "./supabase.js";

const CLICK_TABLE = "reel_click_events";

function normalizeType(type) {
  return type === "rent2buy" ? "rent2buy" : "finance";
}

export async function logReelClick({ source, type, reelId }) {
  const { error } = await supabase.from(CLICK_TABLE).insert({
    source: source || "reel",
    type: normalizeType(type),
    reel_id: reelId || "unknown",
  });

  if (error) {
    throw error;
  }
}

export async function fetchReelClickDashboard() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from(CLICK_TABLE)
    .select("type,reel_id,source,created_at")
    .gte("created_at", today.toISOString());

  if (error) {
    throw error;
  }

  const clicks = data || [];
  const topReelMap = new Map();

  for (const click of clicks) {
    const reelId = click.reel_id || "unknown";
    const type = normalizeType(click.type);
    const key = `${type}:${reelId}`;
    const current = topReelMap.get(key) || {
      reelId,
      type,
      clickCount: 0,
    };
    current.clickCount += 1;
    topReelMap.set(key, current);
  }

  return {
    financeClicksToday: clicks.filter((click) => normalizeType(click.type) === "finance").length,
    rent2BuyClicksToday: clicks.filter((click) => normalizeType(click.type) === "rent2buy").length,
    topReels: [...topReelMap.values()].sort((a, b) => b.clickCount - a.clickCount).slice(0, 5),
  };
}

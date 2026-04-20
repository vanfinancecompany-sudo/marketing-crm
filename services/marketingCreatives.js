import { supabase } from "./supabase.js";
import {
  normalizeCreativeRecord,
  toMarketingCreativePayload,
} from "../utils/creativeUtils.js";

export async function fetchMarketingCreatives(limit = 50) {
  const { data, error } = await supabase
    .from("marketing_creatives")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to load marketing creatives: ${error.message}`);
  }

  return (data || []).map(normalizeCreativeRecord);
}

export async function fetchTodayReelCreatives(limit = 20) {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from("marketing_creatives")
    .select("*")
    .in("status", ["reel_asset", "ready_to_post"])
    .gte("created_at", startOfToday.toISOString())
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to load today reels: ${error.message}`);
  }

  return (data || []).map(normalizeCreativeRecord);
}

export async function saveMarketingCreatives(creatives) {
  const payload = creatives.map(toMarketingCreativePayload);
  const { data, error } = await supabase
    .from("marketing_creatives")
    .insert(payload)
    .select("*");

  if (error) {
    throw new Error(`Creative save failed: ${error.message}`);
  }

  return (data || []).map(normalizeCreativeRecord);
}

export async function updateMarketingCreative(id, updates) {
  const payload = {};
  if (updates.status) payload.status = updates.status;
  if (updates.destinationPage) payload.destination_page = updates.destinationPage;

  const { data, error } = await supabase
    .from("marketing_creatives")
    .update(payload)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Creative update failed: ${error.message}`);
  }

  return normalizeCreativeRecord(data);
}

export async function deleteMarketingCreative(id) {
  const { error } = await supabase
    .from("marketing_creatives")
    .delete()
    .eq("id", id);

  if (error) {
    throw new Error(`Creative delete failed: ${error.message}`);
  }
}

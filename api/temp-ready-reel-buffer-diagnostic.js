import { createClient } from "@supabase/supabase-js";
import { loadBufferAutomationConfig } from "../lib/bufferAutomationConfig.js";
import {
  bufferAutomationSlots,
  extractBufferRegistration,
  isBufferPostReserved,
  londonDateKeyForValue,
} from "../lib/bufferAutomation.js";
import {
  BUFFER_API_URL,
  BUFFER_AUTOMATION_POSTS_QUERY,
  BUFFER_CREATE_POST_MUTATION,
  BUFFER_FACEBOOK_CHANNELS,
  bufferDestinationForProduct,
  buildBufferCreatePostInput,
  parseBufferAutomationPostsPayload,
  readableBufferError,
} from "../lib/bufferPublishing.js";
import { buildAutomatedReelCaption } from "../lib/facebookAutomationContent.js";

const RUN_KEY = "ready21-7b8c19";
const MIN_LEAD_MS = 10 * 60 * 1000;
const DELETE_POST_MUTATION = `
  mutation DeletePost($input: DeletePostInput!) {
    deletePost(input: $input) { __typename }
  }
`;

function safe(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeReg(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing server Supabase environment variables.");
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

async function readJson(response) {
  const raw = await response.text();
  try {
    return { payload: JSON.parse(raw), raw };
  } catch {
    return { payload: {}, raw };
  }
}

async function bufferGraphql(query, variables) {
  const token = String(process.env.BUFFER_API_KEY || "").trim();
  if (!token) throw new Error("BUFFER_API_KEY is not configured on the server.");
  const response = await fetch(BUFFER_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(variables ? { query, variables } : { query }),
  });
  const read = await readJson(response);
  return { response, ...read };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "GET") {
    return response.status(405).json({ ok: false, error: "Method not allowed." });
  }
  if (String(request.query?.run || "") !== RUN_KEY) {
    return response.status(404).json({ ok: false });
  }

  const productKey = request.query?.product === "rent2buy" ? "rent2buy" : "vanFinance";
  let createdPostId = "";

  try {
    const supabase = getSupabase();
    const dateKey = londonDateKeyForValue();
    const activityType = productKey === "rent2buy" ? "rent2buy_reel" : "van_finance_reel";

    const [rowsResult, automationConfig, postsRead] = await Promise.all([
      supabase
        .from("marketing_daily_activity_events")
        .select("id,activity_date,activity_type,source,source_id,metadata,occurred_at")
        .eq("activity_date", dateKey)
        .eq("activity_type", activityType)
        .eq("source", "youtube_daily_batch")
        .order("occurred_at", { ascending: true })
        .limit(100),
      loadBufferAutomationConfig(),
      bufferGraphql(BUFFER_AUTOMATION_POSTS_QUERY),
    ]);

    if (rowsResult.error) throw rowsResult.error;
    if (!postsRead.response.ok) {
      return response.status(200).json({
        ok: false,
        stage: "buffer-posts",
        status: postsRead.response.status,
        error: readableBufferError(postsRead.payload?.errors?.[0]?.message || postsRead.payload || postsRead.raw),
      });
    }

    const posts = parseBufferAutomationPostsPayload(postsRead.payload);
    const channelId = BUFFER_FACEBOOK_CHANNELS[bufferDestinationForProduct(productKey)];
    const channelPosts = posts.filter((post) => post?.channelId === channelId);
    const reserved = new Set(
      channelPosts
        .filter((post) => isBufferPostReserved(post) || String(post?.status || "").toLowerCase() === "sent")
        .map((post) => extractBufferRegistration(post?.text))
        .filter(Boolean),
    );

    const readyRows = (rowsResult.data || []).filter(
      (row) => row?.metadata?.download_url && !row?.metadata?.deleted_at,
    );
    const ready = readyRows.find((row) => {
      const registration = normalizeReg(row?.metadata?.registration);
      return registration && !reserved.has(registration);
    });
    if (!ready) {
      return response.status(200).json({
        ok: false,
        stage: "ready-selection",
        readyCount: readyRows.length,
        error: "No unreserved prepared Reel is available for the diagnostic.",
      });
    }

    const occupied = new Set(
      channelPosts
        .map((post) => {
          const date = new Date(post?.dueAt || 0);
          return Number.isNaN(date.getTime()) ? "" : date.toISOString();
        })
        .filter(Boolean),
    );
    const now = Date.now();
    const slot = bufferAutomationSlots(automationConfig, productKey, dateKey)
      .filter((item) => item.mediaKind === "video")
      .find(
        (item) =>
          new Date(item.dueAt).getTime() > now + MIN_LEAD_MS &&
          !occupied.has(item.dueAt),
      );
    if (!slot) {
      return response.status(200).json({ ok: false, stage: "slot", error: "No safe future Reel slot is available." });
    }

    const registration = normalizeReg(ready?.metadata?.registration);
    const title = String(ready?.metadata?.title || "Vehicle reel").trim();
    const mediaUrl = String(ready?.metadata?.download_url || "").trim();

    let mediaProbe = { ok: false, status: 0, contentType: "", contentLength: "" };
    try {
      const probe = await fetch(mediaUrl, { method: "HEAD" });
      mediaProbe = {
        ok: probe.ok,
        status: probe.status,
        contentType: probe.headers.get("content-type") || "",
        contentLength: probe.headers.get("content-length") || "",
      };
    } catch (error) {
      mediaProbe = { ...mediaProbe, error: error?.message || String(error) };
    }

    const input = buildBufferCreatePostInput({
      destination: bufferDestinationForProduct(productKey),
      text: buildAutomatedReelCaption({ productKey, registration, title }),
      mediaUrl,
      mediaKind: "video",
      draft: false,
      dueAt: slot.dueAt,
    });

    const createRead = await bufferGraphql(BUFFER_CREATE_POST_MUTATION, { input });
    createdPostId = String(createRead?.payload?.data?.createPost?.post?.id || "");
    const createMessage =
      createRead?.payload?.errors?.[0]?.message ||
      createRead?.payload?.data?.createPost?.message ||
      "";

    let deleteResult = null;
    if (createdPostId) {
      const deleteRead = await bufferGraphql(DELETE_POST_MUTATION, { input: { id: createdPostId } });
      deleteResult = {
        status: deleteRead.response.status,
        payload: deleteRead.payload,
      };
    }

    return response.status(200).json({
      ok: Boolean(createdPostId),
      stage: "ready-reel-buffer-create",
      productKey,
      registration,
      readyRowId: ready.id,
      dueAt: slot.dueAt,
      localTime: slot.localTime,
      mediaProbe,
      bufferHttpStatus: createRead.response.status,
      bufferMessage: createMessage ? readableBufferError(createMessage) : "",
      bufferPayload: createRead.payload,
      createdPostId: createdPostId || null,
      deletedDiagnosticPost: Boolean(createdPostId && deleteResult),
      deleteResult,
    });
  } catch (error) {
    if (createdPostId) {
      await bufferGraphql(DELETE_POST_MUTATION, { input: { id: createdPostId } }).catch(() => {});
    }
    return response.status(200).json({
      ok: false,
      stage: "exception",
      error: safe(error?.message || error),
    });
  }
}

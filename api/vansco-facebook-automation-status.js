import {
  VANSCO_FACEBOOK_STORIES_PER_DAY,
  extractVanscoVehicleUrl,
} from "../lib/vanscoFacebookAutomation.js";
import {
  isVanscoFacebookStory,
  loadVanscoAutomationStatus,
  loadVanscoBufferConfig,
  loadVanscoBufferState,
  loadVanscoFacebookActivity,
  loadVanscoFacebookStoryStatus,
  loadVanscoGoogleBusinessAutomationStatus,
  loadVanscoGoogleBusinessConfig,
} from "./_vansco-buffer-runtime.js";

const ACCESS_HEADER = "x-marketing-customer-database-key";

function clean(value) {
  return String(value ?? "").trim();
}

function authorize(request) {
  const expected = clean(process.env.MARKETING_CUSTOMER_DATABASE_API_KEY);
  const supplied = clean(request.headers[ACCESS_HEADER]);
  const authorization = clean(request.headers.authorization);
  return Boolean(
    expected &&
    (supplied === expected || authorization === `Bearer ${expected}`),
  );
}

function londonDateKey(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function activityDateKey(post) {
  const value = post?.sentAt || post?.dueAt || post?.createdAt;
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : londonDateKey(date);
}

function postTitle(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.find((line) => /^\d{4}\s+/.test(line))
    || lines.find((line) => !/^🚐|^✅|^💷|^📍|^📞|^🌐|^#/.test(line))
    || "Vansco vehicle";
}

function postBranch(text) {
  const value = String(text || "").toLowerCase();
  if (value.includes("vansco 333 showroom")) return "Vansco 333";
  if (value.includes("vansco new forest")) return "New Forest / Cadnam";
  if (value.includes("vansco southampton airport")) return "Southampton Airport";
  return "Branch not shown";
}

function queuedPostSummary(post) {
  const assets = Array.isArray(post?.assets) ? post.assets : [];
  const image = assets.find((asset) => String(asset?.mimeType || "").startsWith("image/"));
  return {
    id: String(post?.id || ""),
    title: postTitle(post?.text),
    branch: postBranch(post?.text),
    dueAt: post?.dueAt || null,
    status: String(post?.status || ""),
    vehicleUrl: extractVanscoVehicleUrl(post?.text) || "",
    imageUrl: String(image?.source || ""),
  };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ ok: false, error: "Method not allowed." });
  }
  if (!authorize(request)) {
    return response.status(401).json({ ok: false, error: "Marketing access key not recognised." });
  }

  try {
    const enabled = String(process.env.VANSCO_FACEBOOK_AUTOMATION_ENABLED || "").toLowerCase() === "true";
    const status = await loadVanscoAutomationStatus();
    const config = await loadVanscoBufferConfig();
    const dateKey = londonDateKey();
    const [bufferState, facebookActivity, storyStatus] = await Promise.all([
      loadVanscoBufferState(config, `${dateKey}T12:00:00.000Z`),
      loadVanscoFacebookActivity(config),
      loadVanscoFacebookStoryStatus().catch(() => null),
    ]);
    const sentToday = (facebookActivity.posts || []).filter((post) =>
      String(post?.status || "").toLowerCase() === "sent"
      && !isVanscoFacebookStory(post)
      && activityDateKey(post) === dateKey
    ).length;
    const storiesSentToday = (facebookActivity.posts || []).filter((post) =>
      String(post?.status || "").toLowerCase() === "sent"
      && isVanscoFacebookStory(post)
      && activityDateKey(post) === dateKey
    ).length;
    const storiesScheduledToday = (facebookActivity.posts || []).filter((post) =>
      ["scheduled", "sending"].includes(String(post?.status || "").toLowerCase())
      && isVanscoFacebookStory(post)
      && activityDateKey(post) === dateKey
    ).length;

    let googleBusiness = {
      connected: false,
      branches: {},
      error: "",
    };
    try {
      const googleConfig = await loadVanscoGoogleBusinessConfig();
      const entries = await Promise.all(
        Object.entries(googleConfig.branches || {}).map(async ([branchKey, branchConfig]) => {
          const branchState = await loadVanscoBufferState(
            branchConfig,
            `${dateKey}T12:00:00.000Z`,
          );
          return [branchKey, {
            channelId: branchConfig.channelId,
            channelName: branchConfig.channelName,
            externalLink: branchConfig.externalLink,
            dailyLimit: branchState.limit?.limit ?? null,
            sentToday: branchState.limit?.sent ?? 0,
            scheduledToday: branchState.limit?.scheduled ?? 0,
            queueCount: branchState.posts.length,
          }];
        }),
      );
      googleBusiness = {
        connected: true,
        branches: Object.fromEntries(entries),
        lastRun: await loadVanscoGoogleBusinessAutomationStatus(),
        error: "",
      };
    } catch (googleError) {
      googleBusiness = {
        connected: false,
        branches: {},
        lastRun: await loadVanscoGoogleBusinessAutomationStatus().catch(() => null),
        error: String(googleError?.message || googleError).slice(0, 300),
      };
    }

    return response.status(200).json({
      ok: true,
      enabled,
      state: status?.state || (enabled ? "waiting" : "disabled"),
      lastRun: status,
      buffer: {
        channelName: config.channelName,
        externalLink: config.externalLink,
        queueLimit: config.scheduledPostsLimit,
        dailyLimit: bufferState.limit?.limit ?? null,
        sentToday,
        providerSentToday: bufferState.limit?.sent ?? 0,
        scheduledToday: bufferState.posts.filter((post) => !isVanscoFacebookStory(post)).length,
        queueCount: bufferState.posts.filter((post) => !isVanscoFacebookStory(post)).length,
      },
      stories: {
        target: VANSCO_FACEBOOK_STORIES_PER_DAY,
        sentToday: storiesSentToday,
        scheduledToday: storiesScheduledToday,
        queueCount: bufferState.posts.filter(isVanscoFacebookStory).length,
        lastRun: storyStatus,
      },
      googleBusiness,
      queue: bufferState.posts
        .slice()
        .sort((a, b) => new Date(a?.dueAt || 0).getTime() - new Date(b?.dueAt || 0).getTime())
        .slice(0, 10)
        .map(queuedPostSummary),
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      error: String(error?.message || "Could not load Vansco Facebook status.").slice(0, 300),
    });
  }
}

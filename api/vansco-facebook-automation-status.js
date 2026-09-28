import {
  VANSCO_FACEBOOK_STORIES_PER_DAY,
  extractVanscoVehicleUrl,
} from "../lib/vanscoFacebookAutomation.js";
import {
  isVanscoFacebookStory,
  loadVanscoAutomationStatus,
  loadVanscoCombinedStatusSnapshot,
  loadVanscoFacebookStoryStatus,
  loadVanscoGoogleBusinessAutomationStatus,
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
    const [status, liveSnapshot, storyStatus, googleLastRun] = await Promise.all([
      loadVanscoAutomationStatus(),
      loadVanscoCombinedStatusSnapshot(),
      loadVanscoFacebookStoryStatus().catch(() => null),
      loadVanscoGoogleBusinessAutomationStatus().catch(() => null),
    ]);
    const dateKey = londonDateKey();
    const config = liveSnapshot?.facebook?.config || {};
    const facebookLimit = liveSnapshot?.facebook?.limit || null;
    const facebookPosts = Array.isArray(liveSnapshot?.facebook?.posts)
      ? liveSnapshot.facebook.posts
      : [];
    const queuedFacebookPosts = facebookPosts.filter((post) =>
      ["scheduled", "sending"].includes(String(post?.status || "").toLowerCase())
    );
    const sentToday = facebookPosts.filter((post) =>
      String(post?.status || "").toLowerCase() === "sent"
      && !isVanscoFacebookStory(post)
      && activityDateKey(post) === dateKey
    ).length;
    const storiesSentToday = facebookPosts.filter((post) =>
      String(post?.status || "").toLowerCase() === "sent"
      && isVanscoFacebookStory(post)
      && activityDateKey(post) === dateKey
    ).length;
    const storiesScheduledToday = queuedFacebookPosts.filter((post) =>
      isVanscoFacebookStory(post)
      && activityDateKey(post) === dateKey
    ).length;

    const googleEntries = Object.entries(liveSnapshot?.googleBusiness?.branches || {});
    const googleBusiness = {
      connected: googleEntries.length === 3,
      branches: Object.fromEntries(
        googleEntries.map(([branchKey, branch]) => {
          const branchConfig = branch?.config || {};
          const branchPosts = Array.isArray(branch?.posts) ? branch.posts : [];
          const queued = branchPosts.filter((post) =>
            ["scheduled", "sending"].includes(String(post?.status || "").toLowerCase())
          );
          return [branchKey, {
            channelId: branchConfig.channelId,
            channelName: branchConfig.channelName,
            externalLink: branchConfig.externalLink,
            dailyLimit: branch?.limit?.limit ?? null,
            sentToday: branch?.limit?.sent ?? 0,
            scheduledToday: branch?.limit?.scheduled ?? 0,
            queueCount: queued.length,
          }];
        }),
      ),
      lastRun: googleLastRun,
      error: liveSnapshot?.refreshError || "",
    };

    return response.status(200).json({
      ok: true,
      enabled,
      state: status?.state || (enabled ? "waiting" : "disabled"),
      lastRun: status,
      buffer: {
        channelName: config.channelName,
        externalLink: config.externalLink,
        queueLimit: config.scheduledPostsLimit,
        dailyLimit: facebookLimit?.limit ?? null,
        sentToday,
        providerSentToday: facebookLimit?.sent ?? 0,
        scheduledToday: queuedFacebookPosts.filter((post) => !isVanscoFacebookStory(post)).length,
        queueCount: queuedFacebookPosts.filter((post) => !isVanscoFacebookStory(post)).length,
      },
      stories: {
        target: VANSCO_FACEBOOK_STORIES_PER_DAY,
        sentToday: storiesSentToday,
        scheduledToday: storiesScheduledToday,
        queueCount: queuedFacebookPosts.filter(isVanscoFacebookStory).length,
        lastRun: storyStatus,
      },
      googleBusiness,
      queue: queuedFacebookPosts
        .slice()
        .sort((a, b) => new Date(a?.dueAt || 0).getTime() - new Date(b?.dueAt || 0).getTime())
        .slice(0, 10)
        .map(queuedPostSummary),
      checkedAt: new Date().toISOString(),
      providerCheckedAt: liveSnapshot?.checkedAt || null,
      cached: Boolean(liveSnapshot?.cached),
      stale: Boolean(liveSnapshot?.stale),
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      error: String(error?.message || "Could not load Vansco Facebook status.").slice(0, 300),
    });
  }
}

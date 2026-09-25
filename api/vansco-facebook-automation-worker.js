import {
  buildVanscoFacebookCaption,
  chooseVanscoCandidate,
  extractVanscoVehicleUrl,
  isEligibleVanscoVehicle,
  vanscoDailySlots,
  VANSCO_FACEBOOK_MAX_POSTS_PER_DAY,
} from "../lib/vanscoFacebookAutomation.js";
import {
  enrichVanscoVehicleFromPage,
  fetchVanscoMetaCatalogue,
} from "./_vansco-facebook-source.js";
import {
  createVanscoBufferPost,
  deleteVanscoBufferPost,
  loadVanscoBufferConfig,
  loadVanscoBufferState,
  loadVanscoPostingHistory,
  saveVanscoPostingHistory,
} from "./_vansco-buffer-runtime.js";

export const config = { maxDuration: 300 };

const ACCESS_HEADER = "x-marketing-customer-database-key";
const MIN_SCHEDULE_LEAD_MS = 8 * 60 * 1000;
const MAX_BRANCH_RESOLUTION_ATTEMPTS = 30;

function clean(value) {
  return String(value ?? "").trim();
}

function authorize(request) {
  const cronSecret = clean(process.env.CRON_SECRET);
  const marketingKey = clean(process.env.MARKETING_CUSTOMER_DATABASE_API_KEY);
  const authorization = clean(request.headers.authorization);
  const supplied = clean(request.headers[ACCESS_HEADER]);
  return Boolean(
    (cronSecret && authorization === `Bearer ${cronSecret}`) ||
    (marketingKey && (supplied === marketingKey || authorization === `Bearer ${marketingKey}`)),
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

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function postDueIso(post) {
  const value = clean(post?.dueAt || post?.createdAt);
  const date = new Date(value || 0);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function liveVehicleUrls(vehicles) {
  return new Set(
    (vehicles || [])
      .filter(isEligibleVanscoVehicle)
      .map((vehicle) => clean(vehicle.vehicleUrl))
      .filter(Boolean),
  );
}

async function pruneStaleScheduledPosts(posts, liveUrls) {
  const kept = [];
  const removed = [];
  for (const post of posts || []) {
    const vehicleUrl = extractVanscoVehicleUrl(post?.text);
    if (!vehicleUrl || liveUrls.has(vehicleUrl)) {
      kept.push(post);
      continue;
    }
    try {
      await deleteVanscoBufferPost(post.id);
      removed.push({
        id: String(post.id || ""),
        vehicleUrl,
        dueAt: postDueIso(post),
      });
    } catch (error) {
      kept.push(post);
      removed.push({
        id: String(post.id || ""),
        vehicleUrl,
        dueAt: postDueIso(post),
        deleteFailed: true,
        error: clean(error?.message || error).slice(0, 200),
      });
    }
  }
  return { kept, removed };
}

function dailyLimitFromState(limitState) {
  const providerLimit = Number(limitState?.limit);
  if (Number.isFinite(providerLimit) && providerLimit >= 0) {
    return Math.min(VANSCO_FACEBOOK_MAX_POSTS_PER_DAY, providerLimit);
  }
  return VANSCO_FACEBOOK_MAX_POSTS_PER_DAY;
}

function queueCapacity(config, posts) {
  const configured = Number(config?.scheduledPostsLimit);
  const providerLimit = Number.isFinite(configured) && configured > 0 ? configured : 10;
  return Math.max(0, providerLimit - (posts || []).length);
}

function availableSlots({ dateKey, networkLimit, occupiedPosts, now }) {
  const occupied = new Set((occupiedPosts || []).map(postDueIso).filter(Boolean));
  return vanscoDailySlots(dateKey, networkLimit)
    .filter((slot) => new Date(slot.dueAt).getTime() > now + MIN_SCHEDULE_LEAD_MS)
    .filter((slot) => !occupied.has(slot.dueAt));
}

async function chooseResolvedCandidate({
  vehicles,
  history,
  excludedUrls,
}) {
  const localExcluded = new Set(excludedUrls);
  const held = [];

  for (let attempt = 0; attempt < MAX_BRANCH_RESOLUTION_ATTEMPTS; attempt += 1) {
    const candidate = chooseVanscoCandidate({
      vehicles,
      lastPostedByKey: history.lastPostedByKey,
      excludedUrls: [...localExcluded],
    });
    if (!candidate) return { vehicle: null, held };

    const enriched = await enrichVanscoVehicleFromPage(candidate);
    if (enriched.branchKey && !enriched.branchConflict) {
      return { vehicle: enriched, held };
    }

    localExcluded.add(candidate.vehicleUrl);
    held.push({
      vehicleKey: candidate.vehicleKey,
      vehicleUrl: candidate.vehicleUrl,
      title: candidate.title,
      reason: enriched.branchConflict ? "branch_conflict" : "branch_unresolved",
    });
  }

  return { vehicle: null, held };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (!["GET", "POST"].includes(request.method)) {
    response.setHeader("Allow", "GET, POST");
    return response.status(405).json({ ok: false, error: "Method not allowed." });
  }
  if (!authorize(request)) {
    return response.status(401).json({ ok: false, error: "Automation access not recognised." });
  }

  const startedAt = Date.now();
  const dateKey = londonDateKey();
  const enabled = String(process.env.VANSCO_FACEBOOK_AUTOMATION_ENABLED || "").toLowerCase() === "true";
  const dryRun = String(request.query?.dryRun || "").toLowerCase() === "true";

  try {
    const vehicles = await fetchVanscoMetaCatalogue();
    const eligible = vehicles.filter(isEligibleVanscoVehicle);
    const liveUrls = liveVehicleUrls(eligible);

    if (!enabled && !dryRun) {
      return response.status(200).json({
        ok: true,
        enabled: false,
        date: dateKey,
        metaVehicleCount: vehicles.length,
        eligibleVehicleCount: eligible.length,
        message: "Vansco Facebook automation is built but not enabled. No Buffer changes were made.",
        elapsedMs: Date.now() - startedAt,
      });
    }

    if (dryRun) {
      const history = await loadVanscoPostingHistory();
      const selected = [];
      const held = [];
      const excludedUrls = new Set();
      while (selected.length < 5) {
        const result = await chooseResolvedCandidate({
          vehicles: eligible,
          history,
          excludedUrls,
        });
        held.push(...result.held);
        for (const item of result.held) excludedUrls.add(item.vehicleUrl);
        if (!result.vehicle) break;
        selected.push({
          vehicleKey: result.vehicle.vehicleKey,
          registration: result.vehicle.registration,
          title: result.vehicle.title,
          price: result.vehicle.price,
          vatLabel: result.vehicle.vatLabel,
          mileage: result.vehicle.mileage,
          branchKey: result.vehicle.branchKey,
          branchSource: result.vehicle.branchSource,
          vehicleUrl: result.vehicle.vehicleUrl,
          imageUrl: result.vehicle.imageUrl,
          caption: buildVanscoFacebookCaption(result.vehicle),
        });
        excludedUrls.add(result.vehicle.vehicleUrl);
      }
      return response.status(200).json({
        ok: true,
        dryRun: true,
        enabled,
        date: dateKey,
        metaVehicleCount: vehicles.length,
        eligibleVehicleCount: eligible.length,
        preview: selected,
        held: held.slice(0, 20),
        elapsedMs: Date.now() - startedAt,
      });
    }

    const bufferConfig = await loadVanscoBufferConfig();
    const state = await loadVanscoBufferState(bufferConfig, `${dateKey}T12:00:00.000Z`);
    const pruned = await pruneStaleScheduledPosts(state.posts, liveUrls);
    const posts = [...pruned.kept];

    const networkLimit = dailyLimitFromState(state.limit);
    const providerSent = safeNumber(state.limit?.sent);
    const providerScheduled = Math.max(
      safeNumber(state.limit?.scheduled),
      posts.length,
    );
    const remainingDaily = Math.max(0, networkLimit - providerSent - providerScheduled);
    const capacity = Math.min(queueCapacity(bufferConfig, posts), remainingDaily);
    const slots = availableSlots({
      dateKey,
      networkLimit,
      occupiedPosts: posts,
      now: Date.now(),
    }).slice(0, capacity);

    const history = await loadVanscoPostingHistory();
    const excludedUrls = new Set(
      posts.map((post) => extractVanscoVehicleUrl(post?.text)).filter(Boolean),
    );
    const created = [];
    const held = [];

    for (const slot of slots) {
      const result = await chooseResolvedCandidate({
        vehicles: eligible,
        history,
        excludedUrls,
      });
      held.push(...result.held);
      for (const item of result.held) excludedUrls.add(item.vehicleUrl);
      const vehicle = result.vehicle;
      if (!vehicle) break;

      const caption = buildVanscoFacebookCaption(vehicle);
      const post = await createVanscoBufferPost({
        config: bufferConfig,
        text: caption,
        imageUrl: vehicle.imageUrl,
        dueAt: slot.dueAt,
      });
      posts.push(post);
      excludedUrls.add(vehicle.vehicleUrl);
      history.lastPostedByKey[vehicle.vehicleKey] = slot.dueAt;
      created.push({
        bufferPostId: String(post.id || ""),
        vehicleKey: vehicle.vehicleKey,
        registration: vehicle.registration,
        title: vehicle.title,
        branchKey: vehicle.branchKey,
        branchSource: vehicle.branchSource,
        vehicleUrl: vehicle.vehicleUrl,
        dueAt: post.dueAt || slot.dueAt,
        localTime: slot.localTime,
      });
    }

    if (created.length) {
      await saveVanscoPostingHistory(history.lastPostedByKey);
    }

    return response.status(200).json({
      ok: true,
      enabled: true,
      date: dateKey,
      source: "dealerkit_meta_catalogue",
      metaVehicleCount: vehicles.length,
      eligibleVehicleCount: eligible.length,
      buffer: {
        organizationId: bufferConfig.organizationId,
        channelId: bufferConfig.channelId,
        channelName: bufferConfig.channelName,
        scheduledPostsLimit: bufferConfig.scheduledPostsLimit,
        networkDailyLimit: networkLimit,
        providerSent,
        providerScheduled,
      },
      staleScheduledPosts: pruned.removed,
      created,
      held: held.slice(0, 30),
      queueCountAfter: posts.length,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (error) {
    const message = clean(error?.message || error) || "Vansco Facebook automation failed.";
    console.error("[vansco-facebook-automation] worker failed", { message });
    const status = error?.code === "BUFFER_RATE_LIMIT" ? 429 : 500;
    return response.status(status).json({
      ok: false,
      error: message,
      retryAfter: error?.retryAfter || null,
      elapsedMs: Date.now() - startedAt,
    });
  }
}

import {
  bufferDormantPayload,
  isBufferScheduledRunDue,
} from "../lib/bufferActiveWindow.js";
import {
  VANSCO_FACEBOOK_STORIES_PER_DAY,
  buildVanscoFacebookCaption,
  chooseVanscoCandidate,
  extractVanscoVehicleUrl,
  isEligibleVanscoVehicle,
  isVanscoVatResolved,
  vanscoFacebookStorySlots,
  vanscoNextDateKey,
} from "../lib/vanscoFacebookAutomation.js";
import {
  enrichVanscoVehicleFromPage,
  fetchVanscoMetaCatalogue,
} from "./_vansco-facebook-source.js";
import {
  createVanscoFacebookStory,
  isVanscoFacebookStory,
  loadVanscoBufferConfig,
  loadVanscoBufferState,
  loadVanscoFacebookActivity,
  loadVanscoFacebookStoryHistory,
  saveVanscoFacebookStoryHistory,
  saveVanscoFacebookStoryStatus,
} from "./_vansco-buffer-runtime.js";

export const config = { maxDuration: 180 };

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

function postDateKey(post) {
  const value = clean(post?.sentAt || post?.dueAt || post?.createdAt);
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : londonDateKey(date);
}

function liveStoryPostsForDay(posts, dateKey) {
  return (posts || []).filter((post) =>
    String(post?.status || "").toLowerCase() !== "error"
    && isVanscoFacebookStory(post)
    && postDateKey(post) === dateKey
  );
}

function queueCapacity(config, posts) {
  const configured = Number(config?.scheduledPostsLimit);
  const providerLimit = Number.isFinite(configured) && configured > 0 ? configured : 10;
  return Math.max(0, providerLimit - (posts || []).length);
}

function availableSlots(dateKey, posts, now) {
  const occupied = new Set(
    liveStoryPostsForDay(posts, dateKey)
      .map((post) => {
        const value = post?.dueAt || post?.sentAt || post?.createdAt;
        const date = new Date(value || 0);
        return Number.isNaN(date.getTime()) ? "" : date.toISOString();
      })
      .filter(Boolean),
  );

  return vanscoFacebookStorySlots(dateKey, VANSCO_FACEBOOK_STORIES_PER_DAY)
    .filter((slot) => new Date(slot.dueAt).getTime() > now + MIN_SCHEDULE_LEAD_MS)
    .filter((slot) => !occupied.has(slot.dueAt));
}

async function chooseResolvedStoryCandidate({
  vehicles,
  history,
  excludedUrls,
}) {
  const localExcluded = new Set(excludedUrls);

  for (let attempt = 0; attempt < MAX_BRANCH_RESOLUTION_ATTEMPTS; attempt += 1) {
    const candidate = chooseVanscoCandidate({
      vehicles,
      lastPostedByKey: history.lastPostedByKey,
      excludedUrls: [...localExcluded],
    });
    if (!candidate) return { vehicle: null, held: [] };

    if (candidate.branchKey && !candidate.branchConflict && isVanscoVatResolved(candidate)) {
      return { vehicle: candidate, held: [] };
    }

    const enriched = await enrichVanscoVehicleFromPage(candidate);
    if (enriched.branchKey && !enriched.branchConflict && isVanscoVatResolved(enriched)) {
      return { vehicle: enriched, held: [] };
    }

    localExcluded.add(candidate.vehicleUrl);
  }

  return { vehicle: null, held: [] };
}

function recoverableStoryError(error) {
  const message = clean(error?.message || error);
  if (/already got this one scheduled|same thing twice|duplicate/i.test(message)) {
    return "buffer_duplicate";
  }
  if (
    /compatible jpeg\/png image|unsupported.*(?:image|media)|invalid.*(?:image|media)|(?:image|media).*format/i
      .test(message)
  ) {
    return "buffer_media_rejected";
  }
  return "";
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

  if (!isBufferScheduledRunDue("two-hour")) {
    return response.status(200).json(bufferDormantPayload({
      job: "vansco-facebook-stories",
      message: "Vansco Story refill is dormant outside its daytime two-hour schedule.",
    }));
  }

  const startedAt = Date.now();
  const dateKey = londonDateKey();
  const enabled = String(process.env.VANSCO_FACEBOOK_STORIES_AUTOMATION_ENABLED || "true").toLowerCase() !== "false";
  const dryRun = String(request.query?.dryRun || "").toLowerCase() === "true";

  try {
    if (!enabled && !dryRun) {
      const payload = {
        ok: true,
        enabled: false,
        date: dateKey,
        state: "disabled",
        message: "Vansco Facebook Stories automation is disabled.",
        elapsedMs: Date.now() - startedAt,
      };
      await saveVanscoFacebookStoryStatus({
        ...payload,
        attemptedAt: new Date().toISOString(),
      }).catch(() => {});
      return response.status(200).json(payload);
    }

    const [vehicles, bufferConfig, history] = await Promise.all([
      fetchVanscoMetaCatalogue(),
      loadVanscoBufferConfig(),
      loadVanscoFacebookStoryHistory(),
    ]);
    const eligible = vehicles.filter(isEligibleVanscoVehicle);
    const now = Date.now();

    const [currentState, activity] = await Promise.all([
      loadVanscoBufferState(bufferConfig, `${dateKey}T12:00:00.000Z`),
      loadVanscoFacebookActivity(bufferConfig),
    ]);

    const currentStories = liveStoryPostsForDay(activity.posts, dateKey);
    const currentSlots = availableSlots(dateKey, activity.posts, now);
    const scheduleDateKey = currentStories.length < VANSCO_FACEBOOK_STORIES_PER_DAY && currentSlots.length
      ? dateKey
      : vanscoNextDateKey(dateKey);

    const state = scheduleDateKey === dateKey
      ? currentState
      : await loadVanscoBufferState(bufferConfig, `${scheduleDateKey}T12:00:00.000Z`);
    const targetStories = liveStoryPostsForDay(activity.posts, scheduleDateKey);
    const targetRemaining = Math.max(
      0,
      VANSCO_FACEBOOK_STORIES_PER_DAY - targetStories.length,
    );

    const providerLimit = Number(state.limit?.limit);
    const providerSent = Number(state.limit?.sent) || 0;
    const providerScheduled = Number(state.limit?.scheduled) || 0;
    const providerRemaining = Number.isFinite(providerLimit)
      ? Math.max(0, providerLimit - providerSent - providerScheduled)
      : targetRemaining;
    const capacity = Math.min(
      queueCapacity(bufferConfig, state.posts),
      targetRemaining,
      providerRemaining,
    );
    const slots = availableSlots(scheduleDateKey, activity.posts, now).slice(0, capacity);

    if (dryRun) {
      return response.status(200).json({
        ok: true,
        dryRun: true,
        enabled,
        date: dateKey,
        scheduleDate: scheduleDateKey,
        target: VANSCO_FACEBOOK_STORIES_PER_DAY,
        existingStories: targetStories.length,
        capacity,
        slots,
        eligibleVehicleCount: eligible.length,
        elapsedMs: Date.now() - startedAt,
      });
    }

    const excludedUrls = new Set(
      (activity.posts || [])
        .filter((post) => postDateKey(post) === scheduleDateKey)
        .map((post) => extractVanscoVehicleUrl(post?.text))
        .filter(Boolean),
    );
    const created = [];
    const held = [];
    let historyChanged = false;

    for (const slot of slots) {
      let filled = false;

      for (let attempt = 0; attempt < MAX_BRANCH_RESOLUTION_ATTEMPTS; attempt += 1) {
        const result = await chooseResolvedStoryCandidate({
          vehicles: eligible,
          history,
          excludedUrls,
        });
        const vehicle = result.vehicle;
        if (!vehicle) break;

        try {
          const post = await createVanscoFacebookStory({
            config: bufferConfig,
            text: buildVanscoFacebookCaption(vehicle),
            imageUrl: vehicle.imageUrl,
            dueAt: slot.dueAt,
          });

          excludedUrls.add(vehicle.vehicleUrl);
          history.lastPostedByKey[vehicle.vehicleKey] = slot.dueAt;
          historyChanged = true;
          created.push({
            bufferPostId: String(post.id || ""),
            vehicleKey: vehicle.vehicleKey,
            registration: vehicle.registration,
            title: vehicle.title,
            branchKey: vehicle.branchKey,
            vehicleUrl: vehicle.vehicleUrl,
            dueAt: post.dueAt || slot.dueAt,
            localTime: slot.localTime,
          });
          filled = true;
          break;
        } catch (error) {
          const reason = recoverableStoryError(error);
          if (!reason) throw error;

          excludedUrls.add(vehicle.vehicleUrl);
          held.push({
            vehicleKey: vehicle.vehicleKey,
            vehicleUrl: vehicle.vehicleUrl,
            title: vehicle.title,
            reason,
            error: clean(error?.message || error).slice(0, 200),
          });

          if (reason === "buffer_duplicate") {
            history.lastPostedByKey[vehicle.vehicleKey] = new Date().toISOString();
            historyChanged = true;
          }
        }
      }

      if (!filled) break;
    }

    if (historyChanged) {
      await saveVanscoFacebookStoryHistory(history.lastPostedByKey);
    }

    const payload = {
      ok: true,
      enabled: true,
      date: dateKey,
      scheduleDate: scheduleDateKey,
      state: "healthy",
      source: "dealerkit_meta_catalogue",
      target: VANSCO_FACEBOOK_STORIES_PER_DAY,
      existingStories: targetStories.length,
      created,
      held: held.slice(0, 20),
      providerLimit: Number.isFinite(providerLimit) ? providerLimit : null,
      providerSent,
      providerScheduled,
      elapsedMs: Date.now() - startedAt,
    };
    await saveVanscoFacebookStoryStatus({
      ...payload,
      attemptedAt: new Date().toISOString(),
      lastSuccessAt: new Date().toISOString(),
    });
    return response.status(200).json(payload);
  } catch (error) {
    const message = clean(error?.message || error) || "Vansco Facebook Stories automation failed.";
    const status = error?.code === "BUFFER_RATE_LIMIT" ? 429 : 500;
    const payload = {
      ok: false,
      enabled,
      date: dateKey,
      state: "failed",
      error: message.slice(0, 400),
      retryAfter: error?.retryAfter || null,
      elapsedMs: Date.now() - startedAt,
    };
    await saveVanscoFacebookStoryStatus({
      ...payload,
      attemptedAt: new Date().toISOString(),
      lastError: message.slice(0, 400),
    }).catch(() => {});
    return response.status(status).json(payload);
  }
}

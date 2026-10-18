import {
  bufferDormantPayload,
  isBufferScheduledRunDue,
} from "../lib/bufferActiveWindow.js";
import {
  VANSCO_GOOGLE_BUSINESS_POSTS_PER_DAY,
  buildVanscoGoogleBusinessCaption,
  extractUkRegistration,
  isEligibleVanscoVehicle,
  isVanscoCar,
  vanscoGoogleBusinessSlots,
  vanscoNextDateKey,
} from "../lib/vanscoFacebookAutomation.js";
import { fetchVanscoMetaCatalogue } from "./_vansco-facebook-source.js";
import {
  activeVanscoMediaQuarantine,
  preflightVanscoFacebookImage,
  quarantineFromFailedVanscoGoogleBusinessPosts,
  quarantineVanscoVehicle,
  VANSCO_MEDIA_PREFLIGHT_FAILURE_MS,
} from "../lib/vanscoFailedMediaRecovery.js";
import {
  createVanscoGoogleBusinessPost,
  loadVanscoBufferState,
  loadVanscoCachedFailedGoogleBusinessPosts,
  loadVanscoGoogleBusinessConfig,
  loadVanscoGoogleBusinessHistory,
  loadVanscoGoogleBusinessMediaQuarantine,
  saveVanscoGoogleBusinessMediaQuarantine,
  vanscoBufferCompatibleImageUrl,
  saveVanscoGoogleBusinessAutomationStatus,
  saveVanscoGoogleBusinessHistory,
} from "./_vansco-buffer-runtime.js";

export const config = { maxDuration: 300 };

const ACCESS_HEADER = "x-marketing-customer-database-key";
const MIN_SCHEDULE_LEAD_MS = 8 * 60 * 1000;
const BRANCH_ORDER = ["vansco333", "southamptonAirport", "newForest"];
const BRANCH_SLOT_OFFSETS = Object.freeze({
  vansco333: 0,
  southamptonAirport: 5,
  newForest: 10,
});

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
  const value = post?.dueAt || post?.createdAt;
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : londonDateKey(date);
}

function registrationKey(value) {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function queuedRegistrations(posts, dateKey) {
  return new Set(
    (posts || [])
      .filter((post) => postDateKey(post) === dateKey)
      .map((post) => registrationKey(extractUkRegistration(post?.text)))
      .filter(Boolean),
  );
}

function chooseBranchCandidate({
  vehicles,
  branchKey,
  lastPostedByKey,
  excludedRegistrations,
}) {
  const excluded = excludedRegistrations instanceof Set
    ? excludedRegistrations
    : new Set(excludedRegistrations || []);

  return [...(vehicles || [])]
    .filter(isEligibleVanscoVehicle)
    .filter((vehicle) => !isVanscoCar(vehicle))
    .filter((vehicle) => vehicle.branchKey === branchKey && !vehicle.branchConflict)
    .filter((vehicle) => {
      const registration = registrationKey(vehicle.registration);
      return registration && !excluded.has(registration);
    })
    .sort((first, second) => {
      const firstLast = new Date(lastPostedByKey?.[first.vehicleKey] || 0).getTime() || 0;
      const secondLast = new Date(lastPostedByKey?.[second.vehicleKey] || 0).getTime() || 0;
      if (firstLast !== secondLast) return firstLast - secondLast;
      return String(first.vehicleKey).localeCompare(String(second.vehicleKey));
    })[0] || null;
}

function availableSlots(branchKey, dateKey, posts, now) {
  const occupied = new Set(
    (posts || [])
      .filter((post) => postDateKey(post) === dateKey)
      .map((post) => {
        const value = post?.dueAt || post?.createdAt;
        const date = new Date(value || 0);
        return Number.isNaN(date.getTime()) ? "" : date.toISOString();
      })
      .filter(Boolean),
  );

  return vanscoGoogleBusinessSlots(
    dateKey,
    VANSCO_GOOGLE_BUSINESS_POSTS_PER_DAY,
    BRANCH_SLOT_OFFSETS[branchKey] || 0,
  )
    .filter((slot) => new Date(slot.dueAt).getTime() > now + MIN_SCHEDULE_LEAD_MS)
    .filter((slot) => !occupied.has(slot.dueAt));
}

function queueCapacity(config, posts) {
  const configured = Number(config?.scheduledPostsLimit);
  if (!Number.isFinite(configured) || configured <= 0) return VANSCO_GOOGLE_BUSINESS_POSTS_PER_DAY;
  return Math.max(0, configured - (posts || []).length);
}

function recoverablePostError(error) {
  const message = clean(error?.message || error);
  if (/already got this one scheduled|same thing twice|duplicate/i.test(message)) return "buffer_duplicate";
  if (/compatible jpeg\/png image|unsupported.*(?:image|media)|invalid.*(?:image|media)|(?:image|media).*format/i.test(message)) {
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

  if (!isBufferScheduledRunDue("four-hour-plus-final")) {
    return response.status(200).json(bufferDormantPayload({
      job: "vansco-google-business",
      message: "Vansco Google Business refill is dormant outside its daytime schedule.",
    }));
  }

  const startedAt = Date.now();
  const dateKey = londonDateKey();
  const enabled = String(process.env.VANSCO_GOOGLE_BUSINESS_AUTOMATION_ENABLED || "true").toLowerCase() !== "false";
  const dryRun = String(request.query?.dryRun || "").toLowerCase() === "true";

  try {
    if (!enabled && !dryRun) {
      const payload = {
        ok: true,
        enabled: false,
        date: dateKey,
        state: "disabled",
        message: "Vansco Google Business automation is disabled.",
        elapsedMs: Date.now() - startedAt,
      };
      await saveVanscoGoogleBusinessAutomationStatus({
        ...payload,
        attemptedAt: new Date().toISOString(),
      }).catch(() => {});
      return response.status(200).json(payload);
    }

    const [vehicles, googleConfig, history] = await Promise.all([
      fetchVanscoMetaCatalogue({ preferLiveMetaImages: true }),
      loadVanscoGoogleBusinessConfig({ forceDiscovery: dryRun }),
      loadVanscoGoogleBusinessHistory(),
    ]);

    const eligible = vehicles.filter(isEligibleVanscoVehicle).filter((vehicle) => !isVanscoCar(vehicle));
    const branchVehicleCounts = Object.fromEntries(
      BRANCH_ORDER.map((branchKey) => [
        branchKey,
        eligible.filter((vehicle) => vehicle.branchKey === branchKey && !vehicle.branchConflict).length,
      ]),
    );

    if (dryRun) {
      return response.status(200).json({
        ok: true,
        dryRun: true,
        enabled,
        date: dateKey,
        targetPerBranch: VANSCO_GOOGLE_BUSINESS_POSTS_PER_DAY,
        channels: googleConfig.branches,
        branchVehicleCounts,
        elapsedMs: Date.now() - startedAt,
      });
    }

    const now = Date.now();
    const created = [];
    const held = [];
    const branchResults = {};
    let historyChanged = false;
    const previousMediaQuarantine = await loadVanscoGoogleBusinessMediaQuarantine();
    // The dashboard already checks Buffer's failed publications. Reuse its
    // cached result to avoid additional Buffer requests in the refill worker.
    const publishedFailures = await loadVanscoCachedFailedGoogleBusinessPosts().catch(() => ({}));
    const recoveredMedia = quarantineFromFailedVanscoGoogleBusinessPosts(
      previousMediaQuarantine, publishedFailures, eligible, now,
    );
    let mediaQuarantine = activeVanscoMediaQuarantine(recoveredMedia.quarantine, now);
    let mediaQuarantineChanged = JSON.stringify(mediaQuarantine) !== JSON.stringify(previousMediaQuarantine);
    const MAX_GBP_IMAGE_CHECKS_PER_BRANCH = 12;

    for (const branchKey of BRANCH_ORDER) {
      try {
      const channelConfig = googleConfig.branches?.[branchKey];
      if (!channelConfig?.channelId) {
        branchResults[branchKey] = { connected: false, error: "Buffer channel unavailable." };
        continue;
      }

      const currentState = await loadVanscoBufferState(
        channelConfig,
        `${dateKey}T12:00:00.000Z`,
      );
      const currentSlots = availableSlots(branchKey, dateKey, currentState.posts, now);
      const currentSent = Number(currentState.limit?.sent) || 0;
      const currentScheduled = Number(currentState.limit?.scheduled) || 0;
      const currentRemaining = Math.max(
        0,
        VANSCO_GOOGLE_BUSINESS_POSTS_PER_DAY - currentSent - currentScheduled,
      );

      const scheduleDateKey = currentRemaining > 0 && currentSlots.length
        ? dateKey
        : vanscoNextDateKey(dateKey);
      const state = scheduleDateKey === dateKey
        ? currentState
        : await loadVanscoBufferState(
            channelConfig,
            `${scheduleDateKey}T12:00:00.000Z`,
          );

      const providerSent = Number(state.limit?.sent) || 0;
      const providerScheduled = Number(state.limit?.scheduled) || 0;
      const targetRemaining = Math.max(
        0,
        VANSCO_GOOGLE_BUSINESS_POSTS_PER_DAY - providerSent - providerScheduled,
      );
      const capacity = Math.min(
        queueCapacity(channelConfig, state.posts),
        targetRemaining,
      );
      const slots = availableSlots(
        branchKey,
        scheduleDateKey,
        state.posts,
        now,
      ).slice(0, capacity);

      const excludedRegistrations = queuedRegistrations(state.posts, scheduleDateKey);
      const lastPostedByKey = history.lastPostedByBranch?.[branchKey] || {};
      const branchCreated = [];
      let checkedImages = 0;

      for (const slot of slots) {
        let postCreated = false;
        for (let attempt = 0; attempt < 30; attempt += 1) {
          const vehicle = chooseBranchCandidate({
            vehicles: eligible.filter((item) => !mediaQuarantine[item.vehicleUrl]),
            branchKey,
            lastPostedByKey,
            excludedRegistrations,
          });
          if (!vehicle || checkedImages >= MAX_GBP_IMAGE_CHECKS_PER_BRANCH) break;

          const registration = registrationKey(vehicle.registration);
          // Validate the image *before* creating a new Buffer post, so
          // unreachable stock URLs cannot generate another failed publication.
          checkedImages++;
          const checked = await preflightVanscoFacebookImage(
            vanscoBufferCompatibleImageUrl(vehicle.imageUrl),
          );
          if (!checked.ok) {
            mediaQuarantine = quarantineVanscoVehicle(mediaQuarantine, vehicle.vehicleUrl, {
              periodMs: VANSCO_MEDIA_PREFLIGHT_FAILURE_MS,
              reason: checked.reason,
            });
            mediaQuarantineChanged = true;
            excludedRegistrations.add(registration);
            held.push({
              branchKey,
              vehicleKey: vehicle.vehicleKey,
              registration,
              reason: "image_unavailable",
              detail: checked.reason,
            });
            continue;
          }
          try {
            const post = await createVanscoGoogleBusinessPost({
              config: channelConfig,
              text: buildVanscoGoogleBusinessCaption(vehicle),
              imageUrl: vehicle.imageUrl,
              vehicleId: vehicle.vehicleId,
              dueAt: slot.dueAt,
              linkUrl: vehicle.vehicleUrl,
            });

            excludedRegistrations.add(registration);
            lastPostedByKey[vehicle.vehicleKey] = slot.dueAt;
            history.lastPostedByBranch[branchKey] = lastPostedByKey;
            historyChanged = true;

            const row = {
              branchKey,
              channelId: channelConfig.channelId,
              channelName: channelConfig.channelName,
              bufferPostId: String(post.id || ""),
              vehicleKey: vehicle.vehicleKey,
              registration,
              title: vehicle.title,
              vehicleUrl: vehicle.vehicleUrl,
              dueAt: post.dueAt || slot.dueAt,
              localTime: slot.localTime,
            };
            created.push(row);
            branchCreated.push(row);
            postCreated = true;
            break;
          } catch (error) {
            const reason = recoverablePostError(error);
            if (!reason) throw error;

            excludedRegistrations.add(registration);
            held.push({
              branchKey,
              vehicleKey: vehicle.vehicleKey,
              registration,
              vehicleUrl: vehicle.vehicleUrl,
              reason,
              error: clean(error?.message || error).slice(0, 200),
            });
            if (reason === "buffer_duplicate") {
              lastPostedByKey[vehicle.vehicleKey] = new Date().toISOString();
              history.lastPostedByBranch[branchKey] = lastPostedByKey;
              historyChanged = true;
            }
          }
        }
        if (!postCreated) break;
      }

      branchResults[branchKey] = {
        connected: true,
        channelId: channelConfig.channelId,
        channelName: channelConfig.channelName,
        scheduleDate: scheduleDateKey,
        sent: providerSent,
        scheduled: providerScheduled,
        queueCount: state.posts.length + branchCreated.length,
        created: branchCreated.length,
        checkedImages,
        target: VANSCO_GOOGLE_BUSINESS_POSTS_PER_DAY,
        eligibleVehicles: branchVehicleCounts[branchKey] || 0,
      };
      } catch (error) {
        // One branch's unavailable channel or rejected post must not abandon
        // healthy branches or lose the successful posting history already created.
        const rateLimited = error?.code === "BUFFER_RATE_LIMIT";
        const message = clean(error?.message || error).slice(0, 240);
        branchResults[branchKey] = {
          connected: true,
          state: rateLimited ? "deferred" : "failed",
          error: message,
          retryAfter: rateLimited ? String(error.retryAfter || "") : null,
        };
        console.warn("[vansco-google-business] branch refill deferred", {
          branch: branchKey,
          reason: rateLimited ? "buffer_rate_limit" : "branch_error",
          message,
        });
        if (rateLimited) {
          // All three branches use the same Vansco credential. Stop immediately
          // rather than spend further Buffer requests during its cooldown.
          for (const remaining of BRANCH_ORDER.slice(BRANCH_ORDER.indexOf(branchKey) + 1)) {
            branchResults[remaining] = { state: "deferred", reason: "shared_buffer_cooldown" };
          }
          break;
        }
      }
    }

    if (historyChanged) {
      await saveVanscoGoogleBusinessHistory(history.lastPostedByBranch);
    }
    if (mediaQuarantineChanged) {
      await saveVanscoGoogleBusinessMediaQuarantine(activeVanscoMediaQuarantine(mediaQuarantine));
    }

    const failedBranches = Object.entries(branchResults)
      .filter(([, result]) => result?.state === "failed" || result?.state === "deferred")
      .map(([branch]) => branch);
    const payload = {
      ok: failedBranches.length === 0,
      enabled: true,
      date: dateKey,
      state: failedBranches.length ? "degraded" : "healthy",
      failedBranches,
      source: "dealerkit_meta_catalogue",
      targetPerBranch: VANSCO_GOOGLE_BUSINESS_POSTS_PER_DAY,
      branchVehicleCounts,
      branches: branchResults,
      created,
      held: held.slice(0, 30),
      elapsedMs: Date.now() - startedAt,
    };
    await saveVanscoGoogleBusinessAutomationStatus({
      ...payload,
      attemptedAt: new Date().toISOString(),
      ...(failedBranches.length ? {} : { lastSuccessAt: new Date().toISOString() }),
    });
    return response.status(200).json(payload);
  } catch (error) {
    const payload = {
      ok: false,
      enabled,
      date: dateKey,
      state: "failed",
      error: clean(error?.message || error).slice(0, 400),
      elapsedMs: Date.now() - startedAt,
      attemptedAt: new Date().toISOString(),
    };
    await saveVanscoGoogleBusinessAutomationStatus(payload).catch(() => {});
    return response.status(error?.code === "BUFFER_RATE_LIMIT" ? 429 : 500).json({
      ...payload,
      retryAfter: error?.retryAfter || null,
    });
  }
}

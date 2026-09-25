import {
  buildVanscoFacebookCaption,
  chooseVanscoCandidate,
  extractVanscoVehicleUrl,
  hasExplicitVanscoVatLabel,
  isEligibleVanscoVehicle,
  isVanscoCar,
  isVanscoVatResolved,
  vanscoAdvertVatLabel,
  vanscoDailySlots,
  vanscoNextDateKey,
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
  saveVanscoAutomationStatus,
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

function liveVehicleMap(vehicles) {
  return new Map(
    (vehicles || [])
      .filter(isEligibleVanscoVehicle)
      .map((vehicle) => [clean(vehicle.vehicleUrl), vehicle])
      .filter(([vehicleUrl]) => Boolean(vehicleUrl)),
  );
}

async function pruneStaleScheduledPosts(posts, liveVehicles) {
  const kept = [];
  const removed = [];
  for (const post of posts || []) {
    const vehicleUrl = extractVanscoVehicleUrl(post?.text);
    const vehicle = vehicleUrl ? liveVehicles.get(vehicleUrl) : null;
    const live = Boolean(vehicle);
    const explicitVat = hasExplicitVanscoVatLabel(post?.text);
    const carVatLabelPresent = live && isVanscoCar(vehicle) && explicitVat;
    const vatMissing = live && !isVanscoCar(vehicle) && !explicitVat;
    if ((!vehicleUrl || live) && !vatMissing && !carVatLabelPresent) {
      kept.push(post);
      continue;
    }
    const reason = carVatLabelPresent
      ? "car_vat_label_present"
      : vatMissing
        ? "vat_label_missing"
        : "vehicle_no_longer_live";
    try {
      await deleteVanscoBufferPost(post.id);
      removed.push({
        id: String(post.id || ""),
        vehicleUrl,
        dueAt: postDueIso(post),
        reason,
      });
    } catch (error) {
      kept.push(post);
      removed.push({
        id: String(post.id || ""),
        vehicleUrl,
        dueAt: postDueIso(post),
        reason,
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

    if (candidate.branchKey && !candidate.branchConflict && isVanscoVatResolved(candidate)) {
      return { vehicle: candidate, held };
    }

    const enriched = await enrichVanscoVehicleFromPage(candidate);
    if (enriched.branchKey && !enriched.branchConflict && isVanscoVatResolved(enriched)) {
      return { vehicle: enriched, held };
    }

    localExcluded.add(candidate.vehicleUrl);
    held.push({
      vehicleKey: candidate.vehicleKey,
      vehicleUrl: candidate.vehicleUrl,
      title: candidate.title,
      reason: !isVanscoVatResolved(enriched)
        ? "vat_unresolved"
        : enriched.branchConflict
          ? "branch_conflict"
          : "branch_unresolved",
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
    if (!enabled && !dryRun) {
      const payload = {
        ok: true,
        enabled: false,
        date: dateKey,
        state: "disabled",
        message: "Vansco Facebook automation is built but not enabled. No DealerKit or Buffer changes were made.",
        elapsedMs: Date.now() - startedAt,
      };
      await saveVanscoAutomationStatus({
        ...payload,
        attemptedAt: new Date().toISOString(),
      }).catch(() => {});
      return response.status(200).json(payload);
    }

    const vehicles = await fetchVanscoMetaCatalogue();
    const eligible = vehicles.filter(isEligibleVanscoVehicle);
    const liveVehicles = liveVehicleMap(eligible);

    if (dryRun) {
      const history = await loadVanscoPostingHistory();
      const selected = [];
      const held = [];
      const excludedUrls = new Set();

      const addPreview = (vehicle) => {
        selected.push({
          vehicleKey: vehicle.vehicleKey,
          registration: vehicle.registration,
          title: vehicle.title,
          price: vehicle.price,
          vatLabel: vanscoAdvertVatLabel(vehicle),
          mileage: vehicle.mileage,
          branchKey: vehicle.branchKey,
          branchSource: vehicle.branchSource,
          vehicleUrl: vehicle.vehicleUrl,
          imageUrl: vehicle.imageUrl,
          caption: buildVanscoFacebookCaption(vehicle),
        });
        excludedUrls.add(vehicle.vehicleUrl);
      };

      for (const branchKey of ["vansco333", "newForest", "southamptonAirport"]) {
        const candidate = eligible
          .filter((vehicle) => vehicle.branchKey === branchKey && !vehicle.branchConflict)
          .filter((vehicle) => !excludedUrls.has(vehicle.vehicleUrl))
          .sort((first, second) => {
            const firstLast = new Date(history.lastPostedByKey?.[first.vehicleKey] || 0).getTime() || 0;
            const secondLast = new Date(history.lastPostedByKey?.[second.vehicleKey] || 0).getTime() || 0;
            if (firstLast !== secondLast) return firstLast - secondLast;
            return String(first.vehicleKey).localeCompare(String(second.vehicleKey));
          })[0];
        if (!candidate) continue;
        const enriched = await enrichVanscoVehicleFromPage(candidate);
        if (enriched.branchKey === branchKey && !enriched.branchConflict && isVanscoVatResolved(enriched)) addPreview(enriched);
        else {
          held.push({
            vehicleKey: candidate.vehicleKey,
            vehicleUrl: candidate.vehicleUrl,
            title: candidate.title,
            reason: !isVanscoVatResolved(enriched)
              ? "vat_unresolved"
              : enriched.branchConflict
                ? "branch_conflict"
                : "branch_unresolved",
          });
          excludedUrls.add(candidate.vehicleUrl);
        }
      }

      while (selected.length < 5) {
        const result = await chooseResolvedCandidate({
          vehicles: eligible,
          history,
          excludedUrls,
        });
        held.push(...result.held);
        for (const item of result.held) excludedUrls.add(item.vehicleUrl);
        if (!result.vehicle) break;
        addPreview(result.vehicle);
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
    const now = Date.now();
    const currentState = await loadVanscoBufferState(bufferConfig, `${dateKey}T12:00:00.000Z`);
    const pruned = await pruneStaleScheduledPosts(currentState.posts, liveVehicles);
    const posts = [...pruned.kept];

    const currentNetworkLimit = dailyLimitFromState(currentState.limit);
    const currentSlots = availableSlots({
      dateKey,
      networkLimit: currentNetworkLimit,
      occupiedPosts: posts,
      now,
    });

    // Queue creation and public posting are deliberately separate concerns.
    // Once today's 08:00-21:00 window has no usable slot left, refill Buffer
    // with tomorrow's slots instead of leaving the queue empty overnight.
    const scheduleDateKey = currentSlots.length ? dateKey : vanscoNextDateKey(dateKey);
    const state = scheduleDateKey === dateKey
      ? currentState
      : await loadVanscoBufferState(bufferConfig, `${scheduleDateKey}T12:00:00.000Z`);
    const networkLimit = dailyLimitFromState(state.limit);
    const providerSent = safeNumber(state.limit?.sent);
    const scheduledForTargetDate = posts.filter((post) => {
      const dueAt = postDueIso(post);
      return dueAt && londonDateKey(new Date(dueAt)) === scheduleDateKey;
    }).length;
    const providerScheduled = Math.max(
      safeNumber(state.limit?.scheduled),
      scheduledForTargetDate,
    );
    const remainingDaily = Math.max(0, networkLimit - providerSent - providerScheduled);
    const capacity = Math.min(queueCapacity(bufferConfig, posts), remainingDaily);
    const slots = availableSlots({
      dateKey: scheduleDateKey,
      networkLimit,
      occupiedPosts: posts,
      now,
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

    const payload = {
      ok: true,
      enabled: true,
      date: dateKey,
      scheduleDate: scheduleDateKey,
      state: "healthy",
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
    };
    await saveVanscoAutomationStatus({
      ...payload,
      attemptedAt: new Date().toISOString(),
      lastSuccessAt: new Date().toISOString(),
      createdCount: created.length,
      heldCount: held.length,
      staleRemovedCount: pruned.removed.filter((item) => !item.deleteFailed).length,
      staleRemoveFailedCount: pruned.removed.filter((item) => item.deleteFailed).length,
    }).catch((error) => {
      console.warn("[vansco-facebook-automation] could not persist run status", {
        message: error?.message || String(error),
      });
    });
    return response.status(200).json(payload);
  } catch (error) {
    const message = clean(error?.message || error) || "Vansco Facebook automation failed.";
    console.error("[vansco-facebook-automation] worker failed", { message });
    const status = error?.code === "BUFFER_RATE_LIMIT" ? 429 : 500;
    const payload = {
      ok: false,
      enabled,
      state: "failed",
      date: dateKey,
      error: message,
      retryAfter: error?.retryAfter || null,
      elapsedMs: Date.now() - startedAt,
    };
    await saveVanscoAutomationStatus({
      ...payload,
      attemptedAt: new Date().toISOString(),
      lastError: message,
    }).catch(() => {});
    return response.status(status).json(payload);
  }
}

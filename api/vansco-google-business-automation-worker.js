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
  createVanscoGoogleBusinessPost,
  loadVanscoBufferState,
  loadVanscoGoogleBusinessConfig,
  loadVanscoGoogleBusinessHistory,
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
      fetchVanscoMetaCatalogue(),
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

    for (const branchKey of BRANCH_ORDER) {
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

      for (const slot of slots) {
        let postCreated = false;
        for (let attempt = 0; attempt < 30; attempt += 1) {
          const vehicle = chooseBranchCandidate({
            vehicles: eligible,
            branchKey,
            lastPostedByKey,
            excludedRegistrations,
          });
          if (!vehicle) break;

          const registration = registrationKey(vehicle.registration);
          try {
            const post = await createVanscoGoogleBusinessPost({
              config: channelConfig,
              text: buildVanscoGoogleBusinessCaption(vehicle),
              imageUrl: vehicle.imageUrl,
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
        target: VANSCO_GOOGLE_BUSINESS_POSTS_PER_DAY,
        eligibleVehicles: branchVehicleCounts[branchKey] || 0,
      };
    }

    if (historyChanged) {
      await saveVanscoGoogleBusinessHistory(history.lastPostedByBranch);
    }

    const payload = {
      ok: true,
      enabled: true,
      date: dateKey,
      state: "healthy",
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
      lastSuccessAt: new Date().toISOString(),
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
    return response.status(500).json(payload);
  }
}

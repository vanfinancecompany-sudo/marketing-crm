import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const LISTINGS = {
  "1001": {
    product: "Finance",
    reply: "Thanks for your enquiry! For van finance, available vehicles and online applications, please visit https://www.vanfinancecompany.co.uk/",
  },
  "2002": {
    product: "Rent2Buy",
    reply: "Thanks for your enquiry! For full details about our Rent2Buy programme, available vans, monthly rental prices and online applications, please visit https://www.rent2buyvans.co.uk/",
  },
};

const SCENARIOS = {
  finance: "1001",
  rent2buy: "2002",
  unmatched: "9999",
  answered: "1001",
};

export const INBOX_HEALTH = ["healthy", "signed-out", "security-challenge", "layout-changed"];
const CONFIRMATION_TIMEOUT_MS = 8_000;

function initialState() {
  return {
    enabled: false,
    enabledAfter: 0,
    pauseReason: null,
    health: "healthy",
    hideOutgoing: false,
    threads: [],
  };
}

function loadState(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return initialState();
    throw error;
  }
}

function saveState(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const pending = file + ".next";
  writeFileSync(pending, value, { encoding: "utf8", mode: 0o600 });
  renameSync(pending, file);
}

export function createReplySimulator(file, now = Date.now) {
  let state = loadState(file);
  let lastHeartbeat = null;

  // One loopback server owns the state. Claims are written before returning an
  // instruction to click, so concurrent tabs and restarts cannot claim twice.
  function change(update) {
    const next = structuredClone(state);
    const result = update(next);
    const serialized = JSON.stringify(next);
    if (serialized !== JSON.stringify(state)) {
      saveState(file, serialized);
      state = next;
    }
    return result;
  }

  return {
    snapshot() {
      return { ...structuredClone(state), lastHeartbeat };
    },

    setEnabled(enabled) {
      if (typeof enabled !== "boolean") throw new TypeError("Enabled must be true or false");
      change((next) => {
        if (next.enabled === enabled) return;
        next.enabled = enabled;
        next.pauseReason = enabled && next.health !== "healthy" ? next.health : null;
        if (enabled) {
          next.enabledAfter = next.threads.length;
        } else {
          for (const thread of next.threads) {
            if (thread.status === "Waiting") thread.status = "Ignored while off";
          }
        }
      });
    },

    configureInbox({ health, hideOutgoing }) {
      if (health !== undefined && !INBOX_HEALTH.includes(health)) throw new TypeError("Unknown inbox state");
      if (hideOutgoing !== undefined && typeof hideOutgoing !== "boolean") throw new TypeError("Invalid receipt setting");
      change((next) => {
        if (health !== undefined) {
          next.health = health;
        }
        if (hideOutgoing !== undefined) next.hideOutgoing = hideOutgoing;
      });
    },

    addEnquiry(scenario) {
      if (!Object.hasOwn(SCENARIOS, scenario)) throw new TypeError("Unknown synthetic enquiry");
      return change((next) => {
        const thread = {
          id: "thread-" + (next.threads.length + 1),
          listingId: SCENARIOS[scenario],
          status: scenario === "answered" ? "Already answered" : next.enabled ? "Waiting" : "Ignored while off",
          attemptId: null,
          startedAt: null,
          outgoing: scenario === "answered" ? { id: randomUUID(), text: "The seller has already replied." } : null,
          sendCount: 0,
        };
        next.threads.push(thread);
        return thread;
      });
    },

    observe({ health, rows }) {
      if (!INBOX_HEALTH.includes(health) || !Array.isArray(rows)) throw new TypeError("Invalid inbox observation");
      const observedAt = now();
      lastHeartbeat = new Date(observedAt).toISOString();
      const visible = new Map(rows.map((row) => [row.threadId, row]));

      return change((next) => {
        if (next.enabled && health !== "healthy") next.pauseReason = health;
        for (const thread of next.threads) {
          const row = visible.get(thread.id);
          if (thread.status !== "Sending" && thread.status !== "Unconfirmed") continue;
          if (
            health === "healthy" &&
            row?.listingId === thread.listingId &&
            row?.outgoingId &&
            row.outgoingId === thread.outgoing?.id &&
            !next.hideOutgoing
          ) {
            thread.status = "Sent";
          } else if (observedAt - thread.startedAt >= CONFIRMATION_TIMEOUT_MS) {
            thread.status = "Unconfirmed";
          }
        }

        if (!next.enabled || next.pauseReason || health !== "healthy" || next.health !== "healthy") return null;
        for (const thread of next.threads.slice(next.enabledAfter)) {
          const row = visible.get(thread.id);
          if (thread.status !== "Waiting" || !row) continue;
          if (row.listingId !== thread.listingId || !Object.hasOwn(LISTINGS, thread.listingId)) {
            thread.status = "Unmatched";
            continue;
          }
          if (row.outgoingId || thread.outgoing) {
            thread.status = "Already answered";
            continue;
          }

          thread.attemptId = randomUUID();
          thread.status = "Sending";
          thread.startedAt = observedAt;
          return {
            threadId: thread.id,
            listingId: thread.listingId,
            attemptId: thread.attemptId,
            text: LISTINGS[thread.listingId].reply,
          };
        }
        return null;
      });
    },

    deliver({ threadId, attemptId, text }) {
      return change((next) => {
        const thread = next.threads.find((candidate) => candidate.id === threadId);
        if (!next.enabled || next.pauseReason || next.health !== "healthy") return false;
        if (!thread || thread.status !== "Sending" || thread.attemptId !== attemptId || thread.outgoing) return false;
        if (text !== LISTINGS[thread.listingId]?.reply) return false;

        thread.outgoing = { id: randomUUID(), text };
        thread.sendCount += 1;
        return true;
      });
    },
  };
}

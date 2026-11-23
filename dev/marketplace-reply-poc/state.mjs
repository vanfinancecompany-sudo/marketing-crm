import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { draftMarketplaceReply } from "./assistant.mjs";
import { marketplaceProduct } from "./reply-policy.mjs";
import { FIXTURE_RECEIPTS, inspectInboxSnapshot, marketplaceRegistry } from "./observation.mjs";

export const LISTINGS = {
  "1001": {
    product: "Finance",
    productKey: "finance",
    vehicle: { title: "Simulated Finance van" },
    reply: "Thanks for your enquiry! For van finance, available vehicles and online applications, please visit https://www.vanfinancecompany.co.uk/",
  },
  "2002": {
    product: "Rent2Buy",
    productKey: "rent2buy",
    vehicle: { title: "Simulated Rent2Buy van" },
    reply: "Thanks for your enquiry! For full details about our Rent2Buy programme, available vans, monthly rental prices and online applications, please visit https://www.rent2buyvans.co.uk/",
  },
};

const SCENARIOS = { finance: "1001", rent2buy: "2002", unmatched: "9999", answered: "1001" };
export const INBOX_HEALTH = ["healthy", "signed-out", "security-challenge", "layout-changed"];
const CONFIRMATION_TIMEOUT_MS = 8_000;
const ACTIVE = new Set(["Drafting", "Sending", "Unconfirmed"]);

function loadState(file) {
  try {
    const state = JSON.parse(readFileSync(file, "utf8"));
    for (const thread of state.threads) {
      // The initial simulator stored a single synthetic acknowledgement per thread.
      thread.turns ??= [{
        id: thread.id + ":1", message: null, status: thread.status,
        attemptId: thread.attemptId, startedAt: thread.startedAt, outgoing: thread.outgoing,
        reply: LISTINGS[thread.listingId]?.reply,
      }];
      for (const turn of thread.turns) {
        // Drafting never exposes a send instruction, so restarting can draft again.
        if (turn.status === "Drafting") turn.status = "Waiting";
      }
    }
    return state;
  } catch (error) {
    if (error.code === "ENOENT") return { enabled: false, pauseReason: null, health: "healthy", hideOutgoing: false, threads: [] };
    throw error;
  }
}

function saveState(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const pending = file + ".next";
  writeFileSync(pending, value, { encoding: "utf8", mode: 0o600 });
  renameSync(pending, file);
}

function addTurn(thread, message, enabled) {
  const turn = {
    id: thread.id + ":" + (thread.turns.length + 1),
    message,
    status: thread.reviewReason ? "Needs human" : enabled ? "Waiting" : "Ignored while off",
  };
  thread.turns.push(turn);
  return turn;
}

function validateMessage(message) {
  if (typeof message !== "string" || !message.trim() || message.trim().length > 800) {
    throw new TypeError("Enter a synthetic customer message of 1–800 characters");
  }
  return message.trim();
}

function sentHistory(thread) {
  return thread.turns.filter((turn) => turn.status === "Sent" && turn.message && turn.outgoing).flatMap((turn) => [
    { role: "user", content: turn.message },
    { role: "assistant", content: turn.outgoing.text },
  ]).slice(-16);
}

function summarise(thread) {
  const status = thread.reviewReason ? "Needs human"
    : thread.turns.find((turn) => ACTIVE.has(turn.status))?.status || thread.turns.at(-1).status;
  return { ...thread, status, outgoing: thread.turns.at(-1).outgoing || null };
}

function instruction(thread, turn) {
  return { threadId: thread.id, listingId: thread.listingId, turnId: turn.id, attemptId: turn.attemptId, text: turn.reply };
}

export function createReplySimulator(file, now = Date.now, { draftReply = draftMarketplaceReply } = {}) {
  let state = loadState(file);
  let lastHeartbeat = null;
  const listingRegistry = marketplaceRegistry(FIXTURE_RECEIPTS);

  // One loopback server owns the state. Reserve each turn before any async work.
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
      const copy = structuredClone(state);
      return { ...copy, threads: copy.threads.map(summarise), lastHeartbeat };
    },

    observeBrowser(snapshot) {
      const started = performance.now();
      const report = change((next) => {
        next.browserObserver ??= { ledger: {}, totalAccepted: 0 };
        const audit = next.browserObserver;
        const result = inspectInboxSnapshot(snapshot, audit.ledger, listingRegistry);
        audit.totalAccepted += result.accepted.length;
        return { ...result, totalAccepted: audit.totalAccepted };
      });
      return { ...report, ingestMs: performance.now() - started };
    },

    setEnabled(enabled) {
      if (typeof enabled !== "boolean") throw new TypeError("Enabled must be true or false");
      change((next) => {
        if (next.enabled === enabled) return;
        next.enabled = enabled;
        next.pauseReason = enabled && next.health !== "healthy" ? next.health : null;
        if (enabled) return;
        for (const thread of next.threads) {
          for (const turn of thread.turns) {
            if (turn.status === "Waiting" || turn.status === "Drafting") turn.status = "Ignored while off";
          }
        }
      });
    },

    configureInbox({ health, hideOutgoing }) {
      if (health !== undefined && !INBOX_HEALTH.includes(health)) throw new TypeError("Unknown inbox state");
      if (hideOutgoing !== undefined && typeof hideOutgoing !== "boolean") throw new TypeError("Invalid receipt setting");
      change((next) => {
        if (health !== undefined) next.health = health;
        if (hideOutgoing !== undefined) next.hideOutgoing = hideOutgoing;
      });
    },

    addEnquiry(scenario, message) {
      if (!Object.hasOwn(SCENARIOS, scenario)) throw new TypeError("Unknown synthetic enquiry");
      const inbound = message === undefined ? null : validateMessage(message);
      return change((next) => {
        const thread = {
          id: "thread-" + (next.threads.length + 1),
          listingId: SCENARIOS[scenario],
          sendCount: 0,
          turns: [],
        };
        const turn = addTurn(thread, inbound, next.enabled);
        if (scenario === "answered") {
          turn.status = "Already answered";
          turn.outgoing = { id: randomUUID(), text: "The seller has already replied." };
        }
        next.threads.push(thread);
        return summarise(thread);
      });
    },

    addFollowUp(threadId, message, observedMessage) {
      const inbound = validateMessage(message);
      let sourceMessageId;
      if (observedMessage !== undefined) {
        if (observedMessage?.direction !== "incoming") return { ignored: "Direction is not verified as incoming" };
        sourceMessageId = observedMessage.id;
        if (typeof sourceMessageId !== "string" || !/^[a-z0-9_.:-]{1,128}$/i.test(sourceMessageId)) {
          return { ignored: "No stable incoming message ID" };
        }
      }
      return change((next) => {
        const thread = next.threads.find((candidate) => candidate.id === threadId);
        if (!thread?.turns[0].message) throw new TypeError("Select a simulated Ask Me conversation");
        if (sourceMessageId) {
          const existing = thread.turns.find((turn) => turn.sourceMessageId === sourceMessageId);
          if (existing) return existing.message === inbound ? { ...existing, duplicate: true } : { ignored: "Conflicting data for an observed message ID" };
        }
        const turn = addTurn(thread, inbound, next.enabled);
        if (sourceMessageId) turn.sourceMessageId = sourceMessageId;
        return turn;
      });
    },

    async observe({ health, rows }) {
      if (!INBOX_HEALTH.includes(health) || !Array.isArray(rows)) throw new TypeError("Invalid inbox observation");
      const observedAt = now();
      lastHeartbeat = new Date(observedAt).toISOString();
      const visible = new Map(rows.map((row) => [row.threadId, row]));

      const claim = change((next) => {
        if (next.enabled && health !== "healthy") next.pauseReason = health;
        for (const thread of next.threads) {
          const row = visible.get(thread.id);
          for (const turn of thread.turns) {
            if (turn.status !== "Sending" && turn.status !== "Unconfirmed") continue;
            if (
              health === "healthy" && row?.listingId === thread.listingId && turn.outgoing?.id
              && row.outgoingIds?.includes(turn.outgoing.id) && !next.hideOutgoing
            ) {
              turn.status = "Sent";
            } else if (observedAt - turn.startedAt >= CONFIRMATION_TIMEOUT_MS) {
              turn.status = "Unconfirmed";
            }
          }
        }

        if (!next.enabled || next.pauseReason || health !== "healthy" || next.health !== "healthy") return null;
        for (const thread of next.threads) {
          const row = visible.get(thread.id);
          if (!row || thread.reviewReason || thread.turns.some((turn) => ACTIVE.has(turn.status))) continue;
          const turn = thread.turns.find((candidate) => candidate.status === "Waiting");
          if (!turn || !row.incomingIds?.includes(turn.id)) continue;
          const listing = LISTINGS[thread.listingId];
          const product = marketplaceProduct(listing?.productKey || thread.productKey, turn.message || "");
          if (row.listingId !== thread.listingId || (!listing && (!turn.message || !product))) {
            turn.status = turn.message ? "Needs human" : "Unmatched";
            if (turn.message) thread.reviewReason = "No verified listing match";
            continue;
          }
          if (thread.turns.some((candidate) => candidate.status === "Already answered")) {
            turn.status = "Already answered";
            continue;
          }

          turn.attemptId = randomUUID();
          turn.startedAt = observedAt;
          if (!turn.message) {
            turn.reply = listing.reply;
            turn.status = "Sending";
            return { ready: instruction(thread, turn) };
          }

          if (!listing) thread.productKey = product;
          turn.status = "Drafting";
          return {
            pending: instruction(thread, turn),
            context: {
              product, vehicle: product === "finance" ? listing?.vehicle : undefined,
              message: turn.message, history: sentHistory(thread),
            },
          };
        }
        return null;
      });

      if (!claim?.pending) return claim?.ready ?? null;
      let result;
      try {
        result = await draftReply(claim.context);
      } catch {
        result = { reason: "Ask Me could not verify a safe answer" };
      }

      return change((next) => {
        const thread = next.threads.find((candidate) => candidate.id === claim.pending.threadId);
        const turn = thread.turns.find((candidate) => candidate.id === claim.pending.turnId);
        if (turn.status !== "Drafting" || turn.attemptId !== claim.pending.attemptId) return null;
        if (!next.enabled || next.pauseReason || next.health !== "healthy") {
          turn.status = "Ignored while off";
          return null;
        }
        if (!result?.text || result.reason) {
          thread.reviewReason = result?.reason || "Ask Me could not verify a safe answer";
          turn.status = "Needs human";
          return null;
        }
        turn.reply = result.text;
        turn.status = "Sending";
        turn.startedAt = now();
        return instruction(thread, turn);
      });
    },

    deliver({ threadId, turnId, attemptId, text }) {
      return change((next) => {
        const thread = next.threads.find((candidate) => candidate.id === threadId);
        const turn = thread?.turns.find((candidate) => candidate.id === turnId);
        if (!next.enabled || next.pauseReason || next.health !== "healthy" || thread?.reviewReason) return false;
        if (!turn || turn.status !== "Sending" || turn.attemptId !== attemptId || turn.outgoing || text !== turn.reply) return false;
        turn.outgoing = { id: randomUUID(), text };
        thread.sendCount += 1;
        return true;
      });
    },
  };
}

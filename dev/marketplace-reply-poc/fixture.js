const root = "/__marketplace-reply-poc";
const control = document.querySelector("#reply-control");
const inbox = document.querySelector("#reply-fixture-inbox");
const byId = (id) => document.getElementById(id);
const error = byId("fixture-error");

let latest;
let inboxSignature;
let busy = false;

async function request(path, data) {
  const response = await fetch(root + path, data === undefined ? {} : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}

function threadLabel(thread, listings) {
  return listings[thread.listingId]?.product || "Unknown";
}

function renderControl(state) {
  const toggle = byId("toggle");
  toggle.disabled = false;
  toggle.setAttribute("aria-pressed", String(state.enabled));
  toggle.textContent = state.enabled ? "Turn replies off" : "Turn replies on";
  byId("inbox-health").value = state.health;
  byId("hide-outgoing").checked = state.hideOutgoing;

  const recent = state.lastHeartbeat && Date.now() - Date.parse(state.lastHeartbeat) < 3_000;
  const browser = recent ? "Browser connected" : "Waiting for inbox browser";
  byId("health").textContent = state.pauseReason
    ? "Paused: " + state.pauseReason + ". Turn replies off and back on after restoring the inbox."
    : (state.enabled ? "Replies on. " : "Replies off. ") + browser + ".";

  const sent = (product) => state.threads.filter((row) => threadLabel(row, state.listings) === product && row.status === "Sent").length;
  byId("summary").textContent = "Finance sent: " + sent("Finance") + " · Rent2Buy sent: " + sent("Rent2Buy");
  byId("records").replaceChildren(...state.threads.map((thread) => {
    const row = document.createElement("tr");
    row.dataset.threadId = thread.id;
    for (const value of [thread.id, threadLabel(thread, state.listings), thread.status, thread.sendCount]) {
      row.insertCell().textContent = value;
    }
    return row;
  }));
}

function renderInbox(state) {
  inbox.dataset.fixtureHealth = state.health;
  byId("inbox-status").textContent = "Inbox condition: " + state.health;
  const signature = JSON.stringify([state.health, state.hideOutgoing, state.threads]);
  if (signature === inboxSignature) return;
  inboxSignature = signature;
  inbox.replaceChildren();
  if (state.health !== "healthy") return;

  for (const thread of state.threads) {
    const row = document.createElement("li");
    row.dataset.threadId = thread.id;
    row.dataset.listingId = thread.listingId;
    const label = document.createElement("p");
    label.textContent = thread.id + " · Listing " + thread.listingId + " · " + threadLabel(thread, state.listings);
    row.append(label);
    if (thread.outgoing && !state.hideOutgoing) {
      const outgoing = document.createElement("p");
      outgoing.dataset.outgoingId = thread.outgoing.id;
      outgoing.textContent = thread.outgoing.text;
      row.append(outgoing);
    }
    if (!thread.outgoing) {
      const form = document.createElement("form");
      const reply = document.createElement("input");
      reply.name = "reply";
      reply.required = true;
      reply.setAttribute("aria-label", "Simulated reply");
      const send = document.createElement("button");
      send.type = "submit";
      send.textContent = "Send simulated reply";
      form.append(reply, send);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!form.dataset.attemptId) return;
        send.disabled = true;
        try {
          await request("/deliver", { threadId: thread.id, attemptId: form.dataset.attemptId, text: reply.value });
          await refresh();
        } catch (failure) {
          error.textContent = failure.message;
        }
      });
      row.append(form);
    }
    inbox.append(row);
  }
}

async function refresh() {
  if (busy) return;
  busy = true;
  try {
    latest = await request("/state");
    if (control) renderControl(latest);
    if (inbox) renderInbox(latest);
  } catch (failure) {
    error.textContent = failure.message;
  } finally {
    busy = false;
  }
}

async function change(path, data) {
  try {
    await request(path, data);
    error.textContent = "";
  } catch (failure) {
    error.textContent = failure.message;
  }
  await refresh();
}

if (control) {
  byId("toggle").addEventListener("click", () => change("/control", { enabled: !latest.enabled }));
  byId("inbox-health").addEventListener("change", (event) => change("/scenario", { health: event.target.value }));
  byId("hide-outgoing").addEventListener("change", (event) => change("/scenario", { hideOutgoing: event.target.checked }));
  control.querySelectorAll("[data-enquiry]").forEach((button) => {
    button.addEventListener("click", () => change("/incoming", { scenario: button.dataset.enquiry }));
  });
}

refresh();
setInterval(refresh, 400);

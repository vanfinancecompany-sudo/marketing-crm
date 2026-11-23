const root = "/__marketplace-reply-poc";
const control = document.querySelector("#reply-control");
const inbox = document.querySelector("#reply-fixture-inbox");
const byId = (id) => document.getElementById(id);
const error = byId("fixture-error");

let latest;
let inboxSignature;
let selectionSignature;
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

  const sent = (product) => state.threads.filter((row) => threadLabel(row, state.listings) === product)
    .flatMap((thread) => thread.turns).filter((turn) => turn.status === "Sent").length;
  const human = state.threads.filter((row) => row.status === "Needs human").length;
  byId("summary").textContent = "Finance sent: " + sent("Finance") + " · Rent2Buy sent: " + sent("Rent2Buy") + " · Needs human: " + human;
  byId("records").replaceChildren(...state.threads.map((thread) => {
    const row = document.createElement("tr");
    row.dataset.threadId = thread.id;
    for (const value of [thread.id, threadLabel(thread, state.listings), thread.status, thread.sendCount, thread.reviewReason || ""]) {
      row.insertCell().textContent = value;
    }
    return row;
  }));

  const aiThreads = state.threads.filter((thread) => thread.turns[0].message);
  const signature = JSON.stringify(aiThreads.map((thread) => thread.id));
  if (selectionSignature === signature) return;
  selectionSignature = signature;
  const select = byId("follow-up-thread");
  const selected = select.value;
  select.replaceChildren(...aiThreads.map((thread) => {
    const option = document.createElement("option");
    option.value = thread.id;
    option.textContent = thread.id + " · " + threadLabel(thread, state.listings);
    return option;
  }));
  if (aiThreads.some((thread) => thread.id === selected)) select.value = selected;
  byId("follow-up").disabled = aiThreads.length === 0;
}

function replyForm(thread, turn) {
  const form = document.createElement("form");
  form.dataset.turnId = turn.id;
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
      await request("/deliver", { threadId: thread.id, turnId: turn.id, attemptId: form.dataset.attemptId, text: reply.value });
      await refresh();
    } catch (failure) {
      error.textContent = failure.message;
    }
  });
  return form;
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
    const label = document.createElement("h2");
    label.textContent = thread.id + " · Listing " + thread.listingId + " · " + threadLabel(thread, state.listings);
    row.append(label);
    for (const turn of thread.turns) {
      const incoming = document.createElement("p");
      incoming.dataset.direction = "incoming";
      incoming.dataset.turnId = turn.id;
      incoming.textContent = "Customer: " + (turn.message || "Is this van still available?");
      row.append(incoming);
      if (turn.outgoing && !state.hideOutgoing) {
        const outgoing = document.createElement("p");
        outgoing.dataset.direction = "outgoing";
        outgoing.dataset.outgoingId = turn.outgoing.id;
        outgoing.textContent = "Seller: " + turn.outgoing.text;
        row.append(outgoing);
      }
      if (!turn.outgoing && ["Waiting", "Drafting", "Sending"].includes(turn.status) && !thread.reviewReason) {
        row.append(replyForm(thread, turn));
      }
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
    await refresh();
    return true;
  } catch (failure) {
    error.textContent = failure.message;
    return false;
  }
}

if (control) {
  byId("toggle").addEventListener("click", () => change("/control", { enabled: !latest.enabled }));
  byId("inbox-health").addEventListener("change", (event) => change("/scenario", { health: event.target.value }));
  byId("hide-outgoing").addEventListener("change", (event) => change("/scenario", { hideOutgoing: event.target.checked }));
  for (const button of control.querySelectorAll("[data-enquiry]")) {
    button.addEventListener("click", () => change("/incoming", { scenario: button.dataset.enquiry }));
  }
  byId("askme-start").addEventListener("submit", async (event) => {
    event.preventDefault();
    await change("/incoming", { scenario: byId("askme-product").value, message: byId("askme-message").value });
  });
  byId("askme-follow-up").addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = byId("follow-up-message");
    if (await change("/follow-up", { threadId: byId("follow-up-thread").value, message: message.value })) message.value = "";
  });
}

refresh();
setInterval(refresh, 400);

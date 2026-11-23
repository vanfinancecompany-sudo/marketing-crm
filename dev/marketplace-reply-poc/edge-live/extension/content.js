// Runs in every Facebook tab but stays inert unless the service worker confirms
// this is the dedicated assistant tab. Reads conversation identity and message
// IDs, and only types into the composer when the local service has claimed the
// reply and re-authorises it immediately before the send control is pressed.
(() => {
  if (window.top !== window) return;
  const FIXTURE = location.hostname === "127.0.0.1";
  const THREAD_PATH = /\/messages\/t\/(\d{1,32})(?:\/|$)/;
  const LISTING_PATH = /\/marketplace\/item\/(\d{1,32})/;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const norm = (value) => String(value || "").replace(/\s+/g, " ").trim();
  let home = null;
  let busy = false;
  let queued = false;
  let debounce = null;

  const api = (path, body) => chrome.runtime.sendMessage({ type: "api", path, body }).then((reply) => {
    if (!reply || reply.error) throw new Error(reply?.error || "No reply from extension");
    return reply;
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "marker") sendResponse({ marked: sessionStorage.getItem("r2bAssistantTab") === "1" });
    if (message.type === "tick") { schedule(0); sendResponse({ ok: true }); }
  });

  chrome.runtime.sendMessage({ type: "whoami" }).then((reply) => {
    if (!reply?.assistant) return;
    home = reply.home;
    sessionStorage.setItem("r2bAssistantTab", "1");
    new MutationObserver(() => schedule(1_000)).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    setInterval(() => schedule(0), 20_000);
    schedule(1_500);
  }).catch(() => {});

  function schedule(delay) {
    clearTimeout(debounce);
    debounce = setTimeout(run, delay);
  }

  async function run() {
    if (busy) { queued = true; return; }
    busy = true;
    try {
      await tick();
    } catch (error) {
      console.debug("[r2b-assistant]", error.message);
    } finally {
      busy = false;
      if (queued) { queued = false; schedule(1_000); }
    }
  }

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  function health() {
    if (/\/checkpoint\//.test(location.pathname) || document.querySelector('form[action*="checkpoint"]')) return "security-challenge";
    if (document.querySelector('input[name="email"]') && document.querySelector('input[name="pass"]')) return "signed-out";
    if (document.readyState !== "complete") return "loading";
    return "healthy";
  }

  function threadUrl(id) {
    return FIXTURE ? location.origin + "/__fb/messages/t/" + id + "/" : "https://www.facebook.com/messages/t/" + id + "/";
  }

  // Unread signals seen in Facebook's chat list. Text is never sent anywhere.
  function isUnread(row) {
    const labels = [row, ...row.querySelectorAll("[aria-label]")].map((el) => el.getAttribute("aria-label") || "").join(" | ");
    if (/\bunread\b|\bmark as read\b/i.test(labels)) return true;
    if ([...row.querySelectorAll("span")].some((el) => /^unread message:?$/i.test(norm(el.textContent)))) return true;
    return false;
  }

  function scanInbox() {
    const rows = new Map();
    for (const link of document.querySelectorAll("a[href]")) {
      let path;
      try { path = new URL(link.getAttribute("href"), location.href).pathname; } catch { continue; }
      const id = path.match(THREAD_PATH)?.[1];
      if (!id || rows.has(id)) continue;
      const row = link.closest('[role="row"], [role="listitem"]') || link;
      rows.set(id, { id, unread: isUnread(row) });
    }
    return [...rows.values()];
  }

  function chatLog() {
    return [...document.querySelectorAll('[role="log"], [role="grid"][aria-label*="essages"]')].find(visible) || null;
  }

  function direction(node, logRect) {
    const row = node.closest('[role="row"]') || node;
    const labels = [row, ...row.querySelectorAll("[aria-label], h4, h5, h6")]
      .map((el) => el.getAttribute("aria-label") || (el.matches("h4, h5, h6") ? el.textContent : "") || "").join(" | ");
    if (/\byou sent\b|\byou:/i.test(labels)) return "outgoing";
    if (/\bsent\b/i.test(labels)) return "incoming";
    const bubble = node.querySelector('[dir="auto"]') || node;
    const r = bubble.getBoundingClientRect();
    if (!r.width) return "unknown";
    return r.left + r.width / 2 > logRect.left + logRect.width / 2 ? "outgoing" : "incoming";
  }

  function messageText(node) {
    const parts = [...node.querySelectorAll('[dir="auto"]')]
      .filter((el) => !el.querySelector('[dir="auto"]'))
      .map((el) => norm(el.innerText));
    return (parts.filter(Boolean).join("\n") || norm(node.innerText)).slice(0, 2000);
  }

  function collectMessages(log) {
    const byId = new Map();
    for (const node of log.querySelectorAll("[data-message-id]")) {
      const id = node.getAttribute("data-message-id");
      if (id && !byId.has(id)) byId.set(id, node);
    }
    const logRect = log.getBoundingClientRect();
    return [...byId].map(([id, node]) => ({ id, direction: direction(node, logRect), text: messageText(node) }));
  }

  function listing() {
    const link = [...document.querySelectorAll("a[href]")].find((a) => LISTING_PATH.test(a.getAttribute("href") || "") && visible(a));
    const header = document.querySelector('[role="main"] h1, [role="main"] h2, [data-r2b-thread-title]');
    return {
      listingId: link?.getAttribute("href").match(LISTING_PATH)?.[1] || null,
      listingTitle: norm(link?.innerText || header?.textContent || "").slice(0, 200),
    };
  }

  const composer = () => [...document.querySelectorAll('[role="textbox"][contenteditable="true"]')].find(visible) || null;
  const sendButton = () => [...document.querySelectorAll('[aria-label]')]
    .find((el) => /^(press enter to send|send)$/i.test(el.getAttribute("aria-label")) && visible(el)) || null;

  async function tick() {
    const state = health();
    const threadId = location.pathname.match(THREAD_PATH)?.[1] || null;
    const inbox = state === "healthy" ? scanInbox() : [];
    const beat = await api("/heartbeat", {
      health: state, visibility: document.visibilityState, url: location.pathname,
      rows: inbox.length, unread: inbox.filter((row) => row.unread).length,
    });
    if (beat.mode === "off" || state !== "healthy") return;

    if (threadId) {
      await handleThread(threadId);
      return;
    }
    const { open } = await api("/inbox", { threads: inbox });
    if (open) location.assign(threadUrl(open));
  }

  async function handleThread(threadId) {
    let log = null;
    for (let i = 0; i < 20 && !(log = chatLog())?.querySelector("[data-message-id]"); i++) await sleep(500);
    // An open conversation marks new messages as read, so the inbox will never
    // flag them. Keep reporting until the message IDs stop changing.
    let lastIds = null;
    for (let round = 0; round < 8; round++) {
      log = chatLog() || log;
      const messages = log ? collectMessages(log) : [];
      const ids = messages.map((m) => m.id).join(",");
      if (ids === lastIds) break;
      lastIds = ids;
      const decision = await api("/thread", { threadId, messages, ...listing() });
      if (decision.action === "send") await sendReply(decision, log);
      await sleep(2_000);
    }
    if (home && !location.href.startsWith(home)) location.assign(home);
  }

  function typeInto(box, text) {
    box.focus();
    const lines = text.split("\n");
    lines.forEach((line, index) => {
      if (index) document.execCommand("insertLineBreak");
      if (line) document.execCommand("insertText", false, line);
    });
  }

  function clear(box) {
    box.focus();
    document.execCommand("selectAll");
    document.execCommand("delete");
  }

  async function sendReply({ jobId, text }, log) {
    // Never press send twice for the same claim, even across a page reload.
    const attempted = JSON.parse(sessionStorage.getItem("r2bAttempted") || "[]");
    if (attempted.includes(jobId)) return;
    sessionStorage.setItem("r2bAttempted", JSON.stringify([...attempted, jobId].slice(-200)));

    const box = composer();
    if (!box || !log) return api("/sent", { jobId, confirmed: false, error: "Composer not found" });
    if (norm(box.innerText)) return api("/sent", { jobId, confirmed: false, error: "Composer already contains text" });
    typeInto(box, text);
    await sleep(400);
    if (norm(box.innerText) !== norm(text)) {
      clear(box);
      return api("/sent", { jobId, confirmed: false, error: "Reply text did not insert cleanly" });
    }
    const go = await api("/go", { jobId });
    if (!go.go) { clear(box); return; }

    const before = new Set(collectMessages(log).map((m) => m.id));
    const button = sendButton();
    if (button) button.click();
    else box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));

    const head = norm(text).slice(0, 40).toLowerCase();
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      const sent = collectMessages(chatLog() || log).find((m) => !before.has(m.id) && m.direction === "outgoing" && norm(m.text).toLowerCase().startsWith(head));
      if (sent) return api("/sent", { jobId, confirmed: true, outgoingId: sent.id });
    }
    return api("/sent", { jobId, confirmed: false, error: "No outgoing message appeared after sending" });
  }
})();

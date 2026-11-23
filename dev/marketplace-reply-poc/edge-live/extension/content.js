// Runs in every Facebook tab but stays inert unless the service worker confirms
// this is the dedicated assistant tab. Reads conversation identity and message
// IDs, and only types into the composer when the local service has claimed the
// reply and re-authorises it immediately before the send control is pressed.
(() => {
  if (window.top !== window) return;
  const FIXTURE = location.hostname === "127.0.0.1";
  // Thread links seen on Facebook: /messages/t/<id>, /messages/e2ee/t/<id>, /marketplace/t/<id>.
  const THREAD_PATH = /\/(?:messages\/(?:e2ee\/)?|marketplace\/)t\/(\d{1,32})(?:\/|$)/;
  const MAX_ROW_HEIGHT = 320;
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
    // Read-only snapshot requested from the popup for this tab.
    if (message.type === "diagnose") {
      try { sendResponse({ snapshot: diagnose() }); } catch (error) { sendResponse({ error: error.message }); }
    }
  });

  // Brought to the front (visibility assist or the owner): act at once.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) { lastOpenAt = 0; schedule(0); }
  });

  chrome.runtime.sendMessage({ type: "whoami" }).then((reply) => {
    if (!reply?.assistant) return;
    home = reply.home;
    sessionStorage.setItem("r2bAssistantTab", "1");
    new MutationObserver(() => schedule(1_000)).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    setInterval(() => schedule(0), 20_000);
    schedule(1_500);
  }).catch(() => {});

  // Facebook mutates the DOM constantly; scan at most every 3 seconds.
  let lastRunAt = 0;
  function schedule(delay) {
    clearTimeout(debounce);
    debounce = setTimeout(run, Math.max(delay, lastRunAt + 3_000 - Date.now()));
  }

  async function run() {
    if (busy) { queued = true; return; }
    busy = true;
    lastRunAt = Date.now();
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

  // ---- Conversation list (read-only) ----
  // A row is the largest ancestor of a thread link that contains links to that
  // one conversation only. Facebook's lists often lack per-row roles, and the
  // nearest [role=row|listitem] can be a container shared by every conversation.
  // Live finding (23 Nov 2026, 20:04): Facebook keeps the Messenger panel and its
  // conversation rows in the page when the panel is CLOSED, at zero size. Only
  // rendered (non-zero) links count; hidden ones are reported in diagnostics.
  function threadLinks({ includeHidden = false } = {}) {
    const found = [];
    for (const link of document.querySelectorAll("a[href]")) {
      let url;
      try { url = new URL(link.getAttribute("href"), location.href); } catch { continue; }
      const id = url.pathname.match(THREAD_PATH)?.[1];
      if (id && (includeHidden || visible(link))) found.push({ link, id, pattern: url.pathname.replace(/\d{3,}/g, "#") });
    }
    return found;
  }

  function rowsFromLinks(links) {
    const idsUnder = new Map();
    for (const { link, id } of links) {
      for (let el = link; el && el !== document.body; el = el.parentElement) {
        let ids = idsUnder.get(el);
        if (!ids) idsUnder.set(el, (ids = new Set()));
        ids.add(id);
      }
    }
    const rows = new Map();
    for (const item of links) {
      if (rows.has(item.id)) continue;
      let row = item.link;
      while (row.parentElement && row.parentElement !== document.body && idsUnder.get(row.parentElement)?.size === 1
        && row.parentElement.getBoundingClientRect().height <= MAX_ROW_HEIGHT) row = row.parentElement;
      rows.set(item.id, { ...item, row, group: row.parentElement });
    }
    return [...rows.values()];
  }

  const UNREAD_LABEL = (label) => (/\bunread\b/i.test(label) && !/\bmark(?:ed)? as unread\b/i.test(label)) || /\bmark as read\b/i.test(label);

  function rowSignals(row) {
    const labels = [row, ...row.querySelectorAll("[aria-label]")].map((el) => el.getAttribute("aria-label") || "").filter(Boolean);
    const hiddenUnreadText = [...row.querySelectorAll("span")].some((el) => /^unread(?: message)?:?$/i.test(norm(el.textContent)));
    let dot = null;
    let snippetWeight = 0;
    let maxWeight = 0;
    let textLeaves = 0;
    for (const el of row.querySelectorAll("*")) {
      const style = getComputedStyle(el);
      if (!el.children.length && norm(el.textContent)) {
        const weight = Number(style.fontWeight) || 400;
        textLeaves++;
        snippetWeight = weight; // last text leaf in document order: the message preview
        maxWeight = Math.max(maxWeight, weight);
      }
      if (!dot && !norm(el.textContent)) {
        const r = el.getBoundingClientRect();
        const m = style.backgroundColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (m && r.width >= 6 && r.width <= 16 && Math.abs(r.width - r.height) <= 1 && parseFloat(style.borderRadius) >= r.width / 2 - 1
            && Number(m[3]) >= 150 && Number(m[3]) - Number(m[1]) >= 60) dot = style.backgroundColor;
      }
    }
    return { labels, label: labels.some(UNREAD_LABEL) || hiddenUnreadText, dot, snippetWeight, maxWeight, textLeaves };
  }

  // Observed on the real account (Edge, 23 Nov 2026): an unread conversation
  // shows a round blue dot, rgb(0, 100, 209), and its name in weight 600; read
  // ones have no dot and weight 500. Both agreed on all 60 captured rows.
  // Bold is only meaningful relative to other rows in the same list.
  function classify(rows) {
    const minWeight = new Map();
    for (const r of rows) {
      r.signals = rowSignals(r.row);
      minWeight.set(r.group, Math.min(minWeight.get(r.group) ?? 1000, r.signals.maxWeight || 1000));
    }
    for (const r of rows) {
      const s = r.signals;
      s.groupMinWeight = minWeight.get(r.group);
      s.bold = s.maxWeight >= 600 && s.maxWeight > s.groupMinWeight;
      r.unread = Boolean(s.label || s.dot || s.bold);
    }
    return rows;
  }

  // pos = order within its list, so the service can tell new arrivals (top)
  // from old conversations Facebook renders lazily further down.
  // grid = the list's name ("marketplace", "chats" or "other"). A conversation
  // shown in both lists counts once, as Marketplace. Only the top rows of each
  // list are classified: new activity always arrives at the top, and the live
  // Marketplace list grows to hundreds of rows as Facebook loads it.
  const ROWS_PER_LIST = 100;
  const gridName = (el) => {
    const label = norm(el.closest('[role="grid"][aria-label]')?.getAttribute("aria-label")).toLowerCase();
    return label === "marketplace" ? "marketplace" : label === "chats" ? "chats" : "other";
  };
  function inboxRows() {
    const links = threadLinks().map((l) => ({ ...l, grid: gridName(l.link) }));
    const inMarketplace = new Set(links.filter((l) => l.grid === "marketplace").map((l) => l.id));
    const kept = links.filter((l) => l.grid === "marketplace" || !inMarketplace.has(l.id));
    const counters = new Map();
    const limited = [];
    for (const r of rowsFromLinks(kept)) {
      const grid = r.grid || "other";
      const pos = counters.get(grid) ?? 0;
      counters.set(grid, pos + 1);
      if (pos < ROWS_PER_LIST) limited.push({ ...r, grid, pos });
    }
    return classify(limited);
  }
  function scanInbox() {
    return inboxRows().map(({ id, unread, pos, grid }) => ({ id, unread, pos, grid }));
  }

  // Pilot check: the visible list-row text of ONE named conversation, so the
  // service can confirm it is the expected test conversation before opening it.
  // Finder: match words against every visible Marketplace row inside the page;
  // only IDs, positions and unread state are reported, never row text.
  async function reportFind(words) {
    const wanted = norm(words).toLowerCase();
    const links = threadLinks().map((l) => ({ ...l, grid: gridName(l.link) })).filter((l) => l.grid === "marketplace");
    const rows = rowsFromLinks(links);
    const matches = classify(rows.map((r, pos) => ({ ...r, pos })).filter((r) => norm(r.row.innerText).toLowerCase().includes(wanted)))
      .map((r) => ({ id: r.id, pos: r.pos, grid: r.grid, unread: r.unread }));
    await api("/find/result", { words, matches, searched: rows.length });
  }

  async function reportPilotRow(threadId) {
    const row = inboxRows().find((r) => r.id === threadId);
    await api("/pilot/verify", { threadId, found: Boolean(row), rowText: row ? norm(row.row.innerText).slice(0, 300) : "" });
  }

  // ---- Keeping the conversation list open (list controls only) ----
  // Real account: Messenger icon (top right) -> Marketplace. Only two kinds of
  // control are ever clicked: the header Messenger/Chats button and a
  // "Marketplace" control inside the panel it opens. Anything that is a link to
  // another page, or sits inside a single conversation's row, is never clicked.
  // If the page changes or a conversation view appears after a click, the
  // opener disables itself for this tab.
  const threadIdOf = (a) => {
    try { return new URL(a.getAttribute("href"), location.href).pathname.match(THREAD_PATH)?.[1] || null; } catch { return null; }
  };
  function namedGrid(pattern) {
    return [...document.querySelectorAll('[role="grid"][aria-label]')]
      // A closed panel keeps its grids in the page at zero size: those do not count.
      .find((g) => pattern.test(norm(g.getAttribute("aria-label"))) && visible(g) && [...g.querySelectorAll("a[href]")].some(threadIdOf)) || null;
  }
  function safeToClick(el) {
    const anchor = el.closest("a[href]");
    if (anchor && !(anchor.getAttribute("href") || "").startsWith("#")) return false;
    if ([...el.querySelectorAll("a[href]")].some(threadIdOf)) return false;
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
      const ids = new Set([...node.querySelectorAll("a[href]")].map(threadIdOf).filter(Boolean));
      if (ids.size === 1) return false; // inside one conversation's row
      if (ids.size > 1) break;          // reached a list of conversations
    }
    return true;
  }
  const conversationSurfaces = () => [...document.querySelectorAll('[role="log"], [role="textbox"][contenteditable="true"]')].filter(visible).length;
  // Where conversation views are: inside the main view or the Messenger panel
  // (opened by a click on a conversation), or docked chat windows. Live (20:52):
  // Facebook restores the owner's docked chat windows a few seconds after a
  // reload, which tripped the safety stop on a Messenger-button click.
  function surfaceCounts() {
    const views = [...document.querySelectorAll('[role="log"]')].filter(visible);
    const inPanelOrMain = views.filter((el) => el.closest('[role="main"], [role="dialog"][aria-label]')?.matches('[role="main"]')
      || /^messenger$/i.test(norm(el.closest('[role="dialog"][aria-label]')?.getAttribute("aria-label")))).length;
    return { total: conversationSurfaces(), inPanelOrMain, docked: views.length - inPanelOrMain };
  }
  // No clicks until the page has settled: 10 s after load and 8 s without any
  // change in conversation views, so restored docked windows are counted first.
  const pageLoadedAt = Date.now();
  let lastSurfaceTotal = -1;
  let surfacesStableSince = Date.now();
  function pageSettled() {
    const total = conversationSurfaces();
    if (total !== lastSurfaceTotal) { lastSurfaceTotal = total; surfacesStableSince = Date.now(); }
    return Date.now() - pageLoadedAt >= 10_000 && Date.now() - surfacesStableSince >= 8_000;
  }
  const MESSENGER_LABEL = /^(?:messenger|chats|messages)\b/i;
  function messengerButton() {
    const found = [...document.querySelectorAll("[aria-label]")].filter((el) => MESSENGER_LABEL.test(norm(el.getAttribute("aria-label")))
      && el.matches('[role="button"], [role="link"], button, a') && visible(el) && safeToClick(el));
    return found.find((el) => el.closest('[role="banner"]')) || found[0] || null;
  }
  // The Messenger panel (live: div role=dialog label=Messenger) that holds the Chats grid.
  function messengerPanel() {
    const grid = namedGrid(/^chats$/i);
    if (!grid) return null;
    let scope = grid;
    for (let i = 0; i < 12 && scope.parentElement && scope.parentElement !== document.body; i++) {
      scope = scope.parentElement;
      if (scope.matches('[role="dialog"]') || getComputedStyle(scope).position === "fixed") break;
    }
    return scope;
  }
  // The live panel has no control whose whole text is "Marketplace"; the entry
  // carries extra text (for example a new-message count). Accept any clickable
  // element inside the panel whose label or text STARTS with "Marketplace".
  const CLICKABLE = 'a, button, [role="button"], [role="link"], [role="tab"], [role="row"], [role="gridcell"], [role="menuitem"], [role="option"], [role="radio"], [tabindex]';
  const ROLE_RANK = { tab: 0, button: 1, link: 2, menuitem: 3, option: 4, radio: 5, gridcell: 6, row: 7 };
  function marketplaceCandidates() {
    const panel = messengerPanel();
    if (!panel) return [];
    const seen = new Set();
    const out = [];
    for (const el of panel.querySelectorAll("*")) {
      const label = norm(el.getAttribute("aria-label"));
      const text = norm(el.textContent);
      if (!/^marketplace\b/i.test(label) && !(/^marketplace\b/i.test(text) && text.length <= 80)) continue;
      const target = el.matches(CLICKABLE) ? el : el.closest(CLICKABLE);
      if (!target || seen.has(target) || !panel.contains(target) || target === panel || target.matches('[role="grid"], [role="dialog"]')) continue;
      seen.add(target);
      out.push(target);
    }
    return out;
  }
  function marketplaceControl() {
    return marketplaceCandidates()
      .filter((el) => visible(el) && el.getBoundingClientRect().height <= 120 && safeToClick(el))
      .sort((a, b) => (ROLE_RANK[a.getAttribute("role")] ?? 8) - (ROLE_RANK[b.getAttribute("role")] ?? 8))[0] || null;
  }
  function listState() {
    if (namedGrid(/^marketplace$/i)) return "marketplace";
    if (namedGrid(/^chats$/i)) return openerStatus === "no-marketplace-control" ? "chats-only" : "chats";
    return "none";
  }
  const listReady = (list) => list === "marketplace" || list === "chats-only";

  // Live finding (23 Nov 2026, 20:15-20:18): clicking the Marketplace entry's
  // outer element (div role=button) had no effect, retried every 15 s; the
  // handler sits on an inner element and a click event only bubbles UP. Click
  // the way a mouse does: on the element actually under the entry's centre, so
  // the event passes every handler on the way up. Strategies escalate per retry.
  const CLICK_STRATEGIES = ["centre", "pointer", "outer"];
  function innerAt(target) {
    const r = target.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const el = document.elementFromPoint(x, y);
    return { el: el && target.contains(el) && safeToClick(el) ? el : target, x, y };
  }
  function clickLikeMouse(target, strategy) {
    if (strategy === "outer") { target.click(); return; }
    const { el, x, y } = innerAt(target);
    if (strategy === "pointer") {
      const base = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, button: 0, pointerId: 1, pointerType: "mouse", isPrimary: true };
      el.dispatchEvent(new PointerEvent("pointerdown", { ...base, buttons: 1 }));
      el.dispatchEvent(new MouseEvent("mousedown", { ...base, buttons: 1 }));
      el.dispatchEvent(new PointerEvent("pointerup", { ...base, buttons: 0 }));
      el.dispatchEvent(new MouseEvent("mouseup", { ...base, buttons: 0 }));
    }
    el.click();
  }

  let openerStatus = "";
  let lastOpenAt = 0;
  let messengerMisses = 0;
  let marketplaceMisses = 0;
  async function ensureChatList() {
    if (sessionStorage.getItem("r2bOpenerTripped") === "1") return (openerStatus = "disabled: " + (sessionStorage.getItem("r2bOpenerTripReason") || "a conversation view appeared after a click"));
    if (namedGrid(/^marketplace$/i)) { messengerMisses = 0; marketplaceMisses = 0; return (openerStatus = "present"); }
    const backoff = messengerMisses >= 3 ? 600_000 : 15_000;
    if (!pageSettled()) return (openerStatus = "waiting for the page to settle");
    if (Date.now() - lastOpenAt < backoff) return openerStatus;
    lastOpenAt = Date.now();
    const before = { path: location.pathname, ...surfaceCounts() };
    const chatsOpen = Boolean(namedGrid(/^chats$/i));
    const target = chatsOpen ? marketplaceControl() : messengerButton();
    if (!target) return (openerStatus = chatsOpen ? "no-marketplace-control" : "no-messenger-button");
    const strategy = CLICK_STRATEGIES[marketplaceMisses % CLICK_STRATEGIES.length];
    if (chatsOpen) clickLikeMouse(target, strategy);
    else target.click(); // the Messenger button responds to a plain click (live)
    await sleep(2_500);
    const after = surfaceCounts();
    const why = location.pathname !== before.path || THREAD_PATH.test(location.pathname) ? "the page changed after a click"
      : after.inPanelOrMain > before.inPanelOrMain ? "a conversation opened in the panel or main view after a click"
      : after.docked > before.docked ? "a new docked chat window appeared after a click (" + before.docked + " -> " + after.docked + ")"
      : null;
    if (why) {
      sessionStorage.setItem("r2bOpenerTripReason", why);
      sessionStorage.setItem("r2bOpenerTripped", "1");
      return (openerStatus = "tripped: " + why + "; opener disabled");
    }
    if (!chatsOpen) messengerMisses = namedGrid(/^chats$/i) ? 0 : messengerMisses + 1;
    if (messengerMisses >= 3) return (openerStatus = "messenger-panel-not-found");
    if (chatsOpen) {
      if (namedGrid(/^marketplace$/i)) return (openerStatus = "clicked Marketplace (" + strategy + ")");
      marketplaceMisses++;
      // Rendering is paused in a hidden tab; ask for a brief idle-only assist.
      if (marketplaceMisses >= 2 && document.hidden) chrome.runtime.sendMessage({ type: "need-visibility" }).catch(() => {});
      return (openerStatus = "Marketplace click had no effect (" + strategy + "), attempt " + marketplaceMisses);
    }
    return (openerStatus = "clicked Messenger");
  }

  // ---- Read-only diagnostics ----
  // Structure only: no message text, names or previews leave the page. Labels
  // keep known UI words; every other word becomes "•".
  const KEEP = new Set("messenger communities a as at by chat chats conversation conversations delivered for from in inbox mark marketplace menu message messages more new of on options read seen selling buying sent to unread you your listings actions settings close open search".split(" "));
  const redact = (label) => norm(label).slice(0, 80).split(" ").map((w) => (KEEP.has(w.toLowerCase().replace(/[^a-z]/g, "")) ? w : "•")).join(" ");
  function describe(el) {
    if (!el) return null;
    const label = el.getAttribute("aria-label");
    return [el.tagName.toLowerCase(), el.getAttribute("role") && "role=" + el.getAttribute("role"), label && "label=" + redact(label)].filter(Boolean).join(" ");
  }
  function landmark(el) {
    for (let node = el; node && node !== document.body; node = node.parentElement) {
      if (node.matches('[role="navigation"], [role="complementary"], [role="main"], [role="dialog"], [role="grid"], [role="list"], [aria-label]')
          && node.querySelectorAll("a[href]").length > 1) return node;
    }
    return null;
  }

  // Ancestors of a list that carry a role, a label or fixed positioning: shows
  // whether the list sits in the page itself or in a pop-up panel.
  function trail(el) {
    const out = [];
    for (let node = el?.parentElement; node && node !== document.body && out.length < 8; node = node.parentElement) {
      const position = getComputedStyle(node).position;
      if (node.getAttribute("role") || node.getAttribute("aria-label") || position === "fixed" || position === "sticky") {
        out.push(describe(node) + (position === "fixed" || position === "sticky" ? " pos=" + position : ""));
      }
    }
    return out;
  }

  function diagnose() {
    const links = threadLinks();
    const rows = classify(rowsFromLinks(links));
    const patterns = {};
    for (const a of document.querySelectorAll("a[href]")) {
      let url;
      try { url = new URL(a.getAttribute("href"), location.href); } catch { continue; }
      if (!/messages|marketplace|\/t\//.test(url.pathname)) continue;
      const key = url.pathname.replace(/\d{3,}/g, "#").slice(0, 60);
      patterns[key] = (patterns[key] || 0) + 1;
    }
    const groups = new Map();
    for (const r of rows) {
      const mark = landmark(r.row);
      const key = describe(mark) || "none";
      const g = groups.get(key) || { landmark: key, rows: 0, unread: 0, visible: 0, dot: 0, bold: 0, disagree: 0, trail: trail(mark) };
      g.rows++;
      if (r.unread) g.unread++;
      if (r.signals.dot) g.dot++;
      if (r.signals.bold) g.bold++;
      if (Boolean(r.signals.dot) !== r.signals.bold) g.disagree++;
      if (visible(r.row)) g.visible++;
      groups.set(key, g);
    }
    const unreadLabels = {};
    for (const el of document.querySelectorAll("[aria-label]")) {
      const label = el.getAttribute("aria-label");
      if (/\bunread\b|\bmark as\b|\bnew message/i.test(label)) unreadLabels[redact(label)] = (unreadLabels[redact(label)] || 0) + 1;
    }
    const headings = [...document.querySelectorAll('h1, h2, h3, [role="heading"]')].map((h) => redact(h.textContent)).filter((t) => t && !/^[•\s]+$/.test(t)).slice(0, 20);
    return {
      at: new Date().toISOString(),
      path: location.pathname.replace(/\d{3,}/g, "#"),
      titleCount: Number(document.title.match(/^\((\d+)\)/)?.[1] || 0),
      visibility: document.visibilityState,
      threadLinkPatterns: [...new Set(links.map((l) => l.pattern))],
      hiddenThreadLinks: threadLinks({ includeHidden: true }).length - links.length,
      messengerPanelVisible: [...document.querySelectorAll('[role="dialog"][aria-label]')].some((d) => /^messenger$/i.test(norm(d.getAttribute("aria-label"))) && visible(d)),
      list: listState(),
      opener: openerStatus,
      chatWindows: [...document.querySelectorAll('[role="log"]')].filter(visible).length,
      marketplaceCandidates: marketplaceCandidates().slice(0, 12).map((el) => {
        const anchor = el.closest("a[href]");
        let href = null;
        try { href = anchor ? new URL(anchor.getAttribute("href"), location.href).pathname.replace(/\d{3,}/g, "#") : null; } catch {}
        const r = el.getBoundingClientRect();
        return { el: describe(el), text: redact(el.textContent).slice(0, 40), href, size: [Math.round(r.width), Math.round(r.height)], safe: safeToClick(el), visible: visible(el) };
      }),
      controls: [...document.querySelectorAll("[aria-label], [role=tab], [role=button], a[href]")]
        .filter((el) => /^(?:messenger|chats|messages|marketplace)\b/i.test(norm(el.getAttribute("aria-label") || (el.children.length <= 3 ? el.textContent : ""))))
        .slice(0, 25).map((el) => {
          const anchor = el.closest("a[href]");
          let href = null;
          try { href = anchor ? new URL(anchor.getAttribute("href"), location.href).pathname.replace(/\d{3,}/g, "#") : null; } catch {}
          return { el: describe(el), text: redact(el.children.length <= 3 ? el.textContent : "").slice(0, 30), href, safe: safeToClick(el), banner: Boolean(el.closest('[role="banner"]')), visible: visible(el) };
        }),
      linkPatterns: patterns,
      groups: [...groups.values()],
      headings,
      unreadLabels,
      rows: rows.slice(0, 60).map((r) => {
        const rect = r.row.getBoundingClientRect();
        return {
          id: r.id,
          pattern: r.pattern,
          unread: r.unread,
          visible: rect.width > 0 && rect.height > 0,
          size: [Math.round(rect.width), Math.round(rect.height)],
          row: describe(r.row),
          landmark: describe(landmark(r.row)),
          signals: {
            label: r.signals.label, dot: r.signals.dot, bold: r.signals.bold,
            snippetWeight: r.signals.snippetWeight, maxWeight: r.signals.maxWeight, groupMinWeight: r.signals.groupMinWeight,
            textLeaves: r.signals.textLeaves, labels: [...new Set(r.signals.labels.map(redact))].slice(0, 6),
          },
        };
      }),
    };
  }

  let lastDiagnosticAt = 0;
  async function sendDiagnostics(source) {
    lastDiagnosticAt = Date.now();
    await api("/diagnostics", { source, snapshot: diagnose() });
  }

  // Prefer the conversation in the main view: Facebook mirrors docked chat
  // windows from the owner's other tabs into this one (seen live).
  function chatLog() {
    const logs = [...document.querySelectorAll('[role="log"], [role="grid"][aria-label*="essages"]')].filter(visible);
    return logs.find((el) => el.closest('[role="main"]')) || logs[0] || null;
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
    pageSettled(); // track conversation-view stability on every scan
    let inbox = state === "healthy" ? scanInbox() : [];
    const beat = await api("/heartbeat", {
      health: state, visibility: document.visibilityState, url: location.pathname,
      rows: inbox.length, unread: inbox.filter((row) => row.unread).length, list: listState(), opener: openerStatus,
      ext: chrome.runtime.getManifest().version,
    });
    if (beat.mode === "off" || state !== "healthy") return;
    if (beat.verifyThread && !threadId && listState() === "marketplace") await reportPilotRow(beat.verifyThread);
    if (beat.findWords && !threadId && listState() === "marketplace") await reportFind(beat.findWords);
    // The owner reset the safety stop after checking it was a false trip.
    if (beat.resetOpener && sessionStorage.getItem("r2bOpenerTripped") === "1") {
      sessionStorage.removeItem("r2bOpenerTripped");
      sessionStorage.removeItem("r2bOpenerTripReason");
      openerStatus = "safety stop reset";
      lastOpenAt = 0;
    }

    if (threadId) {
      // Observe never stays on a conversation page; leaving does not change read status.
      if (beat.mode === "observe") { if (home && !location.href.startsWith(home)) location.assign(home); return; }
      await handleThread(threadId);
      return;
    }

    // Keep the conversation list open: list controls only, never a conversation.
    if (listState() !== "marketplace") {
      await ensureChatList();
      inbox = scanInbox();
    } else {
      openerStatus = "present";
    }
    const ready = listReady(listState());

    if (beat.mode === "observe") {
      // Passive: report list and unread indicators only.
      await api("/inbox", { threads: inbox, listReady: ready, list: listState() });
      if (Date.now() - lastDiagnosticAt > 60_000) await sendDiagnostics("assistant-tab");
      return;
    }
    const { open } = await api("/inbox", { threads: inbox, listReady: ready, list: listState() });
    if (open) location.assign(threadUrl(open));
  }

  // Structure of the opened conversation (no text): proves which identity and
  // direction signals Facebook exposes on this account.
  function threadStructure(log, messages) {
    if (!log) return { logFound: false, composer: Boolean(composer()) };
    const attrs = new Set();
    for (const el of log.querySelectorAll("*")) for (const a of el.getAttributeNames()) if (a.startsWith("data-")) attrs.add(a);
    let labelled = 0;
    for (const node of log.querySelectorAll("[data-message-id]")) {
      const row = node.closest('[role="row"]') || node;
      const labels = [row, ...row.querySelectorAll("[aria-label], h4, h5, h6")].map((el) => el.getAttribute("aria-label") || (el.matches("h4, h5, h6") ? el.textContent : "") || "").join(" | ");
      if (/\bsent\b|\byou:/i.test(labels)) labelled++;
    }
    return {
      logFound: true,
      logInMain: Boolean(log.closest('[role="main"]')),
      rows: log.querySelectorAll('[role="row"]').length,
      withMessageId: log.querySelectorAll("[data-message-id]").length,
      directions: {
        incoming: messages.filter((m) => m.direction === "incoming").length,
        outgoing: messages.filter((m) => m.direction === "outgoing").length,
        unknown: messages.filter((m) => !["incoming", "outgoing"].includes(m.direction)).length,
      },
      directionFromLabels: labelled,
      dataAttributes: [...attrs].slice(0, 20),
      composer: Boolean(composer()),
      listingLink: Boolean(listing().listingId),
    };
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
      const decision = await api("/thread", { threadId, messages, ...listing(), structure: threadStructure(log, messages) });
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

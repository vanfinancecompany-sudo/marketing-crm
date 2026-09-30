(() => {
  if (window.__VFC_MARKETPLACE_MANAGER_BOOTED__) return;
  if (!/^\/marketplace\/you\/selling\/?/i.test(window.location.pathname)) return;
  window.__VFC_MARKETPLACE_MANAGER_BOOTED__ = true;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const state = {
    rows: [],
    context: { registry: [], stock: {} },
    running: false,
    productFilter: "all",
    renewSeen: new Set(),
  };

  function fold(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[’'\`]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function visible(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  }

  function itemIdentity(href) {
    try {
      const url = new URL(href, window.location.origin);
      const match = url.pathname.match(/^\/marketplace\/item\/([^/?#]+)/i);
      if (!match) return null;
      return {
        itemId: match[1],
        listingUrl: `https://www.facebook.com/marketplace/item/${match[1]}/`,
      };
    } catch {
      return null;
    }
  }

  function listingActionLabel(element) {
    return fold([
      element?.getAttribute?.("aria-label"),
      element?.getAttribute?.("title"),
      element?.innerText,
      element?.textContent,
    ].filter(Boolean).join(" "));
  }

  function isListingAction(element) {
    const label = listingActionLabel(element);
    return (
      label.includes("mark as sold") ||
      label.includes("boost listing") ||
      label.includes("renew your listing")
    );
  }

  function nearestListingCard(seed) {
    let node = seed;
    for (let depth = 0; depth < 12 && node?.parentElement; depth += 1) {
      node = node.parentElement;
      const text = fold(node.innerText || node.textContent);
      const hasSold = text.includes("mark as sold");
      const hasBoost = text.includes("boost listing");
      const hasRenewTip = text.includes("renew your listing");
      const actionCount = [...(node.querySelectorAll?.('button,[role="button"]') || [])]
        .filter(isListingAction)
        .length;
      if ((hasSold && hasBoost) || (hasRenewTip && actionCount >= 1) || actionCount >= 2) return node;
    }
    return seed?.closest?.('[role="article"]') || seed?.parentElement || null;
  }

  function listingItemLink(card) {
    return [...(card?.querySelectorAll?.('a[href*="/marketplace/item/"]') || [])]
      .find((link) => itemIdentity(link.href)) || null;
  }

  function listingTitle(card, link) {
    const direct = String(link?.innerText || link?.textContent || "").trim();
    if (direct && direct.length > 4) return direct.split("\n").map((line) => line.trim()).find(Boolean) || direct;
    const lines = String(card?.innerText || card?.textContent || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    return (
      lines.find((line) => /rent2buyvans\.co\.uk|vanfinancecompany\.co\.uk/i.test(line)) ||
      lines.find((line) => /^20\d{2}\s+/.test(line) && !/^£/.test(line)) ||
      lines[0] ||
      "Marketplace listing"
    );
  }

  function classifyProduct(text, registryEntry) {
    const explicit = fold(registryEntry?.pipeline || registryEntry?.postingDestination || "");
    if (explicit.includes("rent2buy")) return "rent2buy";
    if (explicit.includes("finance")) return "finance";
    const value = fold(text);
    if (value.includes("rent2buyvans.co.uk") || value.includes("rent2buy")) return "rent2buy";
    if (value.includes("vanfinancecompany.co.uk") || value.includes("deposit from £99")) return "finance";
    return "unknown";
  }

  function registryByItemId() {
    const map = new Map();
    for (const item of state.context.registry || []) {
      const identity = itemIdentity(item?.listingUrl || "");
      if (identity?.itemId) map.set(identity.itemId, item);
    }
    return map;
  }

  function stockStatus(product, registryEntry) {
    if (!registryEntry?.registration || !["finance", "rent2buy"].includes(product)) return "unknown";
    const snapshot = state.context.stock?.[product];
    if (!snapshot || !Array.isArray(snapshot.registrations) || !snapshot.registrations.length) return "unknown";
    const reg = String(registryEntry.registration || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    return snapshot.registrations.includes(reg) ? "active" : "stale";
  }

  async function loadContext() {
    try {
      const result = await chrome.runtime.sendMessage({ type: "GET_MARKETPLACE_MANAGER_CONTEXT" });
      if (result?.ok) {
        state.context = {
          registry: Array.isArray(result.registry) ? result.registry : [],
          stock: result.stock || {},
        };
      }
    } catch {}
  }

  function candidateListingCards() {
    const cards = [];
    const seenCards = new Set();

    const addCard = (card) => {
      if (!card || seenCards.has(card)) return;
      const text = fold(card.innerText || card.textContent);
      if (!text.includes("mark as sold") && !text.includes("boost listing") && !text.includes("renew your listing")) return;
      seenCards.add(card);
      cards.push(card);
    };

    for (const element of document.querySelectorAll('button,[role="button"]')) {
      if (!isListingAction(element)) continue;
      addCard(nearestListingCard(element));
    }

    for (const link of document.querySelectorAll('a[href*="/marketplace/item/"]')) {
      addCard(nearestListingCard(link));
    }

    return cards;
  }

  function rowFromCard(card) {
    const registry = registryByItemId();
    const link = listingItemLink(card);
    const identity = link ? itemIdentity(link.href) : null;
    const entry = identity?.itemId ? (registry.get(identity.itemId) || null) : null;
    const title = listingTitle(card, link);
    const text = String(card.innerText || card.textContent || "");
    const product = classifyProduct(`${title} ${text}`, entry);
    const imageSrc = card.querySelector?.("img")?.src || "";
    const priceLine = text.split("\n").map((line) => line.trim()).find((line) => /^£[\d,.]+/.test(line)) || "";
    const key = identity?.itemId || `card:${fold([title, priceLine, imageSrc].join("|")).slice(0, 520)}`;
    return {
      key,
      itemId: identity?.itemId || "",
      listingUrl: identity?.listingUrl || "",
      card,
      title,
      product,
      registryEntry: entry,
      stockStatus: stockStatus(product, entry),
      renewable: fold(text).includes("renew your listing"),
    };
  }

  function visibleRows() {
    const seen = new Set();
    const rows = [];
    for (const card of candidateListingCards()) {
      const row = rowFromCard(card);
      if (!row.key || seen.has(row.key)) continue;
      seen.add(row.key);
      rows.push(row);
    }
    return rows;
  }

  function mergeRows(rows) {
    const map = new Map(state.rows.map((row) => [row.key, row]));
    for (const row of rows) {
      const previous = map.get(row.key);
      map.set(row.key, {
        ...(previous || {}),
        ...row,
        card: row.card,
      });
    }
    state.rows = [...map.values()];
  }

  function filteredRows(rows = state.rows) {
    if (state.productFilter === "all") return rows;
    return rows.filter((row) => row.product === state.productFilter);
  }

  function scanVisibleListings({ reset = false } = {}) {
    if (reset) state.rows = [];
    const rows = visibleRows();
    mergeRows(rows);
    return rows;
  }

  async function scanAllListings() {
    if (state.running) return;
    state.running = true;
    state.rows = [];
    state.renewSeen.clear();

    const startY = window.scrollY;
    let stableBottomPasses = 0;
    let previousCount = -1;
    let previousHeight = -1;

    window.scrollTo({ top: 0, behavior: "auto" });
    await sleep(500);

    for (let pass = 0; pass < 180; pass += 1) {
      scanVisibleListings();
      render(`Scanning Facebook… ${state.rows.length} listing${state.rows.length === 1 ? "" : "s"} found so far.`);

      const doc = document.documentElement;
      const height = Math.max(doc.scrollHeight, document.body?.scrollHeight || 0);
      const atBottom = window.scrollY + window.innerHeight >= height - 160;

      if (atBottom) {
        if (state.rows.length === previousCount && height === previousHeight) {
          stableBottomPasses += 1;
        } else {
          stableBottomPasses = 0;
        }
        previousCount = state.rows.length;
        previousHeight = height;
        if (stableBottomPasses >= 3) break;
        window.scrollTo({ top: height, behavior: "auto" });
      } else {
        window.scrollBy({ top: Math.max(520, Math.round(window.innerHeight * 0.78)), behavior: "auto" });
      }

      await sleep(380);
    }

    window.scrollTo({ top: startY, behavior: "auto" });
    await sleep(150);
    state.running = false;

    const rows = filteredRows();
    const allRows = state.rows;
    const financeCount = allRows.filter((row) => row.product === "finance").length;
    const rentCount = allRows.filter((row) => row.product === "rent2buy").length;
    const unknownCount = allRows.filter((row) => row.product === "unknown").length;
    render(
      allRows.length
        ? `Full scan complete: ${allRows.length} listings found · ${rentCount} Rent2Buy · ${financeCount} Van Finance · ${unknownCount} unknown. ${rows.length} in the current filter.`
        : "Full scan complete, but Facebook did not expose any managed listing cards.",
    );
  }

  function findMenuButton(card) {
    const candidates = [...card.querySelectorAll('button,[role="button"],div[tabindex="0"]')]
      .filter(visible)
      .filter((element) => {
        const label = listingActionLabel(element);
        return (
          label === "more" ||
          label.includes("more options") ||
          label.includes("more actions") ||
          label.includes("listing actions") ||
          label === "menu"
        );
      });
    if (!candidates.length) return null;
    return candidates.sort((first, second) => {
      const a = first.getBoundingClientRect();
      const b = second.getBoundingClientRect();
      return b.right - a.right;
    })[0];
  }

  function visibleRenewOption() {
    return [...document.querySelectorAll('[role="menuitem"],[role="button"],div[tabindex="0"],span')]
      .filter(visible)
      .find((element) => fold(element.innerText || element.textContent) === "renew listing") || null;
  }

  function closeOpenMenu() {
    try {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
      document.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape", code: "Escape", bubbles: true }));
    } catch {}
  }

  async function tryOpenRenew(row) {
    if (!row?.card || !document.contains(row.card)) return false;
    row.card.scrollIntoView({ block: "center", behavior: "auto" });
    await sleep(180);

    const menu = findMenuButton(row.card);
    if (!menu) return false;

    menu.click();
    await sleep(320);
    const renew = visibleRenewOption();
    if (!renew) {
      closeOpenMenu();
      await sleep(120);
      return false;
    }

    try {
      renew.style.outline = "3px solid #e31b23";
      renew.style.outlineOffset = "2px";
    } catch {}
    render(`Ready: ${row.title.slice(0, 70)}. Facebook's Renew listing option is open. Click Renew listing, then press Find next renewable.`);
    return true;
  }

  async function findNextRenewable() {
    if (state.running) return;
    closeOpenMenu();
    state.running = true;

    const startY = window.scrollY;
    let wrapped = false;
    let noProgress = 0;
    let lastY = -1;

    for (let pass = 0; pass < 220; pass += 1) {
      const rows = filteredRows(visibleRows())
        .filter((row) => row.stockStatus !== "stale")
        .sort((a, b) => a.card.getBoundingClientRect().top - b.card.getBoundingClientRect().top);

      for (const row of rows) {
        if (state.renewSeen.has(row.key)) continue;
        state.renewSeen.add(row.key);
        render(`Checking: ${row.title.slice(0, 58)}…`);
        if (await tryOpenRenew(row)) {
          state.running = false;
          return;
        }
      }

      const doc = document.documentElement;
      const height = Math.max(doc.scrollHeight, document.body?.scrollHeight || 0);
      const atBottom = window.scrollY + window.innerHeight >= height - 160;

      if (atBottom) {
        if (!wrapped && startY > 200) {
          wrapped = true;
          window.scrollTo({ top: 0, behavior: "auto" });
          await sleep(450);
          continue;
        }
        break;
      }

      const nextY = Math.min(height, window.scrollY + Math.max(520, Math.round(window.innerHeight * 0.78)));
      if (Math.abs(nextY - lastY) < 10) noProgress += 1;
      else noProgress = 0;
      if (noProgress >= 4) break;
      lastY = nextY;
      window.scrollTo({ top: nextY, behavior: "auto" });
      await sleep(380);
    }

    state.running = false;
    render("No further Facebook Renew listing option was found. If Facebook has just loaded more adverts, run Scan all listings again.");
  }

  function stats() {
    const rows = filteredRows();
    return {
      total: rows.length,
      rent2buy: rows.filter((row) => row.product === "rent2buy").length,
      finance: rows.filter((row) => row.product === "finance").length,
      active: rows.filter((row) => row.stockStatus === "active").length,
      stale: rows.filter((row) => row.stockStatus === "stale").length,
      stockUnknown: rows.filter((row) => row.stockStatus === "unknown").length,
    };
  }

  function panel() {
    let root = document.getElementById("vfc-marketplace-manager");
    if (root) return root;
    root = document.createElement("section");
    root.id = "vfc-marketplace-manager";
    root.style.cssText = [
      "position:fixed",
      "right:18px",
      "bottom:18px",
      "z-index:2147483646",
      "width:min(420px,calc(100vw - 36px))",
      "background:#111216",
      "color:#fff",
      "border:2px solid #e31b23",
      "border-radius:14px",
      "box-shadow:0 16px 42px rgba(0,0,0,.42)",
      "font:13px/1.35 Arial,sans-serif",
      "overflow:hidden",
    ].join(";");
    document.documentElement.appendChild(root);
    return root;
  }

  function render(message = "") {
    const root = panel();
    const summary = stats();
    root.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 14px;background:#08090b">
        <div>
          <div style="font-size:15px;font-weight:800">VFC Marketplace Manager</div>
          <div style="color:#aeb1b8;font-size:11px">Edge helper · v${chrome.runtime.getManifest().version}</div>
        </div>
        <button id="vfc-mgr-hide" style="border:0;background:#24262b;color:#fff;border-radius:8px;padding:6px 9px;cursor:pointer">Hide</button>
      </div>
      <div style="padding:12px 14px 14px">
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:10px">
          <div style="background:#1c1e23;border-radius:8px;padding:8px"><b style="font-size:17px">${summary.total}</b><br><span style="color:#aeb1b8">scanned</span></div>
          <div style="background:#1c1e23;border-radius:8px;padding:8px"><b style="font-size:17px">${summary.rent2buy}</b><br><span style="color:#aeb1b8">Rent2Buy</span></div>
          <div style="background:#1c1e23;border-radius:8px;padding:8px"><b style="font-size:17px">${summary.finance}</b><br><span style="color:#aeb1b8">Finance</span></div>
        </div>
        <div style="display:flex;gap:6px;align-items:center;margin-bottom:9px">
          <label for="vfc-mgr-product" style="color:#c8cad0;font-weight:700">Show</label>
          <select id="vfc-mgr-product" style="flex:1;background:#202228;color:#fff;border:1px solid #3c3f47;border-radius:8px;padding:7px">
            <option value="all" ${state.productFilter === "all" ? "selected" : ""}>All VFC + Rent2Buy</option>
            <option value="rent2buy" ${state.productFilter === "rent2buy" ? "selected" : ""}>Rent2Buy only</option>
            <option value="finance" ${state.productFilter === "finance" ? "selected" : ""}>Van Finance only</option>
          </select>
        </div>
        <div style="font-size:11px;color:#b9bbc1;margin-bottom:10px">
          Stock match: <b style="color:#bfffc8">${summary.active} active</b> ·
          <b style="color:#ffb4b4">${summary.stale} stale</b> ·
          ${summary.stockUnknown} unknown
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px">
          <button id="vfc-mgr-scan" ${state.running ? "disabled" : ""} style="min-height:38px;border:0;border-radius:9px;background:#343740;color:#fff;font-weight:700;cursor:pointer">Scan all listings</button>
          <button id="vfc-mgr-next" ${state.running ? "disabled" : ""} style="min-height:38px;border:0;border-radius:9px;background:#e31b23;color:#fff;font-weight:800;cursor:pointer">Find next renewable</button>
        </div>
        <div style="margin-top:9px;padding:8px;border-radius:8px;background:#191b20;color:#c7c9cf;min-height:32px">
          ${message || (state.rows.length ? "Ready. Find next renewable opens Facebook's Renew listing option; you make the final click." : "Start with Scan all listings. Facebook will scroll while the helper counts the whole list.")}
        </div>
        <div style="margin-top:7px;color:#8e9199;font-size:10px">Never deletes, marks sold, edits, boosts, publishes or renews a listing without your click.</div>
      </div>
    `;

    root.querySelector("#vfc-mgr-hide")?.addEventListener("click", () => {
      root.style.display = "none";
      const reopen = document.createElement("button");
      reopen.id = "vfc-marketplace-manager-reopen";
      reopen.textContent = "Marketplace Helper";
      reopen.style.cssText = "position:fixed;right:18px;bottom:18px;z-index:2147483646;border:0;border-radius:999px;padding:10px 14px;background:#111216;color:#fff;font:700 12px Arial;box-shadow:0 8px 24px rgba(0,0,0,.3);cursor:pointer";
      reopen.addEventListener("click", () => {
        reopen.remove();
        root.style.display = "";
      });
      document.documentElement.appendChild(reopen);
    });
    root.querySelector("#vfc-mgr-product")?.addEventListener("change", (event) => {
      state.productFilter = event.target.value;
      state.renewSeen.clear();
      render();
    });
    root.querySelector("#vfc-mgr-scan")?.addEventListener("click", scanAllListings);
    root.querySelector("#vfc-mgr-next")?.addEventListener("click", findNextRenewable);
  }

  async function boot() {
    await loadContext();
    render("Waiting for Facebook Marketplace listings…");
    let attempts = 0;
    while (
      attempts < 20 &&
      !document.querySelector('a[href*="/marketplace/item/"]') &&
      ![...document.querySelectorAll('button,[role="button"]')].some(isListingAction)
    ) {
      attempts += 1;
      await sleep(500);
    }
    scanVisibleListings({ reset: true });
    render();
  }

  boot();
})();
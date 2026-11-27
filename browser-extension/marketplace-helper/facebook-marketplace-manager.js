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
    stopRequested: false,
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

  // Facebook's Selling page may scroll an inner container rather than the
  // window. Find the element that actually scrolls the listing cards.
  function scrollRoot(listingControl) {
    const seed = listingControl || document.querySelector('a[href*="/marketplace/item/"]') ||
      [...document.querySelectorAll('button,[role="button"]')].find(isListingAction);
    let scrollable = null;
    for (let node = seed?.parentElement; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
      const overflow = getComputedStyle(node).overflowY;
      if (overflow !== "auto" && overflow !== "scroll") continue;
      if (node.scrollHeight > node.clientHeight + 40) return node;
      scrollable ||= node;
    }
    const page = document.scrollingElement || document.documentElement;
    return scrollable && page.scrollHeight <= page.clientHeight + 40 ? scrollable : page;
  }
  const scrollTopNow = () => scrollRoot().scrollTop;
  function scrollToY(y) { scrollRoot().scrollTo({ top: y, behavior: "auto" }); }
  const scrollToTop = () => scrollToY(0);
  function scrollToBottom() { const root = scrollRoot(); root.scrollTo({ top: root.scrollHeight, behavior: "auto" }); }
  function scrollStep(dy) { const root = scrollRoot(); root.scrollBy({ top: dy ?? Math.max(560, Math.round(root.clientHeight * 0.82)), behavior: "auto" }); }
  function atScrollBottom() { const root = scrollRoot(); return root.scrollTop + root.clientHeight >= root.scrollHeight - 180; }

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
    // Rent2Buy advert titles: "... - NO CREDIT CHECK" and "RENT IT! - DRIVE IT! - OWN IT!".
    if (/\bno credit checks?\b|\brent it\W+drive it\W+own it\b|\brent (?:to|2) own\b/.test(value)) return "rent2buy";
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
      renewable: card.querySelectorAll(moreOptionsSelector).length === 1 && hasRenewalTip(card),
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

  function visibleBatchSignature() {
    return visibleRows()
      .map((row) => row.key)
      .sort()
      .join("|");
  }

  function facebookLoaderVisible() {
    return [...document.querySelectorAll('[role="progressbar"],[aria-label]')]
      .filter(visible)
      .some((element) => {
        const label = fold([
          element.getAttribute?.("aria-label"),
          element.innerText,
          element.textContent,
        ].filter(Boolean).join(" "));
        return element.getAttribute?.("role") === "progressbar" || label.includes("loading");
      });
  }

  async function waitForNextFacebookBatch(previousSignature, previousTotal, timeoutMs = 12000) {
    const deadline = Date.now() + timeoutMs;
    let sawLoader = false;

    while (Date.now() < deadline) {
      if (facebookLoaderVisible()) sawLoader = true;

      scrollToBottom();
      const cards = candidateListingCards();
      cards[cards.length - 1]?.scrollIntoView?.({ block: "end", behavior: "auto" });

      await sleep(sawLoader ? 550 : 350);

      const signature = visibleBatchSignature();
      scanVisibleListings();

      if (
        (signature && signature !== previousSignature) ||
        state.rows.length > previousTotal
      ) {
        return true;
      }
    }

    return false;
  }

  async function scanAllListings() {
    if (state.running) return;
    state.running = true;
    state.rows = [];
    state.renewSeen.clear();

    const startY = scrollTopNow();
    let pageWaitsWithoutProgress = 0;

    scrollToTop();
    await sleep(600);

    for (let pass = 0; pass < 260; pass += 1) {
      scanVisibleListings();
      render(`Scanning Facebook… ${state.rows.length} listing${state.rows.length === 1 ? "" : "s"} found so far.`);

      const atBottom = atScrollBottom();

      if (!atBottom) {
        scrollStep();
        await sleep(420);
        continue;
      }

      const previousSignature = visibleBatchSignature();
      const previousTotal = state.rows.length;
      render(`Facebook is loading the next batch… ${state.rows.length} listings collected so far.`);

      const loadedNextBatch = await waitForNextFacebookBatch(
        previousSignature,
        previousTotal,
        12000,
      );

      if (loadedNextBatch) {
        pageWaitsWithoutProgress = 0;
        await sleep(250);
        continue;
      }

      pageWaitsWithoutProgress += 1;
      if (pageWaitsWithoutProgress >= 3) break;

      scrollStep(-220);
      await sleep(250);
      scrollToBottom();
      await sleep(500);
    }

    scrollToY(startY);
    await sleep(180);
    state.lastCompletedScan = new Date().toISOString();
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
    const actionableSelector = '[role="menuitem"],[role="button"],button,a,div[tabindex="0"]';
    const actionable = [...document.querySelectorAll(actionableSelector)]
      .filter(visible)
      .find((element) => fold(element.innerText || element.textContent) === "renew listing");
    if (actionable) return actionable;

    const textNode = [...document.querySelectorAll('span')]
      .filter(visible)
      .find((element) => fold(element.innerText || element.textContent) === "renew listing");

    return textNode?.closest?.(actionableSelector) || null;
  }

  async function waitForRenewOption(timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const renew = visibleRenewOption();
      if (renew) return renew;
      await sleep(120);
    }
    return null;
  }

  function closeOpenMenu() {
    try {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
      document.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape", code: "Escape", bubbles: true }));
    } catch {}
  }

  function facebookBlockingMessage() {
    if (/^\/(?:checkpoint|login|recover|two_step_verification)(?:\/|$)/i.test(window.location.pathname)) {
      return "Facebook is asking for a login or security check";
    }
    const candidates = [
      ...document.querySelectorAll('[role="alert"],[role="dialog"],[role="alertdialog"],[aria-live="assertive"],[aria-live="polite"]'),
    ].filter(visible);
    for (const element of candidates) {
      const text = fold(element.innerText || element.textContent);
      if (
        text.includes("temporarily blocked") ||
        text.includes("try again later") ||
        text.includes("we limit how often") ||
        text.includes("youre going too fast") ||
        /\b(?:security check|confirm your identity|verify your identity|temporarily restricted|account (?:is |has been )?(?:restricted|suspended|disabled)|(?:you|your account) (?:can ?not|cant) use marketplace|unusual (?:activity|login))\b/.test(text)
      ) {
        return String(element.innerText || element.textContent || "").trim();
      }
    }
    return "";
  }

  async function tryOpenRenew(row) {
    if (!row?.card || !document.contains(row.card)) return false;
    row.card.scrollIntoView({ block: "center", behavior: "auto" });
    await sleep(180);

    const menu = findMenuButton(row.card);
    if (!menu) return false;

    menu.click();
    const renew = await waitForRenewOption(3000);
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

    const startY = scrollTopNow();
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

      const atBottom = atScrollBottom();

      if (atBottom) {
        const previousSignature = visibleBatchSignature();
        const previousTotal = state.rows.length;
        render("Waiting for Facebook to load the next batch…");

        const loadedNextBatch = await waitForNextFacebookBatch(
          previousSignature,
          previousTotal,
          12000,
        );

        if (loadedNextBatch) {
          continue;
        }

        if (!wrapped && startY > 200) {
          wrapped = true;
          scrollToTop();
          await sleep(500);
          continue;
        }
        break;
      }

      const nextY = scrollTopNow() + Math.max(560, Math.round(scrollRoot().clientHeight * 0.82));
      if (Math.abs(nextY - lastY) < 10) noProgress += 1;
      else noProgress = 0;
      if (noProgress >= 4) break;
      lastY = nextY;
      scrollToY(nextY);
      await sleep(380);
    }

    state.running = false;
    render("No further Facebook Renew listing option was found. If Facebook has just loaded more adverts, run Scan all listings again.");
  }

  const moreOptionsSelector = '[aria-label^="More options for " i]';
  const listingLinkSelector = 'a[href*="/marketplace/item/"],a[href*="/ad_center/create/listingad/"]';
  const noticesSelector = '[role="alert"],[role="status"],[role="dialog"],[role="alertdialog"],[aria-live="polite"],[aria-live="assertive"]';
  const dialogSelector = '[role="dialog"],[role="alertdialog"]';
  const renewControlSelector = '[role="menuitem"],[role="button"],button,a,div[tabindex="0"]';
  const maxRenewalScrollSteps = 260;

  function listingIdFromLink(link) {
    const identity = itemIdentity(link.href);
    if (identity) return identity.itemId;
    const target = new URL(link.href).searchParams.get("target_id");
    return /^\d+$/.test(target || "") ? target : "";
  }

  function autoListing(menu) {
    // The Facebook card has its own More options trigger and listing detail.
    // Stop before crossing into a wrapper that contains another advert.
    for (let card = menu.parentElement; card && card !== document.body; card = card.parentElement) {
      if (card.querySelectorAll(moreOptionsSelector).length !== 1) return null;
      const text = card.innerText || "";
      if (!/\blisted on\b/i.test(text)) continue;
      const links = [...card.querySelectorAll(listingLinkSelector)];
      const ids = [...new Set(links.map(listingIdFromLink).filter(Boolean))];
      if (ids.length !== 1) return null;
      const [key] = ids;
      return { key, card, menu, text, title: menu.getAttribute("aria-label").replace(/^more options for /i, "") };
    }
    return null;
  }

  function hasRenewalTip(card) {
    return (card.innerText || "").split("\n").some((line) =>
      /^(?:tip:\s*)?renew your listing(?:[\s.?!:…]|$)/i.test(line.trim())
    );
  }

  function menuInViewport(menu, root) {
    if (!visible(menu)) return false;
    const rect = menu.getBoundingClientRect();
    const bounds = root === document.scrollingElement || root === document.documentElement
      ? { top: 0, bottom: window.innerHeight }
      : root.getBoundingClientRect();
    return rect.bottom > Math.max(0, bounds.top) && rect.top < Math.min(window.innerHeight, bounds.bottom);
  }

  function visibleRenewControls(scope = document) {
    return [...scope.querySelectorAll(renewControlSelector)].filter((element) =>
      visible(element) && !element.closest("#vfc-marketplace-manager") &&
      !element.disabled && element.getAttribute("aria-disabled") !== "true" &&
      [element.innerText, element.getAttribute("aria-label")].some((label) => fold(label) === "renew listing")
    );
  }

  function facebookNotices() {
    return new Map([...document.querySelectorAll(noticesSelector)]
      .filter(visible)
      .map((node) => [node, fold(node.innerText || node.textContent)]));
  }

  function renewalDate(card) {
    return (card.innerText || "").split("\n").map((line) => fold(line))
      .find((line) => /^renewed on\s+\S/.test(line)) || "";
  }

  async function renewVisibleListing(row) {
    if (!row.card.isConnected || !row.menu.isConnected || !hasRenewalTip(row.card)) {
      return { status: "not_eligible", reason: "Listing or renewal message changed before the click" };
    }

    const existingControls = new Set(visibleRenewControls());
    row.menu.click();
    try {
      let renew;
      const menuDeadline = Date.now() + 3000;
      while (Date.now() < menuDeadline && !state.stopRequested) {
        const blocked = facebookBlockingMessage();
        if (blocked) return { status: "blocked", reason: blocked };
        renew = visibleRenewControls().find((control) =>
          !existingControls.has(control) &&
          (row.card.contains(control) || control.closest('[role="menu"],[role="menuitem"]'))
        );
        if (renew) break;
        await sleep(120);
      }
      if (state.stopRequested) return { status: "stopped", reason: "Stopped before the renewal click" };
      if (!renew) return { status: "failed", reason: "Facebook offered no Renew listing action for this card" };

      const previousNotices = facebookNotices();
      const previousDate = renewalDate(row.card);
      let confirmClicked = false;
      renew.click();
      const deadline = Date.now() + 4000;
      while (Date.now() < deadline) {
        const blocked = facebookBlockingMessage();
        if (blocked) return { status: "blocked", reason: blocked };
        for (const [node, text] of facebookNotices()) {
          if (previousNotices.get(node) === text) continue;
          if (/\b(?:could(?: not|nt) renew|unable to renew|renewal failed|something went wrong|listing (?:was not|wasnt|has not been) renewed)\b/.test(text)) {
            return { status: "failed", reason: "Facebook reported a renewal error" };
          }
          if (/^(?:(?:your |the )?(?:listing|item) (?:(?:has been|was) )?(?:successfully )?renewed|(?:successfully renewed|you(?: have|ve)? (?:successfully )?renewed) (?:your|the) (?:listing|item))(?:[.!\s]|$)/.test(text)) {
            return { status: "renewed", reason: "" };
          }
          if (state.stopRequested || confirmClicked || !node.matches(dialogSelector) ||
              previousNotices.has(node) || !/^(?:are you sure you want to )?renew (?:your |this )?listing\b/.test(text)) continue;
          const actions = visibleRenewControls(node);
          if (actions.length === 1) {
            confirmClicked = true;
            actions[0].click();
          }
        }
        const currentDate = row.menu.isConnected && autoListing(row.menu)?.key === row.key && renewalDate(row.card);
        if (currentDate && currentDate !== previousDate) return { status: "renewed", reason: "" };
        await sleep(200);
      }
      return { status: "unconfirmed", reason: "Facebook did not show a new renewal confirmation" };
    } finally {
      closeOpenMenu();
    }
  }

  async function autoRenewAll() {
    if (state.running) return;
    const filter = state.productFilter;
    const scope = filter === "finance" ? "Van Finance" : filter === "rent2buy" ? "Rent2Buy" : "Van Finance + Rent2Buy";
    if (!window.confirm(
      "Renew eligible Facebook Marketplace listings for " + scope +
      " as they appear while scrolling from here? The helper pauses between renewals and stops if Facebook reports an account limit or security warning.",
    )) return;

    state.running = true;
    state.stopRequested = false;
    const report = state.report = { discovered: 0, eligible: 0, renewed: 0, notEligible: 0, failed: 0, outstanding: [] };
    const seen = new Set();
    const attempted = new Set();
    const registry = registryByItemId();
    let scrollSteps = 0;
    let bottomSince = null;
    let stopReason = "";
    render("Looking for Facebook renewal messages…");

    try {
      while (!state.stopRequested) {
        stopReason = facebookBlockingMessage();
        if (stopReason) break;

        const menus = [...document.querySelectorAll(moreOptionsSelector)];
        const root = scrollRoot(menus[0]);
        let processedListing = false;
        for (const menu of menus) {
          if (state.stopRequested) break;
          stopReason = facebookBlockingMessage();
          if (stopReason) break;
          if (!menuInViewport(menu, root)) continue;
          const row = autoListing(menu);
          if (!row || attempted.has(row.key)) continue;
          const entry = registry.get(row.key);
          const product = classifyProduct(row.title + " " + row.text, entry);
          if (filter === "all" ? product === "unknown" : product !== filter) continue;
          seen.add(row.key);
          report.discovered = seen.size;
          if (!hasRenewalTip(row.card)) continue;

          attempted.add(row.key);
          if (stockStatus(product, entry) === "stale") {
            report.notEligible += 1;
            report.outstanding.push({ title: row.title, reason: "Known stale stock" });
            continue;
          }

          report.eligible += 1;
          render("Renewing " + escapeHtml(row.title.slice(0, 65)) + "…");
          let result;
          try {
            result = await renewVisibleListing(row);
          } catch {
            result = { status: "failed", reason: "Could not complete the Facebook renewal action" };
          }

          if (result.status === "renewed") report.renewed += 1;
          else {
            if (result.status === "not_eligible") report.notEligible += 1;
            else if (result.status !== "stopped") report.failed += 1;
            report.outstanding.push({ title: row.title, reason: result.reason });
          }
          if (result.status === "blocked") {
            stopReason = result.reason;
            break;
          }
          if (!state.stopRequested) {
            render("Continuing through Facebook Marketplace…");
            await sleep(850);
          }
          // Renewal can replace the visible cards without any scrolling.
          processedListing = true;
          break;
        }

        if (state.stopRequested || stopReason) break;
        if (processedListing) continue;
        if (scrollSteps >= maxRenewalScrollSteps) {
          stopReason = "Reached the 260-scroll-step limit";
          break;
        }
        if (root.scrollTop + root.clientHeight >= root.scrollHeight - 2) {
          if (bottomSince === null) {
            bottomSince = Date.now();
            render("Waiting for Facebook to load more listings…");
          }
          if (Date.now() - bottomSince >= 12000) break;
          await sleep(350);
          continue;
        }

        bottomSince = null;
        root.scrollBy({ top: Math.max(1, Math.round(root.clientHeight * 0.75)), behavior: "auto" });
        scrollSteps += 1;
        await sleep(420);
      }
    } catch (error) {
      stopReason = "Helper error: " + String(error?.message || error).slice(0, 120);
    }
    const manualStop = state.stopRequested;
    state.running = false;
    state.stopRequested = false;
    const counts = report.renewed + " confirmed · " + report.notEligible + " not eligible · " + report.failed + " failed/unconfirmed";
    const outcome = stopReason ? "Auto renewal stopped. " + escapeHtml(stopReason) :
      manualStop ? "Auto renewal stopped by you" : "Auto renewal finished";
    render(outcome + " · " + counts + ".");
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"]/g, (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]
    );
  }

  function reportHtml() {
    const r = state.report;
    const when = state.lastCompletedScan ? new Date(state.lastCompletedScan).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" }) : "never";
    if (!r) return `<div style="font-size:11px;color:#b9bbc1;margin-bottom:10px">Last completed scan: ${escapeHtml(when)}</div>`;
    const cell = (label, value, colour = "#fff") => `<div style="background:#1c1e23;border-radius:8px;padding:6px"><b style="font-size:15px;color:${colour}">${value}</b><br><span style="color:#aeb1b8;font-size:10px">${label}</span></div>`;
    return `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:5px;margin-bottom:6px">
      ${cell("discovered", r.discovered)}${cell("eligible", r.eligible)}${cell("renewed", r.renewed, "#bfffc8")}
      ${cell("not eligible", r.notEligible)}${cell("failed / unconfirmed", r.failed, r.failed ? "#ffb4b4" : "#fff")}${cell("outstanding", r.outstanding.length, r.outstanding.length ? "#ffb4b4" : "#fff")}
    </div>
    <div style="font-size:11px;color:#b9bbc1;margin-bottom:8px">Last completed scan: ${escapeHtml(when)}</div>
    ${r.outstanding.length ? `<div style="font-size:11px;color:#ffd0d0;margin-bottom:8px;max-height:90px;overflow:auto">${r.outstanding.map((o) => `• ${escapeHtml(o.title.slice(0, 50))}: ${escapeHtml(o.reason)}`).join("<br>")}</div>` : ""}`;
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
      renewable: rows.filter((row) => row.renewable).length,
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
          <b style="color:#9fd2ff">${summary.renewable} showing "Renew your listing"</b> in this filter<br>
          Stock match: <b style="color:#bfffc8">${summary.active} active</b> ·
          <b style="color:#ffb4b4">${summary.stale} stale</b> ·
          ${summary.stockUnknown} unknown
        </div>
        ${reportHtml()}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px">
          <button id="vfc-mgr-scan" ${state.running ? "disabled" : ""} style="min-height:38px;border:0;border-radius:9px;background:#343740;color:#fff;font-weight:700;cursor:pointer">Scan all listings</button>
          <button id="vfc-mgr-next" ${state.running ? "disabled" : ""} style="min-height:38px;border:0;border-radius:9px;background:#343740;color:#fff;font-weight:700;cursor:pointer">Find next renewable</button>
          <button id="vfc-mgr-auto" ${state.running ? "disabled" : ""} style="grid-column:1/-1;min-height:42px;border:0;border-radius:9px;background:#e31b23;color:#fff;font-weight:800;cursor:pointer">Auto renew current filter</button>
          <button id="vfc-mgr-stop" ${state.running ? "" : "disabled"} style="grid-column:1/-1;min-height:34px;border:1px solid #4b4e56;border-radius:9px;background:#202228;color:#fff;font-weight:700;cursor:pointer">Stop auto renewal</button>
        </div>
        <div style="margin-top:9px;padding:8px;border-radius:8px;background:#191b20;color:#c7c9cf;min-height:32px">
          ${message || (state.rows.length ? "Ready. Use Auto renew current filter to renew every listing Facebook currently offers for renewal, or Find next renewable for manual review." : "Start with Scan all listings, or run Auto renew current filter directly.")}
        </div>
        <div style="margin-top:7px;color:#8e9199;font-size:10px">Auto renew only clicks Facebook's existing Renew listing action. It never deletes, marks sold, edits, boosts, publishes or creates adverts.</div>
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
    root.querySelector("#vfc-mgr-auto")?.addEventListener("click", autoRenewAll);
    root.querySelector("#vfc-mgr-stop")?.addEventListener("click", () => {
      state.stopRequested = true;
      render("Stopping after the current Facebook action…");
    });
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

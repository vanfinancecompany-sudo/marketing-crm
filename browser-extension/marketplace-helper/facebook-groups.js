(() => {
  if (window.__VFC_FACEBOOK_GROUPS_HELPER_BOOTED__) return;
  window.__VFC_FACEBOOK_GROUPS_HELPER_BOOTED__ = true;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function clean(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function fold(value) {
    return clean(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[’'`]/g, "")
      .toLowerCase();
  }

  function visible(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  }

  function canonicalGroupUrl(value) {
    try {
      const url = new URL(String(value || ""), location.origin);
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0]?.toLowerCase() !== "groups" || !parts[1]) return "";
      const id = parts[1];
      if (["feed", "discover", "search", "create"].includes(id.toLowerCase())) return "";
      return "https://www.facebook.com/groups/" + id + "/";
    } catch {
      return "";
    }
  }

  function nearestContext(anchor) {
    let node = anchor;
    for (let depth = 0; depth < 7 && node; depth += 1, node = node.parentElement) {
      const text = clean(node.innerText || node.textContent);
      if (text.length >= 20 && text.length <= 1800) return text;
    }
    return clean(anchor.innerText || anchor.textContent);
  }

  function resultName(anchor, context) {
    const direct = clean(anchor.innerText || anchor.textContent || anchor.getAttribute("aria-label"));
    if (direct.length >= 3 && direct.length <= 180) return direct.split("\n")[0];
    const lines = String(context || "").split(/\n+/).map(clean).filter(Boolean);
    return lines.find((line) => line.length >= 3 && line.length <= 180) || "Facebook group";
  }

  function parseMembers(context) {
    const text = clean(context);
    const match = text.match(/([0-9][0-9,.]*\s*[KMB]?)\s+(?:members?|member)/i);
    return match ? clean(match[1]) : "";
  }

  function parsePrivacy(context) {
    if (/\bpublic\s+group\b/i.test(context)) return "Public";
    if (/\bprivate\s+group\b/i.test(context)) return "Private";
    return "";
  }

  async function collectSearchResults(state) {
    for (let index = 0; index < 4; index += 1) {
      window.scrollBy({ top: Math.max(700, window.innerHeight * 0.85), behavior: "smooth" });
      await sleep(850);
    }

    const currentQuery = state?.job?.queries?.[state.queryIndex] || {};
    const seen = new Set();
    const candidates = [];
    const anchors = [...document.querySelectorAll('a[href*="/groups/"]')].filter(visible);

    for (const anchor of anchors) {
      const url = canonicalGroupUrl(anchor.href);
      if (!url || seen.has(url)) continue;
      const context = nearestContext(anchor);
      const name = resultName(anchor, context);
      if (!name || /groups home|discover groups|your groups|create new group/i.test(name)) continue;
      seen.add(url);
      candidates.push({
        name,
        url,
        context: context.slice(0, 1200),
        members: parseMembers(context),
        privacy: parsePrivacy(context),
        segment: currentQuery.segment || "Discovered",
        query: currentQuery.query || "",
      });
      if (candidates.length >= 30) break;
    }

    await chrome.runtime.sendMessage({
      type: "GROUP_DISCOVERY_PAGE_RESULTS",
      jobId: state.job.id,
      queryIndex: state.queryIndex,
      candidates,
    });
  }

  function pageLines() {
    let text = String(document.body?.innerText || "");
    const helperText = clean(document.getElementById("vfc-group-helper-report")?.innerText || "");
    if (helperText) text = text.replace(helperText, "");
    return text
      .split(/\n+/)
      .map(clean)
      .filter(Boolean);
  }

  function registrationEvidenceLines(registration) {
    const wantedReg = normalizeRegistration(registration);
    if (!wantedReg) return [];
    return pageLines().filter((line) => advertRegistrationLine(line, wantedReg));
  }

  function advertRegistrationLine(line, wantedReg) {
    if (/search results for|results for|search this group|search facebook/i.test(line)) return false;
    const pattern = new RegExp(`(?:^|[^A-Z0-9])${wantedReg.split("").join("[\\s-]*")}(?=$|[^A-Z0-9])`, "i");
    return pattern.test(line);
  }

  function visibleSearchResultEvidence(registration) {
    const wantedReg = normalizeRegistration(registration);
    if (!wantedReg) return null;
    const candidates = [...document.querySelectorAll('[role="article"], [data-ad-preview="message"], div')].filter(visible);
    for (const node of candidates) {
      const rawText = String(node.innerText || "");
      const text = clean(rawText);
      if (!text || text.length > 5000) continue;
      if (/search results for|results for/i.test(text) && text.length < 250) continue;
      const helperText = String(document.getElementById("vfc-group-helper-report")?.innerText || "");
      const advertText = helperText ? rawText.replace(helperText, "") : rawText;
      if (!advertText.split(/\n+/).some((line) => advertRegistrationLine(line, wantedReg))) continue;
      if (!node.querySelector('img, a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid="], [role="button"]')) continue;
      return node;
    }
    return null;
  }

  function visibleAdvertCardForExactSearch(registration) {
    const wantedReg = normalizeRegistration(registration);
    if (!wantedReg) return null;

    let searchedReg = "";
    try {
      searchedReg = normalizeRegistration(new URL(location.href).searchParams.get("q") || "");
    } catch {}
    if (!searchedReg || searchedReg !== wantedReg) return null;

    const candidates = [...document.querySelectorAll('[role="article"], div[role="article"], [data-ad-preview="message"]')].filter(visible);
    for (const node of candidates) {
      const text = clean(node.innerText || node.textContent || "");
      if (/search results for|results for/i.test(text) && text.length < 250) continue;
      const largeImage = [...node.querySelectorAll("img")].filter(visible).find((image) => {
        const rect = image.getBoundingClientRect();
        return rect.width >= 180 && rect.height >= 120;
      });
      if (!largeImage) continue;
      const controls = clean([...node.querySelectorAll('button, [role="button"], a')]
        .filter(visible)
        .map((element) => element.innerText || element.textContent || element.getAttribute("aria-label"))
        .join(" "));
      const looksLikePost = /like|comment|share/i.test(controls);
      const looksLikeOurAdvert = /rent\s*(?:2|to)\s*buy\s*vans|van\s*finance\s*company/i.test(text);
      if (looksLikePost || looksLikeOurAdvert) return node;
    }
    return null;
  }

  function visibleFinanceAdvertForExactSearch(registration) {
    const wantedReg = normalizeRegistration(registration);
    if (!wantedReg) return null;

    let searchedReg = "";
    try {
      searchedReg = normalizeRegistration(new URL(location.href).searchParams.get("q") || "");
    } catch {}
    if (!searchedReg || searchedReg !== wantedReg) return null;

    const pageText = clean(document.body?.innerText || "");
    if (!/\bvan\s+finance\s+company\b/i.test(pageText)) return null;

    const largeImage = [...document.querySelectorAll("img")]
      .filter(visible)
      .find((image) => {
        const rect = image.getBoundingClientRect();
        return rect.width >= 220 && rect.height >= 140;
      });
    if (!largeImage) return null;

    return largeImage.closest?.('[role="article"], article, div') || largeImage.parentElement || document.body;
  }

  function visibleRent2BuyAdvertForExactSearch(registration) {
    const wantedReg = normalizeRegistration(registration);
    if (!wantedReg) return null;

    let searchedReg = "";
    try {
      searchedReg = normalizeRegistration(new URL(location.href).searchParams.get("q") || "");
    } catch {}
    if (!searchedReg || searchedReg !== wantedReg) return null;

    const pageText = clean(document.body?.innerText || "");
    const looksLikeRent2BuyAdvert =
      /\brent\s*(?:2|to)\s*buy\s*vans\b/i.test(pageText) ||
      /\bno\s+credit\s+check\b/i.test(pageText) ||
      /\brent\s+it\b[\s\S]{0,120}\bdrive\s+it\b[\s\S]{0,120}\bown\s+it\b/i.test(pageText) ||
      /rent2buyvans\.co\.uk/i.test(pageText);
    if (!looksLikeRent2BuyAdvert) return null;

    const largeImage = [...document.querySelectorAll("img")]
      .filter(visible)
      .find((image) => {
        const rect = image.getBoundingClientRect();
        return rect.width >= 220 && rect.height >= 140;
      });
    if (!largeImage) return null;

    return largeImage.closest?.('[role="article"], article, div') || largeImage.parentElement || document.body;
  }

  function contentUnavailable(text) {
    return /this content isn'?t available right now|content is not available|page isn'?t available|group is unavailable|group has been deleted/i.test(String(text || ""));
  }

  function normalizeRegistration(value) {
    return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  function membershipPendingVisible() {
    const pageText = clean(document.body?.innerText || "");
    return /your membership is pending|membership request (?:is )?pending|your request to join is pending|request to join (?:is )?pending|membership pending|request sent/i.test(pageText);
  }

  async function waitForMembershipPending(timeoutMs = 5000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (membershipPendingVisible()) return true;
      await sleep(250);
    }
    return membershipPendingVisible();
  }

  function extractRuleEvidence(lines) {
    const keywords = /advert|business|commercial|dealer|promo|link|spam|sell|sale|rule|approval|admin|service/i;
    const results = [];
    const seen = new Set();
    for (const line of lines) {
      if (!keywords.test(line) || line.length < 5 || line.length > 420) continue;
      const key = fold(line);
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(line);
      if (results.length >= 14) break;
    }
    return results.join(" | ");
  }

  function explicitRuleStatus(evidence) {
    const text = fold(evidence);
    if (/no advertising|no advertisements|no business advertising|no business posts|no commercial posts|no dealers|dealers not allowed|no promotional posts/.test(text)) {
      return "Red";
    }
    if (/advertising allowed|business advertising allowed|businesses welcome|promote your business|commercial posts allowed|small businesses welcome/.test(text)) {
      return "Green";
    }
    return "Amber";
  }

  function buttonWithText(pattern) {
    return [...document.querySelectorAll('button, [role="button"], a')]
      .filter(visible)
      .find((element) => pattern.test(clean(element.innerText || element.textContent || element.getAttribute("aria-label"))));
  }

  const COMPOSER_OPENER_PATTERN = /^(?:write something(?:\.\.\.)?|what'?s on your mind\??|create post)(?:\s.*)?$/i;
  const COMPOSER_EDITOR_PATTERN = /create a (?:public )?post|write something|what'?s on your mind/i;
  const REJECTED_EDITOR_PATTERN = /write a comment|\bcomment\b|\breply\b|\banswer\b|\bmessage\b/i;

  function elementEvidence(element) {
    if (!element) return "";
    return clean([
      element.getAttribute?.("aria-label"),
      element.getAttribute?.("aria-placeholder"),
      element.getAttribute?.("data-placeholder"),
      element.getAttribute?.("placeholder"),
      element.getAttribute?.("name"),
      element.innerText,
      element.textContent,
    ].filter(Boolean).join(" "));
  }

  function findComposerOpener() {
    const controls = [...document.querySelectorAll('button, [role="button"], a')]
      .filter(visible)
      .filter((element) => COMPOSER_OPENER_PATTERN.test(elementEvidence(element)));

    const direct = controls.find((element) => !REJECTED_EDITOR_PATTERN.test(elementEvidence(element)));
    if (direct) return direct;

    const label = [...document.querySelectorAll("div, span")]
      .filter(visible)
      .find((element) => {
        const evidence = elementEvidence(element);
        return COMPOSER_OPENER_PATTERN.test(evidence) && !REJECTED_EDITOR_PATTERN.test(evidence);
      });
    if (!label) return null;
    return label.closest?.('button, [role="button"]') || label;
  }

  function dialogHasCreatePostIdentity(dialog) {
    if (!dialog || dialog.getAttribute?.("role") !== "dialog" || !visible(dialog)) return false;
    const headings = [...dialog.querySelectorAll('[role="heading"], h1, h2, h3')]
      .filter(visible)
      .map(elementEvidence);
    const identity = clean([dialog.getAttribute?.("aria-label"), ...headings].filter(Boolean).join(" "));
    return /\bcreate post\b/i.test(identity);
  }

  function dialogHasLocalPostButton(dialog) {
    if (!dialog) return false;
    return [...dialog.querySelectorAll('button, [role="button"]')]
      .filter(visible)
      .some((element) => /^post(?:\s|$)/i.test(elementEvidence(element))
        && !/comment|reply/i.test(elementEvidence(element)));
  }

  function dialogHasLocalPhotoControl(dialog) {
    if (!dialog) return false;
    if ([...dialog.querySelectorAll('input[type="file"]')]
      .some((element) => String(element.accept || "").includes("image") || !element.accept)) {
      return true;
    }
    return [...dialog.querySelectorAll('button, [role="button"]')]
      .filter(visible)
      .some((element) => /photo|video/i.test(elementEvidence(element)));
  }

  function isVerifiedCreatePostDialog(dialog) {
    if (!dialogHasCreatePostIdentity(dialog)) return false;
    if (!dialogHasLocalPostButton(dialog)) return false;
    return true;
  }

  function verifiedComposerDialog() {
    return [...document.querySelectorAll('[role="dialog"]')]
      .filter(visible)
      .find(isVerifiedCreatePostDialog) || null;
  }

  function isRejectedComposerEditor(element) {
    if (!element || !visible(element)) return true;
    const evidence = elementEvidence(element);
    if (REJECTED_EDITOR_PATTERN.test(evidence)) return true;
    if (element.closest?.('[role="article"], article')) return true;
    return false;
  }

  function composerEditorCandidates(dialog) {
    if (!isVerifiedCreatePostDialog(dialog)) return [];

    const selectors = [
      '[aria-label*="Create a public post"]',
      '[aria-placeholder*="Create a public post"]',
      '[aria-label*="Write something"]',
      '[aria-placeholder*="Write something"]',
      '[data-lexical-editor="true"]',
      '[contenteditable="true"]',
      '[contenteditable="plaintext-only"]',
      '[role="textbox"]',
    ];

    const candidates = [...new Set(
      selectors.flatMap((selector) => [...dialog.querySelectorAll(selector)])
    )].filter(visible);

    return candidates
      .filter((element) => !isRejectedComposerEditor(element))
      .filter((element) => {
        const evidence = elementEvidence(element);
        const role = element.getAttribute?.("role");
        const contenteditable = element.getAttribute?.("contenteditable");
        const lexical = element.getAttribute?.("data-lexical-editor");
        return COMPOSER_EDITOR_PATTERN.test(evidence)
          || lexical === "true"
          || (role === "textbox" && (contenteditable === "true" || contenteditable === "plaintext-only"))
          || contenteditable === "true"
          || contenteditable === "plaintext-only";
      })
      .sort((first, second) => {
        const score = (element) => {
          let value = 0;
          const evidence = elementEvidence(element);
          if (COMPOSER_EDITOR_PATTERN.test(evidence)) value += 20;
          if (element.getAttribute?.("role") === "textbox") value += 8;
          if (element.getAttribute?.("data-lexical-editor") === "true") value += 8;
          if (element.getAttribute?.("contenteditable") === "true") value += 5;
          if (element.getAttribute?.("contenteditable") === "plaintext-only") value += 5;
          const rect = element.getBoundingClientRect();
          value += Math.min(6, Math.round((rect.width * rect.height) / 18000));
          return value;
        };
        return score(second) - score(first);
      });
  }

  function editorFromPlaceholder(dialog) {
    if (!isVerifiedCreatePostDialog(dialog)) return null;
    const labels = [...dialog.querySelectorAll("div, span, p")]
      .filter(visible)
      .filter((element) => COMPOSER_EDITOR_PATTERN.test(elementEvidence(element)));

    for (const label of labels) {
      const ancestor = label.closest?.(
        '[contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"], [data-lexical-editor="true"]'
      );
      if (ancestor && dialog.contains(ancestor) && !isRejectedComposerEditor(ancestor)) return ancestor;

      const parent = label.parentElement;
      const descendant = parent?.querySelector?.(
        '[contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"], [data-lexical-editor="true"]'
      );
      if (descendant && dialog.contains(descendant) && !isRejectedComposerEditor(descendant) && visible(descendant)) {
        return descendant;
      }
    }
    return null;
  }

  async function waitForComposerEditor(timeoutMs = 6000) {
    const started = Date.now();

    while (Date.now() - started < timeoutMs) {
      const dialog = verifiedComposerDialog();
      if (dialog) {
        const direct = composerEditorCandidates(dialog)[0];
        if (direct) return { editor: direct, scope: dialog, verified: true };

        const placeholderEditor = editorFromPlaceholder(dialog);
        if (placeholderEditor) return { editor: placeholderEditor, scope: dialog, verified: true };

        const placeholder = [...dialog.querySelectorAll("div, span, p")]
          .filter(visible)
          .find((element) => COMPOSER_EDITOR_PATTERN.test(elementEvidence(element)));

        if (placeholder) {
          try { placeholder.click(); } catch {}
          await sleep(180);

          const active = document.activeElement;
          if (
            active &&
            active !== document.body &&
            dialog.contains(active) &&
            !isRejectedComposerEditor(active) &&
            (
              active.getAttribute?.("role") === "textbox" ||
              active.getAttribute?.("contenteditable") === "true" ||
              active.getAttribute?.("contenteditable") === "plaintext-only" ||
              active.getAttribute?.("data-lexical-editor") === "true"
            )
          ) {
            return { editor: active, scope: dialog, verified: true };
          }
        }
      }

      await sleep(250);
    }

    return { editor: null, scope: null, verified: false };
  }

  async function inspectGroup(state) {
    await sleep(1800);
    const lines = pageLines();
    const pageText = lines.join("\n").slice(0, 30000);
    const unavailable = contentUnavailable(pageText);
    const ruleEvidence = extractRuleEvidence(lines);
    const canPost = Boolean(findComposerOpener() || verifiedComposerDialog());
    const joinButton = buttonWithText(/^join(?: group)?$/i);
    const joinedButton = buttonWithText(/^joined$/i);
    const pendingMembershipButton = buttonWithText(/^(?:cancel request|requested|pending)$/i);
    const membershipPending = !canPost && !joinedButton && Boolean(
      pendingMembershipButton ||
      /membership request (?:is )?pending|your request to join is pending|request to join (?:is )?pending|membership pending|request sent/i.test(pageText)
    );
    const joined = canPost || Boolean(joinedButton) ? true : membershipPending || joinButton ? false : null;
    const approvalRequired = /post approval|requires? approval|pending approval|admin approval/i.test(pageText);
    const linksAllowed = /no external links|links? (?:are )?not allowed|no links/i.test(pageText)
      ? false
      : /links? (?:are )?allowed|website links? allowed/i.test(pageText)
        ? true
        : null;
    const heading = [...document.querySelectorAll("h1, h2")]
      .filter(visible)
      .map((element) => clean(element.innerText || element.textContent))
      .find((value) => value.length >= 3 && value.length <= 180) || "";
    const target = state?.job?.groups?.[state.groupIndex] || {};
    const currentUrl = canonicalGroupUrl(location.href) || canonicalGroupUrl(target.url);

    await chrome.runtime.sendMessage({
      type: "GROUP_INSPECTION_PAGE_RESULT",
      jobId: state.job.id,
      groupIndex: state.groupIndex,
      inspection: {
        name: heading || target.name || "",
        url: currentUrl || target.url || "",
        pageText: pageText.slice(0, 10000),
        ruleEvidence,
        explicitStatus: unavailable ? "Red" : explicitRuleStatus(ruleEvidence),
        unavailable,
        canPost: unavailable ? false : canPost,
        joined,
        membershipPending,
        approvalRequired,
        linksAllowed,
        privacy: /\bpublic group\b/i.test(pageText) ? "Public" : /\bprivate group\b/i.test(pageText) ? "Private" : "",
        members: parseMembers(pageText),
      },
    });
  }

  async function checkPostedStatus(state) {
    const target = state?.job?.groups?.[state.groupIndex] || {};
    const wantedReg = normalizeRegistration(target.registration);
    if (target.renewalPost) {
      let matched = null;
      for (let attempt = 0; attempt < 20 && !matched; attempt += 1) {
        if (renewalRestriction()) {
          await chrome.runtime.sendMessage({ type: "GROUP_POST_STATUS_PAGE_RESULT", jobId: state.job.id,
            groupIndex: state.groupIndex, result: { url: target.url, registration: target.registration, restricted: true } });
          return;
        }
        matched = findRenewalAdvert(target, wantedReg);
        if (!matched) await sleep(500);
      }
      await chrome.runtime.sendMessage({ type: "GROUP_POST_STATUS_PAGE_RESULT", jobId: state.job.id,
        groupIndex: state.groupIndex, result: { name: target.name, url: target.url,
          registration: target.registration, accepted: Boolean(matched && !matched.pending && !matched.declined),
          pending: Boolean(matched?.pending && !matched.declined), declined: Boolean(matched?.declined),
          matchedUrl: matched?.url || "", matchMethod: matched ? "dated-renewal-advert" : "", postedAt: target.postedAt,
          observedAt: matched?.observedAt || "", checkedAt: new Date().toISOString() } });
      return;
    }

    // Facebook group search results often render several seconds after navigation.
    // Wait for real registration evidence instead of taking a one-off snapshot too early.
    let resultAnchors = [];
    let evidenceLines = [];
    const waitStarted = Date.now();
    while (Date.now() - waitStarted < 9000) {
      resultAnchors = [...document.querySelectorAll(
        'a[href*="/posts/"], a[href*="/permalink/"], a[href*="multi_permalinks="], a[href*="story_fbid="]'
      )].filter(visible);
      evidenceLines = wantedReg ? registrationEvidenceLines(target.registration) : [];
      const visibleResult = wantedReg ? visibleSearchResultEvidence(target.registration) : null;
      const visibleAdvert = wantedReg ? visibleAdvertCardForExactSearch(target.registration) : null;
      const visibleFinanceAdvert = wantedReg ? visibleFinanceAdvertForExactSearch(target.registration) : null;
      const visibleRent2BuyAdvert = wantedReg ? visibleRent2BuyAdvertForExactSearch(target.registration) : null;
      // Keep the rule simple: exact registration search + a genuine visible advert means
      // Facebook is showing the advert, so it is accepted/Proven.
      if (visibleFinanceAdvert || visibleRent2BuyAdvert || visibleAdvert || visibleResult || evidenceLines.length || contentUnavailable(document.body?.innerText || "")) break;
      await sleep(500);
    }

    const pageText = clean(document.body?.innerText || "");
    const unavailable = contentUnavailable(pageText);
    const declined = /post (?:was )?(?:declined|rejected)|declined by (?:an )?admin|rejected by (?:an )?admin|your post was not approved|post was not approved/i.test(pageText);
    const pending = !declined && /pending approval|awaiting approval|waiting for admin approval|post is pending/i.test(pageText);

    let accepted = false;
    let matchedUrl = "";
    let matchMethod = "";
    if (!unavailable && !declined && wantedReg) {
      for (const anchor of resultAnchors) {
        const context = nearestContext(anchor);
        if (normalizeRegistration(context).includes(wantedReg)) {
          accepted = true;
          matchedUrl = anchor.href || "";
          matchMethod = "post-link";
          break;
        }
      }

      if (!accepted) {
        const visibleFinanceAdvert = visibleFinanceAdvertForExactSearch(target.registration);
        const visibleRent2BuyAdvert = visibleRent2BuyAdvertForExactSearch(target.registration);
        const visibleAdvert = visibleAdvertCardForExactSearch(target.registration);
        const visibleResult = visibleSearchResultEvidence(target.registration);
        if (visibleFinanceAdvert) {
          accepted = true;
          matchedUrl = visibleFinanceAdvert.querySelector?.('a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid="]')?.href || "";
          matchMethod = "exact-search-finance-advert";
        } else if (visibleRent2BuyAdvert) {
          accepted = true;
          matchedUrl = visibleRent2BuyAdvert.querySelector?.('a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid="]')?.href || "";
          matchMethod = "exact-search-rent2buy-advert";
        } else if (visibleAdvert) {
          accepted = true;
          matchedUrl = visibleAdvert.querySelector('a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid="]')?.href || "";
          matchMethod = "exact-search-visible-advert";
        } else if (visibleResult) {
          accepted = true;
          matchedUrl = visibleResult.querySelector('a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid="]')?.href || "";
          matchMethod = "visible-result-card";
        } else if (evidenceLines.length) {
          accepted = true;
          matchMethod = "registration-text";
        }
      }
    }

    await chrome.runtime.sendMessage({
      type: "GROUP_POST_STATUS_PAGE_RESULT",
      jobId: state.job.id,
      groupIndex: state.groupIndex,
      result: {
        name: target.name || "",
        url: canonicalGroupUrl(target.url) || canonicalGroupUrl(location.href),
        registration: target.registration || "",
        accepted,
        pending: !accepted && pending,
        declined,
        unavailable,
        matchedUrl,
        matchMethod,
        checkedAt: new Date().toISOString(),
        ...(target.postedAt ? { postedAt: target.postedAt } : {}),
      },
    });
  }

  function renewalPermalink(value, groupUrl) {
    try {
      const url = new URL(value, location.origin);
      const post = url.pathname.match(/^\/groups\/([^/]+)\/(?:posts|permalink)\/(\d+)\/?$/i);
      if (url.origin !== "https://www.facebook.com" || !post || canonicalGroupUrl(url.href) !== canonicalGroupUrl(groupUrl)) return "";
      return `${canonicalGroupUrl(groupUrl)}posts/${post[2]}/`;
    } catch { return ""; }
  }

  function findRenewalAdvert(target, wantedReg) {
    const expected = Date.parse(target.postedAt);
    if (!wantedReg || !Number.isFinite(expected)) return null;
    const known = target.permalink ? renewalPermalink(target.permalink, target.url) : "";
    const london = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", dateStyle: "short" });
    const matches = new Map();
    for (const article of [...document.querySelectorAll('[role="article"], article')].filter(visible)) {
      const text = article.innerText || "";
      if (!advertRegistrationLine(text, wantedReg)) continue;
      const links = [...article.querySelectorAll('a[href*="/posts/"],a[href*="/permalink/"]')];
      const posts = [...new Set(links.map(link => renewalPermalink(link.href, target.url)).filter(Boolean))];
      if (!posts.length && known && renewalPermalink(location.href, target.url) === known) posts.push(known);
      if (posts.length !== 1 || (known && posts[0] !== known)) continue;
      const labelledDate = links.map(link => link.getAttribute("aria-label") || link.getAttribute("title") || "")
        .find(label => /\b20\d{2}\b/.test(label));
      const unix = article.querySelector("[data-utime]")?.getAttribute("data-utime");
      const when = Date.parse(article.querySelector("time[datetime]")?.getAttribute("datetime") || labelledDate || "");
      const observed = Number.isFinite(when) ? when : unix && /^\d{10}$/.test(unix) ? Number(unix) * 1000 : NaN;
      const windowMatches = Number.isFinite(observed) && (target.reviewKind === "group"
        ? london.format(observed) === london.format(expected) : Math.abs(observed - expected) <= 5 * 60_000);
      if (!known && (!windowMatches || !/rent2buyvans\.co\.uk|vanfinancecompany\.co\.uk\/rent2buy/i.test(text))) continue;
      const declined = /post (?:was )?(?:declined|rejected|not approved)|declined by (?:an )?admin/i.test(text);
      const pending = /pending approval|awaiting (?:admin )?approval|waiting for (?:admin )?approval/i.test(text);
      matches.set(posts[0], { url: posts[0], declined, pending, observedAt: new Date(Number.isFinite(observed) ? observed : expected).toISOString() });
    }
    return matches.size === 1 ? [...matches.values()][0] : null;
  }

  function dataUrlToFile(dataUrl, filename) {
    const parts = String(dataUrl || "").split(",");
    const header = parts[0] || "";
    const base64 = parts[1] || "";
    const mime = header.match(/data:([^;]+)/)?.[1] || "image/jpeg";
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new File([bytes], filename, { type: mime });
  }

  async function attachImage(job, dialog) {
    if (!job.imageUrl) return { ok: true, detail: "No image supplied" };
    if (!isVerifiedCreatePostDialog(dialog)) {
      return { ok: false, detail: "Verified Create Post composer required before attaching an image" };
    }

    let input = [...dialog.querySelectorAll('input[type="file"]')]
      .find((element) => String(element.accept || "").includes("image") || !element.accept);

    if (!input) {
      const photoButton = [...dialog.querySelectorAll('button, [role="button"]')]
        .filter(visible)
        .find((element) => /photo|video/i.test(elementEvidence(element)));
      if (photoButton) {
        photoButton.click();
        await sleep(800);
        if (!isVerifiedCreatePostDialog(dialog)) {
          return { ok: false, detail: "Create Post composer changed before photo upload" };
        }
        input = [...dialog.querySelectorAll('input[type="file"]')]
          .find((element) => String(element.accept || "").includes("image") || !element.accept);
      }
    }
    if (!input) return { ok: false, detail: "Photo input not found inside the verified Create Post composer" };

    const result = await chrome.runtime.sendMessage({ type: "FETCH_MARKETPLACE_IMAGE", url: job.imageUrl });
    if (!result?.ok || !result.dataUrl) return { ok: false, detail: result?.error || "Image fetch failed" };
    const transfer = new DataTransfer();
    transfer.items.add(dataUrlToFile(result.dataUrl, (job.registration || "van") + "-group.jpg"));
    input.files = transfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(1200);
    return { ok: true, detail: "Image attached inside verified Create Post composer" };
  }

  function showPostReport(job, results, fatalMessage = "", nextStep = "") {
    document.getElementById("vfc-group-helper-report")?.remove();
    const panel = document.createElement("div");
    panel.id = "vfc-group-helper-report";
    panel.style.cssText = [
      "position:fixed",
      "right:18px",
      "bottom:18px",
      "z-index:2147483647",
      "width:min(430px,calc(100vw - 36px))",
      "background:#111",
      "color:#fff",
      "border:2px solid #e31b23",
      "border-radius:12px",
      "padding:14px",
      "font:14px/1.45 Arial,sans-serif",
      "box-shadow:0 12px 35px rgba(0,0,0,.45)",
    ].join(";");
    const escape = (value) => String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const failed = results.filter((item) => !item.ok);
    const failureHtml = fatalMessage
      ? '<div style="margin-top:8px;color:#ffd5d5"><b>' + escape(fatalMessage) + "</b></div>"
      : failed.length
        ? '<div style="margin-top:8px;color:#ffd5d5"><b>Needs attention:</b><br>' + failed.map((item) => "• " + escape(item.label) + ": " + escape(item.detail)).join("<br>") + "</div>"
        : '<div style="margin-top:8px;color:#bfffc8"><b>Post is prepared for review.</b></div>';
    panel.innerHTML =
      '<div style="font-size:16px;font-weight:700">VFC Facebook Groups Helper</div>' +
      '<div style="margin-top:4px">' + escape(job.groupName || "Facebook group") + " • " + escape(job.registration || "selected van") + "</div>" +
      '<div style="margin-top:8px">' + results.filter((item) => item.ok).length + "/" + results.length + " preparation checks succeeded.</div>" +
      failureHtml +
      (nextStep ? '<div style="margin-top:10px;color:#fff"><b>Next:</b> ' + escape(nextStep) + "</div>" : "") +
      '<div style="margin-top:10px;color:#ddd"><b>Nothing has been posted.</b> Check the group rules and advert, then click Facebook\'s Post button yourself.</div>';
    if (job.renewal) {
      const copy = document.createElement("button");
      copy.type = "button";
      copy.textContent = "Copy caption";
      copy.addEventListener("click", async (event) => {
        if (!event.isTrusted) return;
        try {
          await navigator.clipboard.writeText(job.caption);
          copy.textContent = "Copied · paste into the composer";
        } catch {
          const caption = document.createElement("textarea");
          caption.readOnly = true;
          caption.value = job.caption;
          caption.setAttribute("aria-label", "Prepared caption");
          panel.appendChild(caption);
          caption.select();
        }
      });
      panel.appendChild(copy);
    }
    document.body.appendChild(panel);
  }

  function watchManualGroupPost(job, dialog) {
    let sent = false;

    async function onClick(event) {
      if (sent) return;
      const button = event.target?.closest?.('button, [role="button"]');
      if (!button || !visible(button)) return;
      if (dialog && dialog !== document && !dialog.contains(button)) return;
      const label = clean(button.innerText || button.textContent || button.getAttribute("aria-label"));
      if (!/^post(?:\s|$)/i.test(label)) return;
      if (button.disabled || button.getAttribute("aria-disabled") === "true") return;

      sent = true;
      await sleep(1800);
      const pageText = clean(document.body?.innerText || "");
      const approvalState = /pending approval|awaiting approval|waiting for admin approval|post is pending/i.test(pageText)
        ? "pending"
        : "submitted";

      chrome.runtime.sendMessage({
        type: "GROUP_POST_SUBMITTED",
        jobId: job.id,
        groupUrl: canonicalGroupUrl(job.groupUrl),
        registration: job.registration || "",
        postedAt: new Date().toISOString(),
        approvalState,
      }).catch(() => {});
    }

    document.addEventListener("click", onClick, true);
    window.setTimeout(() => document.removeEventListener("click", onClick, true), 15 * 60 * 1000);
  }

  function renewalFeedback() {
    return [...document.querySelectorAll('[role="alert"],[role="status"],[aria-live="polite"],[aria-live="assertive"]')]
      .filter(visible).map((element) => clean(element.innerText || element.textContent)).filter((text) => text && text.length < 240);
  }

  function renewalRestriction() {
    return [...renewalFeedback(), ...pageLines().slice(0, 45)].some((text) =>
      /^(?:security check|confirm your identity|we (?:temporarily )?restricted your account|your account (?:has been|is) restricted|you(?:’|')re temporarily blocked|you can(?:not|'t) post right now)\b/i.test(text));
  }

  function renewalOutcome(job, status, detail = {}) {
    return chrome.runtime.sendMessage({ type: "GROUP_RENEWAL_OUTCOME", jobId: job.id, result: { status, ...detail } });
  }

  function classifyRenewalFeedback(feedback) {
    if (feedback.some(text => /\b(?:your )?post (?:was |has been |is )?(?:submitted|sent) for (?:admin )?approval\b|\byour post is (?:now )?(?:pending|awaiting) approval\b/i.test(text))) return "pending";
    if (feedback.some(text => /^(?:your )?post (?:was |has been )?(?:published|posted|shared)(?: successfully)?(?:[.!]|\s+(?:in|to) (?:the|this) group|\s+View post|$)/i.test(text))) return "submitted";
    if (feedback.some(text => /couldn[’']t (?:publish|create|share) your post|post couldn[’']t be (?:published|shared)|failed to post/i.test(text))) return "failed";
    return "";
  }

  async function verifyRenewalSubmission(job, dialog, captionHasRegistration) {
    const before = new Set(renewalFeedback());
    const seen = new Set();
    const postedAt = new Date().toISOString();
    const target = { url: job.groupUrl, postedAt };
    const registration = normalizeRegistration(job.registration);
    const priorAdvert = captionHasRegistration && findRenewalAdvert(target, registration);
    const collect = () => renewalFeedback().forEach(text => { if (!before.has(text)) seen.add(text); });
    const observer = new MutationObserver(collect);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
    try {
      for (let attempt = 0; attempt < 25; attempt += 1) {
        await sleep(600);
        if (renewalRestriction()) return renewalOutcome(job, "stop", { reason: "Facebook reported an account restriction or security check" });
        collect();
        const feedback = classifyRenewalFeedback([...seen]);
        const advert = captionHasRegistration && findRenewalAdvert(target, registration);
        if (advert && advert.url !== priorAdvert?.url && !advert.declined) {
          return renewalOutcome(job, "submitted", { approvalState: advert.pending ? "pending" : "accepted", permalink: advert.url });
        }
        if (captionHasRegistration && (feedback === "pending" || feedback === "submitted")) {
          return renewalOutcome(job, "submitted", { approvalState: feedback });
        }
        if (feedback === "failed" && dialog.isConnected && visible(dialog)) {
          return renewalOutcome(job, "failed", { reason: "Facebook reported a failed post and left the composer open.", failureStage: "publication" });
        }
      }
      return renewalOutcome(job, "needs_attention", { reason: "Facebook did not confirm this exact advert. Check the previous submission before retrying.", duplicateRisk: true, failureStage: "publication" });
    } finally { observer.disconnect(); }
  }

  function actionableRenewalPost(element) {
    return Boolean(visible(element) && !element.disabled && element.getAttribute("aria-disabled") !== "true" &&
      /^post$/i.test(clean(element.getAttribute("aria-label") || element.innerText || element.textContent)));
  }

  function watchRenewalPost(job, dialog, editor) {
    function onClick(event) {
      const button = event.target?.closest?.('button, [role="button"]');
      if (!event.isTrusted || !button || !dialog.contains(button) || !actionableRenewalPost(button)) return;
      document.removeEventListener("click", onClick, true);
      const captionHasRegistration = normalizeRegistration(editor.innerText || editor.textContent).includes(normalizeRegistration(job.registration));
      void verifyRenewalSubmission(job, dialog, captionHasRegistration).catch(() => {});
    }
    document.addEventListener("click", onClick, true);
  }

  function attachedPhoto(dialog) {
    return [...dialog.querySelectorAll('img[src^="blob:"],img[src^="data:image/"],[style*="blob:"],button[aria-label*="Remove photo" i],[role="button"][aria-label*="Remove photo" i]')]
      .find(visible);
  }

  async function submitAutomaticRenewal(job, dialog, editor) {
    const compact = (value) => clean(value).replace(/\s+/g, " ");
    const content = () => editor.innerText || editor.textContent || "";
    if (!advertRegistrationLine(job.caption || "", normalizeRegistration(job.registration))) {
      return renewalOutcome(job, "needs_attention", { reason: "The prepared caption did not identify the selected van" });
    }
    if (compact(content())) {
      return renewalOutcome(job, "needs_attention", { reason: "The verified composer was not empty" });
    }
    if (renewalRestriction()) return renewalOutcome(job, "stop", { reason: "Facebook requires account or security review" });

    const files = new DataTransfer();
    files.setData("text/plain", job.caption);
    editor.focus();
    editor.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: files }));
    let post = null;
    for (let check = 0; check < 20; check += 1) {
      await sleep(500);
      if (renewalRestriction()) return renewalOutcome(job, "stop", { reason: "Facebook requires account or security review" });
      if (!dialog.contains(editor) || !isVerifiedCreatePostDialog(dialog)) break;
      if (compact(content()) !== compact(job.caption) || !attachedPhoto(dialog)) continue;
      const buttons = [...dialog.querySelectorAll('button, [role="button"]')].filter(actionableRenewalPost);
      if (buttons.length === 1) {
        post = buttons[0];
        break;
      }
    }
    if (!post) return renewalOutcome(job, "needs_attention", { reason: "Could not verify the caption, attached photo and Post button in Facebook" });

    const reserved = await chrome.runtime.sendMessage({ type: "BEGIN_GROUP_RENEWAL_SUBMISSION", jobId: job.id });
    if (!reserved?.ok) return renewalOutcome(job, "needs_attention", { reason: reserved?.error || "Automatic submission was stopped before posting" });
    if (renewalRestriction()) return renewalOutcome(job, "stop", { reason: "Facebook requires account or security review" });
    if (!dialog.contains(post) || !dialog.contains(editor) || !actionableRenewalPost(post) ||
        !attachedPhoto(dialog) || compact(content()) !== compact(job.caption)) {
      return renewalOutcome(job, "needs_attention", { reason: "The composer changed before submission" });
    }
    const verification = verifyRenewalSubmission(job, dialog, true);
    post.click();
    return verification;
  }


  // Automatic preparation: observe the actual composer as Facebook renders it.
  // Background tabs can delay timers; DOM changes also trigger a strict check.
  // This does not relax any composer, membership or publication safeguard.
  function renewalComposerSnapshot() {
    const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(visible);
    const identified = dialogs.filter(dialogHasCreatePostIdentity);
    const withPost = identified.filter(dialogHasLocalPostButton);
    const editors = withPost.reduce((count, dialog) => count + composerEditorCandidates(dialog).length, 0);
    return { dialogs: dialogs.length, headings: identified.length, postButtons: withPost.length,
      editors, visibility: document.visibilityState || "unknown" };
  }

  async function waitForRenewalComposer(timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    let openerSeen = false;
    let opened = false;
    let placeholderClicked = false;
    return new Promise((resolve) => {
      let settled = false;
      let observer = null;
      let interval = null;
      let timer = null;
      let scanning = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        observer?.disconnect();
        if (interval !== null) clearInterval(interval);
        if (timer !== null) clearTimeout(timer);
        document.removeEventListener("visibilitychange", scan);
        resolve({ openerSeen, ...result });
      };
      const failure = () => {
        if (settled) return;
        let diagnostic;
        try { diagnostic = renewalComposerSnapshot(); }
        catch { diagnostic = { error: "DOM snapshot unavailable" }; }
        finish({ editor: null, scope: null, verified: false, diagnostic });
      };
      function scan() {
        if (settled || scanning) return;
        scanning = true;
        try {
          if (renewalRestriction() || membershipPendingVisible() || Date.now() >= deadline) {
            failure();
            return;
          }
          const dialog = verifiedComposerDialog();
          if (dialog) {
            let editor = composerEditorCandidates(dialog)[0] || editorFromPlaceholder(dialog);
            const active = document.activeElement;
            if (!editor && placeholderClicked && active && active !== document.body &&
                dialog.contains(active) && !isRejectedComposerEditor(active) &&
                (active.getAttribute?.("role") === "textbox" ||
                 ["true", "plaintext-only"].includes(active.getAttribute?.("contenteditable")) ||
                 active.getAttribute?.("data-lexical-editor") === "true")) editor = active;
            if (editor && dialog.contains(editor) && !isRejectedComposerEditor(editor)) {
              finish({ editor, scope: dialog, verified: true });
              return;
            }
            // Same placeholder fallback as manual preparation, but only once.
            const placeholder = [...dialog.querySelectorAll("div, span, p")].filter(visible)
              .find(element => COMPOSER_EDITOR_PATTERN.test(elementEvidence(element)));
            if (placeholder && !placeholderClicked) {
              placeholderClicked = true;
              try { placeholder.click(); } catch {}
            }
            return;
          }
          // A partially rendered Create Post dialog is not another opener.
          if (!opened && ![...document.querySelectorAll('[role="dialog"]')].some(dialogHasCreatePostIdentity)) {
            const opener = findComposerOpener();
            if (opener) {
              openerSeen = true;
              try { opener.click(); opened = true; } catch {}
            }
          }
        } catch (error) {
          console.warn("VFC composer observation failed", error);
          finish({ editor: null, scope: null, verified: false, diagnostic: { error: "DOM observation failed" } });
        } finally { scanning = false; }
      }
      observer = new MutationObserver(scan);
      observer.observe(document.body, { childList: true, subtree: true, characterData: true,
        attributes: true, attributeFilter: ["role", "aria-label", "aria-hidden", "aria-disabled", "contenteditable", "data-lexical-editor", "style", "class"] });
      document.addEventListener("visibilitychange", scan);
      interval = setInterval(scan, 500);
      timer = setTimeout(failure, timeoutMs);
      scan();
    });
  }

  function renewalComposerTimeoutReason(openerSeen, diagnostic) {
    const prefix = openerSeen ? "Create Post opener found; composer timeout" : "Create Post composer/opener timeout";
    if (!diagnostic) return prefix;
    if (diagnostic.error) return `${prefix}; ${diagnostic.error}`;
    return `${prefix}; visible dialogs=${diagnostic.dialogs}, Create Post=${diagnostic.headings}, local Post=${diagnostic.postButtons}, valid editors=${diagnostic.editors}, tab=${diagnostic.visibility}`;
  }

  // A Join group button is not a posting restriction in a public group.
  // The verified composer is the positive signal; explicit blocks still win.
  function renewalComposerBlock() {
    if (renewalRestriction()) return "Facebook reported an account restriction";
    if (membershipPendingVisible()) return "Membership is pending";
    return "";
  }

  async function prepareGroupPost(job) {
    if (!location.pathname.startsWith("/groups/")) return;
    await sleep(1200);
    const results = [];
    if (job.renewal && renewalRestriction()) {
      await renewalOutcome(job, "stop", { reason: "Facebook requires account or security review" });
      return;
    }

    let editor, scope, verified, openerSeen, diagnostic;
    if (job.renewal?.automatic) {
      ({ editor, scope, verified, openerSeen, diagnostic } = await waitForRenewalComposer());
    } else {
      ({ editor, scope, verified } = await waitForComposerEditor(1200));
      if (!editor || !verified) {
        const opener = findComposerOpener();
        if (opener) {
          try { opener.click(); } catch {}
          ({ editor, scope, verified } = await waitForComposerEditor(6500));
        }
      }
    }

    if (!editor || !scope || !verified || !isVerifiedCreatePostDialog(scope)) {
      const membershipPending = await waitForMembershipPending(5000);
      if (job.renewal) {
        const restricted = renewalRestriction();
        await renewalOutcome(job, restricted ? "stop" : "needs_attention", {
          reason: restricted ? "Facebook requires account or security review" :
            membershipPending ? "Membership is pending" :
              job.renewal.automatic ? renewalComposerTimeoutReason(openerSeen, diagnostic) :
                "Posting permission or group composer could not be verified",
        });
        return;
      }
      const fatalMessage = membershipPending
        ? "Facebook says your membership is pending. This group has been moved to Pending Membership."
        : "Could not verify Facebook group post composer. Nothing was inserted.";
      results.push({
        label: "Composer",
        ok: false,
        detail: membershipPending ? "Posting blocked while group membership is pending" : "Verified Create Post dialog not found",
      });
      results.push({ label: "Caption clipboard", ok: Boolean(job.captionCopied), detail: job.captionCopied ? "Caption copied before Facebook opened" : "Caption was not copied" });
      results.push({ label: "Photo", ok: false, detail: "Skipped because the composer was not verified" });
      showPostReport(job, results, fatalMessage);
      await chrome.runtime.sendMessage({
        type: "GROUP_POST_FILL_COMPLETED",
        jobId: job.id,
        results,
        membershipPending,
      });
      return;
    }

    results.push({ label: "Composer", ok: true, detail: "Verified Create Post dialog" });
    if (job.renewal) {
      const block = renewalComposerBlock();
      if (block) {
        const restricted = renewalRestriction();
        await renewalOutcome(job, restricted ? "stop" : "needs_attention", { reason: block });
        return;
      }
      const ruleEvidence = job.renewal.automatic ? extractRuleEvidence(pageLines().slice(0, 60)) : "";
      if (explicitRuleStatus(ruleEvidence) === "Red" || /\b(?:no (?:external )?links|links? (?:are )?not allowed)\b/i.test(ruleEvidence)) {
        await renewalOutcome(job, "needs_attention", { reason: "Facebook shows a group rule that prohibits commercial adverts" });
        return;
      }
      if (job.renewal.automatic && (attachedPhoto(scope) || clean(editor.innerText || editor.textContent))) {
        await renewalOutcome(job, "needs_attention", { reason: "Facebook opened an existing draft. It was left alone." });
        return;
      }
      let image;
      try { image = await attachImage(job, scope); }
      catch { image = { ok: false, detail: "Facebook did not accept the stock photo" }; }
      if (!image.ok) {
        await renewalOutcome(job, "needs_attention", { reason: image.detail });
        return;
      }
      const ready = await chrome.runtime.sendMessage({ type: "GROUP_RENEWAL_READY", jobId: job.id });
      if (!ready?.ok) return;
      if (job.renewal.automatic) {
        await submitAutomaticRenewal(job, scope, editor);
        return;
      }
      watchRenewalPost(job, scope, editor);
      showPostReport(job, [...results, image, { label: "Caption", ok: true, detail: "Ready to copy" }],
        "", "Copy and paste the caption, review the advert and click Post.");
      return;
    }
    results.push({
      label: "Caption clipboard",
      ok: Boolean(job.captionCopied),
      detail: job.captionCopied
        ? "Formatted CRM caption copied to clipboard"
        : "Clipboard copy was unavailable; copy the caption from the CRM manually",
    });

    const imageResult = await attachImage(job, scope);
    results.push({ label: "Photo", ok: imageResult.ok, detail: imageResult.detail });

    try { editor.focus(); } catch {}
    watchManualGroupPost(job, scope);

    const instruction = job.captionCopied
      ? "Caption copied. Click in the Facebook text box and press Ctrl+V, review the advert, then click Post."
      : "Copy the caption from the CRM, paste it into the Facebook text box, review the advert, then click Post.";
    showPostReport(job, results, "", instruction);
    await chrome.runtime.sendMessage({ type: "GROUP_POST_FILL_COMPLETED", jobId: job.id, results });
  }

  if (window.__VFC_FACEBOOK_GROUPS_TEST_HOOKS__ && typeof window.__VFC_FACEBOOK_GROUPS_TEST_HOOKS__ === "object") {
    Object.assign(window.__VFC_FACEBOOK_GROUPS_TEST_HOOKS__, {
      elementEvidence,
      findComposerOpener,
      isVerifiedCreatePostDialog,
      verifiedComposerDialog,
      isRejectedComposerEditor,
      composerEditorCandidates,
      waitForComposerEditor,
      waitForRenewalComposer,
      renewalComposerSnapshot,
      renewalComposerTimeoutReason,
      attachImage,
      registrationEvidenceLines,
      visibleAdvertCardForExactSearch,
      visibleFinanceAdvertForExactSearch,
      visibleRent2BuyAdvertForExactSearch,
      membershipPendingVisible,
      waitForMembershipPending,
      watchRenewalPost,
      submitAutomaticRenewal,
      classifyRenewalFeedback,
      findRenewalAdvert,
      checkPostedStatus,
      prepareGroupPost,
    });
  }

  if (window.__VFC_FACEBOOK_GROUPS_TEST_MODE__) return;

  (async () => {
    const postResult = await chrome.runtime.sendMessage({ type: "GET_PENDING_GROUP_POST_JOB" }).catch(() => null);
    const job = postResult?.job || null;
    if (job?.id && location.pathname.startsWith("/groups/")) {
      await prepareGroupPost(job);
      return;
    }

    const stateResult = await chrome.runtime.sendMessage({ type: "GET_GROUP_AGENT_STATE" }).catch(() => null);
    const state = stateResult?.state || null;

    if (
      state?.mode === "discovery" &&
      (location.pathname.startsWith("/search/groups") || location.pathname.startsWith("/groups/search"))
    ) {
      await sleep(1600);
      await collectSearchResults(state);
      return;
    }

    if (state?.mode === "inspection" && location.pathname.startsWith("/groups/")) {
      await inspectGroup(state);
      return;
    }

    if (
      (state?.mode === "post-status" || state?.mode === "auto-post-status") &&
      location.pathname.startsWith("/groups/")
    ) {
      await checkPostedStatus(state);
    }
  })().catch((error) => {
    console.error("VFC Facebook Groups Helper failed", error);
  });
})();

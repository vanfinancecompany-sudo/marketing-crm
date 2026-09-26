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
      },
    });
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
    const failed = results.filter((item) => !item.ok);
    const failureHtml = fatalMessage
      ? '<div style="margin-top:8px;color:#ffd5d5"><b>' + fatalMessage + "</b></div>"
      : failed.length
        ? '<div style="margin-top:8px;color:#ffd5d5"><b>Needs attention:</b><br>' + failed.map((item) => "• " + item.label + ": " + item.detail).join("<br>") + "</div>"
        : '<div style="margin-top:8px;color:#bfffc8"><b>Post is prepared for review.</b></div>';
    panel.innerHTML =
      '<div style="font-size:16px;font-weight:700">VFC Facebook Groups Helper</div>' +
      '<div style="margin-top:4px">' + (job.groupName || "Facebook group") + " • " + (job.registration || "selected van") + "</div>" +
      '<div style="margin-top:8px">' + results.filter((item) => item.ok).length + "/" + results.length + " preparation checks succeeded.</div>" +
      failureHtml +
      (nextStep ? '<div style="margin-top:10px;color:#fff"><b>Next:</b> ' + nextStep + "</div>" : "") +
      '<div style="margin-top:10px;color:#ddd"><b>Nothing has been posted.</b> Check the group rules and advert, then click Facebook\'s Post button yourself.</div>';
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

  async function prepareGroupPost(job) {
    if (!location.pathname.startsWith("/groups/")) return;
    await sleep(1200);
    const results = [];

    let { editor, scope, verified } = await waitForComposerEditor(1200);
    if (!editor || !verified) {
      const opener = findComposerOpener();
      if (opener) {
        try { opener.click(); } catch {}
        ({ editor, scope, verified } = await waitForComposerEditor(6500));
      }
    }

    if (!editor || !scope || !verified || !isVerifiedCreatePostDialog(scope)) {
      const membershipPending = await waitForMembershipPending(5000);
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
      attachImage,
      registrationEvidenceLines,
      visibleAdvertCardForExactSearch,
      visibleFinanceAdvertForExactSearch,
      visibleRent2BuyAdvertForExactSearch,
      membershipPendingVisible,
      waitForMembershipPending,
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

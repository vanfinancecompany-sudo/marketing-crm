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
    if (direct.length >= 3 && direct.length <= 180) return direct.split("
")[0];
    const lines = String(context || "").split(/
+/).map(clean).filter(Boolean);
    return lines.find((line) => line.length >= 3 && line.length <= 180) || "Facebook group";
  }

  function parseMembers(context) {
    const text = clean(context);
    const match = text.match(/([0-9][0-9,.]*s*[KMB]?)s+(?:members?|member)/i);
    return match ? clean(match[1]) : "";
  }

  function parsePrivacy(context) {
    if (/publics+group/i.test(context)) return "Public";
    if (/privates+group/i.test(context)) return "Private";
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
    return String(document.body?.innerText || "")
      .split(/
+/)
      .map(clean)
      .filter(Boolean);
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

  async function inspectGroup(state) {
    await sleep(1800);
    const lines = pageLines();
    const pageText = lines.join("
").slice(0, 30000);
    const ruleEvidence = extractRuleEvidence(lines);
    const canPost = Boolean(
      buttonWithText(/write something|what'?s on your mind|create post/i)
      || [...document.querySelectorAll('[contenteditable="true"][role="textbox"]')].some(visible)
    );
    const joinButton = buttonWithText(/^join(?: group)?$/i);
    const joinedButton = buttonWithText(/^joined$/i);
    const joined = canPost || Boolean(joinedButton) ? true : joinButton ? false : null;
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
        explicitStatus: explicitRuleStatus(ruleEvidence),
        canPost,
        joined,
        approvalRequired,
        linksAllowed,
        privacy: /public group/i.test(pageText) ? "Public" : /private group/i.test(pageText) ? "Private" : "",
        members: parseMembers(pageText),
      },
    });
  }

  function reactSetText(element, value) {
    element.focus();
    try {
      document.execCommand("selectAll", false, null);
      document.execCommand("insertText", false, value);
    } catch {
      element.textContent = value;
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    }
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
    let input = [...(dialog || document).querySelectorAll('input[type="file"]')]
      .find((element) => String(element.accept || "").includes("image") || !element.accept);

    if (!input) {
      const photoButton = [...(dialog || document).querySelectorAll('button, [role="button"]')]
        .filter(visible)
        .find((element) => /photo|video/i.test(clean(element.innerText || element.textContent || element.getAttribute("aria-label"))));
      if (photoButton) {
        photoButton.click();
        await sleep(800);
        input = [...document.querySelectorAll('input[type="file"]')]
          .find((element) => String(element.accept || "").includes("image") || !element.accept);
      }
    }
    if (!input) return { ok: false, detail: "Photo input not found" };

    const result = await chrome.runtime.sendMessage({ type: "FETCH_MARKETPLACE_IMAGE", url: job.imageUrl });
    if (!result?.ok || !result.dataUrl) return { ok: false, detail: result?.error || "Image fetch failed" };
    const transfer = new DataTransfer();
    transfer.items.add(dataUrlToFile(result.dataUrl, (job.registration || "van") + "-group.jpg"));
    input.files = transfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(1200);
    return { ok: true, detail: "Image attached" };
  }

  function showPostReport(job, results) {
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
    const failureHtml = failed.length
      ? '<div style="margin-top:8px;color:#ffd5d5"><b>Needs attention:</b><br>' + failed.map((item) => "• " + item.label + ": " + item.detail).join("<br>") + "</div>"
      : '<div style="margin-top:8px;color:#bfffc8"><b>Post is prepared for review.</b></div>';
    panel.innerHTML =
      '<div style="font-size:16px;font-weight:700">VFC Facebook Groups Helper</div>' +
      '<div style="margin-top:4px">' + (job.groupName || "Facebook group") + " • " + (job.registration || "selected van") + "</div>" +
      '<div style="margin-top:8px">' + results.filter((item) => item.ok).length + "/" + results.length + " preparation checks succeeded.</div>" +
      failureHtml +
      '<div style="margin-top:10px;color:#ddd"><b>Nothing has been posted.</b> Check the group rules and advert, then click Facebook\'s Post button yourself.</div>';
    document.body.appendChild(panel);
  }

  async function prepareGroupPost(job) {
    if (canonicalGroupUrl(location.href) !== canonicalGroupUrl(job.groupUrl)) return;
    await sleep(1600);
    const results = [];

    const opener = buttonWithText(/write something|what'?s on your mind|create post/i);
    if (opener) {
      opener.click();
      results.push({ label: "Composer", ok: true, detail: "Opened" });
      await sleep(1000);
    }

    const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(visible);
    const dialog = dialogs[dialogs.length - 1] || document;
    const editor = [...dialog.querySelectorAll('[contenteditable="true"][role="textbox"], [contenteditable="true"]')]
      .filter(visible)
      .find((element) => !/comment/i.test(clean(element.getAttribute("aria-label"))));

    if (editor) {
      reactSetText(editor, job.caption || "");
      await sleep(500);
      results.push({ label: "Post text", ok: clean(editor.innerText || editor.textContent).length > 10, detail: "Caption inserted" });
    } else {
      results.push({ label: "Post text", ok: false, detail: "Composer text box not found" });
    }

    const imageResult = await attachImage(job, dialog);
    results.push({ label: "Photo", ok: imageResult.ok, detail: imageResult.detail });
    showPostReport(job, results);
    await chrome.runtime.sendMessage({ type: "GROUP_POST_FILL_COMPLETED", jobId: job.id, results });
  }

  (async () => {
    const stateResult = await chrome.runtime.sendMessage({ type: "GET_GROUP_AGENT_STATE" }).catch(() => null);
    const state = stateResult?.state || null;

    if (state?.mode === "discovery" && location.pathname.startsWith("/search/groups")) {
      await sleep(1600);
      await collectSearchResults(state);
      return;
    }

    if (state?.mode === "inspection" && location.pathname.startsWith("/groups/")) {
      await inspectGroup(state);
      return;
    }

    const postResult = await chrome.runtime.sendMessage({ type: "GET_PENDING_GROUP_POST_JOB" }).catch(() => null);
    const job = postResult?.job || null;
    if (job?.id && location.pathname.startsWith("/groups/")) {
      await prepareGroupPost(job);
    }
  })().catch((error) => {
    console.error("VFC Facebook Groups Helper failed", error);
  });
})();

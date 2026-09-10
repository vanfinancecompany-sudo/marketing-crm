import { buildMarketingAccessHeaders, parseMarketingJsonResponse } from "../services/marketingAccess.js";

const ROOT_ATTRIBUTE = "data-dealerkit-controlled-publish";
let scanQueued = false;

const clean = (value) => String(value ?? "").trim();
const normaliseRegistration = (value) => clean(value).replace(/[^A-Z0-9]/gi, "").toUpperCase();

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function setStatus(root, text, state = "") {
  const status = root.querySelector("[data-controlled-publish-status]");
  if (!status) return;
  status.textContent = text;
  status.classList.remove("is-good", "is-warning", "is-busy");
  if (state) status.classList.add(state);
}

function confirmationInputMatches(root) {
  const input = root.querySelector("[data-controlled-publish-confirm]");
  return normaliseRegistration(input?.value) === normaliseRegistration(root.dataset.registration);
}

function refreshActionState(root) {
  const state = root._controlledPublishPayload;
  const typed = confirmationInputMatches(root);
  const prepare = root.querySelector("[data-controlled-publish-prepare]");
  const publish = root.querySelector("[data-controlled-publish-apply]");
  if (prepare) prepare.disabled = !typed || !state || !(state.media?.missingDealerKitImageIds?.length);
  if (publish) publish.disabled = !typed || !state?.plan?.canPublish;
}

function renderPayload(root, payload) {
  root._controlledPublishPayload = payload;
  const result = root.querySelector("[data-controlled-publish-result]");
  if (!result) return;
  result.replaceChildren();
  const plan = payload?.plan || {};
  const media = payload?.media || {};
  const productLabel = plan.mode === "rent2buy" ? "Rent2Buy" : plan.mode === "both" ? "Van Finance + Rent2Buy" : "Van Finance";

  const summary = element("div", "dealerkit-wix-preview__summary");
  summary.append(
    element("div", "", `Destination: ${productLabel}`),
    element("div", "", `Records to create: ${plan.targets?.length || 0}`),
    element("div", "", `DealerKit photos READY: ${media.dealerKitReady || 0}/${media.dealerKitExpected || 0}`),
    element("div", "", `Primary image: ${plan.mode === "rent2buy" ? plan.imageSets?.rent2buy?.mainSource || "not ready" : plan.imageSets?.vanFinance?.mainSource || "not ready"}`),
  );
  if (plan.rent2buy?.enabled && plan.rent2buy?.pricing) {
    const pricing = plan.rent2buy.pricing;
    summary.append(
      element("div", "", `Rent2Buy term: ${pricing.termMonths} months · ${pricing.upliftPercent}%`),
      element("div", "", `Rent2Buy: £${pricing.monthly} p/m · £${pricing.upfront} upfront · ${pricing.followingPayments} further payments`),
    );
  }
  result.appendChild(summary);

  if (media.missingDealerKitImageIds?.length) {
    result.appendChild(element("div", "dealerkit-wix-preview__messages dealerkit-wix-preview__messages--warnings", `${media.missingDealerKitImageIds.length} reviewed DealerKit image(s) still need preparing in Wix Media. This changes Media Manager only, never vehicle CMS rows.`));
  }

  if (plan.blockers?.length) {
    const blockers = element("div", "dealerkit-wix-preview__messages dealerkit-wix-preview__messages--blockers");
    blockers.appendChild(element("strong", "", `Publish blockers (${plan.blockers.length})`));
    for (const blocker of plan.blockers) blockers.appendChild(element("div", "", blocker.message || blocker.code));
    result.appendChild(blockers);
  }

  const imageRule = element("div", "dealerkit-wix-preview__field-line", plan.mode === "rent2buy"
    ? "The selected Rent2Buy primary becomes its card image and the first vehicle-page image. Van Finance images are untouched."
    : "The selected Van Finance primary becomes its card image and the first vehicle-page image. Rent2Buy images are untouched.");
  result.appendChild(imageRule);

  const verdict = element("div", `dealerkit-wix-preview__verdict ${plan.canPublish ? "is-good" : "is-warning"}`, plan.canPublish
    ? "FINAL WRITE READY · Fresh DealerKit, Wix rows and all required Wix Media passed the release gates."
    : "FINAL WRITE LOCKED · Resolve the blockers above, then check readiness again.");
  result.appendChild(verdict);
  result.hidden = false;

  setStatus(root, plan.canPublish ? "READY TO PUBLISH" : media.missingDealerKitImageIds?.length ? "PREPARE IMAGES" : "BLOCKED", plan.canPublish ? "is-good" : "is-warning");
  refreshActionState(root);
}

async function loadPreview(root) {
  const registration = normaliseRegistration(root.dataset.registration);
  if (!registration) return;
  setStatus(root, "FRESH RECHECK", "is-busy");
  const result = root.querySelector("[data-controlled-publish-result]");
  if (result) {
    result.hidden = false;
    result.replaceChildren(element("div", "dealerkit-wix-preview__loading", "Re-reading DealerKit, review decisions, Wix Media and every relevant Wix CMS collection…"));
  }
  const product = clean(root.dataset.product) || "finance";
  const response = await fetch(`/api/dealerkit-controlled-publish-preview?registration=${encodeURIComponent(registration)}&product=${encodeURIComponent(product)}`, {
    headers: buildMarketingAccessHeaders({ accept: "application/json" }), cache: "no-store",
  });
  const payload = await parseMarketingJsonResponse(response, "Could not build final publish readiness.");
  renderPayload(root, payload);
}

function createPanel(registration, product = "finance") {
  const root = element("section", "dealerkit-wix-preview");
  root.setAttribute(ROOT_ATTRIBUTE, "true");
  root.dataset.registration = registration;
  root.dataset.product = product === "rent2buy" ? "rent2buy" : "finance";
  const productLabel = root.dataset.product === "rent2buy" ? "Rent2Buy" : "Van Finance";

  const top = element("div", "dealerkit-wix-preview__top");
  const copy = element("div", "dealerkit-wix-preview__copy");
  copy.append(
    element("span", "dealerkit-wix-preview__eyebrow", `${productLabel.toUpperCase()} · DEALERKIT → WIX`),
    element("strong", "", `Prepare and publish to ${productLabel}`),
    element("p", "", "Fresh DealerKit, image and Wix duplicate checks run automatically. No vehicle is published until you press Publish and accept the final confirmation."),
  );
  const actions = element("div", "dealerkit-wix-preview__actions");
  const status = element("span", "dealerkit-wix-preview__status", "CHECK FIRST");
  status.setAttribute("data-controlled-publish-status", "true");
  const check = element("button", "dealerkit-review__save", "Refresh checks");
  check.type = "button";
  actions.append(status, check);
  top.append(copy, actions);

  const confirm = element("div", "dealerkit-wix-preview__confirm");
  const label = document.createElement("label");
  label.textContent = `Type ${registration} to unlock Prepare and Publish`;
  const input = document.createElement("input");
  input.type = "text";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = registration;
  input.setAttribute("data-controlled-publish-confirm", "true");
  label.appendChild(input);
  const prepare = element("button", "dealerkit-wix-preview__apply", "Prepare images");
  prepare.type = "button";
  prepare.disabled = true;
  prepare.setAttribute("data-controlled-publish-prepare", "true");
  const publish = element("button", "dealerkit-wix-preview__apply", `Publish to ${productLabel}`);
  publish.type = "button";
  publish.disabled = true;
  publish.setAttribute("data-controlled-publish-apply", "true");
  confirm.append(label, prepare, publish);

  const result = element("div", "dealerkit-wix-preview__result");
  result.setAttribute("data-controlled-publish-result", "true");
  result.hidden = true;
  root.append(top, confirm, result);

  input.addEventListener("input", () => refreshActionState(root));
  check.addEventListener("click", async () => {
    check.disabled = true;
    check.textContent = "Checking…";
    try { await loadPreview(root); }
    catch (error) { setStatus(root, "CHECK FAILED", "is-warning"); result.replaceChildren(element("div", "dealerkit-wix-preview__error", error?.message || "Could not check final readiness.")); }
    finally { check.disabled = false; check.textContent = "Refresh checks"; }
  });

  prepare.addEventListener("click", async () => {
    if (!confirmationInputMatches(root)) return;
    const approved = window.confirm(`Prepare the approved DealerKit photographs for ${registration} in Wix Media?\n\nThis may add image files to Wix Media Manager, but it will NOT create or update any vehicle CMS row.`);
    if (!approved) return;
    prepare.disabled = true;
    publish.disabled = true;
    prepare.textContent = "Preparing Wix images…";
    setStatus(root, "MEDIA PREPARATION", "is-busy");
    try {
      const response = await fetch("/api/dealerkit-wix-prepare-media", {
        method: "POST",
        headers: buildMarketingAccessHeaders({ accept: "application/json", "content-type": "application/json" }),
        body: JSON.stringify({ registration, confirmRegistration: normaliseRegistration(input.value), productMode: root.dataset.product }),
      });
      const payload = await parseMarketingJsonResponse(response, "Could not prepare DealerKit images in Wix Media.");
      setStatus(root, payload.ready ? "IMAGES READY" : "WIX PROCESSING", payload.ready ? "is-good" : "is-busy");
      await loadPreview(root);
    } catch (error) {
      setStatus(root, "MEDIA BLOCKED", "is-warning");
      result.replaceChildren(element("div", "dealerkit-wix-preview__error", error?.message || "DealerKit image preparation failed. Vehicle CMS rows were not changed."));
    } finally {
      prepare.textContent = "Prepare images";
      refreshActionState(root);
    }
  });

  publish.addEventListener("click", async () => {
    const payload = root._controlledPublishPayload;
    if (!confirmationInputMatches(root) || !payload?.plan?.canPublish || !payload.plan.confirmation) return;
    const approved = window.confirm(`PUBLISH ${registration} TO LIVE ${productLabel.toUpperCase()} WIX?\n\nThis will create only the reviewed ${productLabel} records. The selected primary becomes the listing image and first gallery image. This is the final live-write confirmation.`);
    if (!approved) return;
    publish.disabled = true;
    prepare.disabled = true;
    publish.textContent = "Rechecking + publishing…";
    setStatus(root, "FINAL RECHECK", "is-busy");
    try {
      const response = await fetch("/api/dealerkit-controlled-publish", {
        method: "POST",
        headers: buildMarketingAccessHeaders({ accept: "application/json", "content-type": "application/json" }),
        body: JSON.stringify({ action: "publish_new_vehicle", registration, confirmRegistration: normaliseRegistration(input.value), productMode: root.dataset.product, confirmation: payload.plan.confirmation }),
      });
      const published = await parseMarketingJsonResponse(response, "Controlled Wix publishing failed.");
      setStatus(root, published.verified ? "PUBLISHED + VERIFIED" : "CHECK RESULT", published.verified ? "is-good" : "is-warning");
      result.replaceChildren(element("div", "dealerkit-wix-preview__verdict is-good", published.message || `${registration} was published and verified.`));
      root._controlledPublishPayload = null;
    } catch (error) {
      setStatus(root, "PUBLISH BLOCKED", "is-warning");
      result.replaceChildren(element("div", "dealerkit-wix-preview__error", error?.message || "Publishing failed. Check the rollback result before trying again."));
      try { await loadPreview(root); } catch {}
    } finally {
      publish.textContent = `Publish to ${productLabel}`;
      refreshActionState(root);
    }
  });

  queueMicrotask(() => loadPreview(root).catch((error) => {
    setStatus(root, "CHECK FAILED", "is-warning");
    result.hidden = false;
    result.replaceChildren(element("div", "dealerkit-wix-preview__error", error?.message || "Could not check readiness."));
  }));

  return root;
}

function installPanel() {
  if (typeof window === "undefined" || window.location.pathname !== "/vansco-stock-watch") return;
  const workspace = document.querySelector("[data-dealerkit-review-workspace]");
  if (!workspace || workspace.hidden) return;
  const gallery = workspace.querySelector("[data-dealerkit-product-gallery]");
  if (!gallery) return;
  const registration = normaliseRegistration(gallery.dataset.registration);
  const product = workspace.dataset.product === "rent2buy" ? "rent2buy" : "finance";
  if (!registration) return;
  let root = workspace.querySelector(`[${ROOT_ATTRIBUTE}]`);
  if (!root) {
    root = createPanel(registration, product);
    gallery.insertAdjacentElement("afterend", root);
  } else if (root.dataset.registration !== registration || root.dataset.product !== product) {
    root.replaceWith(createPanel(registration, product));
  }
}

function scheduleScan() {
  if (scanQueued) return;
  scanQueued = true;
  queueMicrotask(() => { scanQueued = false; installPanel(); });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scheduleScan, { once: true });
  else scheduleScan();
  window.addEventListener("popstate", scheduleScan);
  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
}

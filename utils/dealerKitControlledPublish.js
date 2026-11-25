import { retryTemporaryPublishOperation } from "../lib/dealerKitPublishRecovery.js";
import { dealerKitPublishedVehicleUrl, submitDealerKitVehicle } from "./dealerKitSubmitVehicle.js";
import { buildMarketingAccessHeaders, parseMarketingJsonResponse } from "../services/marketingAccess.js";

const ROOT_ATTRIBUTE = "data-dealerkit-controlled-publish";
let scanQueued = false;

// VFC_CREATE_OR_UPDATE_RECONCILE: the existing review panel now describes the
// create/update/publish/draft operations already present in the confirmed plan.

const clean = (value) => String(value ?? "").trim();
const normaliseRegistration = (value) => clean(value).replace(/[^A-Z0-9]/gi, "").toUpperCase();

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function productLabel(product) {
  if (product === "rent2buy") return "Rent2Buy";
  if (product === "cars") return "Cars";
  return "Van Finance";
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
  const completed = root.dataset.publishCompleted === "true";
  const typed = confirmationInputMatches(root);
  const prepare = root.querySelector("[data-controlled-publish-prepare]");
  const publish = root.querySelector("[data-controlled-publish-apply]");
  const check = root.querySelector("[data-controlled-publish-check]");
  const unpreparedCount = state?.media?.unpreparedDealerKitImageIds?.length || 0;
  const processingCount = state?.media?.processingDealerKitImageIds?.length || 0;
  const canPublish = Boolean(state?.plan?.canPublish);

  if (completed) {
    if (prepare) prepare.hidden = true;
    if (publish) publish.hidden = true;
    if (check) check.hidden = true;
    return;
  }

  if (prepare) {
    prepare.hidden = unpreparedCount === 0;
    prepare.disabled = !typed || !state || unpreparedCount === 0;
  }
  if (publish) {
    publish.hidden = !canPublish;
    publish.disabled = !typed || !canPublish;
  }
  if (check) {
    check.hidden = !state || canPublish || unpreparedCount > 0;
    check.disabled = false;
    check.textContent = processingCount > 0 ? "Check image status" : "Check again";
  }
}

function renderPayload(root, payload) {
  root._controlledPublishPayload = payload;
  const result = root.querySelector("[data-controlled-publish-result]");
  if (!result) return;
  result.replaceChildren();
  const plan = payload?.plan || {};
  const media = payload?.media || {};
  const label = productLabel(plan.mode || root.dataset.product);
  const unpreparedCount = media.unpreparedDealerKitImageIds?.length || 0;
  const processingCount = media.processingDealerKitImageIds?.length || 0;
  const mainSource = plan.mode === "rent2buy"
    ? plan.imageSets?.rent2buy?.mainSource
    : plan.mode === "cars"
      ? plan.imageSets?.cars?.mainSource
      : plan.imageSets?.vanFinance?.mainSource;
  const createCount = (plan.targets || []).filter((target) => target.operation === "create").length;
  const updateCount = (plan.targets || []).filter((target) => target.operation === "update").length;
  const restoreCount = (plan.targets || []).filter((target) => target.publishStatusOperation === "publish" && target.operation === "update").length;
  const draftCount = (plan.targets || []).filter((target) => target.operation === "draft").length;

  const summary = element("div", "dealerkit-wix-preview__summary");
  summary.append(
    element("div", "", `Destination: ${label}`),
    element("div", "", `Records to write: ${plan.targets?.length || 0}`),
    element("div", "", `Selected DealerKit photos READY: ${media.dealerKitReady || 0}/${media.dealerKitExpected || 0}`),
    element("div", "", `Primary image: ${mainSource || "not ready"}`),
  );
  if (plan.mode === "finance") {
    summary.append(element("div", "", `CMS reconciliation: ${createCount} Create · ${updateCount} Update existing · ${restoreCount} Restore existing · ${draftCount} Move stale category to Draft`));
  }
  if (plan.rent2buy?.enabled && plan.rent2buy?.pricing) {
    const pricing = plan.rent2buy.pricing;
    summary.append(
      element("div", "", `Rent2Buy Felix default: ${pricing.termMonths} months · ${pricing.milesPerMonth || 1000} miles/month`),
      element("div", "", `Rent2Buy: £${pricing.monthly} + VAT p/m · £${pricing.upfront} + VAT initial`),
    );
  }
  if (plan.mode === "cars" && Number.isFinite(Number(plan.retailPrice)) && Number.isFinite(Number(plan.monthlyPrice))) {
    summary.append(
      element("div", "", `Car retail: £${Number(plan.retailPrice).toLocaleString("en-GB")}`),
      element("div", "", `Example monthly: FROM £${plan.monthlyPrice} P/M`),
    );
  }
  result.appendChild(summary);

  if (unpreparedCount > 0) {
    const publishNote = plan.canPublish
      ? ` The advert can publish now with ${media.dealerKitReady || 0} READY DealerKit photo(s).`
      : "";
    result.appendChild(element("div", "dealerkit-wix-preview__messages dealerkit-wix-preview__messages--warnings", `${unpreparedCount} additional selected DealerKit photo(s) are not prepared yet.${publishNote}`));
  }
  if (processingCount > 0) {
    const publishNote = plan.canPublish
      ? ` The advert can publish now with ${media.dealerKitReady || 0} READY DealerKit photo(s).`
      : "";
    result.appendChild(element("div", "dealerkit-wix-preview__messages dealerkit-wix-preview__messages--warnings", `${processingCount} additional selected DealerKit photo(s) are still processing in Wix Media.${publishNote}`));
  }

  if (plan.vfc?.pricingReconciliation?.eligible) {
    const notice = element("div", "dealerkit-wix-preview__messages dealerkit-wix-preview__messages--warnings", "Verified pricing reconciliation available. Submit to review the existing and calculated monthly prices and approve the correction. No manual Wix edit is needed.");
    result.appendChild(notice);
  }
  if (plan.blockers?.length) {
    const blockers = element("div", "dealerkit-wix-preview__messages dealerkit-wix-preview__messages--blockers");
    blockers.appendChild(element("strong", "", `Publish blockers (${plan.blockers.length})`));
    for (const blocker of plan.blockers) blockers.appendChild(element("div", "", blocker.message || blocker.code));
    result.appendChild(blockers);
  }

  let imageRuleText = "The selected Van Finance primary becomes its card image and the first vehicle-page image. Rent2Buy images are untouched.";
  if (plan.mode === "rent2buy") imageRuleText = "The selected Rent2Buy primary becomes its card image and the first vehicle-page image. Van Finance images are untouched.";
  if (plan.mode === "cars") imageRuleText = "The selected Cars primary becomes its card image and the first Cars vehicle-page image. Van Finance and Rent2Buy records are untouched.";
  result.appendChild(element("div", "dealerkit-wix-preview__field-line", imageRuleText));

  const verdict = element("div", `dealerkit-wix-preview__verdict ${plan.canPublish ? "is-good" : "is-warning"}`, plan.canPublish
    ? "READY TO PUBLISH · All required checks for this product have passed."
    : "NOT READY TO PUBLISH · Complete the single next action shown above, then the panel will recheck automatically.");
  result.appendChild(verdict);
  result.hidden = false;

  const updateExisting = plan.writeIntent === "update_existing_vehicle";
  const updateActionLabel = "Reconcile advert";
  const heading = root.querySelector(".dealerkit-wix-preview__copy strong");
  if (heading) heading.textContent = updateExisting ? `Reconcile ${label} advert` : `Publish to ${label}`;
  const applyButton = root.querySelector("[data-controlled-publish-apply]");
  if (applyButton) applyButton.textContent = updateExisting ? updateActionLabel : `Publish to ${label}`;

  const statusText = plan.canPublish
    ? (updateExisting ? "READY TO RECONCILE" : "READY TO PUBLISH")
    : unpreparedCount > 0
      ? "PREPARE IMAGES"
      : processingCount > 0
        ? "WIX PROCESSING"
        : "BLOCKED";
  setStatus(root, statusText, plan.canPublish ? "is-good" : processingCount > 0 ? "is-busy" : "is-warning");
  refreshActionState(root);
}

async function loadPreview(root, { force = false } = {}) {
  const registration = normaliseRegistration(root.dataset.registration);
  if (!registration) return;
  if (root.dataset.publishCompleted === "true" && !force) return;
  const requestId = (Number(root._controlledPreviewRequestId) || 0) + 1;
  root._controlledPreviewRequestId = requestId;
  setStatus(root, "CHECKING", "is-busy");
  const result = root.querySelector("[data-controlled-publish-result]");
  if (result) {
    result.hidden = false;
    result.replaceChildren(element("div", "dealerkit-wix-preview__loading", "Checking DealerKit, selected images and Wix stock…"));
  }
  const product = clean(root.dataset.product) || "finance";
  const previewUrl = product === "cars"
    ? `/api/dealerkit-car-controlled-publish-preview?registration=${encodeURIComponent(registration)}`
    : `/api/dealerkit-controlled-publish-preview?registration=${encodeURIComponent(registration)}&product=${encodeURIComponent(product)}`;
  const response = await fetch(previewUrl, {
    headers: buildMarketingAccessHeaders({ accept: "application/json" }), cache: "no-store",
  });
  const payload = await parseMarketingJsonResponse(response, "Could not build final publish readiness.");
  if (root._controlledPreviewRequestId !== requestId) return;
  if (root.dataset.publishCompleted === "true" && !force) return;
  renderPayload(root, payload);
  if (payload.publishingDisabled) root._showReadOnlyRecovery?.(payload.recovery);
}

function createPanel(registration, product = "finance") {
  const root = element("section", "dealerkit-wix-preview");
  root.setAttribute(ROOT_ATTRIBUTE, "true");
  root.dataset.registration = registration;
  root.dataset.product = ["finance", "rent2buy", "cars"].includes(product) ? product : "finance";
  const labelText = productLabel(root.dataset.product);

  const top = element("div", "dealerkit-wix-preview__top");
  const copy = element("div", "dealerkit-wix-preview__copy");
  copy.append(
    element("span", "dealerkit-wix-preview__eyebrow", `${labelText.toUpperCase()} · DEALERKIT → WIX`),
    element("strong", "", `Publish to ${labelText}`),
    element("p", "", "Checks run automatically. This panel only shows the next action you actually need."),
  );
  const actions = element("div", "dealerkit-wix-preview__actions");
  const status = element("span", "dealerkit-wix-preview__status", "CHECKING");
  status.setAttribute("data-controlled-publish-status", "true");
  const check = element("button", "dealerkit-review__save", "Check again");
  check.type = "button";
  check.hidden = true;
  check.setAttribute("data-controlled-publish-check", "true");
  actions.append(status, check);
  top.append(copy, actions);

  const confirm = element("div", "dealerkit-wix-preview__confirm");
  const label = document.createElement("label");
  label.textContent = `Type ${registration} to unlock the next step`;
  const input = document.createElement("input");
  input.type = "text";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = `Type ${registration} here`;
  input.setAttribute("data-controlled-publish-confirm", "true");
  label.appendChild(input);
  const prepare = element("button", "dealerkit-wix-preview__apply", "Prepare images");
  prepare.type = "button";
  prepare.disabled = true;
  prepare.hidden = true;
  prepare.setAttribute("data-controlled-publish-prepare", "true");
  const publish = element("button", "dealerkit-wix-preview__apply", `Publish to ${labelText}`);
  publish.type = "button";
  publish.disabled = true;
  publish.hidden = true;
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
    root.dataset.publishCompleted = "false";
    delete root.dataset.publishCompletedAt;
    try { await loadPreview(root, { force: true }); }
    catch (error) { setStatus(root, "CHECK FAILED", "is-warning"); result.replaceChildren(element("div", "dealerkit-wix-preview__error", error?.message || "Could not check final readiness.")); }
    finally { refreshActionState(root); }
  });

  prepare.addEventListener("click", async () => {
    if (!confirmationInputMatches(root)) return;
    const approved = window.confirm(`Prepare the selected DealerKit photographs for ${registration} in Wix Media?\n\nThis changes Wix Media only. It does not publish the vehicle.`);
    if (!approved) return;
    prepare.disabled = true;
    publish.disabled = true;
    prepare.textContent = "Preparing…";
    setStatus(root, "PREPARING IMAGES", "is-busy");
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
    const updateExisting = payload.plan.writeIntent === "update_existing_vehicle";
    const approved = window.confirm(updateExisting
      ? `RECONCILE ${registration} ON LIVE ${labelText.toUpperCase()} WIX?\n\nExisting Wix item IDs will be reused where present. Controlled fields will be updated, missing selected rows may be created, Draft selected rows restored, and stale category rows moved to Draft where applicable.`
      : `PUBLISH ${registration} TO LIVE ${labelText.toUpperCase()} WIX?\n\nThis is the final live-write confirmation.`);
    if (!approved) return;
    const pricingText = pricingApprovalText(payload.plan);
    if (pricingText && !window.confirm(pricingText)) return;
    publish.disabled = true;
    prepare.disabled = true;
    publish.textContent = "Publishing…";
    // Invalidate any preview request that started before this final write. A
    // delayed READY response from the old CMS state must never overwrite a
    // successful publish/reconcile result.
    root._controlledPreviewRequestId = (Number(root._controlledPreviewRequestId) || 0) + 1;
    setStatus(root, "FINAL RECHECK", "is-busy");
    try {
      const endpoint = root.dataset.product === "cars" ? "/api/dealerkit-car-controlled-publish" : "/api/dealerkit-controlled-publish";
      const body = root.dataset.product === "cars"
        ? { action: updateExisting ? "update_existing_car" : "publish_new_car", registration, confirmRegistration: normaliseRegistration(input.value), confirmation: payload.plan.confirmation }
        : { action: updateExisting ? "update_existing_vehicle" : "publish_new_vehicle", registration, confirmRegistration: normaliseRegistration(input.value), productMode: root.dataset.product, confirmation: payload.plan.confirmation };
      body.resumePartial = true;
      if (pricingText) body.pricingApproval = true;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: buildMarketingAccessHeaders({ accept: "application/json", "content-type": "application/json" }),
        body: JSON.stringify(body),
      });
      const published = await parseMarketingJsonResponse(response, "Controlled Wix publishing failed.");
      const partialGallery = Boolean(published.verified && published.galleryComplete === false);
      setStatus(
        root,
        published.verified
          ? partialGallery
            ? "PUBLISHED · GALLERY PROCESSING"
            : (updateExisting ? "RECONCILED + VERIFIED" : "PUBLISHED + VERIFIED")
          : "CHECK RESULT",
        published.verified ? (partialGallery ? "is-busy" : "is-good") : "is-warning",
      );
      result.replaceChildren(element("div", `dealerkit-wix-preview__verdict ${partialGallery ? "is-warning" : "is-good"}`, published.message || `${registration} was published and verified.`));
      root._controlledPublishPayload = null;
      if (published.verified && !partialGallery) {
        root.dataset.publishCompleted = "true";
        root.dataset.publishCompletedAt = new Date().toISOString();
      } else {
        root.dataset.publishCompleted = "false";
        delete root.dataset.publishCompletedAt;
      }
      if (partialGallery) {
        await loadPreview(root, { force: true });
      } else {
        refreshActionState(root);
      }
    } catch (error) {
      // A duplicate/late request can return "preview stale" after an earlier
      // request has already completed successfully. Never replace a verified
      // success with that later stale result.
      if (root.dataset.publishCompleted === "true") return;
      setStatus(root, "PUBLISH BLOCKED", "is-warning");
      result.replaceChildren(element("div", "dealerkit-wix-preview__error", error?.message || "Publishing failed. Check the rollback result before trying again."));
      const checkButton = root.querySelector("[data-controlled-publish-check]");
      if (checkButton) {
        checkButton.hidden = false;
        checkButton.disabled = false;
        checkButton.textContent = "Check again";
      }
    } finally {
      publish.textContent = payload?.plan?.writeIntent === "update_existing_vehicle"
        ? "Reconcile advert"
        : `Publish to ${labelText}`;
      refreshActionState(root);
    }
  });

  queueMicrotask(() => loadPreview(root).catch((error) => {
    setStatus(root, "CHECK FAILED", "is-warning");
    result.hidden = false;
    result.replaceChildren(element("div", "dealerkit-wix-preview__error", error?.message || "Could not check readiness."));
    root._controlledPublishPayload = { plan: { canPublish: false }, media: {} };
    refreshActionState(root);
  }));

  addSubmit(root, registration, root.dataset.product);
  return root;
}

async function publishingRequest(url, body) {
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: buildMarketingAccessHeaders({ accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) }),
    cache: "no-store",
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await parseMarketingJsonResponse(response.clone(), "DealerKit publishing request failed.").catch(async error => {
    const payload = await response.json().catch(() => ({}));
    const blockers = (payload.details?.blockers || []).map(item => item.message || item.code).join(" ");
    if (blockers) error.message += " " + blockers;
    error.manualAttentionRequired = Boolean(payload.manualAttentionRequired || payload.details?.manualAttentionRequired);
    error.capacityReached = payload.details?.code === "wix_cms_item_limit";
    error.details = payload.details;
    error.status = response.status;
    throw error;
  });
  return data;
}

function pricingApprovalText(plan) {
  const pricing = plan?.vfc?.pricingReconciliation;
  if (!pricing?.eligible) return "";
  const rows = pricing.records.filter(row => row.selected).map(row => row.collectionId + ": " + (row.itemId ? row.oldMonthly || "(missing monthly)" : "(new record)") + " → £" + pricing.monthly + " / month");
  return "RECONCILE VFC PRICING FOR " + pricing.registration + "\n\nVerified DealerKit cash price £" + pricing.retail + " " + pricing.vat + ".\nCash/VAT unchanged on existing selected records; monthly figures use approved VFC rules.\n\n" + rows.join("\n") + "\n\nApprove pricing correction and continue publishing?";
}

function addSubmit(root, registration, product) {
  const button = element("button", "dealerkit-wix-preview__apply", "Submit");
  button.type = "button";
  const feedback = element("p", "");
  feedback.setAttribute("role", "status");
  const actions = element("div", "dealerkit-wix-preview__actions");
  const recoveryPanel = element("section", "dealerkit-wix-preview__verdict dealerkit-wix-preview__recovery is-warning");
  recoveryPanel.hidden = true;
  actions.append(button, feedback, recoveryPanel);
  root.prepend(actions);
  const fallback = element("details", "");
  fallback.append(element("summary", "", "Manual publishing controls"));
  while (actions.nextSibling) fallback.appendChild(actions.nextSibling);
  root.append(fallback);
  const displayRecovery = (recovery, ...controls) => {
    recoveryPanel.replaceChildren(
      element("strong", "", recovery.website + " · " + recovery.registration),
      ...[recovery.problem, recovery.explanation, recovery.recommendation, recovery.retained, recovery.modified, recovery.removed]
        .filter(Boolean).map(text => element("p", "", text)),
      ...controls,
    );
    recoveryPanel.hidden = false;
  };
  root._showReadOnlyRecovery = recovery => {
    button.disabled = true;
    fallback.open = false;
    fallback.hidden = true;
    feedback.textContent = "DealerKit publishing is read-only in this Preview.";
    if (!recovery) return;
    const approvalButton = element("button", "dealerkit-wix-preview__apply", "Approve Fix & Continue Publishing");
    approvalButton.disabled = true;
    approvalButton.type = "button";
    displayRecovery(recovery, ...(recovery.approval ? [approvalButton] : []));
  };
  const query = "?registration=" + encodeURIComponent(registration);
  const endpoint = product === "cars" ? "/api/dealerkit-car-controlled-publish" : "/api/dealerkit-controlled-publish";
  const request = { registration, confirmRegistration: registration, productMode: product };
  button.addEventListener("click", async () => {
    if (button.disabled) return;
    const workspace = root.closest("[data-dealerkit-review-workspace]");
    const gallery = workspace?.querySelector("[data-dealerkit-product-gallery]");
    if (!gallery?.savePublishingReview || gallery.dataset.registration !== registration || gallery.dataset.product !== product) {
      feedback.textContent = "Photographs are still loading. Try again when the gallery is ready.";
      return;
    }
    if (!window.confirm("Publish or update " + registration + " on live " + productLabel(product) + " after the selected photographs and categories pass validation?")) return;
    button.disabled = true;
    fallback.open = false;
    fallback.hidden = true;
    const isCurrent = () => root.isConnected && !workspace.hidden && workspace.dataset.product === product && gallery.isConnected;
    const reviewBody = workspace.querySelector("[data-dealerkit-review-body]");
    const locked = [gallery, reviewBody?.querySelector(".dealerkit-review__decisions")].filter(Boolean);
    locked.forEach(node => { node.inert = true; });
    let requiresReview = false;
    const approve = recovery => new Promise(resolve => {
      const confirm = element("button", "dealerkit-wix-preview__apply", "Approve Fix & Continue Publishing");
      const cancel = element("button", "", "Cancel");
      confirm.type = cancel.type = "button";
      const observer = new MutationObserver(() => {
        if (!isCurrent()) finish(false);
      });
      const finish = choice => {
        observer.disconnect();
        recoveryPanel.hidden = true;
        recoveryPanel.replaceChildren();
        resolve(choice);
      };
      feedback.textContent = "Approval required";
      displayRecovery(recovery,
        element("p", "", "After the repair is verified, publishing continues with your saved review."),
        confirm, cancel,
      );
      confirm.addEventListener("click", () => finish(true), { once: true });
      cancel.addEventListener("click", () => finish(false), { once: true });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "data-product"] });
      confirm.focus();
    });
    try {
      const result = await submitDealerKitVehicle({
        save: gallery.savePublishingReview,
        upload: gallery.uploadPublishingPhotos,
        read: () => retryTemporaryPublishOperation(
          () => publishingRequest(endpoint + "-preview" + query + "&product=" + encodeURIComponent(product)),
          { retry: error => error instanceof TypeError, delays: [600] },
        ),
        prepare: () => publishingRequest("/api/dealerkit-wix-prepare-media", request),
        publish: plan => {
          const pricingText = pricingApprovalText(plan);
          if (pricingText && !window.confirm(pricingText)) throw new Error("Pricing correction cancelled. Your saved review is retained.");
          return publishingRequest(endpoint, {
          ...request,
          action: plan.writeIntent === "update_existing_vehicle"
            ? (product === "cars" ? "update_existing_car" : "update_existing_vehicle")
            : (product === "cars" ? "publish_new_car" : "publish_new_vehicle"),
          confirmation: plan.confirmation,
          resumePartial: true,
          ...(pricingText ? { pricingApproval: true } : {}),
          });
        },
        approve,
        repair: recovery => publishingRequest(endpoint, { ...request, action: "approve_recovery", recoveryApproval: recovery.approval }),
        status: message => { feedback.textContent = message + "…"; },
        isCurrent,
      });
      feedback.textContent = result.galleryComplete === false
        ? (result.message || "Advert verified. Some photographs are still processing.")
        : (result.message || "Published and verified successfully.");
      const link = element("a", "", "View vehicle");
      link.href = dealerKitPublishedVehicleUrl(product, registration);
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      feedback.append(" ", link);
      root._controlledPublishPayload = null;
      refreshActionState(root);
      button.textContent = result.galleryComplete === false ? "Retry gallery" : "Submit updates";
    } catch (error) {
      requiresReview = Boolean(error.cause?.manualAttentionRequired);
      feedback.textContent = error.message;
      if (error.cause?.details?.resumable) feedback.append(" Confirmed changes are retained. Submit again to verify and continue.");
      if (error.cause?.capacityReached) {
        feedback.append(" Existing adverts can still be updated when they need no new rows. A site administrator can increase the Wix CMS allowance or review retired records for separate approval.");
      }
      button.textContent = requiresReview ? "Review required" : error.cause?.capacityReached ? "Retry after freeing CMS capacity" : "Retry";
    } finally {
      button.disabled = requiresReview;
      fallback.hidden = requiresReview;
      locked.forEach(node => { node.inert = false; });
    }
  });
}

function installPanel() {
  if (typeof window === "undefined" || window.location.pathname !== "/vansco-stock-watch") return;
  const workspace = document.querySelector("[data-dealerkit-review-workspace]");
  if (!workspace || workspace.hidden) return;
  const product = ["finance", "rent2buy", "cars"].includes(workspace.dataset.product) ? workspace.dataset.product : "finance";
  const gallery = workspace.querySelector("[data-dealerkit-product-gallery]");
  const body = workspace.querySelector("[data-dealerkit-review-body]");
  const registration = product === "cars"
    ? normaliseRegistration(workspace.querySelector("[data-dealerkit-review-title]")?.textContent)
    : normaliseRegistration(gallery?.dataset.registration);
  if (!registration || !body) return;

  let root = workspace.querySelector(`[${ROOT_ATTRIBUTE}]`);
  if (!root) {
    root = createPanel(registration, product);
    const categories = body.querySelector(".dealerkit-review__decisions");
    if (categories) categories.insertAdjacentElement("afterend", root);
    else if (gallery) gallery.insertAdjacentElement("afterend", root);
    else body.appendChild(root);
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
  window.addEventListener("dealerkit-product-gallery-saved", (event) => {
    const registration = normaliseRegistration(event?.detail?.registration);
    const product = clean(event?.detail?.product);
    const root = document.querySelector(`[${ROOT_ATTRIBUTE}]`);
    if (!root || normaliseRegistration(root.dataset.registration) !== registration) return;
    if (product && clean(root.dataset.product) !== product) return;
    root.dataset.publishCompleted = "false";
    delete root.dataset.publishCompletedAt;
    loadPreview(root, { force: true }).catch((error) => {
      setStatus(root, "CHECK FAILED", "is-warning");
      const result = root.querySelector("[data-controlled-publish-result]");
      if (result) {
        result.hidden = false;
        result.replaceChildren(element("div", "dealerkit-wix-preview__error", error?.message || "Could not refresh readiness after saving the gallery."));
      }
    });
  });
  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
}

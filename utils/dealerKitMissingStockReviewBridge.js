const DIRECT_BUTTON_ATTRIBUTE = "data-dealerkit-missing-stock-review";
const REVIEW_BUTTON_ATTRIBUTE = "data-dealerkit-review-button";
let scanQueued = false;

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeRegistration(value) {
  const registration = clean(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (registration.length < 5 || registration.length > 8) return "";
  if (!/[A-Z]/.test(registration) || !/[0-9]/.test(registration)) return "";
  return registration;
}

function cardLabels(card) {
  return Array.from(card.querySelectorAll(".vansco-card__badges .tag"))
    .map((node) => clean(node.textContent).toLowerCase())
    .filter(Boolean);
}

function isFinanceMissingCard(card) {
  const labels = cardLabels(card);
  return labels.some((label) => label.startsWith("finance"))
    && labels.includes("missing from my stock");
}

function registrationFromCard(card) {
  const meta = Array.from(card.querySelectorAll(".vehicle-card__meta"))
    .find((node) => /^registration\s*:/i.test(clean(node.textContent)));
  return normalizeRegistration(clean(meta?.textContent).replace(/^registration\s*:/i, ""));
}

function temporaryReviewRow(registration) {
  const row = document.createElement("article");
  row.className = "dealerkit-comparison__row dealerkit-missing-review-bridge";
  row.hidden = true;
  row.setAttribute("aria-hidden", "true");

  const top = document.createElement("div");
  top.className = "dealerkit-comparison__row-top";
  const strong = document.createElement("strong");
  strong.textContent = registration;
  top.appendChild(strong);

  const links = document.createElement("div");
  links.className = "dealerkit-comparison__links";
  row.append(top, links);
  return row;
}

function waitForReviewButton(row, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const check = () => {
      const button = row.querySelector(`[${REVIEW_BUTTON_ATTRIBUTE}]`);
      if (button) {
        resolve(button);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        resolve(null);
        return;
      }
      window.setTimeout(check, 25);
    };
    check();
  });
}

async function openDealerKitReview(registration) {
  const bridgeRow = temporaryReviewRow(registration);
  document.body.appendChild(bridgeRow);
  try {
    const reviewButton = await waitForReviewButton(bridgeRow);
    if (!reviewButton) throw new Error("DealerKit review workspace did not become ready.");
    reviewButton.click();
  } finally {
    bridgeRow.remove();
  }
}

function installDirectButtons() {
  if (typeof window === "undefined" || window.location.pathname !== "/vansco-stock-watch") return;

  for (const card of document.querySelectorAll(".vansco-card-grid .vansco-card")) {
    if (!isFinanceMissingCard(card)) continue;
    if (card.querySelector(`[${DIRECT_BUTTON_ATTRIBUTE}]`)) continue;

    const registration = registrationFromCard(card);
    const actions = card.querySelector(".card-actions");
    if (!registration || !actions) continue;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "button button--primary";
    button.textContent = "Review vehicle";
    button.setAttribute(DIRECT_BUTTON_ATTRIBUTE, "true");
    button.setAttribute("aria-label", `Review ${registration} in DealerKit`);
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = "Opening review…";
      try {
        await openDealerKitReview(registration);
      } catch (error) {
        button.textContent = error?.message || "Could not open review";
        window.setTimeout(() => {
          button.textContent = "Review vehicle";
          button.disabled = false;
        }, 1800);
        return;
      }
      button.textContent = "Review vehicle";
      button.disabled = false;
    });

    actions.prepend(button);
  }
}

function scheduleScan() {
  if (scanQueued) return;
  scanQueued = true;
  queueMicrotask(() => {
    scanQueued = false;
    installDirectButtons();
  });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scheduleScan, { once: true });
  else scheduleScan();
  window.addEventListener("popstate", scheduleScan);
  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

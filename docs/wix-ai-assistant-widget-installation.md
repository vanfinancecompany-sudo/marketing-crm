# Van Finance Company Wix AI Chat Widget

This package installs the first customer-facing assistant widget on the Van Finance Company Wix website. It uses the Phase 1 public endpoint and does not change the AI engine or support the separate Rent2Buy website.

The integration follows Wix's supported HTML Component messaging pattern: the sandboxed widget sends messages to Wix page code, and Wix page code replies through the component's `postMessage`/`onMessage` bridge. The anonymous conversation ID is stored with `wix-storage-frontend.local`.

## Package files

- Widget entry point: `/wix-ai-assistant/widget.mjs`
- Hosted HTML Component page: `/wix-ai-assistant/embed.html`
- Wix Public adapter: `wix/aiAssistantPageAdapter.js`
- Wix environment helpers: `wix/aiAssistantConfigurations.js`

## Required Wix element IDs

| Element | Required ID | Purpose |
| --- | --- | --- |
| HTML Component | `#htmlAiAssistant` | Hosts the floating widget |
| Existing vehicle application | `#finance-application` by default | Expanded/scrolled to by **Apply for this van** |

If the existing vehicle application has a different Wix ID, do not rebuild it. Pass its real ID in `vehicle.formAnchor`.

## 1. Add the HTML Component

On each supported Wix page:

1. Add **Embed & Social → HTML iframe / Embed Site**.
2. Set the element ID to `htmlAiAssistant`.
3. Use the HTTPS source:

   `https://YOUR-MARKETING-CRM-DOMAIN/wix-ai-assistant/embed.html`

4. Place it at the bottom-right. Suggested initial size is 400 × 640 pixels on desktop.
5. Configure the mobile breakpoint to use the available viewport width and height. The widget itself switches to a full-screen panel below 520 pixels.
6. Keep scrolling disabled on the outer Wix HTML Component; the conversation history scrolls inside the widget.

For development, use the PR Preview deployment domain. For Production, replace it with the stable Production Marketing CRM domain.

## 2. Add the Wix Public files

In **Public & Backend → Public**, create:

- `aiAssistantPageAdapter.js` using `wix/aiAssistantPageAdapter.js`
- `aiAssistantConfigurations.js` using `wix/aiAssistantConfigurations.js`

These files contain no server secret. Never add `AI_ASSISTANT_SESSION_SECRET`, Supabase service-role credentials, OpenAI credentials, prompts or knowledge content to Wix.

## 3. Environment configuration

### Development/test

```js
const assistantConfig = developmentAiAssistantConfig({
  previewApiBaseUrl: "https://YOUR-PR-PREVIEW-DOMAIN",
  privacyUrl: "PASTE_THE_EXISTING_VFC_PRIVACY_PAGE_URL"
});
```

Use a published Wix test site where possible. If Wix uses a different test-site origin, add that exact origin to `AI_ASSISTANT_ALLOWED_ORIGINS` in the Vercel **Preview** environment only. Do not use wildcards.

### Production

```js
const assistantConfig = productionAiAssistantConfig({
  productionApiBaseUrl: "https://YOUR-STABLE-PRODUCTION-MARKETING-CRM-DOMAIN",
  privacyUrl: "PASTE_THE_EXISTING_VFC_PRIVACY_PAGE_URL"
});
```

The privacy URL is deliberately configuration-driven. Use the existing Van Finance Company privacy page rather than adding or guessing another URL.

## 4. Page-code examples

Use these imports at the top of each supported Wix page:

```js
import { installAiAssistantWidget } from "public/aiAssistantPageAdapter.js";
import { productionAiAssistantConfig } from "public/aiAssistantConfigurations.js";

const assistantConfig = productionAiAssistantConfig({
  productionApiBaseUrl: "https://YOUR-STABLE-PRODUCTION-MARKETING-CRM-DOMAIN",
  privacyUrl: "PASTE_THE_EXISTING_VFC_PRIVACY_PAGE_URL"
});
```

### Finance vehicle page

The CTA stays on the current page and opens or scrolls to the existing vehicle application. It never uses the generic application URL.

```js
$w.onReady(async function () {
  await $w("#dynamicDataset").onReadyAsync();
  const vehicle = $w("#dynamicDataset").getCurrentItem();

  installAiAssistantWidget({
    $w,
    elementId: "#htmlAiAssistant",
    ...assistantConfig,
    pageContext: {
      pageType: "finance_vehicle",
      productContext: "finance",
      vehicle: {
        registration: vehicle.registration,
        stockId: vehicle._id,
        title: vehicle.title,
        applicationMode: "page_form",
        formAnchor: "#finance-application"
      }
    }
  });
});
```

Replace `#dynamicDataset` and the three CMS field keys only if the live vehicle page uses different existing IDs/keys. `formAnchor` must be the existing application container's actual Wix element ID.

### General Finance page

```js
$w.onReady(function () {
  installAiAssistantWidget({
    $w,
    elementId: "#htmlAiAssistant",
    ...assistantConfig,
    pageContext: {
      pageType: "finance_general",
      productContext: "finance",
      vehicle: { applicationMode: "generic" }
    }
  });
});
```

The approved CTA navigates in the same window to:

`https://www.vanfinancecompany.co.uk/apply-by-reg-finance/application-form`

### Rent2Buy information page on the Van Finance Company website

```js
$w.onReady(function () {
  installAiAssistantWidget({
    $w,
    elementId: "#htmlAiAssistant",
    ...assistantConfig,
    pageContext: {
      pageType: "rent2buy_general",
      productContext: "rent2buy",
      vehicle: { applicationMode: "generic" }
    }
  });
});
```

The approved CTA navigates in the same window to:

`https://www.vanfinancecompany.co.uk/rent2buy-application`

This does not install anything on the separate Rent2Buy Wix website.

### Homepage

```js
$w.onReady(function () {
  installAiAssistantWidget({
    $w,
    elementId: "#htmlAiAssistant",
    ...assistantConfig,
    pageContext: {
      pageType: "homepage",
      productContext: null,
      vehicle: { applicationMode: "generic" }
    }
  });
});
```

The widget presents Finance and Rent2Buy choices. The chosen product is passed once to the server and the existing server session preserves the product lock.

## Session and security behaviour

- Wix local storage contains only the opaque conversation ID.
- Storage keys are scoped by page type or vehicle identity so a vehicle conversation cannot silently move into another page context.
- Restart removes that ID and calls the endpoint's `start` action for a new anonymous session.
- The adapter sends its configured page context on every request and ignores page context supplied by widget messages.
- Only the Phase 1 public endpoint is called.
- Server CTA actions are allowlisted in both the widget and Wix adapter.
- Only the two approved application URLs can navigate.
- Customer and assistant content is escaped before HTML rendering.
- Rate-limit and unavailable statuses are shown as customer-safe responses.
- The widget displays: “Please do not send bank details, passwords or card information in chat.”

## Pre-install checklist

1. Apply migration `039_ai_assistant_wix_customer_foundation.sql` to the correct Supabase project.
2. Add `AI_ASSISTANT_SESSION_SECRET` to Vercel Preview and Production manually.
3. Confirm `AI_ASSISTANT_ALLOWED_ORIGINS` includes only the required exact Wix origins.
4. Confirm the Phase 1 endpoint works from the published Wix test-site origin.
5. Confirm `#finance-application` points to the existing vehicle application container.
6. Test Finance, Rent2Buy, homepage selection, Restart, mobile layout and every CTA before publishing Wix changes.

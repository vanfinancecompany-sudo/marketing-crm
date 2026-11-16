# Vansco Black Friday 2026 — implementation and review

Built in an independent clone from origin/main 59cc345 on 16 November 2026.
Branch: feature/vansco-black-friday-astra-20261116.

## What changed

The Black Friday email now opens with a cream editorial hero, restrained red accents and the real Vansco logo. Two equally sized charcoal offer panels present £500 off the screen price OR a free 2-year AutoGuard extended warranty. The deadline is 30 November 2026, inclusive. Large, uncropped vehicle photographs, readable derivatives, explicit screen prices and VAT labels, and substantial VIEW VEHICLE buttons replace the previous small two-column stock tiles.

The editor and delivery route share the new Black Friday renderer in public/vansco-email-studio/black-friday.js. The existing Vansco renderer has only an import and a Black Friday routing condition added. No shared provider, recipient, suppression, unsubscribe token, worker, tracking, database or VFC template-designer code was changed.

Switching to Black Friday fills the new copy and clears inherited seasonal brand text, extra text and legal notes. Existing drafts retain their saved editable text and selections; there is no database migration. Select the Black Friday theme again to apply the new campaign defaults to an old draft, then review its content before saving.

Stock selection and selection order remain unchanged. Was/Now overrides remain saved for other themes; Black Friday deliberately shows the source screen price and explains that the discount is agreed at sale. No stock write occurs. Both Desktop and Mobile preview sizes are available. The editor identifies the eligibility, warranty exclusions and combination restrictions that still need business confirmation.

## Verification

- 35 automated tests passed, covering the new proposition, immutable prices and VAT, saved settings and ordering, shared rendering, unsubscribe links, and the existing Vansco delivery/suppression controls.
- npm run build:application passed. Vite reports the existing large main bundle warning.
- Local Chromium renders checked at 900px, 390px and 320px: no horizontal overflow; offer panels stack on mobile. All preview photos and the Vansco logo loaded.
- Local editor exercised with intercepted API fixtures: theme changes, real-listing selection, deselection/reselection, editable copy, saving settings and preview-size switching. No real campaigns or contacts were written.
- Two current Vansco website listings supplied preview data: BP73XHB (£20,995 +VAT) and MH21KLC (£19,495 +VAT). Both individual links returned HTTP 200. These are a dated preview snapshot; production continues using its existing live stock integration.
- Six-vehicle sample HTML is 22,367 bytes. Layout uses presentation tables, inline styles, mobile media rules and a fixed-width Outlook conditional container; critical offer text is real text.
- The original checkout remains clean on codex/branded-story-previews at 94dfa7737bdeaf9fae348b851a4963bcc53734f8. No branch/worktree changes were made there during the independent-clone implementation.

## Preview files

vansco-black-friday-preview.html is an internal preview, not a send-ready personalised customer email.
Desktop, mobile, hero and editor PNGs show the updated composition. The before PNG reconstructs the main-branch Black Friday renderer with the same two vehicle listings and logo for comparison.

## Limits and review points

No production deployment, merge, email send or campaign activation took place. There is no hosted preview deployment.
Actual Gmail, Apple Mail and desktop Outlook inbox rendering has not been tested. Browser screenshots are not inbox certification.
The clone has no DealerKit credentials or production database session: authenticated live stock refresh and real saved-draft persistence were tested through their existing contracts and local fixtures, not against production.
Confirm vehicle eligibility, AutoGuard cover/exclusions and any restrictions on combining offers, then put the approved wording in Footer details / small print. No unverified warranty valuation, finance promise or eligibility rule was added.
The current live vehicle photos already contain Vansco's Black Friday framing; the renderer preserves those source images without cropping or adding new image banners.

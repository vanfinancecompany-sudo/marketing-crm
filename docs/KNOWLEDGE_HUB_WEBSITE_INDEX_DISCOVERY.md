# Website Index Discovery & Review Importer

PR104 adds a review-only discovery workflow to the existing Website Index. Apply
`024_website_index_discovery_review.sql` before deploying the application code.

## Safety boundary

- The protected server API scans only public HTML on the configured Van Finance
  Company domain.
- External destinations, account/login/checkout/search routes, tracking/query
  URLs, downloads, images, `mailto:` and `tel:` links are excluded.
- Wix client-side routes found in page data are treated as candidates only.
- Filter/category controls without a unique URL are saved as requiring manual
  mapping. The scanner never derives or invents a URL for them.
- Every candidate is created as `pending_review`, `verified = false`, and
  `available_to_internal_linking = false`.
- Approval re-fetches the public destination and requires a successful HTML
  response. Only then is an approved, verified, active Website Index row created.
- Internal Linking queries and matching both require approved + verified + active.

## Review workflow

The Website Index screen now provides scan summaries and a review queue. Reviewers
can edit classifications, approve, reject, open a source URL, or selectively merge
fields into an existing approved record. A merge never overwrites unselected
fields. Canonical URLs, redirects, discovery evidence, HTTP status, source page,
and decisions remain in the audit model.

`Vehicle types` is presented as `Matching terms` in the interface. The existing
`vehicle_types` database column is retained for backwards compatibility with
PR102.

## AI Visibility readiness

New and discovered destinations default
`monitor_in_ai_visibility_when_published` to `true`. The checkbox records future
monitoring eligibility only. It does not run a provider, create evidence, or
monitor an unpublished URL.

## Wix readiness

Discovery records preserve canonical URLs, redirect chains, source evidence, and
Wix embedded-route evidence. Approved Website Index rows keep this in
`sync_metadata`, so a future Wix CMS synchroniser can reconcile destinations
without changing the discovery/approval boundary.

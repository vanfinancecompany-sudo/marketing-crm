# DealerKit publishing recovery

DealerKit Submit uses the selected website throughout the workflow. Van Finance uses its finance collections, Rent2Buy uses the authoritative shared Wix collections, and Cars uses CARFINANCE and CARPAGES.

| Publishing stage | Failure handling |
| --- | --- |
| Saved review, DealerKit identity and status | Require a current saved review and unambiguous registration. Stop when source data, availability, pricing or a protected special prevents publication. |
| Existing Wix records | Compare every registration match in the selected collection. Use the unique published row as canonical only when the other item is explicitly Draft and its vehicle identity, URLs, SEO, and relationship fields agree. An older draft may retain different historical prices or photographs. Check other known stock relationships for references to the draft. |
| Approval | Show the affected website, vehicle, collection and item IDs. Bind approval to both Wix snapshots, related stock rows and the saved DealerKit review. Save the two source records to the restricted audit table, then re-read them immediately before editing. |
| Approved repair | Change only the matching title of the duplicate draft. Keep both Wix IDs and verify that the draft retains its data and status and the canonical advert stays published. Stop with an audit reference if Wix cannot confirm the result. |
| Photographs | Reuse registered Wix file IDs, retry temporary reads and explicit rate-limit rejections within a short limit, and recover confirmed missing or failed DealerKit imports. Preserve mapped media when the API cannot verify it. |
| CMS fields | Check the expected Wix ID and reviewed fields before each write. Use stable IDs for new items. Reuse matching records and create selected missing records when DealerKit still authorises the target. Keep existing route fields on updates. |
| Publish status | Check for the intended status before starting a task. If the task response is uncertain, verify the resulting state before proceeding. Escalate uncertain tasks that cannot be verified. |
| Capacity | Show the Wix quota issue and safe next steps. Matching and completed changes can be reused when capacity is available. |
| Final verification | Verify identity, saved fields and publication status. Audit the confirmed outcome or the interruption. |

Ambiguous listings, conflicting identity or route fields, protected stock and related records that reference a duplicate remain blocked for a stock administrator. The matching repair applies to an explicitly Draft copy of a uniquely published advert. Draft-only price and photo differences are shown before approval. It retains both Wix rows and uses the original draft ID so existing relationships remain intact. Direct Wix edits outside DealerKit can change the inputs after a recheck, so DealerKit verifies the result and stops when it cannot establish the expected state.

The recovery audit migration must be available in the CRM database before the feature is enabled. It records the repair approval and snapshots, individual recoveries, verification and failures. The existing Marketing CRM access key authorises staff actions, so the audit has no named staff identity. Service-role access can insert and read events. The browser receives the proposed actions and an approval fingerprint.

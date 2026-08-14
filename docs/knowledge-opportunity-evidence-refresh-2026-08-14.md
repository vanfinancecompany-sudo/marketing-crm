# Knowledge Opportunity live-evidence refresh

Run date: 2026-08-14
Window: 90 days
Since: 2026-05-16T19:08:54Z

The existing evidence-refresh implementation was run once against production telemetry after the AI Control Centre snapshot showed that live evidence had never been refreshed into Knowledge Opportunities.

## Result

- Evidence groups analysed: 290
- Existing opportunities updated: 15
- New review opportunities created: 2
- Stale evidence cleared: 0
- Groups below creation threshold: 273
- Unclassified assistant events: 0
- Unclassified Knowledge Hub searches: 1
- Unclassified Google Search Console queries: 1

Created opportunity IDs:
- 79e0bc56-3fef-4184-b7b5-faf97f6f5997
- b4e4018b-c1b5-4a06-9b37-008f73349b9b

Updated opportunity IDs:
- 115c0611-21df-4e3b-926f-4d4437fad39d
- 18aacbd3-c001-4183-bde0-cc9593a3f882
- 3ca57f3d-4a1e-4223-ab81-2d2714f35d14
- 7260bfbb-19c1-4750-a98a-9e761b4d0108
- 359dac84-5f17-432c-9560-886655b4a29c
- 3acbb171-23f7-499c-9b22-d1b82ecfd0a2
- 7bc779af-480e-4f66-90e4-4b15c033bc22
- 8da09847-5a96-4957-878d-37eb42a722eb
- 6dfe9898-a144-4349-ab8a-7d92967559d8
- 0a8f1adc-422f-4304-b0fa-edeb38577ab8
- 457a88d5-89bc-454c-8973-d1c64a1a4ea7
- cd21e4c0-84f5-493d-8858-97e135db05c5
- e4019bbe-6a24-4616-93eb-3e870426a97f
- e8042968-89b6-4d42-aac7-8b1b3230eba8
- 3a30de75-d8b1-4bdb-a0f6-3ef053d943df

## Safety

- Manual workflow statuses were preserved.
- No Knowledge Hub article content was created.
- No article was approved or published.
- No Wix content was changed.
- No OpenAI calls were made.
- The refresh only updated/created Knowledge Opportunity review records using the existing thresholds and workflow logic.

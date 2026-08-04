# Recipient first-name personalisation

Production campaign sends must render independently for each recipient. `{{first_name}}` uses the normalised `marketing_contacts.first_name` value and falls back to `there` when it is blank or malformed. Internal tests use the explicitly entered test name and fall back to `Stuart` when blank.

`Alex` is designer-preview data only. The shared renderer has no implicit `Alex` fallback, and provider submission fails closed if designer sample data is detected outside designer-preview mode.

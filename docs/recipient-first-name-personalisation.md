# Recipient first-name personalisation

All Email Templates provider sends replace `{{first_name}}` with `there`, producing the fixed greeting `Hi there,` for internal tests and production recipients. Provider-bound rendering does not read a test or customer first name.

`Alex` is designer-preview data only. The shared renderer has no implicit `Alex` fallback, and provider submission fails closed if designer sample data is detected outside designer-preview mode.

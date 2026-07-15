# SMTP2GO webhook setup

Configure this webhook only after PR #80 is deployed to production.

- URL: `https://marketing-crm.vercel.app/api/smtp2go-email-webhook`
- Output type: `JSON`
- Authorization header type: `Bearer`
- Authorization header value: the exact value stored in `SMTP2GO_WEBHOOK_SECRET`
- Users: select the production `SMTP2GO_API_KEY`
- Events: `processed`, `delivered`, `open`, `click`, `bounce`, `reject`, `spam`, `unsubscribe`
- Email headers: `X-Marketing-Campaign-Id`, `X-Marketing-Send-Id`, `X-Marketing-Recipient-Id`

Required SMTP2GO environment variables:

- `SMTP2GO_API_KEY`
- `SMTP2GO_SENDER_EMAIL`
- `SMTP2GO_SENDER_NAME`
- `SMTP2GO_WEBHOOK_SECRET`

The secret must be a new high-entropy value and must not be the SMTP2GO API key. Configure the same secret in Vercel and in SMTP2GO's Bearer authorization-header value. Do not place it in the webhook URL.

If the production `MARKETING_PUBLIC_BASE_URL` uses a different canonical host, use that host with the exact path `/api/smtp2go-email-webhook`; do not configure a preview-deployment URL.

After saving, use SMTP2GO's **Test this webhook** function for each enabled event and confirm the Marketing Dashboard shows `SMTP2GO webhook status: Connected`. No customer email is required for this webhook-only verification.

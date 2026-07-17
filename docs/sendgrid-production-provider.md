# SendGrid production provider

SendGrid production campaign sending is selected explicitly on the server with:

```text
MARKETING_EMAIL_PROVIDER=sendgrid
```

Deploying the code without `MARKETING_EMAIL_PROVIDER` does not switch providers. The legacy fallback remains unchanged: SMTP2GO is selected when any SMTP2GO API or sender setting is present; otherwise Brevo is selected.

Before setting the production provider, verify that these existing server-only variables are configured in the intended Vercel environment:

- `SENDGRID_API_KEY`
- `SENDGRID_WEBHOOK_VERIFICATION_KEY`
- `MARKETING_PUBLIC_BASE_URL`
- `MARKETING_UNSUBSCRIBE_TOKEN_SECRET`

The verified SendGrid sender is `sales@vanfinancecompany.co.uk`. The application reuses an existing configured sender name when available and otherwise uses `Van Finance Company`; it does not require another sender-email variable.

Provider selection is read only by server functions. Do not add any provider API key, webhook verification key or Marketing access key to browser code or `VITE_` variables.

After a Preview deployment, confirm the Campaign Builder Sending section reports SendGrid as selected, the connection as authorised, sender configuration as present and webhook verification as configured. Use only an internal test address for validation. Do not use a production audience until the existing preparation, count review and typed confirmation workflow has been checked.

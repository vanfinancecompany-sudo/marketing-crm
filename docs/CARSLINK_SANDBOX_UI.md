# Carslink sandbox test control

The Stock page includes a temporary sandbox-only control to submit up to 10 current Finance vehicles to `/api/carslink-sandbox-sync`.

- The control never uses a production Carslink key.
- The server endpoint requires `confirmSandbox: true`.
- The sandbox API key remains server-side in `CARSLINK_SANDBOX_API_KEY`.
- The control shows the returned sync result so the Carslink Sync Logs / Sandbox Preview can be checked.

Remove or repurpose this control once production automation is approved.

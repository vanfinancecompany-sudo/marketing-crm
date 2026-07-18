# Cleaned customer import fix

This branch fixes cleaned and Verifalia-style CSV imports so verified contacts already in Awaiting Verification are promoted to Active while preserving customer IDs, suppression state, and campaign history.

The server-side import workflow, shared lifecycle helpers, service response mapping, and focused regression tests are included. No database migration is required.

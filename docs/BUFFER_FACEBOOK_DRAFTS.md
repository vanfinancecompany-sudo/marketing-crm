# Buffer Facebook Draft Integration

Safe first-stage integration for the Marketing CRM.

- Van Finance Facebook channel: `6a8721fbccaf649a67e227a3`
- Rent2Buy Facebook channel: `6a8722ffccaf649a67e22bc6`
- Vehicle posts use the existing public Wix image URL.
- Daily Reels use the existing public Vercel Blob MP4 URL.
- All Buffer posts are created with `saveToDraft: true` during the proof stage.
- Marketplace remains manual.
- The Buffer personal API key is server-side only in `BUFFER_API_KEY`.
- A Buffer draft is not recorded as a confirmed Facebook post in CRM history.

Do not switch to live queue/publishing until both an image draft and a Reel draft have been checked in Buffer.

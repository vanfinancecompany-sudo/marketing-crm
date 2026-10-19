# VFC Open-Weight AI Video Prototype: feasibility and CRM integration gate

Date: 19 October 2026
Status: **Research prototype only**. Do not merge into `main`, deploy, or replace the existing VFC / Rent2Buy Daily Reels workflow without separate approval.

## Goal

Make authentic-looking ~20-second vertical Van Finance Company adverts with genuine vehicle photographs on a clean, consistent studio background and *real generative-video motion*, not zoom-and-pan slideshows. The vehicle must stay recognisable and faithful to its actual stock images. Cost should be as close to £0 as possible and the workflow must not require the user's old Intel HD Graphics 4600 PC.

## What was actually tested

- Input: publicly available photographs from a single genuine VFC van listing (`/vans/hg71efe`).
- Foreground extraction: `@imgly/background-removal-node` running on 2-vCPU CPU sandbox; ~5s per 1280×960 image. Its **AGPL licence needs review/replacement** before any commercial CRM integration.
- Studio composite: manually designed dark graphite empty studio; floor and subtle reflections, no other vehicles or virtual dealership.
- Actual image-to-video model: **Wan 2.2 14B** hosted on third-party Hugging Face ZeroGPU Space `r3gm/wan2-2-fp8da-aoti-preview2`, called through `@gradio/client`. No real GPU installed on user's PC.
- Three distinct ~3.5-second studio-motion MP4s were successfully generated from different real source photos; further submissions stalled/failed on the shared free endpoint.
- Free-demo native result: 480×832 / 16 fps. Playback/edit assembly renders 720×1280 / 24 fps but this **does not restore native 1080p detail**.
- Prototype: 20-second video with six short sections, using **three unique AI-generated motions repeated**. Music comes from current Marketing CRM `assets/default-reel-audio.mp3` and branding overlays are added only after model generation.
- Output: `samples/videos/VFC_Wan_Studio_20s_Test.mp4` on this isolated sample branch.

## Critical gates

1. **Vehicle authenticity:** Models may alter plates, badges, trim, wheels, bodywork or reflections. Require independent quality inspection before posting a real-stock advert. Never advertise altered vehicle details as actual product footage; replace or mask unreliable plate areas or use genuine source photos for plate shots.
2. **Commercial licensing:** Wan 2.2 model licence and exact deployment terms must be checked; IMG.LY cutout package is AGPL and should not simply be embedded in the commercial CRM without an appropriate compliance strategy. Assess permissively licensed rembg/U2NetP or an existing licensed mask pipeline and confirm model weights' provenance.
3. **Compute reliability:** Public ZeroGPU is a best-effort interactive demonstration, not a reliable daily production API. Test quotas, 429/errors, availability, per-run latency, cost, and output persistence over at least seven days before any automated workflow.
4. **Unit economics:** One 20-second video using 3–6 novel AI shots needs **3–6 image-to-video inference runs**. At the existing VFC target of 10 reels/day, that is **30–60 GPU jobs/day for VFC alone**. Free quota has not been shown to support it. 10 R2B daily reels would double that. No claim of automatic £0/day viability.
5. **Resolution:** Native result 480×832 at 16 fps; do not claim high-quality native 1080×1920 from conventional resizing. Test permitted model-side upscale options or a separate reputable open-source upscaler, preserving actual vehicle detail.
6. **Application pipeline safety:** Existing `api/youtube-mp4-render.js` already handles branded MP4 assembly and Blob; existing `lib/youtubeDailyBatch.js` handles candidate selection, cooldown and daily caps. New AI motion must be an **opt-in alternate footage provider** before final composition, with structured job statuses (queued, running, verified, quarantined, failed, ready).
7. **Fail closed / fallback:** Never stall the existing Editorial Impact daily reels. On image, quota, GPU, authenticity or render failure, fall back to existing ordinary Daily Reels without lost posting slots. Avoid regenerating on sold/reserved vehicles; validate current DealerKit/Wix stock truth at selection and immediately before publishing.
8. **Costs:** Add an explicit GBP monthly GPU spend cap with zero as default. Never silently incur new recurring charges or build dependency on a demo Space.
9. **No production integration yet.** First obtain user's quality verdict on the 20-second sample and a reliable, costed GPU path.

## Low-risk proposed Marketing CRM addition if gates pass

A separate `AI Motion Lab` card in Reel Factory (no modification to regular Reels) that:
- Reads stock/gallery *read-only*; lets operator choose one real VFC vehicle and 3-6 approved photos.
- Cuts out vehicle with a commercially vetted local CPU tool and composites onto versioned dark VFC studio master background.
- Sends explicitly limited image-to-video requests to an authorised compute provider, with timeout/retry caps; stores immutable source/processed files in Vercel Blob.
- Inspects/registers source photo, motion clip, model, provider, time and consent/licence data; flags plate/bodywork alterations for human review.
- Calls existing MP4 composition pipeline, attaches the existing music track and branding, previews a finished 9:16 MP4.
- **Manual approval and download only** during pilot, no Buffer automatic posting.
- Collects generation duration, failures, output quality and per-clip cost.
- Is hidden by default and makes no changes to VFC homepage, dealer stock import, CMS or daily Buffer runs.

**Next decision:** Approve the visual direction first, and then source a commercially usable dependable GPU service. If the only feasible service requires paid GPU minutes, present its actual expected GBP/month expense for user approval or keep this as occasional experimental content.

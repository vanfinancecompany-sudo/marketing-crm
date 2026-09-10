# DealerKit → Wix Media plan

Prepared: 10 September 2026

This is the next safety layer for semi-automatic Van Finance publishing. It is deliberately a plan, not an image uploader.

## Verified Wix Media contract

Official Wix Media Manager documentation confirms that public external files can be imported with:

- `POST https://www.wixapis.com/site-media/v1/files/import`
- required request field: `url`
- optional `mediaType`, with `IMAGE` available for vehicle photos
- optional `displayName`, `mimeType`, `externalInfo`, folder fields and URL headers/parameters
- required permission: `MEDIA.SITE_MEDIA_FILES_IMPORT`

An import response may return while the file is still `PENDING`. Imported files are not safe to use in CMS immediately just because the HTTP request succeeded; processing must reach a ready state.

Official method reference:

`https://dev.wix.com/docs/api-reference/assets/media/media-manager/files/import-file`

## DealerKit review rules

The media planner uses the DealerKit image IDs as the persistent review identity and applies saved review decisions in this order:

1. Excluded images are removed.
2. Saved image order is applied.
3. Remaining source images follow in source order.
4. The primary image must still be present in the included set.

A stable cross-system key is prepared as `{dealerKitStockId}:{dealerKitImageId}`.

The plan blocks if DealerKit sends:

- an image without a stable ID
- duplicate image IDs
- a non-HTTP(S) image URL
- no included images
- a primary image that is missing or excluded

## Storage policy

The intended storage model remains:

**DealerKit source → human review → Wix Media → Wix CMS**

Supabase must not become a vehicle-image library. It may retain small review/state references only. If temporary binary staging ever becomes necessary, it must be short-lived and automatically removed after successful Wix transfer.

## Deliberate live-import lock

Live image importing remains locked even when the review plan is otherwise valid.

Before that lock is removed, the live DealerKit API must confirm the source image contract, especially:

- whether image URLs are public or need URL headers
- whether URLs expire or are durable
- whether DealerKit exposes image MIME/content type
- whether image URLs include a reliable file extension
- whether the image host supports `HEAD` requests

Wix requires enough information to identify the file type. The planner therefore does not invent a `.jpg` suffix or MIME type when DealerKit has not supplied one.

This keeps the next production step small: once DealerKit image behaviour is verified, the existing plan can be converted into a guarded Wix Media import without redesigning the review workflow.

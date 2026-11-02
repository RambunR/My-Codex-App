# Cover artwork

In the series editor, choose a **Cover layout** and save the series details:

| Layout | Recommended dimensions | Aspect ratio |
| --- | --- | --- |
| Vertical | 1080 × 1920 | 9:16 |
| Square | 1080 × 1080 | 1:1 |
| Landscape | 1920 × 1080 | 16:9 |

These dimensions describe the display layout; an upload does not need to have exactly those pixels. JPEG, PNG and WebP covers in other dimensions are welcome within the existing 5 MiB limit. The editor shows the loaded image's actual dimensions.

The cover panel uses the full phone width so the recommended dimensions remain readable. The Drama language selector keeps its native keyboard and phone controls, with its arrow inset from the edge and mirrored for right-to-left languages.

The preview and public series details display the entire image without cropping, stretching or zooming on hover. Black space fills any unused area. The Choose cover button sits below the preview so it does not cover the artwork. Uploaded covers do not receive the fictional title and shading overlays used on the sample catalogue.

Explore and publisher pages keep consistent portrait cards, with the whole cover contained inside each card. Ranking, history, Studio and admin thumbnails also fit the entire image against black. Featured uploaded artwork has its own space beside the story information, or above it on phones.

New series start at 9:16. Existing series retain their former 2:3 frame until their creator explicitly chooses a new layout; their images now fit without cropping as well. Older clients can omit the layout field when saving details without resetting it.

The selected `cover_aspect_ratio` is stored in the additive `series_cover_layouts` table. Only the three new layouts are accepted as explicit updates. Layout changes do not alter cover bytes, storage accounting, ownership, purchases or earnings. Cloudflare preserves the original image; the Node server retains its existing orientation correction and bounded WebP optimization with `fit: inside`. No padded derivative file or duplicate image is created.

Validation on 2 November 2026: 346 backend tests and 131 browser tests passed, together with the Cloudflare build and local integration suite. Screenshot pixel checks verify that source corners survive each layout and black padding appears where needed. Tests also cover permissions, persistence, legacy edits and unchanged cover bytes/quota. The phone cover panel and native language selection were visually checked in English and Arabic, including the inset/mirrored arrow and no horizontal overflow. These checks use local fixtures and do not charge money or edit production dramas.

# Publisher example artwork

The publisher landing page at `/studio` uses all five posters supplied by the operator in `example.zip` on 4 November 2026. They replace the former three generated decorative images in `publisher-mosaic`. These examples do not create series, claim playable episodes, or change uploaded creator artwork.

Each poster is served as a 640×800 WebP in `public/images/examples/`, encoded at quality 90 from the complete supplied PNG. The mosaic retains the full frame, original colours and existing title lettering, with no additional captions or image cropping. It displays three posters above two centred posters and adapts to phone widths. Images have explicit dimensions, lazy loading and asynchronous decoding.

| Uploaded filename | Website asset |
| --- | --- |
| `download (4).png` | `crown-secrets.webp` |
| `download (3).png` | `marriage-revenge.webp` |
| `download (2).png` | `return-with-a-storm.webp` |
| `download (1).png` | `midnight-farewell.webp` |
| `download.png` | `his-hidden-heir.webp` |

The operator initially excluded auth art from the poster update, then separately requested the phoenix banner described below. Example poster filenames remain independent of the legacy `/images/blue-hour.jpg` asset.

## Auth phoenix banner

`authpic.zip` supplies `authpic.png`, a 798×1971 phoenix banner with its own marketing wording and language line. `AuthArtwork` uses a full-resolution WebP at `/images/auth-phoenix.webp`, encoded at quality 92 without resizing or cropping. The existing tint, star and duplicate HTML text overlays are removed so the supplied design stays visible in its original colours. `object-fit: contain` displays the complete tall design against a matching purple background.

The same artwork appears on sign-in, registration and recovery/verification pages. Its alternative text repeats the English marketing message, with `lang="en"` reflecting the image's wording. Forms retain their existing translations and behavior. The existing mobile breakpoint continues to hide the decorative panel so forms retain their available screen space. This changes no sign-in, payment, catalogue, publisher mosaic or stored media behavior; the older shared image remains available for legacy references.

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

`authpic.zip` supplies the original 798×1971 phoenix design. At the operator's later request, it was regenerated as a wider 1024×1536 background to remove lateral empty space. `/images/auth-phoenix-background.webp` uses `object-fit: cover` and fills the full panel. The image contains no baked-in text; the original English wording and language line are rendered responsively above it so they remain readable when the panel changes size. A lower gradient provides contrast without adding side bars.

The artwork appears on sign-in, registration and recovery/verification pages. The decorative image has empty alt text because its message is real HTML, marked `lang="en"`. Forms retain their existing translations and behavior. The existing mobile breakpoint still hides the decorative panel. The publisher mosaic, older image URLs and stored creator media remain intact.

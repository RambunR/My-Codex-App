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

The operator explicitly excluded auth art from this update. Keep `AuthArtwork` and its shared `/images/blue-hour.jpg` asset unchanged. New example filenames are independent of that existing file.

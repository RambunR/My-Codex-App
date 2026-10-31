# Asset notes

The demo catalogue titles, synopses, layout, branding, and poster typography were created for this project. The sample preview video is generated locally by FFmpeg and is explicitly labelled as a sample, not an episode from a licensed commercial drama.

`public/aidramio-logo.png` is an AIDramio brand logo requested by the operator on 27 October 2026. It is a 1254 × 1254 RGBA PNG with a transparent background (389 KiB), suitable as the supplied Google consent-screen logo asset. The original generated image is retained in `/workspace/generated_images/` and the full downloadable PNG remains unchanged.

On 31 October 2026 (Hong Kong time), the operator selected concept **05**, a purple–pink origami phoenix, from ten generated LingYing icon concepts. The approved design was prepared as a standalone 1254 × 1254 opaque PNG (`public/lingying-icon.png`); the generated original remains in `/workspace/generated_images/`. This replaces the coral play symbol in current website and app icons. `brand-mark.png` is a 128-pixel header image, `favicon-32.png` is 32 pixels, `apple-touch-icon.png` is 180 pixels, and `icon-192.png` / `icon-512.png` are ordinary PWA icons. The separate opaque `icon-maskable-512.png` uses a centered 328-pixel artwork area for Android masks. The legacy `icon.svg` embeds the current 512-pixel PNG. Icon/manifest links and the service-worker shell cache are versioned to refresh old assets. The historical AIDramio full wordmark above is retained as a previous brand asset.

Cover photography is downloaded from Unsplash's image service and hosted locally. Source photo identifiers:

| Local filename | Unsplash photo identifier |
|---|---|
| hero / last-train | photo-1519608487953-e999c86e7455 |
| midnight | photo-1534528741775-53994a69daeb |
| seoul | photo-1524504388940-b1c1722653e1 |
| kingdom | photo-1519681393784-d120267933ba |
| blue-hour | photo-1488426862026-3ee34a7d66df |
| after-rain | photo-1517841905240-472988babdf9 |
| paper-moon | photo-1477346611705-65d1883cee1e |
| city | photo-1519501025264-65ba15a82390 |
| portrait | photo-1506794778202-cad84cf45f1d |
| wildflower | photo-1515886657613-9f3515b0c78f |
| ocean | photo-1518837695005-2083093ee35b |

Source URL format: `https://images.unsplash.com/<photo identifier>`. [Unsplash licence](https://unsplash.com/license). Demo artwork is not an endorsement by the pictured people and should be replaced with the publisher's own licensed cover artwork for real series.

DM Sans and Playfair Display are hosted locally. Their SIL Open Font License files are in `public/fonts/`. Lucide icons are provided by `lucide-react` under its ISC licence.

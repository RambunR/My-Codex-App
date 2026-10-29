# Phone viewing and company contact

Reviewed on 30 October 2026, Hong Kong time. The phone layout serves the existing website and viewer accounts.

## Changes

- Discovery uses two-column cards with 14px titles and 12px metadata. All six stories in each home section remain available. Hero copy grows with translations and its controls have touch-sized targets.
- Header search opens with input focus and supports Search/Enter submission, Escape and a labelled Close control. Submitting closes it and blurs the field. Navigation stays available at the bottom, with safe-area padding and an account icon.
- Browse controls use 16px text. Rapid search, language and genre changes merge with the latest browser URL so later changes preserve earlier filters. Clear and browser Back retain normal URL/input synchronization.
- Series details put a full-width Watch action ahead of the synopsis, with larger save, like, share and episode controls. Supported phones can use the native share sheet; clipboard sharing remains the fallback.
- Player navigation uses targets of at least 44px. Small phones use five episode columns; short screens can reach the complete unlock overlay. Long uploaded titles and descriptions wrap within the page, and current-episode navigation has an accessible label.
- Form text is at least 16px, with appropriate search keyboard hints. The viewport opts into Android's supported content-resize behavior for the keyboard. Dialogs scroll within the available height.
- Studio/editor/admin code loads on demand, keeping the creator bundle out of initial viewer navigation. Video retains native controls, inline playback and metadata-only preload.
- The footer and Help, Terms and Privacy pages identify **HK NovaXR Production** and link to **contactus@hknovaxrproduction.com** with `mailto:`. This is the public business contact; account-email delivery configuration is managed separately.

## Verification

`tests/browser/mobile.spec.ts` contains eight behavior checks:

| Phone size or scenario | Checked behavior |
| --- | --- |
| 320px, 390px and 430px portrait | Discovery, search, rapid language/genre filtering, series actions and free playback; no horizontal document overflow |
| Header search at 320px | Focus, close/Escape, trimmed query submission, keyboard blur and navigation |
| Language dialog at 320 × 640 | Last language option remains reachable; Arabic RTL persists after reload |
| 390 × 844 then 844 × 390 | Previous/next episode controls stay usable through rotation |
| Maximum-length uploaded text | 120-character unbroken title, 4,000-character description and 60-character creator name stay inside the phone player layout |
| Registration and company contact at 320px | 16px inputs, primary action size, contact link reachable above bottom navigation |

Additional Chromium review covered the catalogue at 320/390/430px in English, Traditional Chinese and Arabic; player checks covered 568px and 844px landscape widths. All 21 interface languages were reviewed at 320px for header/page overflow on Home, registration, Help and locked playback. Local demo data and mocked content were used for interaction checks. The live-site baseline used public GET requests only.

Run `npm run test:e2e`, `npm test` and `npm run build:cloudflare` when changing these flows. Desktop, account recovery and publishing remain part of the full browser suite.

Screenshots: [phone discovery](screenshots/mobile-home.png) and [series details](screenshots/mobile-series.png).

## Verification limits

These checks use Chromium phone emulation. Physical iPhone Safari, Android keyboards, browser chrome, home-screen installation and nonzero notch/safe-area insets still need device checks. Emulation is not real-device certification or a mobile network benchmark.

Large uploaded cover files can still affect cellular loading; the Cloudflare upload path accepts originals up to 5 MiB. Responsive derivatives for those covers require a separate image pipeline. Interface translation retains the creator's original video and story language.

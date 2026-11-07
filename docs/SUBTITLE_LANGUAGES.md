# Subtitle language declarations

In Studio, **Subtitle languages** sits directly below **Drama language**. Open the checklist, choose any combination of the 21 supported languages, then select **Save details**. Selection chips show the current choices; **Clear** removes all declarations. Keyboard, phone and right-to-left interfaces are supported.

This field describes subtitles already included in the uploaded videos. Selecting a language does not generate, translate, dub or upload a subtitle track. Public series details show a compact subtitle-language list beside the spoken language at the top, plus the existing detailed declaration and watch-sidebar metadata. The list wraps on small screens and uses the supported languages in canonical order. If none are declared, the top summary says **Not specified** without assuming that subtitles are available or absent; the detailed declaration and watch-sidebar block remain omitted.

The API accepts an optional `subtitle_languages` array of unique supported language codes. Arrays are returned in the platform's language order. New and legacy series default to an empty list; an omitted PATCH field preserves the existing declaration, and an explicit empty array clears it. Unknown codes, duplicates, nulls and arrays longer than the supported list are rejected.

The additive `series_subtitle_languages` table stores declarations separately from video files. Updating it retains the series' spoken language, ownership, media, quota and financial state. Existing creator permissions and moderation restrictions apply, and administrator metadata edits record the previous and updated declarations.

## Spoken language and Chinese writing

Spoken dialogue uses a separate language catalogue. The creator editor and Explore filter offer **Mandarin** (`cmn`) and **Cantonese** (`yue`), alongside the other supported spoken languages. Interface languages and subtitle declarations keep **Traditional Chinese** (`zh-TW`) and **Simplified Chinese** (`zh-CN`), since those describe written text. Selecting a spoken language does not change the interface, subtitles or video.

Existing series saved with `zh-TW` or `zh-CN` keep their exact stored value. These codes do not establish whether the dialogue is Mandarin or Cantonese, so public spoken metadata identifies them as Chinese with the spoken variety unspecified. The existing editor selection and bookmarked filter remain available as a conditional legacy option. Creators can explicitly choose Mandarin or Cantonese and save; ordinary edits never infer or rewrite the spoken language. Existing API clients and exact legacy language filters remain compatible, with no automatic retagging or database migration.

`/api/config.languages` remains the 21 interface/subtitle options; the additive `spokenLanguages` field exposes the separate 21 spoken options. Spoken codes are valid for series metadata and discovery only. They are not additional interface, account, payment or consent locales.

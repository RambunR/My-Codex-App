# Subtitle language declarations

In Studio, **Subtitle languages** sits directly below **Drama language**. Open the checklist, choose any combination of the 21 supported languages, then select **Save details**. Selection chips show the current choices; **Clear** removes all declarations. Keyboard, phone and right-to-left interfaces are supported.

This field describes subtitles already included in the uploaded videos. Selecting a language does not generate, translate, dub or upload a subtitle track. Public series details show a compact subtitle-language list beside the spoken language at the top, plus the existing detailed declaration and watch-sidebar metadata. The list wraps on small screens and uses the supported languages in canonical order. If none are declared, the top summary says **Not specified** without assuming that subtitles are available or absent; the detailed declaration and watch-sidebar block remain omitted.

The API accepts an optional `subtitle_languages` array of unique supported language codes. Arrays are returned in the platform's language order. New and legacy series default to an empty list; an omitted PATCH field preserves the existing declaration, and an explicit empty array clears it. Unknown codes, duplicates, nulls and arrays longer than the supported list are rejected.

The additive `series_subtitle_languages` table stores declarations separately from video files. Updating it retains the series' spoken language, ownership, media, quota and financial state. Existing creator permissions and moderation restrictions apply, and administrator metadata edits record the previous and updated declarations.

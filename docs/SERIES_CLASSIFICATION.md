# Series classification

LingYing separates four independent choices in Creator Studio, Explore and series details:

| Choice | Purpose | Examples | Creator selection |
| --- | --- | --- | --- |
| Genre | The kind of drama | Romance, Thriller, Comedy, Medical Drama | 1–3 of 29 standard genres |
| Story themes | Plot and character themes | Revenge, Secret Baby, Entrepreneurship (創業), Found Family | Optional, up to 5 of 26 themes |
| Format | How the series looks | Live-action, Animation, Donghua, Motion Comics | One format; may remain unspecified |
| Production method | How it was made | Human-created, AI-assisted, AI-generated | One method |

For example, an uploader can choose **Thriller → Revenge → Animation → AI-assisted**. Animation and human-created are compatible: human-created describes production, rather than limiting the series to live-action.

## Creator and viewer use

Open [Creator Studio](https://lingyingdrama.com/studio), create or manage a series, select its classifications and save details. Themes and format do not introduce a new mandatory save gate. New editor drafts start with live-action selected; existing work with unknown format keeps the empty selection until its creator chooses one. All existing language, price, cover, episode, duration and storage rules remain in force.

[Explore](https://lingyingdrama.com/browse) offers separate genre, story-theme, format and production-method filters, alongside spoken language, search and sorting. Filters combine: selecting Revenge + Animation + Thriller returns series matching all three. Empty selectors apply no restriction. URLs retain the filters for sharing, and Clear filters resets them. Selecting a classification on a series detail page opens its corresponding Explore filter.

After publication, Explore opens on Newest with the series' spoken language, first genre, first theme (when present), format (when present) and production method selected. The first publication date keeps its existing semantics.

All new classification labels and helper text are translated in the existing 21 interface languages, including right-to-left Arabic and Urdu. Creator-written titles and descriptions retain their uploaded language.

On 8 November 2026, ten choices were added to the existing sixteen:

| Stable ID | English label | Traditional Chinese | Simplified Chinese |
| --- | --- | --- | --- |
| `entrepreneurship` | Entrepreneurship | 創業 | 创业 |
| `business-rivalry` | Business Rivalry | 商戰 | 商战 |
| `inheritance-succession` | Inheritance & Succession | 繼承與接班 | 继承与接班 |
| `family-feud` | Family Feud | 家族恩怨 | 家族恩怨 |
| `love-triangle` | Love Triangle | 三角戀 | 三角恋 |
| `redemption` | Redemption | 救贖 | 救赎 |
| `friendship` | Friendship | 友情 | 友情 |
| `self-discovery` | Self-Discovery | 自我探索 | 自我探索 |
| `survival` | Survival | 生存挑戰 | 生存挑战 |
| `found-family` | Found Family | 非血緣的家人 | 非血缘的家人 |

These are additional choices in creator/admin classification controls, public series metadata links and Explore filters. Existing identifiers and saved choices keep their meaning. No existing series is automatically assigned a new theme, and the maximum remains five themes per series.

## Existing series and API compatibility

The additive `series_classifications` table stores themes and nullable format without changing existing series, media or financial records. Reading an existing series does not write or reclassify it. Legacy series tagged with the old Animation genre expose an inferred animation format; other existing series keep an unknown format. A saved explicit null remains null even if an old Animation genre is retained.

Old Animation genre labels remain in the API vocabulary and appear in the editor when already selected. Creators can remove the old genre label themselves. Existing `?genre=animation` bookmarks continue to find old animation-tagged series and new animated formats. The new `?format=animation` selects the general animation format; Donghua and Motion Comics have their own exact format filters.

`GET /api/config` exposes `standardGenres`, `storyThemes`, `formats` and `creationTypes`; the existing `genres` field retains the legacy Animation ID. Series responses add `themes: string[]` and `format: string | null`. Public list queries accept `theme` and `format` along with the existing filters. IDs are stable and independent of translated display labels; see [the canonical vocabulary](../shared/taxonomy.ts).

Creator create/edit requests accept optional `themes` and `format`. Omitting either field during edits preserves its previous value; sending `themes: []` or `format: null` explicitly clears that field. Unknown IDs, duplicates, oversized arrays and invalid filter values are rejected. Administrative edits and their classification changes are recorded in the existing metadata audit transaction; takedown, ownership, payment-review and storage protections remain in place.

The Donghua display label replaces the former combined label in all 21 interface languages. The stored `anime-donghua` ID remains unchanged, so existing classifications and exact format bookmarks keep working without retagging content.

// Stable identifiers are stored in series metadata and browse URLs; labels live in i18n.
export const STANDARD_GENRES = [
  'romance','romantic-comedy','drama','comedy','action','adventure','thriller','mystery','crime',
  'horror','sci-fi','fantasy','supernatural','historical','family','detective','psychological',
  'youth','coming-of-age','workplace','medical','legal','war-military','martial-arts','sports',
  'music-dance','slice-of-life','tragedy','superhero',
] as const;
// Retain old animation genre metadata and links; new editing uses the separate format field.
export const GENRES = [...STANDARD_GENRES,'animation'] as const;
export const STORY_THEMES = [
  'billionaire-ceo','contract-marriage','enemies-to-lovers','forbidden-romance','second-chance-love',
  'secret-baby','hidden-identity','revenge','betrayal-secrets','strong-heroine','against-all-odds',
  'historical-romance','time-travel-rebirth','werewolf-romance','mafia',
] as const;
export const SERIES_FORMATS = ['live-action','animation','anime-donghua','motion-comic'] as const;
export const CREATION_TYPES = ['human','ai-assisted','ai-generated'] as const;
export type Genre = typeof GENRES[number];
export type StoryTheme = typeof STORY_THEMES[number];
export type SeriesFormat = typeof SERIES_FORMATS[number];
export type CreationType = typeof CREATION_TYPES[number];
export const MAX_STORY_THEMES = 5;

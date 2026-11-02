// Stable Browse query values describe publisher-defined access, independently
// of a particular viewer's purchases or the creator's retained paid price.
export const SERIES_ACCESS_FILTERS=['all-free','all-paid','free-then-paid'] as const;
export type SeriesAccessType=typeof SERIES_ACCESS_FILTERS[number];

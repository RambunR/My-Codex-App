/** Compare titles without changing the creator's saved spelling or punctuation. */
export function normalizeSeriesTitle(title:string):string {
  return title.normalize('NFKC').replace(/\s+/gu,' ').trim().toLowerCase();
}

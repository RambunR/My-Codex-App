export const MAX_EPISODE_BATCH_SIZE=1000;
export const MAX_EPISODE_BATCH_BASE_NAME=115;

/** Titles use the current persisted episode number, never a client supplied
 * suffix or an index within the selected subset. Reordering does not rename. */
export function batchEpisodeTitle(baseName:string,episodeNumber:number){
  const base=baseName.trim();
  if(!base||base.length>MAX_EPISODE_BATCH_BASE_NAME)throw new RangeError('Enter a name between 1 and 115 characters.');
  if(!Number.isSafeInteger(episodeNumber)||episodeNumber<1||episodeNumber>1000)throw new RangeError('Enter a valid episode number.');
  return `${base} ${String(episodeNumber).padStart(3,'0')}`;
}

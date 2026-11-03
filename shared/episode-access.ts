/** Publisher-defined free access is independent of a viewer's paid receipt.
 * The optional final episode follows the highest currently persisted number. */
export function isEpisodeFree(number:number,freeEpisodes:number,lastEpisodeFree=false,lastEpisodeNumber?:number|null){
  return number<=freeEpisodes||(lastEpisodeFree&&lastEpisodeNumber!==null&&lastEpisodeNumber!==undefined&&number===lastEpisodeNumber);
}
/** Reordering renumbers the full list from one. Compare access membership,
 * including gaps, overlap with first-N, and movement of the final episode. */
export function episodeOrderChangesAccess(episodes:readonly {id:string;number:number}[],orderedIds:readonly string[],freeEpisodes:number,lastEpisodeFree=false){
  const finalNumber=episodes.length?Math.max(...episodes.map(episode=>episode.number)):null;
  const byId=new Map(episodes.map(episode=>[episode.id,episode]));
  return orderedIds.some((id,index)=>{
    const episode=byId.get(id);if(!episode)return false;
    return isEpisodeFree(episode.number,freeEpisodes,lastEpisodeFree,finalNumber)!==isEpisodeFree(index+1,freeEpisodes,lastEpisodeFree,orderedIds.length);
  });
}

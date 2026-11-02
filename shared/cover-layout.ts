export const UPLOAD_COVER_ASPECT_RATIOS=['9:16','1:1','16:9'] as const;
export type UploadCoverAspectRatio=typeof UPLOAD_COVER_ASPECT_RATIOS[number];
export type CoverAspectRatio=UploadCoverAspectRatio|'2:3';
export const COVER_ASPECT_DIMENSIONS:Record<CoverAspectRatio,readonly[number,number]>={
  '9:16':[1080,1920],
  '1:1':[1080,1080],
  '16:9':[1920,1080],
  '2:3':[1000,1500],
};
/** Only known ratios can become CSS. Legacy records keep their former frame
 * until the creator explicitly chooses one of the three new display formats. */
export function coverAspectRatioCss(value:unknown){
  return value==='9:16'?'9 / 16':value==='1:1'?'1 / 1':value==='16:9'?'16 / 9':'2 / 3';
}

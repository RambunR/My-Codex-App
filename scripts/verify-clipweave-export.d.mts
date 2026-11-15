export interface LocalClipWeaveIssue {state:'WAIT'|'REJECT';code:string;message:string;path?:string;verified?:boolean;}
export interface LocalClipWeaveSeriesReport {sourceId:string;name:string;state:'READY'|'WAIT'|'REJECT';requiredAssetsIntact:boolean;clipCount:number;expectedFiles:number;verifiedFiles:number;errors:LocalClipWeaveIssue[];}
export interface LocalClipWeaveReport {
  format:'ClipWeave';state:'READY'|'PARTIAL'|'WAIT'|'REJECT';exportId:string|null;manifestSha256:string|null;
  generatedExportIntact:boolean;originalSeriesComplete:null;reportedOriginalSeriesComplete:boolean|null;
  originalStoryCompletenessVerified:false;batchReady:boolean;series:LocalClipWeaveSeriesReport[];errors:LocalClipWeaveIssue[];
  sourceMediaChanged:false;writesPerformed:false;uploadsPerformed:false;mediaProbed:false;remoteDriveVerified:false;
}
export function verifyClipWeaveExport(folder:string,options?:{seriesId?:string;wholeBatch?:boolean}):Promise<LocalClipWeaveReport>;
export function main(args?:string[]):Promise<void>;

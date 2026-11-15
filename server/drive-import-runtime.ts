import type {DriveImportRuntime} from '../shared/drive-import-types.js';
import {config} from './config.js';
import {AppError} from './errors.js';
import {googleDriveCredentials} from './google-drive-import.js';

/** Durable background processing and private R2 staging are provided by the
 * Cloudflare adapter. The local runtime reports setup without starting jobs. */
export const driveImportRuntime:DriveImportRuntime={
  available:()=>false,
  credentials:()=>googleDriveCredentials(config.driveImportCredentials),
  verifyFolder:async()=>{throw new AppError(503,'DRIVE_IMPORT_RUNTIME_UNAVAILABLE','Drive imports require the production Cloudflare runtime.');}
};

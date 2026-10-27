import multer from 'multer';
import path from 'node:path';
import {config} from './config.js';
import {MAX_EPISODE_BYTES} from '../shared/config.js';

export const upload=multer({dest:path.join(config.dataDir,'tmp'),limits:{fileSize:MAX_EPISODE_BYTES,files:1,fields:8,fieldSize:10000}});
export const coverUpload=multer({dest:path.join(config.dataDir,'tmp'),limits:{fileSize:5*1024*1024,files:1,fields:2}});

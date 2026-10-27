import { createReadStream, existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import sharp from 'sharp';
import type { Request, Response } from 'express';
import { config } from './config.js';
import { assert, AppError } from './errors.js';
import { MAX_EPISODE_SECONDS } from '../shared/config.js';

const exec = promisify(execFile);
export async function removeTempFile(file:string){await fs.rm(file,{force:true});}
let activeJobs=0;
const waitingJobs:Array<()=>void>=[];
async function withVideoSlot<T>(work:()=>Promise<T>):Promise<T>{
  assert(waitingJobs.length<8,503,'SERVER_BUSY','Video processing is busy. Please retry shortly.');
  if(activeJobs>=2)await new Promise<void>(resolve=>waitingJobs.push(resolve));else activeJobs++;
  try{return await work();}finally{const next=waitingJobs.shift();if(next)next();else activeJobs--;}
}
const bucket = process.env.S3_BUCKET;
const s3 = bucket ? new S3Client({ region: process.env.S3_REGION || 'auto', endpoint: process.env.S3_ENDPOINT, forcePathStyle: true,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID || '', secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '' } }) : null;
export async function probeVideo(file: string) {
  const { stdout } = await exec(config.ffprobe, ['-v', 'error', '-protocol_whitelist','file,pipe','-format_whitelist','mov,matroska,webm','-show_entries', 'format=duration:stream=codec_type,width,height,duration', '-of', 'json', file], { timeout: 20000, maxBuffer: 1024 * 1024 }).catch(()=>{throw new AppError(422,'INVALID_VIDEO','Please choose a valid MP4, MOV, or WebM video.');});
  const metadata = JSON.parse(stdout); const video = metadata.streams?.find((s: any) => s.codec_type === 'video');
  const duration = Number(metadata.format?.duration || video?.duration);
  assert(video && Number.isFinite(duration) && duration > 0, 422, 'INVALID_VIDEO', 'This file does not contain a readable video.');
  assert(duration <= MAX_EPISODE_SECONDS, 422, 'VIDEO_TOO_LONG', 'Episodes must be 3 minutes or less.');
  assert(video.width <= 7680 && video.height <= 7680, 422, 'INVALID_VIDEO', 'Video dimensions are too large.');
  return { duration, width: video.width, height: video.height };
}
export async function prepareVideo(input: string) { return withVideoSlot(async()=>{
  const info = await probeVideo(input); const output = path.join(config.dataDir, 'tmp', `${crypto.randomUUID()}.mp4`);
  try {
    await exec(config.ffmpeg, ['-nostdin', '-y','-protocol_whitelist','file,pipe','-format_whitelist','mov,matroska,webm','-threads','2', '-i', input, '-map', '0:v:0', '-map', '0:a:0?','-map_metadata','-1', '-vf', "scale='min(1280,iw)':'min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '25', '-maxrate', '2400k', '-bufsize', '4800k', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', '-threads', '2', '-metadata', 'comment=', output], { timeout: 180000, maxBuffer: 2 * 1024 * 1024 });
    return { path: output, duration: info.duration, bytes: (await fs.stat(output)).size };
  } catch (error) { await fs.rm(output, { force: true }); throw error; }
});}
export async function prepareCover(input: string) {
  const output = path.join(config.dataDir, 'tmp', `${crypto.randomUUID()}.webp`);
  const handle=await fs.open(input,'r');const header=Buffer.alloc(16);try{await handle.read(header,0,16,0);}finally{await handle.close();}
  const isJpeg=header[0]===255&&header[1]===216&&header[2]===255;
  const isPng=header.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const isWebp=header.subarray(0,4).toString()==='RIFF'&&header.subarray(8,12).toString()==='WEBP';
  assert(isJpeg||isPng||isWebp,422,'INVALID_IMAGE','Please use a valid JPEG, PNG, or WebP image.');
  try { await sharp(input, { limitInputPixels: 40_000_000 }).rotate().resize({ width: 1000, height: 1500, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toFile(output); }
  catch { assert(false, 422, 'INVALID_IMAGE', 'Please use a valid JPEG, PNG, or WebP image.'); }
  return { path: output, bytes: (await fs.stat(output)).size };
}
function objectPath(key: string) {
  assert(/^[a-zA-Z0-9/_\-.]+$/.test(key) && !key.includes('..'), 400, 'INVALID_PATH', 'Invalid media path.');
  return path.join(config.dataDir, 'objects', key);
}
export async function putObject(file: string, key: string, contentType: string) {
  if (s3 && bucket) await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: createReadStream(file), ContentType: contentType }));
  else { const dest = objectPath(key); await fs.mkdir(path.dirname(dest), { recursive: true }); await fs.copyFile(file, dest); }
}
export async function deleteObject(key: string) {
  if (!key || key.startsWith('public:') || key.startsWith('demo/')) return;
  if (s3 && bucket) await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  else await fs.rm(objectPath(key), { force: true });
}
export async function serveObject(key: string, req: Request, res: Response, type: string) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (s3 && bucket && !key.startsWith('demo/')) { res.redirect(await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key, ResponseContentType: type }), { expiresIn: 120 })); return; }
  const file = objectPath(key); assert(existsSync(file), 404, 'MEDIA_UNAVAILABLE', 'This media file is unavailable.');
  const stat = await fs.stat(file); const range = req.headers.range;
  res.type(type); res.setHeader('Accept-Ranges', 'bytes');
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) { res.status(416).setHeader('Content-Range', `bytes */${stat.size}`); res.end(); return; }
    const start = match[1] ? Number(match[1]) : Math.max(0, stat.size - Number(match[2]));
    const end = match[1] ? (match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1) : stat.size - 1;
    if (start > end || start >= stat.size) { res.status(416).setHeader('Content-Range', `bytes */${stat.size}`); res.end(); return; }
    res.status(206); res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`); res.setHeader('Content-Length', end - start + 1);
    const stream=createReadStream(file,{start,end});res.once('close',()=>stream.destroy());stream.on('error',error=>res.destroy(error));stream.pipe(res);
  } else { res.setHeader('Content-Length', stat.size); const stream=createReadStream(file);res.once('close',()=>stream.destroy());stream.on('error',error=>res.destroy(error));stream.pipe(res); }
}

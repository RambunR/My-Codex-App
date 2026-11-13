/** Correct a narrowly identified, oversignalled AVC export at delivery time.
 * Original objects, encoded pictures, audio, timestamps and byte offsets stay intact.
 * Unknown layouts and genuine high-complexity streams always pass through unchanged. */
export interface VideoBytePatch {offset:number;bytes:Uint8Array}
type ReadRange=(offset:number,length:number)=>Promise<Uint8Array>;
interface Box {type:string;start:number;data:number;end:number}
const MAX_METADATA=4*1024*1024;
const cache=new Map<string,Promise<VideoBytePatch[]>>();
const u32=(b:Uint8Array,p:number)=>{if(p<0||p+4>b.length)throw new Error('Truncated MP4');return new DataView(b.buffer,b.byteOffset,b.byteLength).getUint32(p);};
const u16=(b:Uint8Array,p:number)=>{if(p<0||p+2>b.length)throw new Error('Truncated MP4');return b[p]*256+b[p+1];};
const text=(b:Uint8Array,p:number)=>String.fromCharCode(...b.subarray(p,p+4));
function boxHeader(b:Uint8Array,p:number,end:number):Box{
  if(p+8>end)throw new Error('Truncated box');let size=u32(b,p),header=8;
  if(size===1){size=u32(b,p+8)*2**32+u32(b,p+12);header=16;}
  if(size===0)size=end-p;
  if(!Number.isSafeInteger(size)||size<header||p+size>end)throw new Error('Invalid box');
  return{type:text(b,p+4),start:p,data:p+header,end:p+size};
}
function children(b:Uint8Array,start:number,end:number){
  const result:Box[]=[];for(let p=start;p<end;){if(result.length>=512)throw new Error('Too many boxes');const box=boxHeader(b,p,end);result.push(box);p=box.end;}return result;
}
function required(boxes:Box[],type:string){const found=boxes.filter(b=>b.type===type);if(found.length!==1)throw new Error('Unsupported MP4 layout');return found[0];}
class Bits{
  pos=0;constructor(readonly data:Uint8Array){}
  read(n:number){if(n<0||n>32||this.pos+n>this.data.length*8)throw new Error('Truncated SPS');let value=0;for(let i=0;i<n;i++){value=value*2+((this.data[this.pos>>3]>>(7-(this.pos&7)))&1);this.pos++;}return value;}
  ue(){let zeros=0;while(this.read(1)===0)if(++zeros>24)throw new Error('Oversized SPS value');return 2**zeros-1+this.read(zeros);}
  se(){const n=this.ue();return n&1?(n+1)/2:-n/2;}
}
function unescapeNal(nal:Uint8Array){
  const out:number[]=[];let zeros=0;
  for(let i=0;i<nal.length;i++){const byte=nal[i];if(zeros>=2&&byte===3){if(i+1>=nal.length||nal[i+1]>3)throw new Error('Invalid NAL escape');zeros=0;continue;}out.push(byte);zeros=byte===0?zeros+1:0;}
  return Uint8Array.from(out);
}
function escapeNal(rbsp:Uint8Array){const out:number[]=[];let zeros=0;for(const byte of rbsp){if(zeros>=2&&byte<=3){out.push(3);zeros=0;}out.push(byte);zeros=byte===0?zeros+1:0;}return Uint8Array.from(out);}
function writeBits(data:Uint8Array,pos:number,n:number,value:number){for(let i=0;i<n;i++){const mask=1<<(7-((pos+i)&7));data[(pos+i)>>3]=(data[(pos+i)>>3]&~mask)|(Math.floor(value/2**(n-i-1))%2?mask:0);}}
function gcd(a:number,b:number):number{return b?gcd(b,a%b):a;}
function correctedSps(nal:Uint8Array,scale:number,delta:number,width:number,height:number,maxFps:number){
  const rbsp=unescapeNal(nal),bits=new Bits(rbsp);
  if(bits.read(8)!==0x67)return null;const profile=bits.read(8),constraints=bits.read(8),level=bits.read(8);bits.ue();
  // The affected export is ordinary 8-bit 4:2:0 High Profile, incorrectly
  // labelled above Level 4.2 with an implausible, non-fixed VUI clock.
  if(profile!==100||constraints!==0||level<=42)return null;
  if(bits.ue()!==1||bits.ue()!==0||bits.ue()!==0||bits.read(1)!==0)return null;
  if(bits.read(1)){for(let i=0;i<8;i++)if(bits.read(1)){let last=8,next=8;for(let j=0;j<(i<6?16:64);j++){if(next)next=(last+bits.se()+256)%256;last=next||last;}}}
  if(bits.ue()>12)return null;const order=bits.ue();
  if(order===0){if(bits.ue()>12)return null;}else if(order===1){bits.read(1);bits.se();bits.se();const cycle=bits.ue();if(cycle>255)return null;for(let i=0;i<cycle;i++)bits.se();}else if(order!==2)return null;
  const refs=bits.ue();bits.read(1);const columns=bits.ue()+1,rows=bits.ue()+1;
  if(bits.read(1)!==1)return null;bits.read(1);
  let cropX=0,cropY=0;if(bits.read(1)){cropX=(bits.ue()+bits.ue())*2;cropY=(bits.ue()+bits.ue())*2;}
  const frameMbs=columns*rows,fps=scale/delta;
  if(columns*16-cropX!==width||rows*16-cropY!==height||width>1920||height>1920||frameMbs>8704||frameMbs*maxFps>522240||refs>16||refs*frameMbs>34816)return null;
  if(!bits.read(1))return null;
  if(bits.read(1)){if(bits.read(8)===255){bits.read(16);bits.read(16);}}
  if(bits.read(1))bits.read(1);
  if(bits.read(1)){bits.read(3);bits.read(1);if(bits.read(1)){bits.read(8);bits.read(8);bits.read(8);}}
  if(bits.read(1)){bits.ue();bits.ue();}
  if(!bits.read(1))return null;const timingPosition=bits.pos;
  const oldTick=bits.read(32),oldScale=bits.read(32),fixed=bits.read(1);
  if(!oldTick||fixed||oldScale/(2*oldTick)<=Math.max(120,fps*4))return null;
  // Do not alter HRD schedules or interlaced/picture-structure signalling.
  if(bits.read(1)||bits.read(1)||bits.read(1))return null;
  if(!bits.read(1))return null;bits.read(1);bits.ue();bits.ue();bits.ue();bits.ue();
  const reorder=bits.ue(),buffering=bits.ue();
  if(buffering<refs||buffering>16||reorder>buffering||buffering*frameMbs>34816)return null;
  const divisor=gcd(scale,delta),tick=delta/divisor,timeScale=2*scale/divisor;
  if(!Number.isSafeInteger(timeScale)||timeScale>0xffffffff||tick>0xffffffff)return null;
  rbsp[3]=frameMbs<=8192&&frameMbs*maxFps<=245760&&buffering*frameMbs<=32768?41:42;
  // Equivalent clock fractions can need different emulation-prevention bytes.
  // Choose an exactly equivalent fraction whose escaped NAL length is unchanged.
  for(let factor=1;factor<=256&&timeScale*factor<=0xffffffff&&tick*factor<=0xffffffff;factor++){
    writeBits(rbsp,timingPosition,32,tick*factor);writeBits(rbsp,timingPosition+32,32,timeScale*factor);
    const corrected=escapeNal(rbsp);if(corrected.length===nal.length)return corrected;
  }
  return null;
}
function sampleRate(b:Uint8Array,table:Box[],scale:number,fileSize:number){
  const stts=required(table,'stts'),entries=u32(b,stts.data+4);
  if(!entries||stts.end-stts.data!==8+entries*8||u32(b,stts.data)!==0)return null;
  let count=0,ticks=0,zeroDuration=0,minDelta=Infinity,maxDelta=0;
  for(let i=0;i<entries;i++){
    const samples=u32(b,stts.data+8+i*8),delta=u32(b,stts.data+12+i*8);
    if(!samples||!delta&&(i!==entries-1||samples!==1))return null;
    count+=samples;ticks+=samples*delta;if(delta){minDelta=Math.min(minDelta,delta);maxDelta=Math.max(maxDelta,delta);}else zeroDuration+=samples;
  }
  const average=scale*(count-zeroDuration)/ticks;
  if(!Number.isSafeInteger(ticks)||!Number.isSafeInteger(count)||count>MAX_METADATA/4||count>fileSize||!ticks||maxDelta/minDelta>1.15)return null;
  // This is a non-fixed nominal decoder clock, not the presentation timeline.
  // Keep all MP4 sample timestamps (including 23.976/29.97/59.94) unchanged.
  const rates=[[24,1],[25,1],[30,1],[50,1],[60,1]];
  rates.sort((a,c)=>Math.abs(a[0]/a[1]-average)-Math.abs(c[0]/c[1]-average));
  const [clock,delta]=rates[0],fps=clock/delta;
  if(Math.abs(fps-average)/fps>0.005)return null;
  const stsz=required(table,'stsz');if(u32(b,stsz.data)!==0||u32(b,stsz.data+8)!==count)return null;
  const fixed=u32(b,stsz.data+4),window=Math.ceil(fps)+1;
  if(stsz.end-stsz.data!==(fixed?12:12+count*4))return null;
  // Bound the actual compressed samples as well as their claimed btrt tag.
  // This conservative sliding window stays below the Level 4.1 bitrate limit.
  if(fixed){if(fixed*count>fileSize||fixed*Math.min(count,window)>6_250_000)return null;}
  else{
    const sizes=new Float64Array(window);let recent=0,total=0;
    for(let i=0;i<count;i++){const size=u32(b,stsz.data+12+i*4);if(!size)return null;total+=size;recent+=size-sizes[i%window];sizes[i%window]=size;if(recent>6_250_000||total>fileSize)return null;}
  }
  return{scale:clock,delta,fps,maxFps:scale/minDelta};
}
function moovPatches(b:Uint8Array,base:number,fileSize:number):VideoBytePatch[]{
  const movie=children(b,0,b.length),tracks=movie.filter(box=>box.type==='trak');const videos:Box[][]=[];
  for(const track of tracks){const mdia=required(children(b,track.data,track.end),'mdia'),media=children(b,mdia.data,mdia.end),handler=required(media,'hdlr');if(handler.end-handler.data<12)throw new Error('Truncated handler');if(text(b,handler.data+8)==='vide')videos.push(media);}
  if(videos.length!==1)return[];const media=videos[0],mdhd=required(media,'mdhd');
  const version=b[mdhd.data];if(version!==0&&version!==1)return[];const scale=u32(b,mdhd.data+(version===1?20:12));if(!scale)return[];
  const minf=required(media,'minf'),stbl=required(children(b,minf.data,minf.end),'stbl'),table=children(b,stbl.data,stbl.end);
  const cadence=sampleRate(b,table,scale,fileSize);if(!cadence)return[];
  const stsd=required(table,'stsd');if(u32(b,stsd.data)!==0||u32(b,stsd.data+4)!==1)return[];
  const entry=required(children(b,stsd.data+8,stsd.end),'avc1');if(entry.end-entry.data<78)return[];
  const width=u16(b,entry.data+24),height=u16(b,entry.data+26);
  const avc=required(children(b,entry.data+78,entry.end),'avcC'),p=avc.data;
  if(avc.end-p<8||b[p]!==1||(b[p+5]&31)!==1)return[];
  const length=u16(b,p+6),nalStart=p+8;if(length<5||length>1024||nalStart+length+1>avc.end)return[];
  const nal=b.subarray(nalStart,nalStart+length);
  if(b[p+1]!==nal[1]||b[p+2]!==nal[2]||b[p+3]!==nal[3])return[];
  const corrected=correctedSps(nal,cadence.scale,cadence.delta,width,height,cadence.maxFps);if(!corrected)return[];
  return[{offset:base+p+3,bytes:Uint8Array.of(corrected[3])},{offset:base+nalStart,bytes:corrected}];
}
export async function inspectMp4Playback(size:number,read:ReadRange):Promise<VideoBytePatch[]>{
  try{
    if(!Number.isSafeInteger(size)||size<16)return[];let offset=0,format=false;
    for(let n=0;offset+8<=size&&n<128;n++){
      const h=await read(offset,Math.min(16,size-offset));if(h.length<8)return[];let length=u32(h,0),header=8;
      if(length===1){length=u32(h,8)*2**32+u32(h,12);header=16;}if(length===0)length=size-offset;
      if(!Number.isSafeInteger(length)||length<header||offset+length>size)return[];
      const type=text(h,4);if(type==='ftyp')format=true;
      if(type==='moov'){if(!format||length-header>MAX_METADATA)return[];const data=await read(offset+header,length-header);if(data.length!==length-header)return[];return moovPatches(data,offset+header,size);}
      offset+=length;
    }
  }catch{/* Unsupported/malformed legacy media retains its original delivery. */}
  return[];
}
export function cachedMp4Playback(key:string,version:string,size:number,read:ReadRange){
  const identity=key+'\0'+version;const prior=cache.get(identity);if(prior)return prior;
  if(cache.size>=64)cache.delete(cache.keys().next().value!);
  let readError:unknown;
  const result=inspectMp4Playback(size,async(offset,length)=>{try{return await read(offset,length);}catch(error){readError=error;throw error;}}).then(patches=>{if(readError)throw readError;return patches;});
  cache.set(identity,result);void result.catch(()=>{if(cache.get(identity)===result)cache.delete(identity);});return result;
}
export function patchVideoBytes(bytes:Uint8Array,offset:number,patches:VideoBytePatch[]):Uint8Array{
  const overlaps=patches.filter(p=>p.offset<offset+bytes.length&&p.offset+p.bytes.length>offset);if(!overlaps.length)return bytes;
  const out=Uint8Array.from(bytes);for(const patch of overlaps){const start=Math.max(offset,patch.offset),end=Math.min(offset+bytes.length,patch.offset+patch.bytes.length);out.set(patch.bytes.subarray(start-patch.offset,end-patch.offset),start-offset);}return out;
}

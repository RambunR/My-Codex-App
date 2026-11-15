import {useCallback,useEffect,useRef,useState,type RefObject} from 'react';

export type VideoFullscreenMode='none'|'container'|'native';
type FullscreenDocument=Document&{webkitFullscreenElement?:Element|null;webkitFullscreenEnabled?:boolean;webkitExitFullscreen?:()=>void|Promise<void>};
type FullscreenContainer=HTMLDivElement&{webkitRequestFullscreen?:()=>void|Promise<void>;webkitRequestFullScreen?:()=>void|Promise<void>};
type NativeFullscreenVideo=HTMLVideoElement&{webkitEnterFullscreen?:()=>void;webkitExitFullscreen?:()=>void;webkitDisplayingFullscreen?:boolean;webkitPresentationMode?:string;webkitSetPresentationMode?:(mode:'inline'|'fullscreen')=>void;webkitSupportsPresentationMode?:(mode:'fullscreen')=>boolean};
const fullscreenElement=(doc:FullscreenDocument)=>doc.fullscreenElement||doc.webkitFullscreenElement;
function supportsNativePresentation(media:NativeFullscreenVideo){try{return typeof media.webkitSetPresentationMode==='function'&&!!media.webkitSupportsPresentationMode?.('fullscreen');}catch{return false;}}

/** Native presentation is a separate surface: leave it before a DOM paywall.
 * Exiting is best effort; a browser's own Done/exit control remains available. */
export async function exitNativeVideoFullscreen(video:HTMLVideoElement|null){
  const node=video as NativeFullscreenVideo|null;if(!node)return;
  const doc=document as FullscreenDocument;
  try{
    if(fullscreenElement(doc)===node){
      await Promise.resolve(typeof doc.exitFullscreen==='function'?doc.exitFullscreen():doc.webkitExitFullscreen?.());return;
    }
    if(typeof node.webkitExitFullscreen==='function')node.webkitExitFullscreen();
    else if(typeof node.webkitSetPresentationMode==='function')node.webkitSetPresentationMode('inline');
    else return;
    if(!node.webkitDisplayingFullscreen&&node.webkitPresentationMode!=='fullscreen')return;
    await new Promise<void>(resolve=>{
      const finish=()=>{clearTimeout(timer);node.removeEventListener('webkitendfullscreen',finish);node.removeEventListener('webkitpresentationmodechanged',changed);resolve();};
      const changed=()=>{if(!node.webkitDisplayingFullscreen&&node.webkitPresentationMode!=='fullscreen')finish();};
      const timer=setTimeout(finish,700);node.addEventListener('webkitendfullscreen',finish,{once:true});node.addEventListener('webkitpresentationmodechanged',changed);
    });
  }catch{/* Native controls remain available if the browser refuses an exit. */}
}

export function useVideoFullscreen(container:RefObject<HTMLDivElement|null>,video:RefObject<HTMLVideoElement|null>,hasVideo:boolean,onChange?:(mode:VideoFullscreenMode)=>void,videoIdentity?:unknown){
  const[mode,setMode]=useState<VideoFullscreenMode>('none'),[supported,setSupported]=useState(false),[busy,setBusy]=useState(false),[unavailable,setUnavailable]=useState(false);
  const currentMode=useRef<VideoFullscreenMode>('none'),nativeActive=useRef(false),deniedContainer=useRef(false),deniedNative=useRef(false),pending=useRef(false),notify=useRef(onChange);notify.current=onChange;
  const update=useCallback(()=>{
    const doc=document as FullscreenDocument,node=container.current as FullscreenContainer|null,media=video.current as NativeFullscreenVideo|null,active=fullscreenElement(doc);
    const next:VideoFullscreenMode=node&&active===node?'container':media&&(active===media||nativeActive.current||media.webkitDisplayingFullscreen||media.webkitPresentationMode==='fullscreen')?'native':'none';
    if(next!==currentMode.current){currentMode.current=next;setMode(next);notify.current?.(next);}
    if(next!=='none')setUnavailable(false);
    const containerAvailable=!!node&&!deniedContainer.current&&((doc.fullscreenEnabled!==false&&typeof node.requestFullscreen==='function')||(doc.webkitFullscreenEnabled!==false&&(typeof node.webkitRequestFullscreen==='function'||typeof node.webkitRequestFullScreen==='function')));
    const nativeAvailable=!!media&&!deniedNative.current&&(typeof media.webkitEnterFullscreen==='function'||supportsNativePresentation(media));
    setSupported(next!=='none'||containerAvailable||nativeAvailable);
  },[container,video]);
  useEffect(()=>{
    const doc=document as FullscreenDocument,media=video.current as NativeFullscreenVideo|null;nativeActive.current=false;deniedNative.current=false;
    const begin=()=>{nativeActive.current=true;update();},end=()=>{nativeActive.current=false;update();};
    const presentation=()=>{if(typeof media?.webkitPresentationMode==='string')nativeActive.current=media.webkitPresentationMode==='fullscreen';update();};
    // An early native request can fail before metadata is ready. Let the next
    // user gesture retry once the browser knows the media's capabilities.
    const metadata=()=>{deniedNative.current=false;update();};
    update();doc.addEventListener('fullscreenchange',update);doc.addEventListener('webkitfullscreenchange',update);
    media?.addEventListener('webkitbeginfullscreen',begin);media?.addEventListener('webkitendfullscreen',end);media?.addEventListener('webkitpresentationmodechanged',presentation);media?.addEventListener('loadedmetadata',metadata);
    return()=>{doc.removeEventListener('fullscreenchange',update);doc.removeEventListener('webkitfullscreenchange',update);media?.removeEventListener('webkitbeginfullscreen',begin);media?.removeEventListener('webkitendfullscreen',end);media?.removeEventListener('webkitpresentationmodechanged',presentation);media?.removeEventListener('loadedmetadata',metadata);nativeActive.current=false;};
  },[hasVideo,videoIdentity,update,video]);
  useEffect(()=>{const node=container.current;return()=>{const doc=document as FullscreenDocument;if(node&&fullscreenElement(doc)===node){try{void Promise.resolve(typeof doc.exitFullscreen==='function'?doc.exitFullscreen():doc.webkitExitFullscreen?.()).catch(()=>{});}catch{}}};},[container]);
  const toggle=()=>{
    if(pending.current||!container.current)return;
    const doc=document as FullscreenDocument,node=container.current as FullscreenContainer,media=video.current as NativeFullscreenVideo|null;
    let nativeAttempt=false;pending.current=true;setBusy(true);setUnavailable(false);
    try{
      let result:void|Promise<void>;
      if(currentMode.current==='container')result=typeof doc.exitFullscreen==='function'?doc.exitFullscreen():doc.webkitExitFullscreen?.();
      else if(currentMode.current==='native')result=exitNativeVideoFullscreen(media);
      else if(!deniedContainer.current&&doc.fullscreenEnabled!==false&&typeof node.requestFullscreen==='function')result=node.requestFullscreen();
      else if(!deniedContainer.current&&doc.webkitFullscreenEnabled!==false&&typeof node.webkitRequestFullscreen==='function')result=node.webkitRequestFullscreen();
      else if(!deniedContainer.current&&doc.webkitFullscreenEnabled!==false&&typeof node.webkitRequestFullScreen==='function')result=node.webkitRequestFullScreen();
      // Invoke iPhone's API directly in a fresh user gesture. An async denied
      // container request must never manufacture permission for a fallback.
      else if(media&&!deniedNative.current&&typeof media.webkitEnterFullscreen==='function'){nativeAttempt=true;result=media.webkitEnterFullscreen();}
      else if(media&&!deniedNative.current&&supportsNativePresentation(media)&&media.webkitSetPresentationMode){nativeAttempt=true;result=media.webkitSetPresentationMode('fullscreen');}
      else{setUnavailable(true);update();pending.current=false;setBusy(false);return;}
      void Promise.resolve(result).then(update).catch(()=>{if(nativeAttempt)deniedNative.current=true;else deniedContainer.current=true;setUnavailable(true);update();}).finally(()=>{pending.current=false;setBusy(false);});
    }catch{if(nativeAttempt)deniedNative.current=true;else deniedContainer.current=true;pending.current=false;setBusy(false);setUnavailable(true);update();}
  };
  return{mode,supported,busy,unavailable,toggle};
}

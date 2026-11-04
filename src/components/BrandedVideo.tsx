import {forwardRef,useEffect,useRef,useState,type Key,type ReactNode,type VideoHTMLAttributes} from 'react';
import {Maximize,Minimize} from 'lucide-react';
import {useI18n} from '../i18n';
import '../branded-video.css';
import '../media-save-controls.css';

type FullscreenDocument=Document&{webkitFullscreenElement?:Element|null;webkitFullscreenEnabled?:boolean;webkitExitFullscreen?:()=>void|Promise<void>};
type FullscreenContainer=HTMLDivElement&{webkitRequestFullscreen?:()=>void|Promise<void>;webkitRequestFullScreen?:()=>void|Promise<void>};
interface BrandedVideoProps extends VideoHTMLAttributes<HTMLVideoElement>{
  wrapperClassName?:string;
  videoKey?:Key;
  overlay?:ReactNode;
}

/** The original video and native controls stay intact. Fullscreen targets the
 * container so its decorative brand remains visible alongside the video. */
export const BrandedVideo=forwardRef<HTMLVideoElement,BrandedVideoProps>(function BrandedVideo({wrapperClassName='',videoKey,overlay,controlsList,onContextMenu,onDragStart,...props},ref){
  const{t}=useI18n();const root=useRef<FullscreenContainer>(null);const denied=useRef(false);const[fullscreen,setFullscreen]=useState(false);const[supported,setSupported]=useState(false);const[busy,setBusy]=useState(false);
  useEffect(()=>{
    const doc=document as FullscreenDocument;
    const update=()=>{
      const node=root.current;
      setFullscreen(!!node&&(doc.fullscreenElement||doc.webkitFullscreenElement)===node);
      setSupported(!denied.current&&!!node&&((doc.fullscreenEnabled!==false&&typeof node.requestFullscreen==='function')||(doc.webkitFullscreenEnabled!==false&&(typeof node.webkitRequestFullscreen==='function'||typeof node.webkitRequestFullScreen==='function'))));
    };
    update();doc.addEventListener('fullscreenchange',update);doc.addEventListener('webkitfullscreenchange',update);
    return()=>{doc.removeEventListener('fullscreenchange',update);doc.removeEventListener('webkitfullscreenchange',update);};
  },[]);
  const toggleFullscreen=async()=>{
    if(busy||!root.current)return;setBusy(true);
    const doc=document as FullscreenDocument,node=root.current;
    try{
      if((doc.fullscreenElement||doc.webkitFullscreenElement)===node){
        if(typeof doc.exitFullscreen==='function')await doc.exitFullscreen();else await doc.webkitExitFullscreen?.();
      }else if(doc.fullscreenEnabled!==false&&typeof node.requestFullscreen==='function')await node.requestFullscreen();
      else if(typeof node.webkitRequestFullscreen==='function')await node.webkitRequestFullscreen();
      else await node.webkitRequestFullScreen?.();
    }catch{
      // Restore the native fullscreen control if container fullscreen is denied.
      // Native presentation may omit DOM overlays, but playback stays usable.
      denied.current=true;setSupported(false);
    }finally{setBusy(false);}
  };
  const nativeControls=[...new Set(['nodownload',...(controlsList||'').split(/\s+/).filter(Boolean),...(supported?['nofullscreen']:[])])].join(' ');
  return <div className={`branded-video ${wrapperClassName}`} ref={root}>
    <video {...props} key={videoKey} ref={ref} controlsList={nativeControls} draggable={false} onContextMenu={event=>{event.preventDefault();onContextMenu?.(event);}} onDragStart={event=>{event.preventDefault();onDragStart?.(event);}}/>
    <img className="branded-video-icon" src="/icon-192.png?v=lingying-phoenix-05-v1" alt="" aria-hidden="true" draggable={false}/>
    {overlay}
    {supported&&<button className="branded-video-fullscreen" type="button" onClick={()=>void toggleFullscreen()} disabled={busy} aria-label={t(fullscreen?'videoExitFullscreen':'videoEnterFullscreen')} title={t(fullscreen?'videoExitFullscreen':'videoEnterFullscreen')}>{fullscreen?<Minimize size={18} aria-hidden="true"/>:<Maximize size={18} aria-hidden="true"/>}</button>}
  </div>;
});

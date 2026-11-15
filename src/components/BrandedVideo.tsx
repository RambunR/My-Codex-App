import {forwardRef,useCallback,useId,useRef,type Key,type ReactNode,type Ref,type VideoHTMLAttributes} from 'react';
import {Maximize,Minimize} from 'lucide-react';
import {useI18n} from '../i18n';
import {useVideoFullscreen,type VideoFullscreenMode} from '../useVideoFullscreen';
import '../branded-video.css';
import '../media-save-controls.css';

interface BrandedVideoProps extends VideoHTMLAttributes<HTMLVideoElement>{
  wrapperClassName?:string;
  videoKey?:Key;
  overlay?:ReactNode;
  renderVideo?:boolean;
  containerRef?:Ref<HTMLDivElement>;
  fullscreenControls?:ReactNode;
  onFullscreenChange?:(mode:VideoFullscreenMode)=>void;
}

function setRef<T>(ref:Ref<T>|undefined,value:T|null){if(typeof ref==='function')ref(value);else if(ref)ref.current=value;}

/** The original video and native controls stay intact. Fullscreen targets the
 * container so its decorative brand remains visible alongside the video. */
export const BrandedVideo=forwardRef<HTMLVideoElement,BrandedVideoProps>(function BrandedVideo({wrapperClassName='',videoKey,overlay,renderVideo=true,containerRef,fullscreenControls,onFullscreenChange,controlsList,onContextMenu,onDragStart,...props},ref){
  const{t}=useI18n();const root=useRef<HTMLDivElement>(null),video=useRef<HTMLVideoElement>(null);const statusId=useId();
  const assignContainer=useCallback((node:HTMLDivElement|null)=>{root.current=node;setRef(containerRef,node);},[containerRef]);
  const assignVideo=useCallback((node:HTMLVideoElement|null)=>{video.current=node;setRef(ref,node);},[ref]);
  const fullscreen=useVideoFullscreen(root,video,renderVideo,onFullscreenChange,videoKey);
  // Keep native fullscreen available, including if the container API is denied.
  const nativeControls=[...new Set(['nodownload',...(controlsList||'').split(/\s+/).filter(value=>value&&value!=='nofullscreen')])].join(' ');
  return <div className={`branded-video ${wrapperClassName}`} ref={assignContainer} data-fullscreen-mode={fullscreen.mode}>
    {renderVideo&&<video {...props} key={videoKey} ref={assignVideo} controlsList={nativeControls} draggable={false} onContextMenu={event=>{event.preventDefault();onContextMenu?.(event);}} onDragStart={event=>{event.preventDefault();onDragStart?.(event);}}/>}
    <img className="branded-video-icon" src="/icon-192.png?v=lingying-phoenix-05-v1" alt="" aria-hidden="true" draggable={false}/>
    {overlay}
    {fullscreen.mode==='container'&&fullscreenControls&&<div className="branded-video-fullscreen-controls">{fullscreenControls}</div>}
    <button className="branded-video-fullscreen" type="button" onClick={fullscreen.toggle} disabled={fullscreen.busy||!fullscreen.supported} aria-label={t(fullscreen.mode==='none'?'videoEnterFullscreen':'videoExitFullscreen')} title={t(!fullscreen.supported?'watchFullscreenUnavailable':fullscreen.mode==='none'?'videoEnterFullscreen':'videoExitFullscreen')} aria-describedby={fullscreen.unavailable||!fullscreen.supported?statusId:undefined}>{fullscreen.mode==='none'?<Maximize size={18} aria-hidden="true"/>:<Minimize size={18} aria-hidden="true"/>}</button>
    {(fullscreen.unavailable||!fullscreen.supported)&&<span className="branded-video-fullscreen-status" id={statusId} role="status">{t('watchFullscreenUnavailable')}</span>}
  </div>;
});

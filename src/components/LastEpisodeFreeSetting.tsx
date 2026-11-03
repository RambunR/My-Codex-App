import {useEffect,useId,useRef,useState} from 'react';
import {Info} from 'lucide-react';
import {useI18n} from '../i18n';
import '../last-episode-free.css';

export function LastEpisodeFreeSetting({checked,onChange,disabled=false}:{checked:boolean;onChange:(value:boolean)=>void;disabled?:boolean}){
  const{t}=useI18n();const id=useId();const root=useRef<HTMLDivElement>(null);const pinned=useRef(false);const[open,setOpen]=useState(false);
  const close=()=>{pinned.current=false;setOpen(false);};
  useEffect(()=>{
    const outside=(event:PointerEvent)=>{if(event.target instanceof Node&&!root.current?.contains(event.target))close();};
    document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);
  },[]);
  useEffect(()=>{if(disabled)close();},[disabled]);
  return <div className="last-episode-free-setting" ref={root} onKeyDown={event=>{if(event.key==='Escape'){close();event.stopPropagation();}}}>
    <div className="last-episode-free-row">
      <label className="last-episode-free-choice" htmlFor={`${id}-checkbox`}><input id={`${id}-checkbox`} name="last_episode_free" type="checkbox" form="series-details-form" checked={checked} disabled={disabled} onChange={event=>{close();onChange(event.target.checked);}}/><span>{t('lastEpisodeFreeLabel')}</span></label>
      <div className="last-episode-free-help" onPointerEnter={event=>{if(event.pointerType==='mouse'&&!disabled)setOpen(true);}} onPointerLeave={()=>{if(!pinned.current&&!root.current?.contains(document.activeElement))setOpen(false);}}>
        <button className="last-episode-free-info" type="button" aria-label={t('lastEpisodeFreeInfoLabel')} aria-expanded={open} aria-controls={`${id}-info`} aria-describedby={open?`${id}-info`:undefined} disabled={disabled} onFocus={()=>setOpen(true)} onBlur={event=>{if(!root.current?.contains(event.relatedTarget))close();}} onClick={()=>{const next=!pinned.current;pinned.current=next;setOpen(next);}}><Info size={17} aria-hidden="true"/></button>
      </div>
    </div>
    {open&&<p id={`${id}-info`} className="last-episode-free-tooltip" role="tooltip">{t('lastEpisodeFreeInfoBody')}</p>}
  </div>;
}

import {useEffect,type RefObject} from 'react';
import {api,post,ApiError} from './api';
import type {PlaybackReceipt} from '../shared/analytics';

// Media requests can be preloads and seeks. Measure visible, advancing playback
// instead, and flush on pause/navigation so short episodes still report time.
export function usePlaybackAnalytics(videoRef:RefObject<HTMLVideoElement|null>,episodeId:string|undefined,enabled:boolean,userId:string|undefined,revision:number){
  useEffect(()=>{
    const video=videoRef.current;
    if(!video||!episodeId||!enabled)return;
    let disposed=false,excluded=false,starting=false,sessionId='',baselineMs=0,activeMs=0,sentMs=-1;
    let visible=document.visibilityState==='visible',advancing=false;
    let lastTime=video.currentTime,lastClock=performance.now();
    const reset=()=>{lastTime=video.currentTime;lastClock=performance.now();};
    const sample=()=>{
      const now=performance.now(),elapsed=now-lastClock,delta=video.currentTime-lastTime,rate=video.playbackRate||1;
      if(visible&&advancing&&!video.seeking&&delta>0&&delta<=Math.max(1.5,elapsed/1000*rate+0.5)){
        activeMs+=Math.min(elapsed,delta/rate*1000);
      }
      lastTime=video.currentTime;lastClock=now;
    };
    const flush=(keepalive=false)=>{
      if(!sessionId||excluded)return;
      const watchedMs=Math.min(180_000,Math.floor(baselineMs+activeMs));
      if(watchedMs<=sentMs)return;
      const priorSent=sentMs;sentMs=watchedMs;
      const targetSession=sessionId;
      void api<PlaybackReceipt>(`/api/playback/${targetSession}`,{method:'PUT',body:JSON.stringify({watchedMs}),keepalive}).catch(error=>{
        // Analytics failures never stop playback or expose an error to viewers.
        if(error instanceof ApiError&&error.code==='PLAYBACK_EXPIRED'&&sessionId===targetSession&&!disposed){
          sessionId='';baselineMs=0;activeMs=0;sentMs=-1;reset();
          if(visible&&advancing)start();
          return;
        }
        if(sentMs===watchedMs)sentMs=priorSent;
      });
    };
    const start=()=>{
      if(sessionId||starting||excluded||disposed||!visible)return;
      starting=true;
      void post<PlaybackReceipt&{excluded?:boolean}>(`/api/episodes/${episodeId}/playback`).then(receipt=>{
        if(receipt.excluded){excluded=true;return;}
        sessionId=receipt.sessionId;baselineMs=receipt.reportedMs??receipt.watchedMs;
        if(activeMs>0)flush(disposed);
      }).catch(()=>{}).finally(()=>{starting=false;});
    };
    const onPlaying=()=>{reset();advancing=true;start();};
    const onWaiting=()=>{sample();advancing=false;flush();};
    const onPause=()=>{sample();advancing=false;flush(true);};
    const onSeeking=()=>{sample();advancing=false;reset();};
    const onSeeked=()=>{reset();advancing=!video.paused&&!video.ended;};
    const onTime=()=>{
      sample();
      if(activeMs>=3300&&sentMs<baselineMs+3000)flush();
    };
    const onVisibility=()=>{
      sample();visible=document.visibilityState==='visible';reset();
      advancing=visible&&!video.paused&&!video.ended&&!video.seeking;
      if(visible&&advancing)start();else flush(true);
    };
    const onPageHide=()=>{sample();advancing=false;flush(true);};
    const timer=window.setInterval(()=>{sample();if(advancing){start();flush();}},10_000);
    video.addEventListener('playing',onPlaying);
    video.addEventListener('waiting',onWaiting);
    video.addEventListener('pause',onPause);
    video.addEventListener('ended',onPause);
    video.addEventListener('seeking',onSeeking);
    video.addEventListener('seeked',onSeeked);
    video.addEventListener('timeupdate',onTime);
    document.addEventListener('visibilitychange',onVisibility);
    window.addEventListener('pagehide',onPageHide);
    if(!video.paused&&!video.ended)onPlaying();
    return()=>{
      sample();disposed=true;advancing=false;flush(true);window.clearInterval(timer);
      video.removeEventListener('playing',onPlaying);
      video.removeEventListener('waiting',onWaiting);
      video.removeEventListener('pause',onPause);
      video.removeEventListener('ended',onPause);
      video.removeEventListener('seeking',onSeeking);
      video.removeEventListener('seeked',onSeeked);
      video.removeEventListener('timeupdate',onTime);
      document.removeEventListener('visibilitychange',onVisibility);
      window.removeEventListener('pagehide',onPageHide);
    };
  },[videoRef,episodeId,enabled,userId,revision]);
}

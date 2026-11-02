import type {CSSProperties,ImgHTMLAttributes} from 'react';
import {coverAspectRatioCss} from '../../shared/cover-layout';
import '../cover-artwork.css';

export function coverFrameStyle(ratio:unknown):CSSProperties{return{aspectRatio:coverAspectRatioCss(ratio)};}
export function CoverArtwork({className='',onLoad,onDimensions,...props}:ImgHTMLAttributes<HTMLImageElement>&{onDimensions?:(dimensions:{width:number;height:number})=>void}){
  return <img {...props} className={`cover-artwork-image ${className}`} data-cover-artwork="whole" onLoad={event=>{const image=event.currentTarget;if(image.naturalWidth&&image.naturalHeight)onDimensions?.({width:image.naturalWidth,height:image.naturalHeight});onLoad?.(event);}}/>;
}

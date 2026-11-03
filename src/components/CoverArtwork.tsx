import type {CSSProperties,ImgHTMLAttributes} from 'react';
import {coverAspectRatioCss} from '../../shared/cover-layout';
import '../cover-artwork.css';
import '../poster-watermark.css';

type CoverArtworkProps=ImgHTMLAttributes<HTMLImageElement>&{onDimensions?:(dimensions:{width:number;height:number})=>void};

export function coverFrameStyle(ratio:unknown):CSSProperties{return{aspectRatio:coverAspectRatioCss(ratio)};}
export function CoverArtwork({className='',onLoad,onDimensions,...props}:CoverArtworkProps){
  return <img {...props} className={`cover-artwork-image ${className}`} data-cover-artwork="whole" onLoad={event=>{const image=event.currentTarget;if(image.naturalWidth&&image.naturalHeight)onDimensions?.({width:image.naturalWidth,height:image.naturalHeight});onLoad?.(event);}}/>;
}

/** A decorative display layer; original artwork and stored media stay intact. */
export function CoverWatermark({className=''}:{className?:string}){
  return <span className={`cover-watermark ${className}`} aria-hidden="true"/>;
}

/** Small cover frames preserve the surrounding row's existing dimensions. */
export function CoverThumbnail({frameClassName='',...props}:CoverArtworkProps&{frameClassName?:string}){
  return <span className={`cover-thumbnail ${frameClassName}`}><CoverArtwork {...props}/><CoverWatermark/></span>;
}

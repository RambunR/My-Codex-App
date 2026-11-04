import '../publisher-mosaic.css';

// Operator-supplied example posters are decorative artwork, not catalogue entries.
const posters=['crown-secrets','marriage-revenge','return-with-a-storm','midnight-farewell','his-hidden-heir'];

export function PublisherMosaic(){
  return <div className="publisher-mosaic publisher-example-mosaic" aria-hidden="true">
    {posters.map(poster=><div key={poster}><img src={`/images/examples/${poster}.webp`} width={640} height={800} alt="" loading="lazy" decoding="async"/></div>)}
  </div>;
}

import { Rectangle, Sprite, Texture } from 'pixi.js';
import atlasUrl from './assets/interwar-miniatures.webp?url';

// Trimmed rectangles in the single atlas. Anchors mark the boots, wheels or tent footprint.
const frames = {
  infantry:        {x:2,   w:180,h:178,footX:.4617,footY:.9541,width:37},
  cavalry:         {x:186, w:164,h:180,footX:.4530,footY:.9573,width:35},
  artillery:       {x:354, w:180,h:106,footX:.5047,footY:.9231,width:43},
  headquarters:    {x:538, w:180,h:156,footX:.5063,footY:.9649,width:43},
  headquartersRed: {x:722, w:180,h:156,footX:.5063,footY:.9649,width:43},
} as const;
type Kind=keyof typeof frames;
export type Miniatures=ReadonlyMap<string,{texture:Texture; width:number}>;
let loading:Promise<Miniatures|undefined>|undefined;

export function loadMiniatures() {
  return loading ??= (async()=>{
    const image=new Image();
    image.src=atlasUrl;
    await image.decode();
    const source=Texture.from(image).source;
    const result=new Map<string,{texture:Texture;width:number}>();
    for(const kind of Object.keys(frames) as Kind[]) {
      const f=frames[kind];
      const texture=new Texture({source,frame:new Rectangle(f.x,2,f.w,f.h),defaultAnchor:{x:f.footX,y:f.footY}});
      result.set(kind,{texture,width:f.width});
    }
    return result;
  })().catch(()=>{loading=undefined;return undefined;});
}

export function figure(textures:Miniatures,kind:string,west:boolean) {
  const frame=textures.get(kind==='headquarters' && !west ? 'headquartersRed' : kind);
  if(!frame) return;
  const sprite=new Sprite(frame.texture);
  sprite.scale.set(frame.width/frame.texture.width);
  sprite.eventMode='none';
  return sprite;
}

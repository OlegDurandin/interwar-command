import type { Graphics } from 'pixi.js';
import { hexToPixel, radius, type Hex } from './geometry';

// A coordinate hash chooses engraving variants without advancing the simulation RNG.
export function variation(h:Hex) {
  let bits=Math.imul(h.q+11,0x85ebca6b)^Math.imul(h.r+7,0xc2b2ae35);
  bits=Math.imul(bits^(bits>>>16),0x7feb352d);
  return (bits^(bits>>>15))>>>0;
}
const fieldInk=[0xe5dbac,0xd9d2a4,0xe6dfb7,0xdaddac];
const base:Record<string,number>={urban:0xd5c2a0,forest:0xacbc8f,hills:0xcabe99,water:0x99b9bd,swamp:0xb5bea2};
const trees=[[-12,1],[-7,-6],[0,-9],[8,-5],[14,2],[-3,4],[5,8]] as const;

export function polygon(h: Hex, size = radius) {
  const p = hexToPixel(h);
  return Array.from({length: 6}, (_, i) => {
    const angle = (60 * i - 90) * Math.PI / 180;
    return [p.x + size * Math.cos(angle), p.y + size * Math.sin(angle)];
  }).flat();
}

export function drawTerrain(g:Graphics,h:Hex,terrain:string) {
  const {x,y}=hexToPixel(h), v=variation(h);
  g.poly(polygon(h)).fill(base[terrain] ?? fieldInk[v%4]!).stroke({color:0x817d68,alpha:.43,width:.64});
  if(terrain==='plain') {
    const angle=((v%13)-6)*.13,c=Math.cos(angle),s=Math.sin(angle);
    const spot=(u:number,w:number):[number,number]=>[x+c*u-s*w,y+s*u+c*w];
    const pattern=(v>>>4)%5;
    if(pattern!==0) {
      // Tapered field boundaries and plough lines share endpoints. Some hexes remain meadow.
      const l=-19+(v>>>8)%9, r=pattern===1 ? 4 : 12+(v>>>12)%7;
      const top=-14+(v>>>16)%7, bottom=8+(v>>>20)%7;
      g.poly([...spot(l,top+3),...spot(r,top),...spot(r-3,bottom-3),...spot(l+2,bottom)])
        .fill({color:pattern%2 ? 0xbfad75 : 0xa9ae74,alpha:.43});
      for(let u=l+3;u<r-2;u+=3) {
        const t=(u-l)/(r-l);
        g.moveTo(...spot(u,top+3*(1-t)+1)).lineTo(...spot(u+2-5*t,bottom-3*t-1))
          .stroke({color:0xf3e7b6,width:.7,alpha:.7});
      }
      if(pattern===3) {
        g.poly([...spot(l+2,bottom+1),...spot(r-3,bottom-2),...spot(r-5,bottom+4),...spot(l+5,bottom+6)])
          .fill({color:0xc39851,alpha:.39});
      }
      if((v&3)===1) g.moveTo(...spot(l,top+4)).quadraticCurveTo(...spot(l+1,0),...spot(l+2,bottom))
        .stroke({color:0x939962,width:1.25,alpha:.66});
    }
    for(let i=0;i<3;i++) {
      const dx=(((v>>>(i*5))&15)-8)*1.8,dy=((v>>>(i*3+6))&31)-15;
      g.moveTo(x+dx-1.8,y+dy-1).lineTo(x+dx,y+dy+1).lineTo(x+dx+1,y+dy-2)
        .stroke({color:0x969765,width:.65,alpha:.55});
    }
  } else if(terrain==='forest') {
    for(const [i,[dx,dy]] of trees.entries()) {
      const xx=x+dx+((v>>>(i*3))&3)-1, yy=y+dy+((v>>>(i*2))&3)-1;
      g.ellipse(xx+2,yy+4,5,2).fill({color:0x4e6144,alpha:.27});
      g.rect(xx-.7,yy-1,1.4,6).fill(0x675b42);
      if(((v>>>i)&3)===0){
        g.poly([xx-4.3,yy+2,xx,yy-9,xx+4.2,yy+2]).fill(0x4e674a);
        g.poly([xx-3.7,yy-.8,xx,yy-9,xx+.4,yy-1.2]).fill(0x899d6a);
      } else {
        g.ellipse(xx+.7,yy-2,4.4,5.2).fill(i%2?0x57744d:0x637e50);
        g.circle(xx-1.5,yy-3.5,3.5).fill(i%2?0x7d945e:0x8fa56a);
        g.circle(xx-.5,yy-5,2.7).fill({color:0xaab779,alpha:.83});
      }
    }
  } else if(terrain==='hills') {
    const shift=(v%5)-2;
    for(let i=0;i<4;i++) {
      const yy=y-8+i*4;
      g.moveTo(x-19+i,yy+6).bezierCurveTo(x-8,yy+7,x-8+shift,yy-10,x+6,yy-7)
        .quadraticCurveTo(x+13,yy-4,x+19-i,yy-6).stroke({color:0x948563,alpha:.65,width:.8});
    }
  } else if(terrain==='urban') {
    const houses=[[-11,-5],[0,-9],[9,-2],[-6,6],[4,9]] as const;
    for(const [dx,dy] of houses) {
      g.rect(x+dx-3,y+dy-1,7,5).fill(0x9b866c);
      g.poly([x+dx-4,y+dy,x+dx-1,y+dy-4,x+dx+4,y+dy-3,x+dx+3,y+dy]).fill(0xac7958);
    }
  } else if(terrain==='swamp' || terrain==='water') {
    for(let i=0;i<3;i++) g.moveTo(x-12+i*3,y-7+i*6).quadraticCurveTo(x-5,y-9+i*6,x+10-i,y-7+i*6).stroke({color:0x638c8b,width:.7,alpha:.65});
  }
}

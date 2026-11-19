import type { Graphics } from 'pixi.js';
import type { MovementView } from '../../../../crates/game-wasm/pkg/game_wasm.js';
import { hexToPixel, radius, type Point } from './geometry';

type Edge = MovementView['edges'][number];
type Reach = { start: Point; end: Point; middle: Point; normal: Point };
const cornerKey = (p: Point) => Math.round(p.x * 100) + ',' + Math.round(p.y * 100);

function drawRivers(g: Graphics, edges: Edge[]) {
  const reaches: Reach[] = [];
  const joins = new Map<string, Point[]>();
  for (const edge of edges) {
    if (!edge.river) continue;
    const a = hexToPixel(edge.a), b = hexToPixel(edge.b);
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const normal = {x: (b.x - a.x) / length, y: (b.y - a.y) / length};
    const middle = {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2};
    const dx = -normal.y * radius / 2, dy = normal.x * radius / 2;
    const start = {x: middle.x - dx, y: middle.y - dy};
    const end = {x: middle.x + dx, y: middle.y + dy};
    reaches.push({start, end, middle, normal});
    for (const [corner, next] of [[start, end], [end, start]] as const) {
      const key = cornerKey(corner);
      const neighbours = joins.get(key) ?? [];
      neighbours.push(next);
      joins.set(key, neighbours);
    }
  }

  // A shared tangent smooths connected banks. Every reach passes under its own crossing.
  function handle(corner: Point, next: Point) {
    const neighbours = joins.get(cornerKey(corner));
    const from = neighbours?.length === 2 ? neighbours.find(p => p !== next) ?? corner : corner;
    const dx = next.x - from.x, dy = next.y - from.y;
    const step = radius * .23 / (Math.hypot(dx, dy) || 1);
    return {x: corner.x + dx * step, y: corner.y + dy * step};
  }
  const curves = reaches.map(({start, end, middle, normal}) => {
    const h1 = handle(start, end), h2 = handle(end, start);
    const dx = (end.x - start.x) * .17 + normal.x * 1.8;
    const dy = (end.y - start.y) * .17 + normal.y * 1.8;
    return {start, end, middle, h1, h2, dx, dy, normal};
  });
  for (const [width, color] of [[9.2,0x80875e],[8.4,0xb4ae90],[6.9,0x506d72],[5.5,0x759c9e]] as const) {
    for (const {start, end, middle, h1, h2, dx, dy} of curves) {
      g.moveTo(start.x,start.y)
        .bezierCurveTo(h1.x,h1.y,middle.x-dx,middle.y-dy,middle.x,middle.y)
        .bezierCurveTo(middle.x+dx,middle.y+dy,h2.x,h2.y,end.x,end.y);
    }
    if (curves.length) g.stroke({width,color,cap:'round',join:'round'});
  }
  for (const {middle:m, dx, dy, normal:n} of curves) {
    g.moveTo(m.x-dx+n.x,m.y-dy+n.y).quadraticCurveTo(m.x+n.x,m.y+n.y,m.x+dx*.6,m.y+dy*.6)
      .stroke({width:.4,color:0xc4d6c8,alpha:.85,cap:'round'});
    // Broken highlights and small stones follow each bank in local stream coordinates.
    for (const [along,across,length] of [[-1.8,-.8,.55],[-.5,-1.5,.38],[1.1,.65,.5]] as const) {
      const x=m.x+dx*along+n.x*across, y=m.y+dy*along+n.y*across;
      g.moveTo(x,y).quadraticCurveTo(x+dx*.3+n.x*.3,y+dy*.3+n.y*.3,x+dx*length,y+dy*length)
        .stroke({width:.3,color:0xd3dfd0,alpha:.73,cap:'round'});
    }
    for (const side of [-1,1]) {
      const x=m.x+side*(n.x*3.8+dx*1.2), y=m.y+side*(n.y*3.8+dy*1.2);
      g.ellipse(x,y,1.2,.8).fill(0x8b8b75);
      g.ellipse(x-.2,y-.3,.75,.43).fill(0xcdc5a2);
      g.ellipse(x+dx*.42,y+dy*.42,.78,.55).fill(0xb5ae92);
      const grassX=x+n.x*side*1.2, grassY=y+n.y*side*1.2;
      g.moveTo(grassX-.45,grassY).lineTo(grassX-.9,grassY-1.5).moveTo(grassX,grassY).lineTo(grassX+.38,grassY-1.9)
        .stroke({width:.34,color:0x686e47});
    }
  }
}

export function drawInfrastructure(g:Graphics,edges:MovementView['edges'],roads:boolean) {
  drawRivers(g,edges);
  for(const edge of edges) {
    if(!edge.bridge && !(roads && (edge.road || edge.rail))) continue;
    const a=hexToPixel(edge.a),b=hexToPixel(edge.b),len=Math.hypot(b.x-a.x,b.y-a.y);
    const ux=(b.x-a.x)/len,uy=(b.y-a.y)/len;
    const pt=(along:number,across=0):[number,number]=>[(a.x+b.x)/2+ux*along-uy*across,(a.y+b.y)/2+uy*along+ux*across];
    const track=(l:number,r:number,offset:number,width:number,color:number)=>{
      g.moveTo(...pt(l,offset)).lineTo(...pt(r,offset)).stroke({color,width,cap:'round'});
    };
    const spans=edge.river ? [[-len/2,edge.bridge?-6:-5.2],[edge.bridge?6:5.2,len/2]] as const : [[-len/2,len/2]] as const;
    for(const [l,r] of spans) {
      if(roads && edge.road) {
        const bend=(edge.a.q+edge.a.r)%2===0 ? 2.6 : -2.6;
        for (const [offset,width,color] of [[0,4.9,0xab9269],[0,3.7,0xe7ca94],[-.85,.55,0xc4a578],[.85,.5,0xf4deb2]] as const) {
          g.moveTo(...pt(l,offset)).bezierCurveTo(...pt(l+(r-l)*.28,offset+bend),...pt(l+(r-l)*.70,offset+bend*.45),...pt(r,offset))
            .stroke({width,color,cap:'butt'});
        }
      }
      if(roads && edge.rail) {
        track(l,r,0,4.25,0xb2a18a);
        for(let t=l+1.5;t<r;t+=3.3) g.moveTo(...pt(t,-2.4)).lineTo(...pt(t,2.4)).stroke({color:0x574c40,width:.94});
        track(l,r,-1.25,.8,0x4b4d49);track(l,r,1.25,.8,0x4b4d49);
      }
    }
    if(edge.bridge) {
      const deck=(half:number,across:number,offset:number)=>[...pt(-half,-across+offset),...pt(half,-across+offset),...pt(half,across+offset),...pt(-half,across+offset)];
      g.poly(deck(7.6,4.3,1.1)).fill({color:0x454335,alpha:.4});
      g.poly(deck(7.6,4,0)).fill(0xaaa184).stroke({color:0x6d6855,width:.7});
      g.poly(deck(6.7,3.65,0)).fill(0xe1bb86);
      for(let t=-6;t<=6;t+=1.6) {
        g.moveTo(...pt(t,-3)).lineTo(...pt(t,3)).stroke({color:0x937345,width:.53});
        g.moveTo(...pt(t+.4,-2.8)).lineTo(...pt(t+.4,2.8)).stroke({color:0xf2d29d,width:.35});
      }
      track(-7,7,-3.6,1.65,0x574c3e);track(-7,7,3.6,1.65,0x574c3e);
      track(-7,7,-4.15,.50,0xe1c595);track(-7,7,3.02,.48,0xcaaa7b);
      for(const t of [-6.5,0,6.5]) for(const offset of [-3.6,3.6])
        g.circle(...pt(t,offset),.9).fill(0x665945).stroke({color:0xdfc69c,width:.33});
    }
  }
}

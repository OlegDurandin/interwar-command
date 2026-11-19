import { Container, Graphics, Text } from 'pixi.js';
import type { MovementView, RouteView, Supply } from '../../../../crates/game-wasm/pkg/game_wasm.js';
import { drawTerrain, polygon } from './terrain';
import { Landscape, type TerrainArtwork } from './landscape';
import { drawInfrastructure } from './infrastructure';
import { figure, type Miniatures } from './miniatures';
import { hexToPixel, radius } from './geometry';
import type { Hex } from './geometry';

export const sameHex = (a: Hex, b: Hex) => a.q === b.q && a.r === b.r;
export const unitNames: Record<string, string> = {
  infantry: 'Пехота', cavalry: 'Кавалерия', artillery: 'Артиллерия', headquarters: 'Штаб',
};
export const terrainNames: Record<string, string> = {
  plain: 'Равнина', urban: 'Город', forest: 'Лес', hills: 'Холмы', water: 'Вода', swamp: 'Болото',
};
export const supplyNames: Record<Supply,string> = {full:'Полное', low:'Ограниченное', none:'Нет'};
const supplyInk: Record<Supply,number> = {full:0x487755, low:0xc68e26, none:0x955650};
const blue = 0x315d72;
const red = 0x965644;

function label(layer: Container, value: string, x: number, y: number, size: number, color: number, halo = false) {
  const text = new Text({text: value, resolution: 2, style: {fontFamily: 'Georgia, serif', fontSize: size, fill: color, stroke: halo ? {color:0xf8edcd,width:1.5,join:'round'} : undefined}});
  text.anchor.set(0.5);
  text.position.set(x, y);
  layer.addChild(text);
}

export interface MapFocus { at?: Hex; routes: RouteView[]; path?: RouteView; forecast: boolean; targets: string[]; attacker?: string; roads?:boolean; objectives?:boolean; zoc?:boolean }
type Cell = MovementView['cells'][number];
type Counter = MovementView['units'][number];
export interface MapDrawing {
  cells: (Pick<Cell,'position'|'terrain'|'controller'|'source'|'city'|'objective_points'> & Partial<Pick<Cell,'forecast'|'enemy_zoc'>>)[];
  units: (Pick<Counter,'id'|'kind'|'faction'|'strength'|'position'> & Partial<Pick<Counter,'supply'|'moved'>>)[];
  edges: MovementView['edges'];
  sides: {id:string}[];
}
function drawBoard(layer: Container, state: MapDrawing, focus: MapFocus, west:string|undefined, illustrated:boolean) {
  for (const child of layer.removeChildren()) child.destroy({children: true});
  const sheet = layer.addChild(new Graphics());

  for (const cell of state.cells) {
    const {x,y} = hexToPixel(cell.position);
    const sideInk = cell.controller === west ? blue : red;
    if (!illustrated || cell.terrain === 'water') drawTerrain(sheet,cell.position,cell.terrain);
    else sheet.poly(polygon(cell.position)).stroke({color:0x4d5233,alpha:.56,width:.55});
    if (illustrated && cell.terrain === 'hills') {
      for (const offset of [0,3]) sheet.moveTo(x-17,y+7+offset).bezierCurveTo(x-6,y+8+offset,x-2,y-4+offset,x+11,y-6+offset)
        .stroke({color:0x786c44,width:.45,alpha:.55});
    }
    if (cell.controller) sheet.poly(polygon(cell.position,radius-.5)).fill({color:sideInk,alpha:.055});
    if (focus.forecast && cell.forecast && cell.terrain !== 'water') sheet.poly(polygon(cell.position,radius-1)).fill({color:supplyInk[cell.forecast],alpha:0.5});
    if (focus.zoc && cell.enemy_zoc) {
      sheet.poly(polygon(cell.position,radius-3)).stroke({color:0x955f50,width:1.6});
      for(const dy of [-6,0,6]) sheet.moveTo(x-13,y+dy+5).lineTo(x+11,y+dy-5).stroke({color:0x995c4b,width:.9});
    }
  }
  for (const route of focus.routes) {
    const dest=route.path.at(-1);
    if (dest) sheet.poly(polygon(dest,radius-1.4)).fill({color:0xffdf88,alpha:.14}).stroke({color:0xe8c26b,width:.85,alpha:.86});
  }
  drawInfrastructure(sheet,state.edges,focus.roads!==false);
  const marks=layer.addChild(new Graphics());
  if (focus.at) {
    marks.poly(polygon(focus.at,radius-1)).stroke({color:0x78512a,width:2.7});
    marks.poly(polygon(focus.at,radius-1.5)).stroke({color:0xffda72,width:1.55});
  }
  if (focus.path) {
    for (const [i,hex] of focus.path.path.entries()) {
      const p=hexToPixel(hex);
      if (i===0) marks.moveTo(p.x,p.y); else marks.lineTo(p.x,p.y);
    }
    marks.stroke({color:0x825624,width:3,cap:'round'});
    for (const hex of focus.path.path) {
      const p=hexToPixel(hex); marks.circle(p.x,p.y,3).fill(0xf5dc81).stroke({width:1,color:0x825624});
    }
  }
  for (const cell of state.cells) {
    const {x,y}=hexToPixel(cell.position);
    if (focus.objectives!==false && cell.objective_points) label(layer,'★',x,y-15,14,0x81571d,true);
    if (cell.source) label(layer,'▣',x-18,y+16,9,0x324332,true);
    if (cell.city) {
      const names: Record<string,string>={west_depot:'Зап. склад',east_depot:'Вост. склад',bridgehead:'Предмостье'};
      label(layer,names[cell.city] ?? cell.city,x+(cell.source?3:0),y+21.6,6.7,0x283524,true);
    }
    if (cell.position.r === 0) label(layer,String(cell.position.q),x,y-radius-11,10,0x777b68);
    if (cell.position.q === 0) label(layer,String(cell.position.r),x-radius-9,y,10,0x777b68);
  }
}

function drawCounters(layer:Container,state:MapDrawing,focus:MapFocus,west:string|undefined,textures?:Miniatures) {
  for(const child of layer.removeChildren()) child.destroy({children:true});
  for (const u of state.units) {
    const {x,y}=hexToPixel(u.position);
    const g=layer.addChild(new Graphics());
    g.position.set(x,y);
    if (focus.targets.includes(u.id)) g.ellipse(0,0,23,17).stroke({color:0x8b352b,width:2.5});
    if (focus.attacker===u.id) g.ellipse(0,0,23,17).stroke({color:blue,width:2.5});
    const friendly=u.faction===west;
    const sprite=textures && figure(textures,u.kind,friendly);
    if(sprite) {
      g.ellipse(0,8.3,16,4).fill({color:0x393727,alpha:.19});
      sprite.position.set(x-1,y+9);
      layer.addChild(sprite);
      const marker=layer.addChild(new Graphics());
      marker.position.set(x,y+13);
      marker.poly([-10,-5,12,-5,10,5,-12,5]).fill(friendly?0x2c567c:0x893b32).stroke({color:0xf3e3ba,width:.75});
      if (friendly) marker.poly([-8,0,-5,-3.2,-2,0,-5,3.2]).fill(0xfff4dc);
      else marker.poly([-8,2.5,-4.8,-3.3,-1.5,2.5]).fill(0xfff4dc);
      const strength=new Text({text:String(u.strength),resolution:2,style:{fontFamily:'Arial, sans-serif',fontWeight:'bold',fontSize:10.4,fill:0xfffaea}});
      strength.anchor.set(.5);strength.position.set(marker.x+4,marker.y);layer.addChild(strength);
      if(u.supply) {
        marker.rect(-9,5.2,9,1.7).fill(supplyInk[u.supply]).stroke({color:0xf9efd5,width:.7});
        if(u.supply==='none') marker.moveTo(-9,7).lineTo(0,5.1).stroke({color:0xfff2be,width:.8});
        if(u.supply==='low') marker.moveTo(-5,5).lineTo(-5,7).stroke({color:0xfff2be,width:.8});
      }
      if(u.moved) marker.circle(8,-6,1.9).fill(0xf2d27f).stroke({color:0x665338,width:.7});
      continue;
    }
    g.roundRect(-17,-11,35,25,2).fill({color:0x423e31,alpha:0.25});
    g.roundRect(-18,-13,35,24,2).fill(u.faction===west?blue:red).stroke({color:0x373c33,width:1});
    const color=0xfff7dc;
    g.rect(-13,-8,17,12).stroke({color,width:1});
    if (u.kind==='infantry' || u.kind==='cavalry') g.moveTo(-13,4).lineTo(4,-8).stroke({color,width:1.4});
    if (u.kind==='infantry') g.moveTo(-13,-8).lineTo(4,4).stroke({color,width:1.4});
    if (u.kind==='artillery') g.circle(-4,-2,3).fill(color);
    if (u.kind==='headquarters') label(layer,'Ш',x-5,y-2,11,color);
    label(layer,String(u.strength),x+10,y-1,9,color);
    if (u.supply) g.rect(-13,6,13,3).fill(supplyInk[u.supply]).stroke({color:0xf6efd9,width:0.7});
    if (u.supply==='none') g.moveTo(-13,9).lineTo(0,6).stroke({color:0xfff2be,width:1});
    if (u.supply==='low') g.moveTo(-7,6).lineTo(-7,9).stroke({color:0xfff2be,width:1});
    if (u.moved) g.circle(12,7,1.8).fill(0xf1d488);
  }
}

// Panning only transforms the world. Crossing the detail threshold replaces the counters alone.
export class OperationLayer extends Container {
  private readonly landscape=this.addChild(new Landscape());
  private terrainArtwork?:TerrainArtwork;
  private readonly board=this.addChild(new Container());
  private readonly counters=this.addChild(new Container());
  private state?:MapDrawing;
  private focus?:MapFocus;
  private west?:string;
  private textures?:Miniatures;

  setTerrainArtwork(artwork:TerrainArtwork) {
    this.terrainArtwork=artwork;
    if (this.state && this.focus) {
      this.landscape.draw(this.state.cells,artwork);
      drawBoard(this.board,this.state,this.focus,this.west,true);
    }
  }

  draw(state:MapDrawing,focus:MapFocus) {
    this.state=state;this.focus=focus;
    this.west=state.sides.find(s=>s.id==='blue')?.id ?? state.sides[0]?.id;
    if (this.terrainArtwork) this.landscape.draw(state.cells,this.terrainArtwork);
    drawBoard(this.board,state,focus,this.west,!!this.terrainArtwork);
    drawCounters(this.counters,state,focus,this.west,this.textures);
  }

  updateScale(scale:number,atlas?:Miniatures) {
    const textures=Math.sqrt(3)*radius*scale>=37 ? atlas : undefined;
    if(textures!==this.textures) {
      this.textures=textures;
      if(this.state && this.focus) drawCounters(this.counters,this.state,this.focus,this.west,textures);
    }
    return textures ? 'miniatures' : 'compact';
  }
}

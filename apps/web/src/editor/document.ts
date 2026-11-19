import { hex_neighbors, validate_scenario } from '../../../../crates/game-wasm/pkg/game_wasm.js';
import type { Hex } from '../renderer/geometry';
import { sameHex, type MapDrawing } from '../renderer/operation';

export interface Tile extends Hex { terrain?:string; controller?:string|null; city_id?:string|null; supply_source?:boolean }
export type Feature = 'road'|'rail'|'river'|'bridge';
export type Pair = [number,number];
export type Edge = {a:Pair;b:Pair} & Partial<Record<Feature,boolean>>;
export interface Unit extends Hex {
  id:string; faction_id:string; unit_type:string; strength:number; readiness:number; entrenchment:number;
  name?:string|null; historical_id?:string|null; experience?:number|null;
}
export interface Context {map_date:string; hex_scale:string; formation_scale:string; assumptions:string; review_version:string}
export interface Document {
  schema_version:number; rules_version:string; id:string; title:string; historicity:string; turn_days:number;
  description?:string|null; period?:string|null; languages?:string[]; sources?:string[]; historical_context?:Context|null;
  map:{width:number;height:number;default_terrain:string;default_controller:string|null;tiles:Tile[];edges:Edge[]};
  factions:{id:string;name:string}[]; units:Unit[];
  objectives:(Hex & {id:string;type:'control';points_per_round:number})[];
  victory:{max_rounds:number;target_score?:number}; starting_faction_id:string; random_seed:string;
}

export function importDocument(raw:string):Document {
  validate_scenario(raw);
  const doc:Document=JSON.parse(raw);
  doc.map.tiles ??= [];
  doc.map.edges ??= [];
  return doc;
}
export function blank(width:number,height:number):Document {
  return {schema_version:1,rules_version:'0.1',id:'new_map',title:'Новая карта',historicity:'fictional',turn_days:1,
    factions:[{id:'blue',name:'Синие'},{id:'red',name:'Красные'}],starting_faction_id:'blue',random_seed:'42',
    map:{width,height,default_terrain:'plain',default_controller:null,tiles:[],edges:[]},
    units:[],objectives:[],victory:{max_rounds:8}};
}
export const point = ([q,r]:Pair):Hex=>({q,r});
const key = (h:Hex)=>h.q+','+h.r;
export function neighbors(doc:Document,h:Hex) {
  const pairs=hex_neighbors(h.q,h.r);
  const valid:Hex[]=[];
  for(let i=0;i<pairs.length;i+=2) {
    const q=pairs[i]!, r=pairs[i+1]!;
    if(q>=0 && r>=0 && q<doc.map.width && r<doc.map.height) valid.push({q,r});
  }
  return valid;
}
export function tileAt(doc:Document,h:Hex) {
  return {terrain:doc.map.default_terrain,controller:doc.map.default_controller,...doc.map.tiles.find(t=>sameHex(t,h)),...h};
}
export function setTile(doc:Document,h:Hex,props:Partial<Tile>):Document {
  const found=doc.map.tiles.find(t=>sameHex(t,h));
  const updated={...found,...h,...props};
  const tiles=found ? doc.map.tiles.map(t=>t===found ? updated : t) : [...doc.map.tiles,updated];
  return {...doc,map:{...doc.map,tiles}};
}
export function paint(doc:Document,start:Hex,terrain:string,fill:boolean):Document {
  if(!fill) return setTile(doc,start,{terrain});
  const tiles=new Map(doc.map.tiles.map(tile=>[key(tile),tile]));
  const original=tiles.get(key(start))?.terrain ?? doc.map.default_terrain;
  if(original===terrain) return doc;
  const queue=[start];
  for(let i=0;i<queue.length;i++) {
    const h=queue[i]!, k=key(h), tile=tiles.get(k);
    if((tile?.terrain ?? doc.map.default_terrain)!==original) continue;
    tiles.set(k,{...tile,...h,terrain});
    queue.push(...neighbors(doc,h));
  }
  return {...doc,map:{...doc.map,tiles:[...tiles.values()]}};
}
export function edgeAt(doc:Document,a:Hex,b:Hex) {
  return doc.map.edges.find(e=>(sameHex(a,point(e.a)) && sameHex(b,point(e.b))) || (sameHex(b,point(e.a)) && sameHex(a,point(e.b))));
}
export function setEdge(doc:Document,a:Hex,b:Hex,flags:Record<Feature,boolean>):Document {
  const old=edgeAt(doc,a,b);
  const edges=doc.map.edges.filter(e=>e!==old);
  if(Object.values(flags).some(Boolean)) edges.push({a:[a.q,a.r],b:[b.q,b.r],...flags});
  return {...doc,map:{...doc.map,edges}};
}

// A draft may still lack sources or objectives. Draw its authored geometry directly;
// game-state creation and legality checks use the Rust loader.
export function drawing(doc:Document):MapDrawing {
  const {map}=doc;
  const tiles=new Map(map.tiles.map(t=>[key(t),t]));
  const goals=new Map(doc.objectives.map(o=>[key(o),o.points_per_round]));
  const cells:MapDrawing['cells']=[];
  for(let r=0;r<map.height;r++) for(let q=0;q<map.width;q++) {
    const position={q,r}, k=key(position), tile=tiles.get(k);
    cells.push({position,terrain:tile?.terrain ?? map.default_terrain,
      controller:(tile?.controller===undefined ? map.default_controller : tile.controller) ?? undefined,
      source:tile?.supply_source ?? false,city:tile?.city_id ?? undefined,objective_points:goals.get(k) ?? 0});
  }
  return {sides:doc.factions,cells,edges:map.edges.map(e=>({a:point(e.a),b:point(e.b),
    road:!!e.road,rail:!!e.rail,river:!!e.river,bridge:!!e.bridge})),
    units:doc.units.map(u=>({position:{q:u.q,r:u.r},kind:u.unit_type,id:u.id,faction:u.faction_id,strength:u.strength}))};
}


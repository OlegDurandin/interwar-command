import type { FormEvent, ReactNode } from 'react';
import type { Hex } from '../renderer/geometry';
import { sameHex, terrainNames, unitNames } from '../renderer/operation';
import { edgeAt, setEdge, setTile, tileAt, type Document, type Feature } from './document';

type Props={doc:Document;at:Hex;commit:(next:Document)=>void};
export const coord=(p:Hex)=>'('+p.q+', '+p.r+')';
export function Field({label,children}:{label:string;children:ReactNode}) {return <label>{label}{children}</label>;}
function Input({name,label,value='',type='text',required=false}:{name:string;label:string;value?:string|number|null;type?:string;required?:boolean}) {
  return <Field label={label}><input name={name} type={type} defaultValue={value ?? ''} required={required}/></Field>;
}
export function options(names:Record<string,string>) {return Object.entries(names).map(([id,name])=><option key={id} value={id}>{name}</option>);}
const str=(data:FormData,name:string)=>String(data.get(name) ?? '').trim();
const num=(data:FormData,name:string)=>Number(str(data,name));
const lines=(data:FormData,name:string)=>str(data,name).split('\n').map(s=>s.trim()).filter(Boolean);
function submit(e:FormEvent<HTMLFormElement>) {e.preventDefault();return new FormData(e.currentTarget);}

export function CellForm({doc,at,commit}:Props) {
  const t=tileAt(doc,at);
  return <form onSubmit={e=>{const d=submit(e);
    commit(setTile(doc,at,{terrain:str(d,'terrain'),controller:str(d,'controller') || null,city_id:str(d,'city') || null,supply_source:d.has('source')}));
  }}>
    <Field label="Местность"><select name="terrain" defaultValue={t.terrain}>{options(terrainNames)}</select></Field>
    <Field label="Контроль"><select name="controller" defaultValue={t.controller ?? ''}><option value="">Нейтральная</option>
      {doc.factions.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></Field>
    <Input name="city" label="Город · ID" value={t.city_id}/>
    <label><input name="source" type="checkbox" defaultChecked={t.supply_source}/> Источник снабжения</label>
    <button>Применить к клетке</button>
  </form>;
}

const features:Record<Feature,string>={road:'Дорога',rail:'Железная дорога',river:'Река',bridge:'Мост'};
export function EdgeForm({doc,at,end,commit}:Props & {end:Hex}) {
  const edge=edgeAt(doc,at,end);
  return <form onSubmit={e=>{const d=submit(e);
    commit(setEdge(doc,at,end,{road:d.has('road'),rail:d.has('rail'),river:d.has('river'),bridge:d.has('bridge')}));
  }}>
    <p>{coord(at)} — {coord(end)}</p>
    {(Object.keys(features) as Feature[]).map(k=><label key={k}><input name={k} type="checkbox" defaultChecked={edge?.[k]}/>{features[k]}</label>)}
    <button>Применить к ребру</button>
  </form>;
}

export function UnitForm({doc,at,id,commit,choose}:{id:string;choose:(id:string)=>void} & Props) {
  const unit=doc.units.find(u=>u.id===id);
  return <><Field label="Редактируемая часть"><select value={unit?.id ?? ''} onChange={e=>choose(e.target.value)}>
    <option value="">Новая часть</option>{doc.units.map(u=><option key={u.id} value={u.id}>{u.id} · {coord(u)}</option>)}
  </select></Field><form onSubmit={e=>{const d=submit(e),nextId=str(d,'id');
    const input=e.currentTarget.elements.namedItem('id') as HTMLInputElement;
    if(doc.units.some(u=>u!==unit && u.id===nextId)){input.setCustomValidity('Такой ID уже занят');input.reportValidity();return;}
    const next={...unit,...at,id:nextId,faction_id:str(d,'faction'),unit_type:str(d,'kind'),strength:num(d,'strength'),readiness:num(d,'readiness'),entrenchment:num(d,'entrenchment')};
    commit({...doc,units:unit ? doc.units.map(u=>u===unit ? next : u) : [...doc.units,next]});choose(nextId);
  }} onInput={e=>{const input=e.currentTarget.elements.namedItem('id') as HTMLInputElement;input.setCustomValidity('');}}>
    <Input name="id" label="ID части" value={unit?.id} required/>
    <Field label="Сторона части"><select name="faction" defaultValue={unit?.faction_id ?? doc.starting_faction_id}>{doc.factions.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></Field>
    <Field label="Род части"><select name="kind" defaultValue={unit?.unit_type ?? 'infantry'}>{options(unitNames)}</select></Field>
    <Input name="strength" label="Прочность" type="number" value={unit?.strength ?? 10} required/>
    <Input name="readiness" label="Готовность" type="number" value={unit?.readiness ?? 100} required/>
    <Input name="entrenchment" label="Окопы" type="number" value={unit?.entrenchment ?? 0} required/>
    <button>Разместить в {coord(at)}</button>
    {unit && <button type="button" onClick={()=>{commit({...doc,units:doc.units.filter(u=>u!==unit)});choose('');}}>Удалить часть</button>}
  </form></>;
}
export function GoalForm({doc,at,commit}:Props) {
  const existing=doc.objectives.find(o=>sameHex(o,at));
  const others=doc.objectives.filter(o=>o!==existing);
  return <form onSubmit={e=>{const d=submit(e);
    commit({...doc,objectives:[...others,{...at,id:str(d,'id'),type:'control',points_per_round:num(d,'points')}]});
  }}>
    <Input name="id" label="ID цели" value={existing?.id ?? 'objective_'+at.q+'_'+at.r} required/>
    <Input name="points" label="Очки за раунд" type="number" value={existing?.points_per_round ?? 1} required/>
    <button>Сохранить цель</button>{existing && <button type="button" onClick={()=>commit({...doc,objectives:others})}>Удалить цель</button>}
  </form>;
}
export function ScenarioForm({doc,commit}:{doc:Document;commit:Props['commit']}) {
  const ctx=doc.historical_context;
  return <form onSubmit={e=>{const d=submit(e);
    const factions=doc.factions.map((_,i)=>({id:str(d,'faction'+i),name:str(d,'name'+i)}));
    if(new Set(factions.map(f=>f.id)).size!==factions.length) {
      const input=e.currentTarget.elements.namedItem('faction1') as HTMLInputElement;
      input.setCustomValidity('Сторонам нужны разные ID');input.reportValidity();return;
    }
    const ids=new Map(doc.factions.map((f,i)=>[f.id,factions[i]!.id]));
    const rename=(id:string)=>ids.get(id) ?? id;
    const changed=doc.factions.some(f=>rename(f.id)!==f.id);
    const references=changed ? {
      map:{...doc.map,default_controller:doc.map.default_controller===null ? null : rename(doc.map.default_controller),
        tiles:doc.map.tiles.map(t=>typeof t.controller==='string' ? {...t,controller:rename(t.controller)} : t)},
      units:doc.units.map(u=>({...u,faction_id:rename(u.faction_id)})),
    } : {};
    const context={map_date:str(d,'date'),hex_scale:str(d,'scale'),formation_scale:str(d,'formation'),assumptions:str(d,'assumptions'),review_version:str(d,'review')};
    commit({...doc,id:str(d,'id'),title:str(d,'title'),description:str(d,'description'),period:str(d,'period'),
      historicity:str(d,'historicity'),sources:lines(d,'sources'),languages:lines(d,'languages'),turn_days:num(d,'days'),
      random_seed:str(d,'seed'),starting_faction_id:rename(str(d,'start')),factions,...references,
      historical_context:Object.values(context).some(Boolean) ? context : undefined,
      victory:{max_rounds:num(d,'rounds'),...(str(d,'score') ? {target_score:num(d,'score')} : {})}});
  }} onInput={e=>(e.currentTarget.elements.namedItem('faction1') as HTMLInputElement).setCustomValidity('')}>
    <Input label="Название" name="title" value={doc.title} required/><Input label="ID сценария" name="id" value={doc.id} required/>
    <Field label="Описание"><textarea name="description" defaultValue={doc.description ?? ''}/></Field>
    <Input label="Период" name="period" value={doc.period}/>
    <Field label="Историчность"><select name="historicity" defaultValue={doc.historicity}>{options({fictional:'Вымышленный',inspired:'По мотивам',historical:'Исторический'})}</select></Field>
    {doc.factions.map((f,i)=><fieldset key={f.id}><legend>Сторона {i+1}</legend>
      <Input label={'ID стороны '+(i+1)} name={'faction'+i} value={f.id} required/>
      <Input label={'Название стороны '+f.id} name={'name'+i} value={f.name} required/></fieldset>)}
    <Field label="Стартовая сторона"><select name="start" defaultValue={doc.starting_faction_id}>{doc.factions.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></Field>
    <Input label="Дней в ходе" name="days" type="number" value={doc.turn_days} required/>
    <Input label="Лимит раундов" name="rounds" type="number" value={doc.victory.max_rounds} required/>
    <Input label="Целевой счёт" name="score" type="number" value={doc.victory.target_score}/>
    <Input label="Seed" name="seed" value={doc.random_seed} required/>
    <details><summary>Масштаб и источники</summary>
      <Input label="Дата карты" name="date" type="date" value={ctx?.map_date}/>
      <Input label="Масштаб гекса" name="scale" value={ctx?.hex_scale}/>
      <Input label="Уровень соединений" name="formation" value={ctx?.formation_scale}/>
      <Input label="Игровые допущения" name="assumptions" value={ctx?.assumptions}/>
      <Input label="Версия проверки" name="review" value={ctx?.review_version}/>
      <Field label="Источники · по одному на строку"><textarea name="sources" defaultValue={doc.sources?.join('\n')}/></Field>
      <Field label="Языки · по одному на строку"><textarea name="languages" defaultValue={doc.languages?.join('\n')}/></Field>
    </details><button>Применить настройки</button>
  </form>;
}

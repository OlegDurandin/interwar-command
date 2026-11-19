import { useEffect, useRef, useState } from 'react';
import { useBackButton } from '../platform/useBackButton';
import { MovementSession } from '../../../../crates/game-wasm/pkg/game_wasm.js';
import { catalog, training } from './catalog';
import { initializeCore } from './App';
import { mountMap } from '../renderer/map';
import { OperationLayer } from '../renderer/operation';
import { readSlot } from './storage';

export type Commander='blue'|'red'|'both';
export interface Position { game:string; commander:Commander }
export function unpack(raw:string):Position {
  const data=JSON.parse(raw) as Partial<Position> & {save_schema_version?:number};
  if(data.save_schema_version===1) return {game:raw,commander:'both'};
  if(typeof data.game!=='string' || !['blue','red','both'].includes(data.commander ?? '')) throw new Error('Неизвестный формат позиции');
  return {game:data.game,commander:data.commander as Commander};
}

function ScenarioMap({scenario}:{scenario:string}) {
  const host=useRef<HTMLDivElement>(null);
  const [error,setError]=useState('');
  useEffect(()=>{
    const target=host.current;
    if(!target) return;
    const stop=new AbortController();
    const layer=new OperationLayer();
    async function draw(target:HTMLDivElement) {
      try {
        await initializeCore();
        if(stop.signal.aborted) return;
        const game=new MovementSession(scenario);
        try {
          const view=game.snapshot();
          layer.draw(view,{routes:[],targets:[],forecast:false});
          await mountMap(target,stop.signal,()=>{},{width:view.width,height:view.height,layer});
        } finally {game.free();}
      } catch(cause) {if(!stop.signal.aborted) setError(String(cause));}
    }
    void draw(target);
    return ()=>{stop.abort();if(!layer.destroyed) layer.destroy({children:true});};
  },[scenario]);
  return <div className="menu-art"><div className="menu-map" ref={host}/>{error && <p role="alert">{error}</p>}</div>;
}

export function CampaignMenu({open,confirmOrders,onConfirm}:{open:(game:string|null,side:Commander,source?:string)=>void;confirmOrders:boolean;onConfirm:(value:boolean)=>void}) {
  const [screen,setScreen]=useState<'menu'|'scenario'|'settings'>('menu');
  useBackButton(screen === 'menu' ? null : () => setScreen('menu'));
  const [saves,setSaves]=useState<{auto?:string;manual?:string}>({});
  const [commander,setCommander]=useState<Commander>('blue');
  const [id,setId]=useState(training.briefing.id);
  const {source,briefing}=catalog.find(s=>s.briefing.id===id) ?? training;
  const context=briefing.historical_context;
  const trainingMap=id===training.briefing.id;
  const [error,setError]=useState('');
  const [ready,setReady]=useState(false);
  useEffect(()=>{
    let live=true;
    void Promise.all([readSlot('auto'),readSlot('manual')]).then(([auto,manual])=>{
      if(live){setSaves({auto,manual});setReady(true);}
    }).catch((e:unknown)=>{if(live){setError('Хранилище недоступно. '+String(e));setReady(true);}});
    return ()=>{live=false;};
  },[]);
  function resume(raw:string) {
    try {const p=unpack(raw);open(p.game,p.commander);}
    catch(e){setError('Ошибка загрузки. '+String(e));}
  }
  return <main className="command-room campaign-menu">
    <header><span className="seal" aria-hidden="true">✥</span><h1>Interwar Command</h1></header>
    <div className="menu-sheet"><ScenarioMap scenario={source}/>
      <section><p className="menu-eyebrow">{trainingMap ? 'Учебная операция' : 'По мотивам · '+briefing.period}</p><h2>{briefing.title}</h2>
      {screen==='menu' && <><p>{trainingMap ? 'Две стороны, один мост. Каждый раунд удержание предмостья приносит очки.' : briefing.description}</p>
        <nav aria-label="Главное меню">
          {saves.auto && <button className="primary" onClick={()=>resume(saves.auto!)}>Продолжить партию</button>}
          <button disabled={!ready} onClick={()=>setScreen('scenario')}>Начать</button>
          <button disabled={!saves.manual} onClick={()=>saves.manual && resume(saves.manual)}>Загрузить позицию</button>
          <button onClick={()=>setScreen('scenario')}>Сценарии</button>
          <button onClick={()=>setScreen('settings')}>Настройки</button>
          <a className="editor-link" href="?editor">Редактор сценариев</a>
        </nav></>}
      {screen==='scenario' && <><label>Сценарий<select value={id} onChange={e=>setId(e.target.value)}>
          {catalog.map(({briefing:s})=><option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
        <p>{briefing.description}</p>
        <p>{briefing.map.width} × {briefing.map.height} клеток · {briefing.units.length} частей · до {briefing.victory.max_rounds} раундов · целевой счёт {briefing.victory.target_score}.</p>
        {context && <details className="scenario-notes"><summary>Масштаб и исторические источники</summary>
          <p>{briefing.period}. {context.hex_scale} Один раунд — {briefing.turn_days} день. {context.formation_scale}</p>
          <p>{context.assumptions}</p>
          <ul>{briefing.sources?.map(url=><li key={url}><a href={url} target="_blank" rel="noreferrer">{new URL(url).hostname}</a></li>)}</ul>
        </details>}
        <label>Командование<select value={commander} onChange={e=>setCommander(e.target.value as Commander)}>
          {briefing.factions.map(f=><option key={f.id} value={f.id}>{f.name} · против ИИ</option>)}<option value="both">Обе стороны · за одним экраном</option></select></label>
        <p>Первая фаза — {briefing.factions.find(f=>f.id===briefing.starting_faction_id)?.name}. Выберите часть, затем подсвеченную клетку или обведённого противника.</p>
        <button className="primary" disabled={!ready} onClick={()=>{if(!saves.auto || window.confirm('Начать новую операцию и заменить автосохранение?')) open(null,commander,source);}}>Начать операцию</button>
        <button onClick={()=>setScreen('menu')}>Назад</button></>}
      {screen==='settings' && <><label className="check-label"><input type="checkbox" checked={confirmOrders} onChange={e=>onConfirm(e.target.checked)}/> Подтверждать конец фазы при доступных приказах</label>
        <button onClick={()=>setScreen('menu')}>Назад</button></>}
      {error && <p role="alert">{error}</p>}</section></div>
  </main>;
}

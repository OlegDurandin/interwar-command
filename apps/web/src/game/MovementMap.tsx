import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { platform } from '../platform';
import { useBackButton } from '../platform/useBackButton';
import { MovementSession } from '../../../../crates/game-wasm/pkg/game_wasm.js';
import type { AttackOption, JournalEvent, MovementOptions, MovementView, RouteView } from '../../../../crates/game-wasm/pkg/game_wasm.js';
import scenario from '../../../../content/scenarios/crossing.json?raw';
import { CampaignMenu, unpack } from './CampaignMenu';
import type { Commander } from './CampaignMenu';
import { Situation } from './CommandPanels';
import { readSlot, writeSlot } from './storage';
import { CombatOrder } from './CombatOrder';
import { initializeCore } from './App';
import { mountMap } from '../renderer/map';
import { OperationLayer, sameHex, supplyNames, terrainNames, unitNames } from '../renderer/operation';
import type { Hex } from '../renderer/geometry';

const movementHint = 'Нажмите на золотую клетку, чтобы переместить часть.';

interface Selection extends MovementOptions { at: Hex; unit?: string; battle?: AttackOption; inspectingRoute?: boolean; preview?: RouteView; travelled?: RouteView }
const available=(o:MovementOptions)=>o.can_entrench || o.routes.length>0 || o.targets.length>0;
const panels = {orders:'Приказ', forces:'Части', layers:'Слои', situation:'Сводка', saves:'Запись'} as const;
type Panel = keyof typeof panels;
const coords = (h: Hex) => `(${h.q}, ${h.r})`;

export function MovementMap() {
  const [opening,setOpening]=useState<{serial:number;data:string|null;side:Commander;source:string}>();
  const [confirmOrders,setConfirmOrders]=useState(()=>{try{return localStorage.getItem('confirm-phase')!=='off';}catch{return true;}});
  function open(data:string|null,side:Commander,source=scenario) {
    const original=data ? JSON.stringify(JSON.parse(data).scenario) : source;
    setOpening(old=>({data,side,source:original,serial:(old?.serial ?? 0)+1}));
  }
  if(!opening) return <CampaignMenu open={open} confirmOrders={confirmOrders} onConfirm={value=>{setConfirmOrders(value);try{localStorage.setItem('confirm-phase',value?'on':'off');}catch{/* Session preference still applies. */}}}/>;
  return <CommandRoom key={opening.serial} initial={opening.data} source={opening.source} commander={opening.side} confirmOrders={confirmOrders} onOpen={(data,side)=>open(data,side,opening.source)} onMenu={()=>setOpening(undefined)}/>;
}

export function CommandRoom({initial,commander,confirmOrders,onOpen,onMenu,source,playtest=false}:{source:string;playtest?:boolean;initial:string|null;commander:Commander;confirmOrders:boolean;onOpen:(data:string|null,side:Commander)=>void;onMenu:()=>void}) {
  const host = useRef<HTMLDivElement>(null);
  const session = useRef<MovementSession | null>(null);
  const [display,setDisplay] = useState<{layer: OperationLayer; paint: NonNullable<Awaited<ReturnType<typeof mountMap>>>}>();
  const click = useRef<(h: Hex) => void | 'order'>(() => {});
  const [view, setView] = useState<MovementView>();
  const [selection, setSelection] = useState<Selection>();
  const [panel,setPanel] = useState<Panel>('orders');
  const [roads,setRoads]=useState(true);
  const [objectives,setObjectives]=useState(true);
  const [zoc,setZoc]=useState(false);
  const [showSupply, setShowSupply] = useState(false);
  const [events,setEvents]=useState<JournalEvent[]>([]);
  const [filter,setFilter]=useState('');
  const [storage,setStorage]=useState('');
  const [hasManual,setHasManual]=useState(false);
  const ticket=useRef(0);
  const autoRequested=useRef(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('Загрузка карты…');

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const controller = new AbortController();
    const { signal } = controller;
    let game: MovementSession | undefined;
    let layer: OperationLayer | undefined;
    async function start(container: HTMLDivElement) {
      try {
        await initializeCore();
        if (signal.aborted) return;
        const raw=initial;
        // The manual slot and WebGL initialize independently. A slow IndexedDB read
        // should not postpone starting the renderer.
        const checkpoint=playtest ? {available:false,warning:''} : readSlot('manual').then(
          saved=>({available:saved!==undefined, warning:''}),
          (cause:unknown)=>({available:false, warning:'Хранилище недоступно. '+String(cause)}),
        );
        game = raw==null ? new MovementSession(source) : MovementSession.load_save(raw);
        const state = game.snapshot();
        // The roster and orders use Rust state immediately, even on a slow WebGL startup.
        session.current = game;
        setView(state);
        setEvents(game.journal().events);
        const first = state.units.find(u => u.faction === state.active && u.kind === 'infantry');
        if (first) setSelection({ at: first.position, unit: first.id, ...game.options(first.id) });
        setStatus(raw ? 'Партия восстановлена.' : movementHint);
        layer = new OperationLayer();
        const paint = await mountMap(container, signal, h => click.current(h), {
          width: state.width, height: state.height, layer, mobileDetail:true,
        });
        if (!paint || signal.aborted) return;
        setDisplay({layer,paint});
        const {available,warning}=await checkpoint;
        if (signal.aborted) return;
        if (available) setHasManual(true);
        // An early player or AI order may already have committed a later revision.
        if (!autoRequested.current) {
          if (warning) setStorage(warning);
          else persist(game,'auto');
        }
      } catch (cause) {
        if (!signal.aborted) setError(`Не удалось открыть карту. ${String(cause)}`);
      }
    }
    void start(element);
    return () => {
      controller.abort();
      session.current = null;
      game?.free();
      if (layer && !layer.destroyed) layer.destroy({children: true});
    };
  }, [initial,commander,source,playtest]);

  function persist(game:MovementSession,slot:'manual'|'auto') {
    if (playtest) return;
    if (slot==='auto') autoRequested.current=true;
    const current=++ticket.current;
    setStorage('Сохранение…');
    try {
      const data=JSON.stringify({game:game.serialize_save(),commander});
      void writeSlot(slot,data).then(()=>{
        if(session.current!==game) return;
        if(slot==='manual') setHasManual(true);
        if(current===ticket.current) setStorage('Сохранено');
      }).catch((cause:unknown)=>{if(session.current===game && current===ticket.current) setStorage('Ошибка сохранения. '+String(cause));});
    } catch(cause) {setStorage('Ошибка сохранения. '+String(cause));}
  }
  function refresh(game:MovementSession) {
    const state=game.snapshot();
    setView(state);
    setEvents(game.journal().events);
    persist(game,'auto');
    return state;
  }
  async function restoreManual() {
    try {
      const raw=await readSlot('manual');
      if(!raw) return;
      const saved=unpack(raw);
      const tested=MovementSession.load_save(saved.game);
      tested.free();
      onOpen(saved.game,saved.commander);
    } catch(cause) {setStorage('Ошибка загрузки. '+String(cause));}
  }
  function entrench() {
    const game=session.current;
    if(!game || aiTurn || !selection?.unit) return;
    try {
      game.apply_action({type:'entrench',unit_id:selection.unit});
      refresh(game);
      setSelection({...selection,...game.options(selection.unit),inspectingRoute:false,preview:undefined,battle:undefined,travelled:undefined});
      setStatus('Часть окопалась.');
    } catch(cause) {setError(String(cause));}
  }

  const aiTurn=!!view?.active && commander!=='both' && view.active!==commander;
  function select(at: Hex): void | 'order' {
    const game=session.current;
    if (!game || !view || aiTurn) return;
    setPanel('orders');
    const target=view.units.find(u => sameHex(u.position, at));
    if (target) {
      const battle=selection?.targets.find(t => t.target===target.id);
      if (selection && battle) {
        setSelection({...selection, at, battle, inspectingRoute:false, preview:undefined, travelled:undefined});
        setStatus('Сравните возможные потери и подтвердите приказ.');
        return;
      }
      // A tap on the current unit can start a camera double tap without rebuilding the map.
      if (selection?.unit===target.id && sameHex(selection.at,at) &&
          !selection.inspectingRoute && !selection.battle && !selection.travelled) return;
      const options=game.options(target.id);
      setSelection({at, unit:target.id, ...options});
      setStatus(options.targets.length ? 'Выберите выделенную цель для предпросмотра боя.' :
        options.routes.length ? movementHint : 'Для этой части сейчас нет доступных приказов движения и атаки.');
      return;
    }
    const route=selection?.routes.find(item => {
      const end=item.path.at(-1);
      return end && sameHex(end,at);
    });
    if (route && selection?.unit) {
      if (!selection.inspectingRoute) {
        moveTo(at,selection.unit);
        return 'order';
      }
      setSelection({...selection,at,battle:undefined,preview:route,travelled:undefined});
      setStatus('Проверьте маршрут и подтвердите перемещение.');
    } else {
      setSelection({at,routes:[],targets:[],can_entrench:false});
      setStatus('Выберите фишку на карте или часть в списке.');
    }
  }

  useLayoutEffect(() => {
    click.current = select;
    if (!view || !display) return;
    display.layer.draw(view, {at:selection?.at, routes:selection?.routes ?? [],
      path:selection?.preview ?? selection?.travelled, forecast:showSupply && !!view.active,
      roads,objectives,zoc,
      targets:selection?.targets.map(t=>t.target) ?? [], attacker:selection?.battle ? selection.unit : undefined});
    display.paint();
  }, [view,selection,showSupply,roads,objectives,zoc,aiTurn,display]);

  function moveTo(at:Hex,unit:string) {
    const game=session.current;
    if (!game || aiTurn) return;
    try {
      const travelled=game.move_to(unit,at.q,at.r);
      refresh(game);
      const options=game.options(unit);
      setSelection({at,unit,...options,travelled});
      setStatus(`Приказ выполнен. Часть заняла клетку ${coords(at)}.` + (options.targets.length ? ' Выберите выделенную цель.' : ''));
    } catch (cause) { setError(String(cause)); }
  }
  function attack() {
    const game=session.current;
    if (!game || aiTurn || !selection?.unit || !selection.battle) return;
    try {
      const id=selection.unit, target=selection.battle.target;
      const losses=game.attack(id,target);
      const state=refresh(game);
      const survivor=state.units.find(u=>u.id===id);
      setSelection(survivor ? {at:survivor.position,unit:id,...game.options(id)} : undefined);
      const outcome=!survivor ? ' Атакующая часть уничтожена.' : '';
      const defense=state.units.some(u=>u.id===target) ? '' : ' Защитник уничтожен.';
      setStatus(`Бой завершён. Потери атакующего: ${losses.attacker_loss}, защитника: ${losses.defender_loss}.${outcome}${defense}`);
    } catch (cause) { setError(String(cause)); }
  }
  function next() {
    const game=session.current;
    if (!game || aiTurn) return;
    if(confirmOrders && view?.units.some(u=>u.faction===view.active && available(game.options(u.id))) &&
      !window.confirm('У частей остались приказы. Завершить фазу?')) return;
    try {
      game.end_phase();
      setPanel('orders');
      const state=refresh(game);
      setSelection(undefined);
      setStatus(state.active ? 'Выберите часть активной стороны.' : 'Партия завершена.');
    } catch (cause) { setError(String(cause)); }
  }

  const runAI=useRef<()=>void>(()=>{});
  useLayoutEffect(()=>{
    runAI.current=()=>{
      const game=session.current;
      if(!game || !aiTurn) return;
      try {
        const order=game.next_ai_action();
        game.apply_action(order);
        const after=refresh(game);
        setSelection(undefined);
        setStatus(!after.active?'Партия завершена.':order.type==='end_phase'?'Ваш ход. Выберите часть.':'Противник отдаёт приказы…');
      } catch(cause) {setError('Ошибка хода противника. '+String(cause));}
    };
  });
  useEffect(()=>{
    if(!aiTurn || error) return;
    const controller=new AbortController();
    let timer:number|undefined;
    function schedule() {
      window.clearTimeout(timer);
      if (platform.isActive()) timer=window.setTimeout(()=>{if (platform.isActive()) runAI.current();},160);
    }
    schedule();
    platform.onPause(schedule,controller.signal);
    platform.onResume(schedule,controller.signal);
    return ()=>{window.clearTimeout(timer);controller.abort();};
  },[aiTurn,view,error]);

  const selected=view?.units.find(u => u.id===selection?.unit);
  useEffect(() => {
    platform.setMapGestures(true);
    return () => platform.setMapGestures(false);
  }, []);
  useBackButton(() => {
    if (panel !== 'orders') setPanel('orders');
    else if (selected && (selection?.battle || selection?.inspectingRoute)) select(selected.position);
    else onMenu();
  });
  const defender=view?.units.find(u=>u.id===selection?.battle?.target);
  useEffect(()=>{
    function shortcuts(e:KeyboardEvent) {
      if (e.altKey || e.ctrlKey || e.metaKey || e.repeat || (e.target instanceof HTMLElement && (['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName) || (e.code==='Space' && ['BUTTON','A','SUMMARY'].includes(e.target.tagName))))) return;
      switch(e.code) {
        case 'Escape': setSelection(undefined);setStatus('Выберите часть.');break;
        case 'Space': if(view?.active) next();break;
        case 'KeyF': if(selected) display?.paint.center(selected.position);break;
        case 'Digit1': setShowSupply(v=>!v);break;
        case 'Digit2': setRoads(v=>!v);break;
        case 'Digit3': setObjectives(v=>!v);break;
        case 'Digit4': setZoc(v=>!v);break;
        default:return;
      }
      e.preventDefault();
    }
    window.addEventListener('keydown',shortcuts);
    return ()=>window.removeEventListener('keydown',shortcuts);
  });
  const cell=view?.cells.find(c => selection && sameHex(c.position,selection.at));
  const sideName=(id?: string) => view?.sides.find(s=>s.id===id)?.name ?? 'Нейтральная';
  const path=selection?.preview ?? selection?.travelled;
  const canMove=!!selection?.routes.length && !aiTurn;
  const canAttack=!!selection?.targets.length && !aiTurn;
  const canEntrench=!!selection?.can_entrench && !aiTurn;
  return <main className="operation command-room">
    <header><span className="seal" aria-hidden="true">✥</span><h1>Interwar Command</h1>
      {view && <div className="header-score">{view.sides.map(s=><span key={s.id}>{s.name} <b>{s.score}</b></span>)}</div>}
      <button className="back-menu" onClick={onMenu}>{playtest ? 'Вернуться в редактор' : 'В меню'}</button><a className="map-link" href="?demo">Тестовая сетка ↗</a></header>
    <div className="op-heading"><div><p>{playtest ? 'Тестовая партия' : 'Операция'}</p><h2>{view?.title ?? 'Открытие карты…'}</h2></div>
      {view && <div className="turn"><span>Раунд {view.round}</span><strong>{view.active ? sideName(view.active) : view.winner ? 'Победа: '+sideName(view.winner) : 'Ничья'}</strong></div>}
    </div>
    <div className="layout" data-panel={panel} data-battle={!!selection?.battle} data-route={!!selection?.preview}>
      <nav className="field-tabs" aria-label="Панели карты">
        {(Object.keys(panels) as Panel[]).map(key=>
          <button hidden={playtest && key==='saves'} key={key} type="button" aria-pressed={panel===key} onClick={()=>setPanel(key)}>{panels[key]}</button>)}
      </nav>
      {view && <aside className="forces"><details open><summary>Части на карте</summary>
        <input className="roster-search" type="search" aria-label="Поиск части" placeholder="Найти часть…" value={filter} onChange={e=>setFilter(e.target.value)}/>
        {view.sides.map(s=><div key={s.id} className="roster-group"><h3>{s.name}</h3><div className="roster">{view.units.filter(u=>u.faction===s.id && (unitNames[u.kind]+' '+coords(u.position)).toLowerCase().includes(filter.toLowerCase())).map(u=>
          <button key={u.id} type="button" aria-pressed={selected?.id===u.id} className={'counter-row '+(u.faction===(view.sides.some(s=>s.id==='blue') ? 'blue' : view.sides[0]?.id)?'west':'east')} onClick={()=>{display?.paint.reveal(u.position);select(u.position);}}>
            <i aria-hidden="true"/><span>{unitNames[u.kind]}</span><small>{selection?.targets.some(t=>t.target===u.id) && '◎ '}{coords(u.position)}</small></button>)}</div></div>)}
      </details></aside>}
      <section className="map-panel" aria-label="Карта сценария">
        <div className="map-frame"><div className="map-title"><h2>Оперативная карта</h2><span>{view && `${view.width} × ${view.height}`}</span></div>
        <div className="paper"><div className="canvas-host" ref={host}/><span className="north" aria-hidden="true">С<br/>↑</span></div>
        <div className="map-footer" role={error ? 'alert' : 'status'}>{error || status}</div></div>
        <div className="map-settings">{view?.active && <div className="supply-switch"><label><input type="checkbox" checked={showSupply} onChange={e=>setShowSupply(e.target.checked)}/> Прогноз снабжения на следующую фазу · {sideName(view.active)}</label>
          {showSupply && <div className="supply-key"><span>● Полное</span><span>● Ограниченное</span><span>● Нет</span></div>}</div>}
        <div className="map-tools" aria-label="Слои и масштаб">
          <label><input type="checkbox" checked={roads} onChange={e=>setRoads(e.target.checked)}/> Дороги</label>
          <label><input type="checkbox" checked={objectives} onChange={e=>setObjectives(e.target.checked)}/> Цели</label>
          <label><input type="checkbox" checked={zoc} onChange={e=>setZoc(e.target.checked)}/> Зоны контроля</label>
          <button aria-label="Уменьшить масштаб" onClick={()=>display?.paint.zoom(.8)}>−</button>
          <button aria-label="Увеличить масштаб" onClick={()=>display?.paint.zoom(1.25)}>+</button>
        </div>
        <div className="map-key"><span><b>★</b> Цель</span><span><b>▣</b> Склад</span><span><i/> Доступная клетка</span>{!!selection?.targets.length && <span className="target-key">◎ Цель атаки</span>}</div></div>
      </section>
      {view && <Situation view={view} events={events}/>}
      <aside className="order-tray">
        <section className="order"><h2>{selected ? unitNames[selected.kind] : 'Выбор клетки'}</h2>
          {selection && <p className="location">{selected && sideName(selected.faction)+' · '}{coords(selected?.position ?? selection.at)}</p>}
          {selected && <dl className="controls"><dt>Прочность</dt><dd>{selected.strength}</dd><dt>Снабжение части</dt><dd>{supplyNames[selected.supply]}</dd><dt>Готовность</dt><dd>{selected.readiness}</dd></dl>}
          {cell && !selection?.battle && <p>{terrainNames[cell.terrain]} · {sideName(cell.controller)}{cell.source && ' · Склад'}{cell.objective_points > 0 && ' · Цель'}</p>}
          {cell && showSupply && view?.active && <p>Прогноз для {coords(cell.position)} · {supplyNames[cell.forecast]}</p>}
          {path && <div className="itinerary"><strong>{selection?.preview ? 'Маршрут' : 'Пройденный путь'}</strong>
            <p>{path.path.map(coords).join(' → ')}</p><span>Стоимость: {path.cost} ОД</span></div>}
          {selected && <div className="unit-actions">
            {!selection?.preview && <button disabled={!canMove} aria-pressed={!!selection?.inspectingRoute} onClick={()=>{
              if (!selection || !selected) return;
              if (selection.inspectingRoute) { select(selected.position); return; }
              setSelection({...selection,at:selected.position,inspectingRoute:true,battle:undefined,travelled:undefined});
              setStatus('Выберите золотую клетку для просмотра пути и стоимости.');
            }}>Маршрут</button>}
            <button className="touch-order" disabled={!canAttack} aria-describedby="order-help" onClick={()=>setStatus('Коснитесь обведённой вражеской фишки для предпросмотра боя.')}>Атака</button>
            <button className={canEntrench ? '' : 'touch-order'} disabled={!canEntrench} aria-describedby="order-help" onClick={entrench}>Окопаться{canEntrench && ' · уровень '+(selected.entrenchment+1)}</button>
          </div>}
          {selected && (!canMove || !canAttack || !canEntrench) && <details className="order-help touch-order" id="order-help"><summary>Доступность приказов</summary>
            {selected.faction!==view?.active || aiTurn || !view?.active ? <p>Приказы доступны в свою фазу.</p> : <>
              {!canMove && <p>Для этой части нет доступных маршрутов.</p>}
              {!canAttack && <p>Атака · доступных целей для этого приказа нет.</p>}
              {!canEntrench && <p>Окопаться · {selected.entrenchment>=2 ? 'достигнут предел окопов.' : 'часть уже получила приказ в этой фазе.'}</p>}
            </>}
          </details>}
          {selection?.preview && selected && <div className="route-actions">
            <button onClick={()=>select(selected.position)}>Отмена</button>
            <button className="primary" onClick={()=>moveTo(selection.at,selected.id)}>Переместить в {coords(selection.at)}</button>
          </div>}
        </section>
        {selection?.battle && defender && <CombatOrder preview={selection.battle} defender={defender} terrain={cell ? terrainNames[cell.terrain] ?? cell.terrain : ''} onAttack={attack} onCancel={()=>{if(selected) select(selected.position);}}/>}

        {view && <section className="phase-controls">{!view.active && <p>Раундов сыграно: {view.round} · Боёв: {view.combat_index}</p>}{!view.active && <h2>{view.winner ? commander==='both' ? 'Победа · '+sideName(view.winner) : view.winner===commander ? 'Победа' : 'Поражение' : 'Ничья'}</h2>}<p>{view.sides.map(s=>`${s.name}: ${s.score}`).join(' · ')}</p>
          {view.active ? <button disabled={aiTurn} onClick={next}>{aiTurn?'Ход противника…':'Завершить фазу →'}</button> : <button onClick={()=>onOpen(null,commander)}>Начать заново</button>}</section>}
        {!playtest && <section className="save-controls"><h2>Сохранения</h2>
          {view && <button onClick={()=>session.current && persist(session.current,'manual')}>Сохранить позицию</button>}
          {hasManual && <button onClick={()=>void restoreManual()}>Загрузить позицию</button>}
          {(view?.active || error) && <button onClick={()=>{if(window.confirm('Начать операцию заново? Автосохранение будет заменено.')) onOpen(null,commander);}}>Новая партия</button>}
          <span aria-live="polite" className="save-status">{storage}</span>
        </section>}
      </aside>
    </div>
  </main>;
}

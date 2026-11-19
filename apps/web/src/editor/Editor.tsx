import { useEffect, useRef, useState } from 'react';
import crossing from '../../../../content/scenarios/crossing.json?raw';
import { validate_scenario } from '../../../../crates/game-wasm/pkg/game_wasm.js';
import { initializeCore } from '../game/App';
import { CommandRoom } from '../game/MovementMap';
import { useBackButton } from '../platform/useBackButton';
import { terrainNames, sameHex } from '../renderer/operation';
import type { Hex } from '../renderer/geometry';
import { Atlas } from './Atlas';
import { CellForm, EdgeForm, Field, GoalForm, ScenarioForm, UnitForm, coord, options } from './Inspector';
import { blank, importDocument, neighbors, paint, type Document } from './document';
import { change, redo, undo, type History } from './history';
import './editor.css';

const tools={cell:'Клетка',brush:'Кисть',fill:'Заливка',edge:'Ребро',unit:'Часть',goal:'Цель',settings:'Сценарий'};
type Tool=keyof typeof tools;
type Notice={error?:boolean;text:string};

export default function Editor() {
  const [history,setHistory]=useState<History>();
  const [error,setError]=useState('');
  const [play,setPlay]=useState<{source:string;serial:number}>();
  useEffect(()=>{let live=true;
    void initializeCore().then(()=>{if(live) setHistory({past:[],draft:importDocument(crossing),future:[]});})
      .catch((e:unknown)=>{if(live) setError(String(e));});
    return ()=>{live=false;};
  },[]);
  if(!history) return <main><p role={error?'alert':'status'}>{error || 'Загрузка редактора…'}</p><a href="./">В меню</a></main>;
  if(play) return <CommandRoom key={play.serial} initial={null} source={play.source} commander="both" confirmOrders playtest
    onOpen={()=>setPlay({...play,serial:play.serial+1})} onMenu={()=>setPlay(undefined)}/>;
  return <Workbench history={history} update={h=>setHistory(h)} play={source=>setPlay({source,serial:0})}/>;
}

function Workbench({history,update,play}:{history:History;update:(next:History)=>void;play:(source:string)=>void}) {
  useBackButton(()=>location.assign('./'));
  const doc=history.draft;
  const [tool,setTool]=useState<Tool>('cell'),[ink,setInk]=useState('forest');
  const [selection,setSelection]=useState<Hex>({q:0,r:0}),[end,setEnd]=useState<Hex>();
  const at=selection.q<doc.map.width && selection.r<doc.map.height ? selection : {q:0,r:0};
  const [unit,setUnit]=useState('');
  const [notice,setNotice]=useState<Notice>({text:''});
  const [creating,setCreating]=useState(false);
  const [reading,setReading]=useState(false);
  const [revision,setRevision]=useState(0);
  const file=useRef<HTMLInputElement>(null);
  function display(h:History) {update(h);setRevision(v=>v+1);setNotice({text:''});}
  function apply(next:Document) {display(change(history,next));}
  function switchDoc(next:Document) {apply(next);setSelection({q:0,r:0});setEnd(undefined);setUnit('');}
  function select(h:Hex) {
    if(tool==='edge' && !end && !sameHex(at,h) && neighbors(doc,at).some(p=>sameHex(p,h))) {setEnd(h);return;}
    setSelection(h);setEnd(undefined);
    if(tool==='brush' || tool==='fill') apply(paint(doc,h,ink,tool==='fill'));
  }
  function validate(action:'check'|'export'|'play') {
    try {
      const raw=JSON.stringify(doc,null,2);
      const warnings=validate_scenario(raw);
      if(action==='play'){play(raw);return;}
      if(action==='export') {
        const url=URL.createObjectURL(new Blob([raw+'\n'],{type:'application/json'}));
        const link=document.createElement('a');link.href=url;link.download=doc.id+'.json';link.click();
        window.setTimeout(()=>URL.revokeObjectURL(url),1000);
      }
      setNotice({text:[action==='export'?'JSON экспортирован.':'Сценарий прошёл проверку.',...warnings].join(' ')});
    } catch(e){setNotice({error:true,text:String(e)});}
  }
  async function openFile(f:File) {
    setReading(true);
    try {
      if(f.size>16*1024*1024) throw new Error('$ — файл превышает 16 МиБ');
      const next=importDocument(await f.text());
      switchDoc(next);setNotice({text:'Открыт '+f.name});
    } catch(e){setNotice({error:true,text:String(e)});}
    finally {setReading(false);if(file.current) file.current.value='';}
  }
  const props={doc,at,commit:apply};
  return <main className="editor command-room"><header><div><small>INTERWAR COMMAND</small><h1>Редактор сценариев</h1></div><a href="./">В меню</a></header>
    <fieldset disabled={reading} className="editor-body"><div className="editor-bar">
      <button onClick={()=>setCreating(!creating)}>Новая карта</button>
      <button onClick={()=>switchDoc(importDocument(crossing))}>Копия «Переправы»</button>
      <button onClick={()=>file.current?.click()}>Открыть JSON</button><input type="file" accept=".json,application/json" ref={file} hidden onChange={e=>{const f=e.target.files?.[0];if(f) void openFile(f);}}/>
      <button disabled={!history.past.length} onClick={()=>{display(undo(history));setEnd(undefined);}}>Отменить</button>
      <button disabled={!history.future.length} onClick={()=>{display(redo(history));setEnd(undefined);}}>Повторить</button>
      <button onClick={()=>validate('check')}>Проверить</button><button onClick={()=>validate('export')}>Экспорт JSON</button>
      <button className="primary" onClick={()=>validate('play')}>Тестовая партия</button></div>
    {creating && <form className="dimensions" onSubmit={e=>{e.preventDefault();const d=new FormData(e.currentTarget);
      const w=Number(d.get('width')),h=Number(d.get('height'));
      if(w*h>16384){setNotice({error:true,text:'map: не более 16384 клеток'});return;}
      switchDoc(blank(w,h));setCreating(false);
    }}><Field label="Ширина"><input type="number" name="width" min="1" max="256" required defaultValue="8"/></Field>
      <Field label="Высота"><input type="number" name="height" min="1" max="256" required defaultValue="5"/></Field><button>Создать карту</button></form>}
    <div className="editor-work"><section className="editor-sheet"><div className="sheet-title"><h2>{doc.title}</h2><span>{doc.map.width} × {doc.map.height}</span></div>
      <Atlas doc={doc} at={at} end={tool==='edge'?end:undefined} select={select}/>
      <div className="sheet-foot"><span>Клетка {coord(at)}</span><span>Колесо — масштаб · перетаскивание — панорама</span></div></section>
    <aside className="inspector"><nav aria-label="Инструменты редактора">{(Object.keys(tools) as Tool[]).map(k=>
      <button aria-pressed={tool===k} key={k} onClick={()=>{setTool(k);setEnd(undefined);}}>{tools[k]}</button>)}</nav>
      <h2>{tools[tool]} {tool!=='settings' && coord(at)}</h2><div key={revision+':'+coord(at)+':'+unit+':'+(end?coord(end):'')}>
      {tool==='cell' && <CellForm {...props}/>}
      {(tool==='brush' || tool==='fill') && <><Field label="Краска"><select value={ink} onChange={e=>setInk(e.target.value)}>{options(terrainNames)}</select></Field>
        <p>{tool==='fill'?'Щёлкните по области одинаковой местности, чтобы залить её целиком.':'Щёлкайте по клеткам, чтобы менять местность.'}</p></>}
      {tool==='edge' && <><p>Выберите два соседних гекса. Второй конец можно выбрать из списка.</p>
        <Field label="Соседняя клетка"><select value={end ? coord(end) : ''} onChange={e=>setEnd(neighbors(doc,at).find(h=>coord(h)===e.target.value))}>
          <option value="">Выберите гекс</option>{neighbors(doc,at).map(h=><option key={coord(h)}>{coord(h)}</option>)}</select></Field>
        {end && <EdgeForm {...props} end={end}/>}</>}
      {tool==='unit' && <UnitForm {...props} id={unit} choose={setUnit}/>}
      {tool==='goal' && <GoalForm {...props}/>}
      {tool==='settings' && <ScenarioForm doc={doc} commit={apply}/>}
      </div></aside></div></fieldset>
    {notice.text && <p className="editor-notice" role={notice.error?'alert':'status'}>{notice.text}</p>}
  </main>;
}

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { mountMap } from '../renderer/map';
import { OperationLayer } from '../renderer/operation';
import type { Hex } from '../renderer/geometry';
import { drawing, type Document } from './document';

export function Atlas({doc,at,end,select}:{doc:Document;at:Hex;end?:Hex;select:(at:Hex)=>void}) {
  const host=useRef<HTMLDivElement>(null);
  const paint=useRef<(()=>void)|undefined>(undefined);
  const state=useMemo(()=>drawing(doc),[doc]);
  const latest=useRef({state,at,end,select});
  const [error,setError]=useState('');
  useLayoutEffect(()=>{latest.current={state,at,end,select};},[state,at,end,select]);
  useLayoutEffect(()=>{paint.current?.();},[state,at,end]);
  const {width,height}=doc.map;
  useEffect(()=>{
    const target=host.current;
    if(!target) return;
    const stop=new AbortController(),layer=new OperationLayer();
    void mountMap(target,stop.signal,h=>latest.current.select(h),{width,height,layer}).then(refresh=>{
      if(!refresh || stop.signal.aborted) return;
      paint.current=()=>{
        const {state,at,end}=latest.current;
        layer.draw(state,{at,routes:[],targets:[],forecast:false,path:end ? {path:[at,end],cost:0} : undefined});
        refresh();
      };
      paint.current();
    }).catch((cause:unknown)=>{if(!stop.signal.aborted) setError(String(cause));});
    return ()=>{stop.abort();paint.current=undefined;if(!layer.destroyed) layer.destroy({children:true});};
  },[width,height]);
  return <section className="atlas" aria-label="Карта редактора"><div className="atlas-canvas" ref={host}/>{error && <p role="alert">{error}</p>}</section>;
}

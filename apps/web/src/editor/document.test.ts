import { expect, test } from 'vitest';
import crossing from '../../../../content/scenarios/crossing.json?raw';
import type { Document } from './document';
import { change, redo, undo, type History } from './history';

test('independent edits retain at least thirty undo and redo steps, and a new branch discards redo',()=>{
  const original:Document=JSON.parse(crossing);
  let h:History={past:[],draft:original,future:[]};
  for(let i=0;i<40;i++){
    h=change(h,{...h.draft,victory:{...h.draft.victory,max_rounds:i+1}});
  }
  const painted=h.draft;
  for(let i=0;i<40;i++) h=undo(h);
  expect(h.draft).toEqual(original);
  for(let i=0;i<40;i++) h=redo(h);
  expect(h.draft).toEqual(painted);
  h=undo(h);
  h=change(h,{...h.draft,title:'Другая операция'});
  expect(h.future).toHaveLength(0);
  expect(redo(h).draft.title).toBe('Другая операция');
});

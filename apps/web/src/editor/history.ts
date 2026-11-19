import type { Document } from './document';

export interface History {past:Document[]; draft:Document; future:Document[]}
export function change(history:History,next:Document):History {
  return next===history.draft ? history : {past:[...history.past.slice(-49),history.draft],draft:next,future:[]};
}
export function undo(h:History):History {
  const prev=h.past.at(-1);
  return prev ? {past:h.past.slice(0,-1),draft:prev,future:[h.draft,...h.future]} : h;
}
export function redo(h:History):History {
  const next=h.future[0];
  return next ? {past:[...h.past,h.draft],draft:next,future:h.future.slice(1)} : h;
}

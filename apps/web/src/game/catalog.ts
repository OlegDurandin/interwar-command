import crossing from '../../../../content/scenarios/crossing.json?raw';
import warsaw from '../../../../content/scenarios/warsaw-1920.json?raw';
import type { Document } from '../editor/document';

// Keep each original v1 document for the Rust loader and its canonical save hash.
const entry=(source:string)=>({source,briefing:JSON.parse(source) as Document});
export const training=entry(crossing);
export const catalog=[training,entry(warsaw)];

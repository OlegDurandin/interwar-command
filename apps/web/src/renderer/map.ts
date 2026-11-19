// Preload Pixi's CSP-compatible synchronizers alongside the UI, before opening WebGL.
import 'pixi.js/unsafe-eval';
import { Application, Container, Graphics } from 'pixi.js';
import type { OperationLayer } from './operation';
import { loadTerrainArtwork, type TerrainArtwork } from './landscape';
import { loadMiniatures, type Miniatures } from './miniatures';
import { platform } from '../platform';
import { columns, fitCamera, hexToPixel, pick, radius, rows, zoomAt } from './geometry';
import type { Camera, Hex, Point } from './geometry';

const outline = Array.from({ length: 6 }, (_, index) => {
  const angle = (index * 60 - 90) * Math.PI / 180;
  return [Math.cos(angle) * radius, Math.sin(angle) * radius];
}).flat();

// A printed test swatch. The letters only select ink and ornament.
const swatches = [
  'pffhppwppf', 'pffhhpwppf', 'ppfhpwwpff', 'hppppwppfh',
  'hhppwwppph', 'pfppwpphhp', 'ffpwwphhpp', 'ffpwppppff',
] as const;
const ink: Record<string, number> = { p: 0xc6c69d, f: 0x91a888, h: 0xc7b18b, w: 0x87adb0 };

function drawSheet(): Graphics {
  const sheet = new Graphics();
  for (const [r, line] of swatches.entries()) {
    for (const [q, type] of [...line].entries()) {
      const { x, y } = hexToPixel({ q, r });
      const polygon = outline.map((v, i) => v + (i % 2 === 0 ? x : y));
      sheet.poly(polygon).fill(ink[type]).stroke({ color: 0x566958, width: 1.1 });
      if (type === 'f') {
        for (const [dx, dy] of [[-7, 4], [2, -4], [8, 7]] as const) {
          sheet.moveTo(x + dx - 3, y + dy + 2).lineTo(x + dx, y + dy - 4)
            .lineTo(x + dx + 3, y + dy + 2).stroke({ color: 0x536e58, width: 1.4 });
        }
      } else if (type === 'w' || type === 'h') {
        for (const dy of [-3, 3]) {
          const crest = type === 'w' ? 3 : 8;
          sheet.moveTo(x - 10, y + dy).quadraticCurveTo(x - 3, y + dy - crest, x + 2, y + dy)
            .quadraticCurveTo(x + 7, y + dy + 2, x + 11, y + dy - 1)
            .stroke({ color: type === 'w' ? 0x527d80 : 0x937e59, width: 1.2 });
        }
      }
    }
  }
  return sheet;
}

export async function mountMap(
  host: HTMLDivElement, signal: AbortSignal, onSelect: (cell: Hex) => void | 'order',
  scene?: { width: number; height: number; layer: OperationLayer; mobileDetail?: boolean },
) {
  if (signal.aborted) return;
  let atlas:Miniatures|undefined;
  let terrain:TerrainArtwork|undefined;
  let mounted=false;
  let frame:number|undefined;
  function scheduleArt() {
    if (mounted && frame===undefined && !signal.aborted) frame=requestAnimationFrame(()=>{
      frame=undefined;
      if (!signal.aborted) refreshArt();
    });
  }
  if (scene) {
    void loadMiniatures().then(textures=>{atlas=textures;scheduleArt();});
    void loadTerrainArtwork().then(textures=>{terrain=textures;scheduleArt();});
  }
  const app = new Application();
  try {
    await app.init({
      preference: 'webgl', antialias: true, backgroundAlpha: 0,
      autoStart: false, autoDensity: true, resolution: Math.min(window.devicePixelRatio, 2),
    });
  } catch (error) {
    if (app.renderer) app.destroy(true, { children: true });
    throw error;
  }
  if (signal.aborted) {
    app.destroy(true, { children: true });
    return;
  }

  const mapWidth = scene?.width ?? columns;
  const mapHeight = scene?.height ?? rows;
  const canvas = app.canvas;
  const world = new Container();
  const selected = new Graphics().poly(outline).fill({ color: 0xffefbc, alpha: 0.44 })
    .stroke({ color: 0x8c3c26, width: 3 });
  selected.moveTo(-6, 0).lineTo(6, 0).moveTo(0, -6).lineTo(0, 6)
    .stroke({ color: 0x67301f, width: 2 });
  function initialCamera(w:number,h:number) {
    const fit=fitCamera(w,h,mapWidth,mapHeight);
    // Keep counters legible on the narrow operation map. The menu retains its full-map overview.
    return scene?.mobileDetail && w<480 ? zoomAt(fit,{x:w/2,y:h/2},1.65) : fit;
  }
  let camera: Camera = initialCamera(host.clientWidth, host.clientHeight);
  let movedCamera = false;
  let width = host.clientWidth;
  let height = host.clientHeight;
  function resize() {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h || (w === width && h === height)) return;
    resetInput();
    if (movedCamera) {
      camera.x += (w - width) / 2;
      camera.y += (h - height) / 2;
    } else {
      camera = initialCamera(w,h);
    }
    width = w;
    height = h;
    app.renderer.resize(w, h);
    paint();
  }
  const observer = new ResizeObserver(resize);
  signal.addEventListener('abort', () => {
    resetInput();
    if (frame!==undefined) cancelAnimationFrame(frame);
    observer.disconnect();
    app.destroy(true, { children: true });
  }, { once: true });

  function paint() {
    if(scene) canvas.dataset.unitStyle=scene.layer.updateScale(camera.scale,atlas);
    world.position.set(camera.x, camera.y);
    world.scale.set(camera.scale);
    app.render();
  }

  function point(e: MouseEvent): Point {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  const fingers=new Map<number,Point>();
  let pinch:{start:Camera;mid:Point;distance:number}|undefined;
  const measure=()=>{
    const [a,b]=[...fingers.values()];
    if(!a || !b) return;
    return {mid:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},distance:Math.max(1,Math.hypot(b.x-a.x,b.y-a.y))};
  };
  const doubleTapMs=300;
  let lastTap:{cell:Hex;time:number}|undefined;
  function resetInput() {
    fingers.clear();
    pinch=undefined;
    drag=undefined;
    lastTap=undefined;
  }
  function resume() {
    resetInput();
    if (platform.isActive()) {resize();paint();}
  }
  platform.onPause(resetInput,signal);
  platform.onResume(resume,signal);
  window.addEventListener('blur',resetInput,{signal});
  window.addEventListener('keydown',resetInput,{signal});
  document.addEventListener('pointerdown',e=>{
    if(e.target!==canvas) resetInput();
  },{capture:true,signal});
  let drag: { id: number; started: number; start: Point; origin: Point; moved: boolean } | undefined;
  function track(e: PointerEvent) {
    if (!drag || drag.id !== e.pointerId) return;
    const p = point(e);
    const dx = p.x - drag.start.x;
    const dy = p.y - drag.start.y;
    if (Math.hypot(dx, dy) > (e.pointerType==='touch' ? 8 : 4)) {drag.moved=true;lastTap=undefined;}
    if (drag.moved) {
      movedCamera = true;
      camera = { ...camera, x: drag.origin.x + dx, y: drag.origin.y + dy };
      paint();
    }
  }
  canvas.addEventListener('pointerdown', e => {
    if (!platform.isActive() || (e.button!==0 && e.button!==1)) return;
    if(e.pointerType==='touch') {
      fingers.set(e.pointerId,point(e));
      canvas.setPointerCapture(e.pointerId);
      const pair=measure();
      if(fingers.size===2 && pair) {lastTap=undefined;pinch={start:{...camera},...pair};drag=undefined;return;}
      if(fingers.size>2 || pinch) return;
    }
    if(drag) return;
    drag = { id: e.pointerId, started: e.timeStamp, start: point(e), origin: { ...camera }, moved: false };
    canvas.setPointerCapture(e.pointerId);
  }, { signal });
  canvas.addEventListener('pointermove', e=>{
    if(fingers.has(e.pointerId)) fingers.set(e.pointerId,point(e));
    if(pinch && fingers.size>=2) {
      const current=measure();
      if(!current) return;
      camera=zoomAt(pinch.start,pinch.mid,current.distance/pinch.distance);
      camera.x+=current.mid.x-pinch.mid.x;camera.y+=current.mid.y-pinch.mid.y;
      movedCamera=true;paint();
    } else track(e);
  }, { signal });
  canvas.addEventListener('pointerup', e => {
    const touched=fingers.delete(e.pointerId);
    if(touched && pinch) {if(fingers.size===0) pinch=undefined;return;}
    if (drag?.id !== e.pointerId) return;
    track(e);
    const held = touched && e.timeStamp - drag.started > 500;
    const cell = !drag.moved && !held && e.button===0 && platform.isActive()
      ? pick(point(e), camera, mapWidth, mapHeight) : undefined;
    drag = undefined;
    if (!cell) lastTap=undefined;
    if (cell) {
      const center = hexToPixel(cell);
      if (!scene) {
        selected.position.set(center.x, center.y);
        selected.visible = true;
        paint();
      }
      if (e.pointerType==='mouse' && (e.ctrlKey || e.metaKey || e.altKey)) return;
      if(touched && lastTap && e.timeStamp-lastTap.time<doubleTapMs && cell.q===lastTap.cell.q && cell.r===lastTap.cell.r) {
        camera=zoomAt(camera,point(e),1.35);
        camera.x=width/2-center.x*camera.scale;camera.y=height/2-center.y*camera.scale;
        movedCamera=true;paint();lastTap=undefined;return;
      }
      // A completed order consumes this tap. Only a selection can start a camera double tap.
      const result=onSelect(cell);
      lastTap=touched && result!=='order' ? {cell,time:e.timeStamp} : undefined;
    }
  }, { signal });
  const cancel = (e: PointerEvent) => { fingers.delete(e.pointerId);if(!fingers.size) pinch=undefined; if (drag?.id === e.pointerId) drag = undefined; };
  canvas.addEventListener('pointercancel', resetInput, { signal });
  canvas.addEventListener('lostpointercapture', cancel, { signal });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    if (drag || pinch) return;
    lastTap=undefined;
    const pixels = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? height : 1);
    camera = zoomAt(camera, point(e), Math.exp(-0.0015 * pixels));
    movedCamera = true;
    paint();
  }, { passive: false, signal });

  canvas.setAttribute('aria-label', `Гексагональная карта, ${mapWidth} на ${mapHeight} клеток`);
  world.addChild(scene?.layer ?? drawSheet(), selected);
  selected.visible = false;
  app.stage.addChild(world);
  host.append(canvas);
  app.renderer.resize(width, height);
  function refreshArt() {
    if (terrain && scene && canvas.dataset.terrainStyle!=='illustrated') {
      scene.layer.setTerrainArtwork(terrain);
      canvas.dataset.terrainStyle='illustrated';
    }
    paint();
  }
  mounted=true;
  refreshArt();
  observer.observe(host);
  return Object.assign(paint,{
    center(hex:Hex) {
      const p=hexToPixel(hex);
      camera={...camera,x:width/2-p.x*camera.scale,y:height/2-p.y*camera.scale};
      movedCamera=true; paint();
    },
    reveal(hex:Hex) {
      const p=hexToPixel(hex);
      const x=camera.x+p.x*camera.scale, y=camera.y+p.y*camera.scale;
      const pad=radius*camera.scale;
      if(x<pad || x>width-pad || y<pad || y>height-pad) {
        camera.x=width/2-p.x*camera.scale; camera.y=height/2-p.y*camera.scale;
        movedCamera=true;paint();
      }
    },
    zoom(factor:number) {camera=zoomAt(camera,{x:width/2,y:height/2},factor);movedCamera=true;paint();},
  });
}

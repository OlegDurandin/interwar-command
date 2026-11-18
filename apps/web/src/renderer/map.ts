import { Application, Container, Graphics } from 'pixi.js';
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
  host: HTMLDivElement, signal: AbortSignal, onSelect: (cell: Hex) => void,
) {
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

  const canvas = app.canvas;
  const world = new Container();
  const selected = new Graphics().poly(outline).fill({ color: 0xffefbc, alpha: 0.44 })
    .stroke({ color: 0x8c3c26, width: 3 });
  selected.moveTo(-6, 0).lineTo(6, 0).moveTo(0, -6).lineTo(0, 6)
    .stroke({ color: 0x67301f, width: 2 });
  let camera: Camera = fitCamera(host.clientWidth, host.clientHeight);
  let movedCamera = false;
  let width = host.clientWidth;
  let height = host.clientHeight;
  const observer = new ResizeObserver(() => {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (w === width && h === height) return;
    if (movedCamera) {
      camera.x += (w - width) / 2;
      camera.y += (h - height) / 2;
    } else {
      camera = fitCamera(w, h);
    }
    width = w;
    height = h;
    app.renderer.resize(w, h);
    paint();
  });
  signal.addEventListener('abort', () => {
    observer.disconnect();
    app.destroy(true, { children: true });
  }, { once: true });

  function paint() {
    world.position.set(camera.x, camera.y);
    world.scale.set(camera.scale);
    app.render();
  }

  function point(e: MouseEvent): Point {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  let drag: { id: number; start: Point; origin: Point; moved: boolean } | undefined;
  function track(e: PointerEvent) {
    if (!drag || drag.id !== e.pointerId) return;
    const p = point(e);
    const dx = p.x - drag.start.x;
    const dy = p.y - drag.start.y;
    if (Math.hypot(dx, dy) > 4) drag.moved = true;
    if (drag.moved) {
      movedCamera = true;
      camera = { ...camera, x: drag.origin.x + dx, y: drag.origin.y + dy };
      paint();
    }
  }
  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0 || drag) return;
    drag = { id: e.pointerId, start: point(e), origin: { ...camera }, moved: false };
    canvas.setPointerCapture(e.pointerId);
  }, { signal });
  canvas.addEventListener('pointermove', track, { signal });
  canvas.addEventListener('pointerup', e => {
    if (drag?.id !== e.pointerId) return;
    track(e);
    const cell = drag.moved ? undefined : pick(point(e), camera);
    drag = undefined;
    if (cell) {
      const center = hexToPixel(cell);
      selected.position.set(center.x, center.y);
      selected.visible = true;
      paint();
      onSelect(cell);
    }
  }, { signal });
  const cancel = (e: PointerEvent) => { if (drag?.id === e.pointerId) drag = undefined; };
  canvas.addEventListener('pointercancel', cancel, { signal });
  canvas.addEventListener('lostpointercapture', cancel, { signal });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    if (drag) return;
    const pixels = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? height : 1);
    camera = zoomAt(camera, point(e), Math.exp(-0.0015 * pixels));
    movedCamera = true;
    paint();
  }, { passive: false, signal });

  canvas.setAttribute('aria-label', `Гексагональная карта, ${columns} на ${rows} клеток`);
  world.addChild(drawSheet(), selected);
  selected.visible = false;
  app.stage.addChild(world);
  host.append(canvas);
  app.renderer.resize(width, height);
  paint();
  observer.observe(host);
}

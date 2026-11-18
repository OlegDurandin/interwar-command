export interface Hex { q: number; r: number }
export interface Point { x: number; y: number }
export interface Camera extends Point { scale: number }

export const columns = 10;
export const rows = 8;
export const radius = 30;
const root3 = Math.sqrt(3);

export function hexToPixel({ q, r }: Hex): Point {
  return { x: radius * root3 * (q + r / 2), y: radius * 1.5 * r };
}

export function pixelToHex({ x, y }: Point): Hex {
  const q = (x / root3 - y / 3) / radius;
  const r = (2 * y / 3) / radius;
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const eq = Math.abs(rq - q);
  const er = Math.abs(rr - r);
  const es = Math.abs(rs - s);
  if (eq > er && eq > es) rq = -rr - rs;
  else if (er > es) rr = -rq - rs;
  return { q: rq || 0, r: rr || 0 };
}

export function screenToWorld(p: Point, camera: Camera): Point {
  return { x: (p.x - camera.x) / camera.scale, y: (p.y - camera.y) / camera.scale };
}

export function pick(point: Point, camera: Camera): Hex | undefined {
  const cell = pixelToHex(screenToWorld(point, camera));
  if (cell.q >= 0 && cell.q < columns && cell.r >= 0 && cell.r < rows) return cell;
}

export function zoomAt(camera: Camera, point: Point, factor: number): Camera {
  const anchor = screenToWorld(point, camera);
  const scale = Math.max(0.15, Math.min(4, camera.scale * factor));
  return { x: point.x - anchor.x * scale, y: point.y - anchor.y * scale, scale };
}

export function fitCamera(width: number, height: number): Camera {
  const last = hexToPixel({ q: columns - 1, r: rows - 1 });
  const scale = Math.min(width * 0.86 / (last.x + radius * root3),
    height * 0.82 / (last.y + radius * 2), 1.6);
  return { x: (width - last.x * scale) / 2, y: (height - last.y * scale) / 2, scale };
}

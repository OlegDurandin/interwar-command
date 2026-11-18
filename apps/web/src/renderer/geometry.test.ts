import { describe, expect, it } from 'vitest';
import { hexToPixel, pick, pixelToHex, radius, screenToWorld, zoomAt } from './geometry';

describe('pointy-top renderer', () => {
  it('round-trips centers in all quadrants', () => {
    for (let q = -10; q <= 10; q++) {
      for (let r = -8; r <= 8; r++) {
        expect(pixelToHex(hexToPixel({ q, r }))).toEqual({ q, r });
      }
    }
  });

  it('rounds on the two sides of a slanted edge', () => {
    const x = Math.sqrt(3) * radius / 4;
    expect(pixelToHex({ x, y: radius * 0.74 })).toEqual({ q: 0, r: 0 });
    expect(pixelToHex({ x, y: radius * 0.76 })).toEqual({ q: 0, r: 1 });
  });

  it('keeps the pointer anchored and picks inside axial bounds after pan and zoom', () => {
    const camera = { x: -20, y: 15, scale: 0.5 };
    const pointer = { x: 31, y: 41 };
    const next = zoomAt(camera, pointer, 3);
    expect(next.scale).toBe(1.5);
    expect(screenToWorld(pointer, next)).toEqual(screenToWorld(pointer, camera));
    for (const cell of [{ q: 0, r: 0 }, { q: 9, r: 7 }, { q: 10, r: 3 }, { q: -1, r: 7 }]) {
      const p = hexToPixel(cell);
      const hit = pick({ x: next.x + next.scale * p.x, y: next.y + next.scale * p.y }, next);
      expect(hit).toEqual(cell.q >= 0 && cell.q < 10 ? cell : undefined);
    }
  });
});

import { Container, Rectangle, Sprite, Texture } from 'pixi.js';
import { hexToPixel, radius, type Hex } from './geometry';
import { variation } from './terrain';
import countrysideUrl from './assets/countryside.webp?url';

const frameSize = 248;
const stride = 252;
const frames: Record<string, number> = {forest: 2, urban: 3, hills: 4, swamp: 5};
type LandscapeCell = {position: Hex; terrain: string};
export type TerrainArtwork = readonly Texture[];
let loading: Promise<TerrainArtwork | undefined> | undefined;

export function loadTerrainArtwork() {
  return loading ??= (async () => {
    const image = new Image();
    image.src = countrysideUrl;
    await image.decode();
    const source = Texture.from(image).source;
    return Array.from({length: 6}, (_, i) => new Texture({
      source,
      frame: new Rectangle((i % 3) * stride + 2, Math.floor(i / 3) * stride + 2, frameSize, frameSize),
    }));
  })().catch(() => { loading = undefined; return undefined; });
}

// Keep the terrain sprites while orders, highlights and control change above them.
export class Landscape extends Container {
  private signature?: string;

  draw(cells: LandscapeCell[], artwork: TerrainArtwork) {
    const signature = cells.map(c => c.position.q + ',' + c.position.r + ':' + c.terrain).join('|');
    if (signature === this.signature) return;
    this.signature = signature;
    for (const sprite of this.removeChildren()) sprite.destroy();
    for (const cell of cells) {
      const variant = variation(cell.position);
      const index = cell.terrain === 'plain' ? (variant % 5 === 0 ? 1 : 0) : frames[cell.terrain];
      const texture = index === undefined ? undefined : artwork[index];
      if (!texture) continue;
      const tile = new Sprite(texture);
      tile.eventMode = 'none';
      tile.anchor.set(.5);
      tile.position.copyFrom(hexToPixel(cell.position));
      tile.width = Math.sqrt(3) * radius + .28;
      tile.height = 2 * radius + .3;
      if (variant & 32) tile.scale.x *= -1;
      if ((index === 0 || index === 1) && (variant & 64)) tile.scale.y *= -1;
      this.addChild(tile);
    }
  }
}

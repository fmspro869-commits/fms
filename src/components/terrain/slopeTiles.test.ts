import { describe, expect, it } from 'vitest';
import {
  colorizeTerrariumPixels,
  fieldMaskTileUrl,
  pointInPixelPolygon,
  slopeColor,
  terrariumElevation,
} from './slopeTiles';

describe('DEM terrain analysis', () => {
  it('decodes Terrarium RGB elevations', () => {
    expect(terrariumElevation(128, 0, 0)).toBe(0);
    expect(terrariumElevation(128, 100, 0)).toBe(100);
  });

  it('colors terrain slope from green lowlands through yellow to steep red', () => {
    expect(slopeColor(0)).toEqual([0, 190, 84]);
    expect(slopeColor(4)).toEqual([228, 228, 24]);
    expect(slopeColor(12)).toEqual([239, 46, 39]);
    expect(slopeColor(40)).toEqual(slopeColor(12));
  });

  it('creates a field-clipped tile URL and tests projected mask inclusion', () => {
    expect(fieldMaskTileUrl([[52, 19], [52, 20], [53, 20]])).toContain('fms-slope://tiles/{z}/{x}/{y}.png?field=');
    expect(pointInPixelPolygon({ x: 1, y: 1 }, [
      { x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 },
    ])).toBe(true);
    expect(pointInPixelPolygon({ x: 3, y: 1 }, [
      { x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 },
    ])).toBe(false);
  });

  it('clips colorized slope pixels outside the actual field boundary', () => {
    const pixels = new Uint8ClampedArray(256 * 256 * 4);
    for (let index = 0; index < pixels.length; index += 4) {
      pixels[index] = 128;
      pixels[index + 1] = 0;
      pixels[index + 3] = 255;
    }
    const field: [number, number][] = [
      [52.65, 19.06],
      [52.65, 19.08],
      [52.66, 19.08],
      [52.66, 19.06],
    ];
    const zoom = 12;
    const worldSize = 256 * 2 ** zoom;
    const worldX = (19.07 + 180) / 360 * worldSize;
    const latitudeRadians = 52.655 * Math.PI / 180;
    const worldY = (0.5 - Math.log((1 + Math.sin(latitudeRadians)) / (1 - Math.sin(latitudeRadians))) / (4 * Math.PI)) * worldSize;
    const tileX = Math.floor(worldX / 256);
    const tileY = Math.floor(worldY / 256);
    colorizeTerrariumPixels(pixels, zoom, tileX, tileY, field);
    const insideX = Math.floor(worldX - tileX * 256);
    const insideY = Math.floor(worldY - tileY * 256);
    const insideIndex = (insideY * 256 + insideX) * 4;
    expect(pixels[insideIndex + 3]).toBe(176);
    expect(pixels[insideIndex]).toBe(0);
    expect(pixels[insideIndex + 1]).toBe(190);

    const outsideX = Math.floor((19.09 + 180) / 360 * worldSize) - tileX * 256;
    const outsideIndex = (insideY * 256 + outsideX) * 4;
    expect(pixels[outsideIndex + 3]).toBe(0);
  });
});

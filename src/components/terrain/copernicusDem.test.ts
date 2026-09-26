import { describe, expect, it } from 'vitest';
import { copernicusDemTileUrl } from './copernicusDem';

describe('Copernicus DEM tiles', () => {
  it('requests the Copernicus GLO-30 item covering the field tile', () => {
    const url = new URL(copernicusDemTileUrl(12, 2264, 1340));
    expect(url.origin).toBe('https://planetarycomputer.microsoft.com');
    expect(url.pathname).toBe('/api/data/v1/item/tiles/WebMercatorQuad/12/2264/1340.png');
    expect(url.searchParams.get('collection')).toBe('cop-dem-glo-30');
    expect(url.searchParams.get('item')).toBe('Copernicus_DSM_COG_10_N52_00_E019_00_DEM');
    expect(url.searchParams.get('algorithm')).toBe('terrarium');
    expect(url.searchParams.get('resampling')).toBe('bilinear');
  });

  it('handles tiles west and south of the equator', () => {
    const tileCount = 2 ** 10;
    const westSouthUrl = new URL(copernicusDemTileUrl(10, 158, 657));
    expect(westSouthUrl.searchParams.get('item')).toMatch(/_S\d{2}_00_W\d{3}_00_DEM$/);
    expect(() => copernicusDemTileUrl(10, 1, tileCount)).toThrow('Nieprawidłowe współrzędne');
  });

  it('wraps x around the world while keeping the server tile index valid', () => {
    const url = new URL(copernicusDemTileUrl(4, -1, 7));
    expect(url.pathname).toBe('/api/data/v1/item/tiles/WebMercatorQuad/4/15/7.png');
  });
});

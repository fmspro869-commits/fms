const COPERNICUS_TILE_API = 'https://planetarycomputer.microsoft.com/api/data/v1/item/tiles/WebMercatorQuad';

function tileCenter(z: number, x: number, y: number): [number, number] {
  if (!Number.isInteger(z) || z < 0 || z > 24) {
    throw new Error('Nieprawidłowy poziom kafla DEM Copernicus.');
  }
  const tileCount = 2 ** z;
  if (!Number.isInteger(x) || !Number.isInteger(y) || y < 0 || y >= tileCount) {
    throw new Error('Nieprawidłowe współrzędne kafla DEM Copernicus.');
  }
  const wrappedX = ((x % tileCount) + tileCount) % tileCount;
  const longitude = ((wrappedX + 0.5) / tileCount) * 360 - 180;
  const mercatorY = Math.PI - (2 * Math.PI * (y + 0.5)) / tileCount;
  const latitude = (180 / Math.PI) * Math.atan(Math.sinh(mercatorY));
  return [latitude, longitude];
}

function itemIdFor(latitude: number, longitude: number): string {
  const latDegree = Math.floor(latitude);
  const lngDegree = Math.floor(longitude);
  const latHemisphere = latDegree < 0 ? 'S' : 'N';
  const lngHemisphere = lngDegree < 0 ? 'W' : 'E';
  return `Copernicus_DSM_COG_10_${latHemisphere}${String(Math.abs(latDegree)).padStart(2, '0')}_00_${lngHemisphere}${String(Math.abs(lngDegree)).padStart(3, '0')}_00_DEM`;
}

export function copernicusDemTileUrl(z: number, x: number, y: number): string {
  const [latitude, longitude] = tileCenter(z, x, y);
  const item = itemIdFor(latitude, longitude);
  const params = new URLSearchParams({
    collection: 'cop-dem-glo-30',
    item,
    assets: 'data',
    algorithm: 'terrarium',
    resampling: 'bilinear',
  });
  const tileCount = 2 ** z;
  const wrappedX = ((x % tileCount) + tileCount) % tileCount;
  return `${COPERNICUS_TILE_API}/${z}/${wrappedX}/${y}.png?${params.toString()}`;
}

export async function fetchCopernicusDemTile(
  z: number,
  x: number,
  y: number,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const response = await fetch(copernicusDemTileUrl(z, x, y), { signal });
  if (!response.ok) {
    throw new Error(`Copernicus DEM zwrócił HTTP ${response.status} dla kafla ${z}/${x}/${y}.`);
  }
  return response.arrayBuffer();
}

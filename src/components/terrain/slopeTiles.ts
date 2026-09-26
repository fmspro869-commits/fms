const TILE_SIZE = 256;
const MAX_MASK_POINTS = 96;

type PixelPoint = { x: number; y: number };

const SLOPE_STOPS = [
  { value: 0, color: [0, 190, 84] },
  { value: 2, color: [80, 210, 56] },
  { value: 4, color: [228, 228, 24] },
  { value: 8, color: [255, 133, 18] },
  { value: 12, color: [239, 46, 39] },
];

function sampleFieldRing(field: [number, number][]): [number, number][] {
  const validField = Array.isArray(field)
    ? field.filter((point): point is [number, number] =>
      Array.isArray(point)
      && point.length >= 2
      && Number.isFinite(point[0])
      && Number.isFinite(point[1])
      && Math.abs(point[0]) <= 85.0511
      && Math.abs(point[1]) <= 180)
    : [];
  if (validField.length <= MAX_MASK_POINTS) return validField;
  const step = (validField.length - 1) / (MAX_MASK_POINTS - 1);
  return Array.from({ length: MAX_MASK_POINTS }, (_, index) => validField[Math.round(index * step)]);
}

export function fieldMaskTileUrl(field: [number, number][]): string {
  const encodedField = encodeURIComponent(JSON.stringify(sampleFieldRing(field)));
  return `fms-slope://tiles/{z}/{x}/{y}.png?field=${encodedField}`;
}

export function terrariumElevation(red: number, green: number, blue: number): number {
  return red * 256 + green + blue / 256 - 32768;
}

export function slopeColor(slopePercent: number): [number, number, number] {
  const value = Math.max(0, Math.min(12, slopePercent));
  const upperIndex = SLOPE_STOPS.findIndex((stop) => stop.value >= value);
  const lower = SLOPE_STOPS[Math.max(0, upperIndex - 1)];
  const upper = SLOPE_STOPS[upperIndex < 0 ? SLOPE_STOPS.length - 1 : upperIndex];
  const ratio = upper.value === lower.value ? 0 : (value - lower.value) / (upper.value - lower.value);
  return lower.color.map((channel, index) => Math.round(channel + (upper.color[index] - channel) * ratio)) as [number, number, number];
}

function lonLatToWorldPixel([lat, lng]: [number, number], zoom: number): PixelPoint {
  const worldSize = TILE_SIZE * 2 ** zoom;
  const sinLat = Math.sin(lat * Math.PI / 180);
  return {
    x: ((lng + 180) / 360) * worldSize,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * worldSize,
  };
}

function fieldTileMask(
  polygon: PixelPoint[],
  tileX: number,
  tileY: number,
): Uint8Array {
  const mask = new Uint8Array(TILE_SIZE * TILE_SIZE);
  if (polygon.length < 3) return mask;
  const tileLeft = tileX * TILE_SIZE;
  const tileTop = tileY * TILE_SIZE;

  for (let y = 0; y < TILE_SIZE; y++) {
    const scanY = tileTop + y + 0.5;
    const intersections: number[] = [];
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[j];
      const b = polygon[i];
      if ((a.y > scanY) !== (b.y > scanY)) {
        intersections.push(a.x + ((scanY - a.y) * (b.x - a.x)) / (b.y - a.y));
      }
    }
    intersections.sort((a, b) => a - b);

    for (let i = 0; i + 1 < intersections.length; i += 2) {
      const start = Math.max(0, Math.ceil(intersections[i] - tileLeft - 0.5));
      const end = Math.min(TILE_SIZE, Math.ceil(intersections[i + 1] - tileLeft - 0.5));
      if (start < end) mask.fill(1, y * TILE_SIZE + start, y * TILE_SIZE + end);
    }
  }

  return mask;
}

export function pointInPixelPolygon(point: PixelPoint, polygon: PixelPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const crosses = (a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function colorizeTerrariumPixels(
  pixels: Uint8ClampedArray,
  zoom: number,
  tileX: number,
  tileY: number,
  field: [number, number][],
): Uint8ClampedArray {
  if (pixels.length !== TILE_SIZE * TILE_SIZE * 4) {
    throw new Error(`Unexpected DEM tile dimensions: ${pixels.length / 4} pixels`);
  }

  const polygon = sampleFieldRing(field).map((point) => lonLatToWorldPixel(point, zoom));
  const mask = fieldTileMask(polygon, tileX, tileY);
  const worldSize = TILE_SIZE * 2 ** zoom;
  const centerY = (tileY * TILE_SIZE + TILE_SIZE / 2) / worldSize;
  const latitude = Math.atan(Math.sinh(Math.PI * (1 - 2 * centerY))) * 180 / Math.PI;
  const metersPerPixel = 156543.03392 * Math.cos(latitude * Math.PI / 180) / 2 ** zoom;
  const elevations = new Float32Array(TILE_SIZE * TILE_SIZE);

  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const index = (y * TILE_SIZE + x) * 4;
      elevations[y * TILE_SIZE + x] = terrariumElevation(pixels[index], pixels[index + 1], pixels[index + 2]);
    }
  }

  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const index = (y * TILE_SIZE + x) * 4;
      if (!mask[y * TILE_SIZE + x]) {
        pixels[index + 3] = 0;
        continue;
      }

      const west = elevations[y * TILE_SIZE + Math.max(0, x - 1)];
      const east = elevations[y * TILE_SIZE + Math.min(TILE_SIZE - 1, x + 1)];
      const north = elevations[Math.max(0, y - 1) * TILE_SIZE + x];
      const south = elevations[Math.min(TILE_SIZE - 1, y + 1) * TILE_SIZE + x];
      const riseOverRun = Math.hypot((east - west) / 2, (south - north) / 2) / Math.max(0.1, metersPerPixel);
      const [red, green, blue] = slopeColor(riseOverRun * 100);
      pixels[index] = red;
      pixels[index + 1] = green;
      pixels[index + 2] = blue;
      pixels[index + 3] = 176;
    }
  }

  return pixels;
}

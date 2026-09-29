import { Component, useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Sky } from '@react-three/drei';
import * as THREE from 'three';
import { fetchCopernicusDemTile } from '@/components/terrain/copernicusDem';

type LatLng = [number, number];
type GuidanceLine = { label: string; segments: LatLng[][] };
type CameraMode = 'follow' | 'north-up' | 'top-down' | 'free';
type ViewMode = 'satellite' | 'slope' | 'elevation';
type ImageryRequest = { key: string; center: LatLng; zoom: number };

interface ImageryPatch {
  geometry: THREE.BufferGeometry;
  texture: THREE.CanvasTexture;
  zoom: number;
  missingTiles: number;
}

interface Terrain {
  geometry: THREE.BufferGeometry;
  satellite: THREE.CanvasTexture;
  slopeColors: Float32Array;
  elevationColors: Float32Array;
  minElevation: number;
  maxElevation: number;
  heightAt: (lat: number, lng: number) => number | null;
  slopeAt: (lat: number, lng: number) => number | null;
  elevationAt: (lat: number, lng: number) => number | null;
  satelliteWarning: string | null;
}

interface Props {
  position: { lat: number; lng: number; heading: number | null } | null;
  track: LatLng[];
  fieldGeo: LatLng[];
  guidanceLines: GuidanceLine[];
  activeLabel: string | null;
  doneLabels: string[];
  info: {
    activeLine: { label: string } | null;
    xte: number;
    steer: 'left' | 'right' | 'center';
    distanceToEnd: number;
  };
  implementWidth: number;
  heading: number | null;
  speedKmh: number;
  isDemo: boolean;
  night: boolean;
  accuracyM: number | null;
  satellites: number | null;
  fixLabel: string;
  paused: boolean;
  onTogglePause: () => void;
  onStop: () => void;
  onOpenMap: () => void;
}

const TERRAIN_SEGMENTS = 256;
const DEM_ZOOM = 15;
const TILE_SIZE = 256;
const TERRAIN_EXAGGERATION = 2.5;

function toMercatorPixel(lat: number, lng: number, zoom: number): [number, number] {
  const scale = TILE_SIZE * 2 ** zoom;
  const clampedLat = Math.max(-85.0511, Math.min(85.0511, lat));
  const sinLat = Math.sin((clampedLat * Math.PI) / 180);
  return [
    ((lng + 180) / 360) * scale,
    (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
  ];
}

function localMeters(lat: number, lng: number, origin: LatLng): [number, number] {
  const metersPerLng = 111412.84 * Math.cos((origin[0] * Math.PI) / 180);
  return [(lng - origin[1]) * metersPerLng, (lat - origin[0]) * 111132.92];
}

function getFieldCenter(field: LatLng[], position: Props['position'], track: LatLng[]): LatLng {
  if (field.length > 0) {
    return [
      field.reduce((sum, point) => sum + point[0], 0) / field.length,
      field.reduce((sum, point) => sum + point[1], 0) / field.length,
    ];
  }
  if (track.length > 0) return track[0];
  if (position) return [position.lat, position.lng];
  return [52.2297, 21.0122];
}

function getFieldSize(field: LatLng[], center: LatLng): number {
  if (field.length < 2) return 600;
  const lngScale = 111412.84 * Math.cos((center[0] * Math.PI) / 180);
  const xs = field.map((point) => (point[1] - center[1]) * lngScale);
  const zs = field.map((point) => (center[0] - point[0]) * 111132.92);
  return Math.max(400, Math.min(1600, Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) + 240));
}

function tileRange(min: number, max: number): number[] {
  const first = Math.floor(min / TILE_SIZE);
  const last = Math.floor(max / TILE_SIZE);
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

function getTileKey(x: number, y: number, zoom: number): string {
  const count = 2 ** zoom;
  return `${((x % count) + count) % count}/${y}`;
}

function tileBoundaryLatLng(x: number, y: number, zoom: number): LatLng {
  const count = 2 ** zoom;
  const longitude = (x / count) * 360 - 180;
  const mercatorY = Math.PI * (1 - (2 * y) / count);
  const latitude = (180 / Math.PI) * Math.atan(Math.sinh(mercatorY));
  return [latitude, longitude];
}

function imageryRequestFor(
  center: LatLng,
  distance: number,
  viewportHeight: number,
  fov: number,
): ImageryRequest {
  const visibleHeight = 2 * distance * Math.tan((fov * Math.PI) / 360);
  const metersPerPixel = visibleHeight / Math.max(1, viewportHeight);
  const groundResolutionAtZoomZero = 156543.03392 * Math.cos((center[0] * Math.PI) / 180);
  const zoom = Math.max(16, Math.min(20, Math.floor(Math.log2(groundResolutionAtZoomZero / metersPerPixel))));
  const [worldX, worldY] = toMercatorPixel(center[0], center[1], zoom);
  const tileX = Math.floor(worldX / TILE_SIZE);
  const tileY = Math.floor(worldY / TILE_SIZE);
  return {
    key: `${zoom}:${tileX}:${tileY}`,
    center,
    zoom,
  };
}

function makeRampColor(value: number): THREE.Color {
  const clamped = Math.max(0, Math.min(1, value));
  return new THREE.Color().setHSL(0.34 * (1 - clamped), 0.82, 0.47);
}

async function loadTerrain(origin: LatLng, size: number, signal: AbortSignal): Promise<Terrain> {
  const half = size / 2;
  const latitudeOffset = half / 111132.92;
  const longitudeOffset = half / (111412.84 * Math.max(0.01, Math.cos((origin[0] * Math.PI) / 180)));
  const northWest = toMercatorPixel(origin[0] + latitudeOffset, origin[1] - longitudeOffset, DEM_ZOOM);
  const southEast = toMercatorPixel(origin[0] - latitudeOffset, origin[1] + longitudeOffset, DEM_ZOOM);
  const demXs = tileRange(northWest[0], southEast[0]);
  const demYs = tileRange(northWest[1], southEast[1]);
  const demTiles = new Map<string, ImageData>();

  await Promise.all(demYs.flatMap((tileY) => demXs.map(async (tileX) => {
    const bytes = await fetchCopernicusDemTile(DEM_ZOOM, tileX, tileY, signal);
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    try {
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Brak kontekstu Canvas do odczytu kafla DEM.');
      context.drawImage(bitmap, 0, 0);
      demTiles.set(getTileKey(tileX, tileY, DEM_ZOOM), context.getImageData(0, 0, canvas.width, canvas.height));
    } finally {
      bitmap.close();
    }
  })));

  const elevationAt = (lat: number, lng: number): number | null => {
    const [worldX, worldY] = toMercatorPixel(lat, lng, DEM_ZOOM);
    const tileX = Math.floor(worldX / TILE_SIZE);
    const tileY = Math.floor(worldY / TILE_SIZE);
    const image = demTiles.get(getTileKey(tileX, tileY, DEM_ZOOM));
    if (!image) throw new Error('Kafel DEM nie obejmuje całego obszaru terenu.');
    const pixelX = Math.min(image.width - 1, Math.max(0, Math.floor(worldX - tileX * TILE_SIZE)));
    const pixelY = Math.min(image.height - 1, Math.max(0, Math.floor(worldY - tileY * TILE_SIZE)));
    const offset = (pixelY * image.width + pixelX) * 4;
    if (image.data[offset + 3] === 0) return null;
    return image.data[offset] * 256 + image.data[offset + 1] + image.data[offset + 2] / 256 - 32768;
  };

  const elevations = new Float32Array((TERRAIN_SEGMENTS + 1) ** 2);
  const range = { min: Infinity, max: -Infinity };
  for (let row = 0; row <= TERRAIN_SEGMENTS; row++) {
    for (let column = 0; column <= TERRAIN_SEGMENTS; column++) {
      const x = (column / TERRAIN_SEGMENTS - 0.5) * size;
      const z = (row / TERRAIN_SEGMENTS - 0.5) * size;
      const elevation = elevationAt(
        origin[0] - z / 111132.92,
        origin[1] + x / (111412.84 * Math.cos((origin[0] * Math.PI) / 180)),
      );
      elevations[row * (TERRAIN_SEGMENTS + 1) + column] = elevation ?? Number.NaN;
      if (elevation !== null) {
        range.min = Math.min(range.min, elevation);
        range.max = Math.max(range.max, elevation);
      }
    }
  }

  const centerElevation = elevationAt(origin[0], origin[1]);
  if (centerElevation === null || !Number.isFinite(range.min) || !Number.isFinite(range.max)) {
    throw new Error('Copernicus DEM nie zawiera danych wysokościowych w centrum widoku.');
  }
  const sampleGrid = (lat: number, lng: number) => {
    const [x, northing] = localMeters(lat, lng, origin);
    const column = Math.max(0, Math.min(TERRAIN_SEGMENTS, (x / size + 0.5) * TERRAIN_SEGMENTS));
    const row = Math.max(0, Math.min(TERRAIN_SEGMENTS, (0.5 - northing / size) * TERRAIN_SEGMENTS));
    const x0 = Math.floor(column);
    const y0 = Math.floor(row);
    const x1 = Math.min(TERRAIN_SEGMENTS, x0 + 1);
    const y1 = Math.min(TERRAIN_SEGMENTS, y0 + 1);
    const tx = column - x0;
    const ty = row - y0;
    const samples = [
      [x0, y0, (1 - tx) * (1 - ty)],
      [x1, y0, tx * (1 - ty)],
      [x0, y1, (1 - tx) * ty],
      [x1, y1, tx * ty],
    ] as const;
    let weightedElevation = 0;
    let validWeight = 0;
    for (const [sampleX, sampleY, weight] of samples) {
      const elevation = elevations[sampleY * (TERRAIN_SEGMENTS + 1) + sampleX];
      if (Number.isFinite(elevation) && weight > 0) {
        weightedElevation += elevation * weight;
        validWeight += weight;
      }
    }
    return validWeight > 0 ? weightedElevation / validWeight : null;
  };
  const heightAt = (lat: number, lng: number) => {
    const elevation = sampleGrid(lat, lng);
    return elevation === null ? null : (elevation - centerElevation) * TERRAIN_EXAGGERATION;
  };
  const slopeAt = (lat: number, lng: number) => {
    const deltaLat = 10 / 111132.92;
    const deltaLng = 10 / (111412.84 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
    const west = elevationAt(lat, lng - deltaLng);
    const east = elevationAt(lat, lng + deltaLng);
    const south = elevationAt(lat - deltaLat, lng);
    const north = elevationAt(lat + deltaLat, lng);
    if (west === null || east === null || south === null || north === null) return null;
    return Math.hypot((east - west) / 20, (north - south) / 20) * 100;
  };

  const geometry = new THREE.PlaneGeometry(size, size, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
  const vertices = geometry.attributes.position;
  const terrainColor = new Float32Array(vertices.count * 3);
  const slopeColor = new Float32Array(vertices.count * 3);
  const validVertices = new Uint8Array(vertices.count);
  for (let index = 0; index < vertices.count; index++) {
    const x = vertices.getX(index);
    const northing = vertices.getY(index);
    const lat = origin[0] + northing / 111132.92;
    const lng = origin[1] + x / (111412.84 * Math.cos((origin[0] * Math.PI) / 180));
    const elevation = sampleGrid(lat, lng);
    const elevationRamp = makeRampColor(elevation === null ? 0 : (elevation - range.min) / Math.max(1, range.max - range.min));
    const slopeValue = elevation === null ? null : slopeAt(lat, lng);
    const slopeRamp = makeRampColor(slopeValue === null ? 0 : slopeValue / 12);
    terrainColor.set([elevationRamp.r, elevationRamp.g, elevationRamp.b], index * 3);
    slopeColor.set([slopeRamp.r, slopeRamp.g, slopeRamp.b], index * 3);
    if (elevation !== null) {
      validVertices[index] = 1;
      vertices.setZ(index, (elevation - centerElevation) * TERRAIN_EXAGGERATION);
    } else {
      vertices.setZ(index, 0);
    }
  }

  const sourceIndices = geometry.getIndex();
  if (!sourceIndices) throw new Error('Nie można utworzyć siatki terenu z danych DEM.');
  const validIndices: number[] = [];
  for (let index = 0; index < sourceIndices.count; index += 3) {
    const a = sourceIndices.getX(index);
    const b = sourceIndices.getX(index + 1);
    const c = sourceIndices.getX(index + 2);
    if (validVertices[a] && validVertices[b] && validVertices[c]) validIndices.push(a, b, c);
  }
  if (validIndices.length === 0) throw new Error('Copernicus DEM nie zawiera powierzchni do wyrenderowania.');
  geometry.setIndex(validIndices);
  geometry.setAttribute('elevationColor', new THREE.BufferAttribute(terrainColor, 3));
  geometry.setAttribute('slopeColor', new THREE.BufferAttribute(slopeColor, 3));
  geometry.rotateX(-Math.PI / 2);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const imageryZoom = 18;
  const [westPixel, northPixel] = toMercatorPixel(origin[0] + latitudeOffset, origin[1] - longitudeOffset, imageryZoom);
  const [eastPixel, southPixel] = toMercatorPixel(origin[0] - latitudeOffset, origin[1] + longitudeOffset, imageryZoom);
  const imageryXs = tileRange(westPixel, eastPixel);
  const imageryYs = tileRange(northPixel, southPixel);
  const baseX = Math.min(...imageryXs);
  const baseY = Math.min(...imageryYs);
  const imageryCanvas = document.createElement('canvas');
  imageryCanvas.width = imageryXs.length * TILE_SIZE;
  imageryCanvas.height = imageryYs.length * TILE_SIZE;
  const imageryContext = imageryCanvas.getContext('2d');
  if (!imageryContext) throw new Error('Brak kontekstu Canvas do obrazu satelitarnego.');
  const failedImages: string[] = [];
  await Promise.all(imageryYs.flatMap((tileY) => imageryXs.map(async (tileX) => {
    const wrappedX = ((tileX % 2 ** imageryZoom) + 2 ** imageryZoom) % 2 ** imageryZoom;
    const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${imageryZoom}/${tileY}/${wrappedX}`;
    try {
      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bitmap = await createImageBitmap(await response.blob());
      try {
        imageryContext.drawImage(bitmap, (tileX - baseX) * TILE_SIZE, (tileY - baseY) * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      } finally {
        bitmap.close();
      }
    } catch (error) {
      if (signal.aborted) throw error;
      failedImages.push(error instanceof Error ? error.message : 'Błąd kafla satelitarnego');
    }
  })));

  const satellite = new THREE.CanvasTexture(imageryCanvas);
  satellite.colorSpace = THREE.SRGBColorSpace;
  satellite.anisotropy = 4;
  satellite.minFilter = THREE.LinearMipmapLinearFilter;
  satellite.magFilter = THREE.LinearFilter;
  const uvs = geometry.attributes.uv;
  for (let index = 0; index < vertices.count; index++) {
    const x = vertices.getX(index);
    const z = vertices.getZ(index);
    const lat = origin[0] - z / 111132.92;
    const lng = origin[1] + x / (111412.84 * Math.cos((origin[0] * Math.PI) / 180));
    const [pixelX, pixelY] = toMercatorPixel(lat, lng, imageryZoom);
    uvs.setXY(
      index,
      (pixelX - baseX * TILE_SIZE) / imageryCanvas.width,
      1 - (pixelY - baseY * TILE_SIZE) / imageryCanvas.height,
    );
  }
  uvs.needsUpdate = true;

  return {
    geometry,
    satellite,
    slopeColors: slopeColor,
    elevationColors: terrainColor,
    minElevation: range.min,
    maxElevation: range.max,
    heightAt,
    slopeAt,
    elevationAt,
    satelliteWarning: failedImages.length ? 'Część kafli satelitarnych nie została pobrana.' : null,
  };
}

async function loadImageryPatch(
  request: ImageryRequest,
  origin: LatLng,
  terrainSize: number,
  terrain: Terrain,
  signal: AbortSignal,
): Promise<ImageryPatch> {
  const tileCount = 2 ** request.zoom;
  const [worldX, worldY] = toMercatorPixel(request.center[0], request.center[1], request.zoom);
  const centerTileX = Math.floor(worldX / TILE_SIZE);
  const centerTileY = Math.floor(worldY / TILE_SIZE);
  const firstTileX = centerTileX - 1;
  const firstTileY = Math.max(0, centerTileY - 1);
  const lastTileY = Math.min(tileCount - 1, centerTileY + 1);
  const rowCount = lastTileY - firstTileY + 1;
  const tileCanvas = document.createElement('canvas');
  tileCanvas.width = TILE_SIZE * 3;
  tileCanvas.height = TILE_SIZE * rowCount;
  const context = tileCanvas.getContext('2d');
  if (!context) throw new Error('Brak kontekstu Canvas do obrazu satelitarnego.');

  let missingTiles = 0;
  await Promise.all(Array.from({ length: rowCount }, (_, row) =>
    Array.from({ length: 3 }, async (_, column) => {
      const tileX = firstTileX + column;
      const tileY = firstTileY + row;
      const wrappedX = ((tileX % tileCount) + tileCount) % tileCount;
      const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${request.zoom}/${tileY}/${wrappedX}`;
      try {
        const response = await fetch(url, { signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bitmap = await createImageBitmap(await response.blob());
        try {
          context.drawImage(bitmap, column * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        } finally {
          bitmap.close();
        }
      } catch (error) {
        if (signal.aborted) throw error;
        missingTiles++;
      }
    }),
  ).flat());
  if (missingTiles === rowCount * 3) {
    throw new Error(`Nie udało się pobrać kafli satelitarnych Esri w zoomie ${request.zoom}.`);
  }

  const feather = context.createRadialGradient(
    tileCanvas.width / 2,
    tileCanvas.height / 2,
    Math.min(tileCanvas.width, tileCanvas.height) * 0.36,
    tileCanvas.width / 2,
    tileCanvas.height / 2,
    Math.min(tileCanvas.width, tileCanvas.height) * 0.72,
  );
  feather.addColorStop(0, 'rgba(255,255,255,1)');
  feather.addColorStop(0.75, 'rgba(255,255,255,0.96)');
  feather.addColorStop(1, 'rgba(255,255,255,0)');
  context.globalCompositeOperation = 'destination-in';
  context.fillStyle = feather;
  context.fillRect(0, 0, tileCanvas.width, tileCanvas.height);
  context.globalCompositeOperation = 'source-over';

  const northWest = tileBoundaryLatLng(firstTileX, firstTileY, request.zoom);
  const southEast = tileBoundaryLatLng(centerTileX + 2, lastTileY + 1, request.zoom);
  const [westX] = localMeters(northWest[0], northWest[1], origin);
  const [eastX] = localMeters(southEast[0], southEast[1], origin);
  const northingNorth = (northWest[0] - origin[0]) * 111132.92;
  const northingSouth = (southEast[0] - origin[0]) * 111132.92;
  const minX = Math.max(-terrainSize / 2, westX);
  const maxX = Math.min(terrainSize / 2, eastX);
  const minNorthing = Math.max(-terrainSize / 2, northingSouth);
  const maxNorthing = Math.min(terrainSize / 2, northingNorth);
  if (maxX <= minX || maxNorthing <= minNorthing) {
    throw new Error('Kafle satelitarne nie obejmują widocznego terenu.');
  }

  const centerX = (minX + maxX) / 2;
  const centerNorthing = (minNorthing + maxNorthing) / 2;
  const patchGeometry = new THREE.PlaneGeometry(maxX - minX, maxNorthing - minNorthing, 96, 96);
  const vertices = patchGeometry.attributes.position;
  const uvs = patchGeometry.attributes.uv;
  const validVertices = new Uint8Array(vertices.count);
  for (let index = 0; index < vertices.count; index++) {
    const x = centerX + vertices.getX(index);
    const northing = centerNorthing + vertices.getY(index);
    const lat = origin[0] + northing / 111132.92;
    const lng = origin[1] + x / (111412.84 * Math.cos((origin[0] * Math.PI) / 180));
    const height = terrain.heightAt(lat, lng);
    if (height !== null) {
      vertices.setZ(index, height + 0.14);
      validVertices[index] = 1;
    } else {
      vertices.setZ(index, 0);
    }
    const [pixelX, pixelY] = toMercatorPixel(lat, lng, request.zoom);
    uvs.setXY(
      index,
      (pixelX - firstTileX * TILE_SIZE) / tileCanvas.width,
      1 - (pixelY - firstTileY * TILE_SIZE) / tileCanvas.height,
    );
  }
  const sourceIndices = patchGeometry.getIndex();
  if (!sourceIndices) throw new Error('Nie można utworzyć geometrii szczegółowych kafli satelitarnych.');
  const validIndices: number[] = [];
  for (let index = 0; index < sourceIndices.count; index += 3) {
    const a = sourceIndices.getX(index);
    const b = sourceIndices.getX(index + 1);
    const c = sourceIndices.getX(index + 2);
    if (validVertices[a] && validVertices[b] && validVertices[c]) validIndices.push(a, b, c);
  }
  patchGeometry.setIndex(validIndices);
  patchGeometry.translate(centerX, centerNorthing, 0);
  patchGeometry.rotateX(-Math.PI / 2);
  patchGeometry.computeVertexNormals();
  patchGeometry.computeBoundingSphere();

  const texture = new THREE.CanvasTexture(tileCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return { geometry: patchGeometry, texture, zoom: request.zoom, missingTiles };
}

function useTerrain(origin: LatLng, size: number, reload: number) {
  const [result, setResult] = useState<{ key: string; terrain: Terrain | null; error: string | null }>({ key: '', terrain: null, error: null });
  const key = `${origin[0]}:${origin[1]}:${size}:${reload}`;
  useEffect(() => {
    const controller = new AbortController();
    void loadTerrain(origin, size, controller.signal).then(
      (terrain) => setResult({ key, terrain, error: null }),
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setResult({ key, terrain: null, error: error instanceof Error ? error.message : 'Nie udało się pobrać rzeczywistego DEM.' });
        }
      },
    );
    return () => controller.abort();
  }, [key, origin, size, reload]);
  useEffect(() => () => {
    result.terrain?.geometry.dispose();
    result.terrain?.satellite.dispose();
  }, [result.terrain]);
  return result.key === key ? result : { terrain: null, error: null };
}

function useImageryPatch(
  request: ImageryRequest | null,
  origin: LatLng,
  size: number,
  terrain: Terrain | null,
) {
  const [result, setResult] = useState<{ key: string; patch: ImageryPatch | null; error: string | null }>({
    key: '',
    patch: null,
    error: null,
  });
  useEffect(() => {
    if (!request || !terrain) return;
    const controller = new AbortController();
    void loadImageryPatch(request, origin, size, terrain, controller.signal).then(
      (patch) => setResult({ key: request.key, patch, error: null }),
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setResult({
            key: request.key,
              patch: null,
            error: error instanceof Error ? error.message : 'Nie udało się pobrać szczegółowych kafli Esri.',
          });
        }
      },
    );
    return () => controller.abort();
  }, [request, origin, size, terrain]);
  useEffect(() => () => {
    result.patch?.geometry.dispose();
    result.patch?.texture.dispose();
  }, [result.patch]);
  return {
    patch: result.patch,
    error: result.key === request?.key ? result.error : null,
  };
}

function TerrainMesh({ terrain, view }: { terrain: Terrain; view: ViewMode }) {
  const geometry = useMemo(() => {
    const copy = terrain.geometry.clone();
    if (view === 'slope') copy.setAttribute('color', new THREE.BufferAttribute(terrain.slopeColors, 3));
    else if (view === 'elevation') copy.setAttribute('color', new THREE.BufferAttribute(terrain.elevationColors, 3));
    else copy.deleteAttribute('color');
    return copy;
  }, [terrain, view]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial map={terrain.satellite} vertexColors={view !== 'satellite'} roughness={0.95} />
    </mesh>
  );
}

function ImageryMesh({ patch }: { patch: ImageryPatch }) {
  return (
    <mesh geometry={patch.geometry} renderOrder={1}>
      <meshStandardMaterial
        map={patch.texture}
        transparent
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-1}
        roughness={0.92}
      />
    </mesh>
  );
}

function TerrainPath({
  points, origin, terrain, color, width,
}: {
  points: LatLng[];
  origin: LatLng;
  terrain: Terrain;
  color: string;
  width: number;
}) {
  const object = useMemo(() => {
    if (points.length < 2) return null;
    const vertices: THREE.Vector3[] = [];
    for (let index = 1; index < points.length; index++) {
      const [startLat, startLng] = points[index - 1];
      const [endLat, endLng] = points[index];
      const startHeight = terrain.heightAt(startLat, startLng);
      const endHeight = terrain.heightAt(endLat, endLng);
      if (startHeight === null || endHeight === null) continue;
      const [startX, startNorthing] = localMeters(startLat, startLng, origin);
      const [endX, endNorthing] = localMeters(endLat, endLng, origin);
      vertices.push(
        new THREE.Vector3(startX, startHeight + 0.5, -startNorthing),
        new THREE.Vector3(endX, endHeight + 0.5, -endNorthing),
      );
    }
    if (vertices.length === 0) return null;
    const geometry = new THREE.BufferGeometry().setFromPoints(vertices);
    return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color, linewidth: width }));
  }, [points, origin, terrain, color, width]);
  useEffect(() => () => {
    object?.geometry.dispose();
    (object?.material as THREE.Material | undefined)?.dispose();
  }, [object]);
  return object ? <primitive object={object} /> : null;
}

function Paths({
  origin, terrain, field, lines, activeLabel, doneLabels, track,
}: {
  origin: LatLng;
  terrain: Terrain;
  field: LatLng[];
  lines: GuidanceLine[];
  activeLabel: string | null;
  doneLabels: string[];
  track: LatLng[];
}) {
  return (
    <group>
      {field.length > 2 && <TerrainPath points={[...field, field[0]]} origin={origin} terrain={terrain} color="#fbbf24" width={2} />}
      {lines.flatMap((line) => line.segments.map((segment, index) => (
        <TerrainPath
          key={`${line.label}-${index}`}
          points={segment}
          origin={origin}
          terrain={terrain}
          color={line.label === activeLabel ? '#00ff78' : doneLabels.includes(line.label) ? '#67e8f9' : '#ffffff'}
          width={line.label === activeLabel ? 3 : 1}
        />
      )))}
      {track.length > 1 && <TerrainPath points={track} origin={origin} terrain={terrain} color="#f97316" width={2} />}
    </group>
  );
}

function Tractor({
  position, origin, terrain, heading, width,
}: {
  position: Props['position'];
  origin: LatLng;
  terrain: Terrain;
  heading: number | null;
  width: number;
}) {
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!group.current || !position) return;
    const [x, northing] = localMeters(position.lat, position.lng, origin);
    const height = terrain.heightAt(position.lat, position.lng);
    group.current.visible = height !== null;
    if (height === null) return;
    group.current.position.set(x, height, -northing);
    if (heading !== null && Number.isFinite(heading)) group.current.rotation.y = Math.PI - (heading * Math.PI) / 180;
  });
  const wheelRadius = 0.65;
  return (
    <group ref={group}>
      <mesh position={[0, 0.95, 0]} castShadow>
        <boxGeometry args={[1.7, 0.6, 3.2]} />
        <meshStandardMaterial color="#198b38" roughness={0.55} />
      </mesh>
      <mesh position={[0, 1.65, -0.25]} castShadow>
        <boxGeometry args={[1.25, 1.1, 1.35]} />
        <meshStandardMaterial color="#173e4a" roughness={0.28} metalness={0.15} />
      </mesh>
      <mesh position={[0, 2.23, -0.25]}>
        <boxGeometry args={[1.35, 0.12, 1.45]} />
        <meshStandardMaterial color="#72b82b" />
      </mesh>
      {[-0.92, 0.92].flatMap((x) => [-0.92, 0.98].map((z) => (
        <mesh key={`${x}-${z}`} position={[x, wheelRadius, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[wheelRadius, wheelRadius, 0.34, 16]} />
          <meshStandardMaterial color="#15191a" roughness={0.94} />
        </mesh>
      )))}
      <mesh position={[0, 0.55, 2.1]}>
        <boxGeometry args={[Math.max(2.5, width), 0.12, 0.45]} />
        <meshStandardMaterial color="#334155" metalness={0.4} roughness={0.55} />
      </mesh>
    </group>
  );
}

function CameraRig({
  position, origin, terrain, heading, mode, size, zoomFactor, onImageryRequest,
}: {
  position: Props['position'];
  origin: LatLng;
  terrain: Terrain;
  heading: number | null;
  mode: CameraMode;
  size: number;
  zoomFactor: number;
  onImageryRequest: (request: ImageryRequest) => void;
}) {
  const camera = useRef<THREE.PerspectiveCamera>(null);
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const lastImageryKey = useRef('');
  const viewport = useThree((state) => state.size);
  useFrame(() => {
    if (!camera.current) return;
    let target: THREE.Vector3;
    let expectedDistance: number;
    if (mode !== 'free') {
      const lat = position?.lat ?? origin[0];
      const lng = position?.lng ?? origin[1];
      const [x, northing] = localMeters(lat, lng, origin);
      const z = -northing;
      const elevation = terrain.heightAt(lat, lng) ?? terrain.heightAt(origin[0], origin[1]) ?? 0;
      const bearing = heading !== null && Number.isFinite(heading) ? (heading * Math.PI) / 180 : 0;
      const distance = Math.max(12, size * (mode === 'top-down' ? 0.42 : 0.16) / zoomFactor);
      target = new THREE.Vector3(x, elevation + 1.5, z);
      const destination = mode === 'top-down'
        ? new THREE.Vector3(x, elevation + distance, z + 0.01)
        : mode === 'north-up'
          ? new THREE.Vector3(x + distance * 0.45, elevation + distance * 0.7, z + distance)
          : new THREE.Vector3(x - Math.sin(bearing) * distance, elevation + distance * 0.58, z + Math.cos(bearing) * distance);
      expectedDistance = destination.distanceTo(target);
      camera.current.position.lerp(destination, 0.12);
      camera.current.lookAt(target);
      if (controls.current) {
        controls.current.target.lerp(target, 0.12);
        controls.current.update();
      }
    } else {
      target = controls.current?.target ?? new THREE.Vector3();
      expectedDistance = camera.current.position.distanceTo(target);
    }
    const center: LatLng = [
      origin[0] - target.z / 111132.92,
      origin[1] + target.x / (111412.84 * Math.cos((origin[0] * Math.PI) / 180)),
    ];
    const request = imageryRequestFor(center, expectedDistance, viewport.height, camera.current.fov);
    if (request.key !== lastImageryKey.current) {
      lastImageryKey.current = request.key;
      onImageryRequest(request);
    }
  });
  return (
    <>
      <PerspectiveCamera ref={camera} makeDefault fov={50} position={[0, size * 0.45, size * 0.25]} />
      <OrbitControls
        ref={controls}
        enabled={mode === 'free'}
        enablePan
        maxPolarAngle={Math.PI / 2.03}
        minDistance={Math.max(4, size * 0.16 / 8)}
        maxDistance={size * 1.5}
      />
    </>
  );
}

class SceneBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    if (this.state.error) {
      return <div role="alert" className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950 p-6 text-center text-sm text-amber-200">Nie można uruchomić sceny 3D: {this.state.error}</div>;
    }
    return this.props.children;
  }
}

export function FieldPilot3DNavigation(props: Props) {
  const {
    position, track, fieldGeo, guidanceLines, activeLabel, doneLabels, info, implementWidth,
    heading, speedKmh, isDemo, night, accuracyM, satellites, fixLabel, paused,
    onTogglePause, onStop, onOpenMap,
  } = props;
  const [origin, setOrigin] = useState<LatLng>(() => getFieldCenter(fieldGeo, position, track));
  const originWasKnownRef = useRef(fieldGeo.length > 0 || track.length > 0 || position !== null);
  const [cameraMode, setCameraMode] = useState<CameraMode>('follow');
  const [view, setView] = useState<ViewMode>('satellite');
  const [reload, setReload] = useState(0);
  const [zoomFactor, setZoomFactor] = useState(1);
  const [imageryRequest, setImageryRequest] = useState<ImageryRequest | null>(null);
  useEffect(() => {
    if (!originWasKnownRef.current && position) {
      setOrigin([position.lat, position.lng]);
      originWasKnownRef.current = true;
    }
  }, [position]);

  const size = useMemo(() => getFieldSize(fieldGeo, origin), [fieldGeo, origin]);
  const { terrain, error } = useTerrain(origin, size, reload);
  const { patch: imageryPatch, error: imageryError } = useImageryPatch(imageryRequest, origin, size, terrain);
  const readout = useMemo(() => {
    if (!terrain) return null;
    const samplePosition = position ? [position.lat, position.lng] as LatLng : origin;
    return {
      elevation: terrain.elevationAt(samplePosition[0], samplePosition[1]),
      slope: terrain.slopeAt(samplePosition[0], samplePosition[1]),
    };
  }, [origin, position?.lat, position?.lng, terrain]);

  const steerColor = info.steer === 'center' ? '#34d399' : Math.abs(info.xte) > 1 ? '#f87171' : '#fbbf24';
  return (
    <div className="absolute inset-0 overflow-hidden bg-slate-950 text-white" data-testid="fieldpilot-three-scene">
      <SceneBoundary>
        {terrain && (
          <Canvas shadows dpr={[1, 2]} camera={{ fov: 50, position: [0, size * 0.45, size * 0.25] }} gl={{ antialias: true, powerPreference: 'high-performance' }}>
            <CameraRig
              position={position}
              origin={origin}
              terrain={terrain}
              heading={heading}
              mode={cameraMode}
              size={size}
              zoomFactor={zoomFactor}
              onImageryRequest={setImageryRequest}
            />
            <Sky sunPosition={night ? [-100, -10, -100] : [100, 40, 100]} />
            <fog attach="fog" args={[night ? '#020617' : '#c6d9e8', size * 0.8, size * 3]} />
            <ambientLight intensity={night ? 0.45 : 0.8} />
            <directionalLight position={[30, 70, 25]} intensity={night ? 0.75 : 1.5} castShadow />
            <TerrainMesh terrain={terrain} view={view} />
            {view === 'satellite' && imageryPatch && <ImageryMesh patch={imageryPatch} />}
            <Paths origin={origin} terrain={terrain} field={fieldGeo} lines={guidanceLines} activeLabel={activeLabel} doneLabels={doneLabels} track={track} />
            {position && <Tractor position={position} origin={origin} terrain={terrain} heading={heading} width={implementWidth} />}
          </Canvas>
        )}
      </SceneBoundary>

      {!terrain && !error && <div role="status" className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/80 p-6 text-center text-sm text-slate-200">Pobieram rzeczywiste kafle Esri i Copernicus DEM…</div>}
      {error && (
        <div role="alert" className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-slate-950/95 p-6 text-center">
          <div className="max-w-lg text-sm text-amber-200">Nie udało się załadować rzeczywistego terenu 3D: {error}</div>
          <div className="text-xs text-slate-400">Widok nie zastępuje DEM płaską ani symulowaną powierzchnią.</div>
          <button onClick={() => setReload((value) => value + 1)} className="min-h-11 rounded-xl bg-emerald-700 px-4 text-sm font-bold">PONÓW ŁADOWANIE</button>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-2 top-2 flex items-start justify-between gap-2">
        <div className="rounded-xl border border-white/10 bg-slate-950/75 px-3 py-2 text-[10px] shadow-lg backdrop-blur-md">
          <div className="font-black text-emerald-300">{isDemo ? '🧪 DEMO · GPS SYMULOWANY' : `📡 ${fixLabel}`}</div>
          <div className="mt-1 text-slate-200">± {accuracyM == null || isDemo ? '—' : `${accuracyM.toFixed(1)} m`} · {satellites ?? '—'} SAT</div>
          <div className="text-slate-200">{speedKmh.toFixed(1)} km/h · {heading == null ? '—' : `${Math.round(heading)}°`}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-slate-950/75 px-3 py-2 text-right text-[10px] shadow-lg backdrop-blur-md">
          <div className="font-bold text-emerald-300">{info.activeLine?.label ?? 'NO LINE'}</div>
          <div>{readout ? `${readout.elevation === null ? 'NO DATA' : `${readout.elevation.toFixed(0)} m · ${readout.slope === null ? '—' : `${readout.slope.toFixed(1)}%`}`}` : 'DEM'}</div>
          <div>{terrain ? `Copernicus DEM · ${terrain.minElevation.toFixed(0)}–${terrain.maxElevation.toFixed(0)} m` : 'Ładowanie DEM'}</div>
          <div>{imageryPatch ? `Esri SAT · z${imageryPatch.zoom}` : imageryRequest ? `Esri SAT · z${imageryRequest.zoom} · ładowanie…` : 'Esri SAT · z18'}</div>
          <div className="text-slate-400">Rzeźba wizualna ×{TERRAIN_EXAGGERATION}</div>
          {imageryError && <div role="status" className="max-w-40 text-amber-300">Brak zbliżonych kafli: {imageryError}</div>}
        </div>
      </div>

      {terrain && (
        <>
          <div className="absolute right-2 top-1/2 flex -translate-y-1/2 flex-col gap-1.5">
            {(['follow', 'north-up', 'top-down', 'free'] as const).map((mode) => (
              <button key={mode} onClick={() => setCameraMode(mode)} className={`min-h-10 min-w-12 rounded-xl border px-2 text-[9px] font-black backdrop-blur-md ${cameraMode === mode ? 'border-emerald-300 bg-emerald-700/90' : 'border-white/15 bg-slate-950/75'}`}>
                {mode === 'north-up' ? 'NORTH' : mode.toUpperCase()}
              </button>
            ))}
            <button
              onClick={() => setZoomFactor((value) => Math.min(8, value * 1.5))}
              disabled={cameraMode === 'free' || zoomFactor >= 8}
              className="min-h-10 min-w-12 rounded-xl border border-white/15 bg-slate-950/75 px-2 text-base font-black backdrop-blur-md disabled:opacity-40"
              aria-label="Przybliż widok terenu 3D"
              title={cameraMode === 'free' ? 'W trybie FREE użyj kółka myszy lub gestu szczypania' : 'Przybliż widok i pobierz dokładniejsze kafle satelitarne'}
            >
              +
            </button>
            <button
              onClick={() => setZoomFactor((value) => Math.max(1, value / 1.5))}
              disabled={cameraMode === 'free' || zoomFactor <= 1}
              className="min-h-10 min-w-12 rounded-xl border border-white/15 bg-slate-950/75 px-2 text-base font-black backdrop-blur-md disabled:opacity-40"
              aria-label="Oddal widok terenu 3D"
            >
              −
            </button>
            <button onClick={() => setView((value) => value === 'satellite' ? 'slope' : value === 'slope' ? 'elevation' : 'satellite')} className="min-h-10 rounded-xl border border-white/15 bg-slate-950/75 px-2 text-[9px] font-black backdrop-blur-md">
              {view.toUpperCase()}
            </button>
            <button onClick={onOpenMap} className="min-h-10 rounded-xl border border-white/15 bg-slate-950/75 px-2 text-[9px] font-black backdrop-blur-md">MAPLIBRE</button>
          </div>
          {terrain.satelliteWarning && <div role="status" className="absolute bottom-16 left-2 rounded-lg bg-amber-950/85 px-2 py-1 text-[9px] text-amber-200">{terrain.satelliteWarning}</div>}
          {view !== 'satellite' && (
            <div className="absolute left-2 top-28 rounded-lg border border-white/10 bg-slate-950/75 px-2 py-2 text-[9px] backdrop-blur-md">
              {view === 'slope' ? 'NACHYLENIE 0–12%+' : `WYSOKOŚĆ ${terrain.minElevation.toFixed(0)}–${terrain.maxElevation.toFixed(0)} m`}
              <div className="mt-1 h-2 w-28 rounded" style={{ background: 'linear-gradient(90deg,#159447,#d7d72b,#ed8e1c,#dd3229)' }} />
            </div>
          )}
        </>
      )}

      <div className="absolute inset-x-2 bottom-2 flex items-center gap-2">
        <div className="flex min-h-11 flex-1 items-center justify-around gap-2 rounded-xl border border-white/10 bg-slate-950/80 px-2 text-[10px] backdrop-blur-md">
          <span className="font-black">{info.activeLine?.label ?? '—'}</span>
          <span style={{ color: steerColor }}>{Math.abs(info.xte).toFixed(2)} m {info.steer === 'left' ? '←' : info.steer === 'right' ? '→' : '●'}</span>
          <span>{implementWidth.toFixed(1)} m</span>
          {info.distanceToEnd > 0 && <span>{info.distanceToEnd.toFixed(0)} m</span>}
        </div>
        <button onClick={onTogglePause} className="min-h-11 rounded-xl bg-amber-600 px-3 text-xs font-black">{paused ? '▶' : 'Ⅱ'}</button>
        <button onClick={onStop} className="min-h-11 rounded-xl bg-red-600 px-3 text-xs font-black">STOP</button>
      </div>
    </div>
  );
}

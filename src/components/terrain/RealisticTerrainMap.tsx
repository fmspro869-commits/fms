import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Component, type ReactNode } from 'react';
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Field } from '@/types';
import type { GuidanceGeometry } from '@/geometry/guidance';
import { NavigationMap } from '@/components/fieldpilot/NavigationMap';
import type { MapHandle } from '@/components/fieldpilot/NavigationMap';
import { fetchCopernicusDemTile } from './copernicusDem';
import {
  fieldCenter,
  fieldFeature,
  fieldsFeature,
  guidanceFeatures,
  guidanceLabelFeatures,
  headingFeature,
  coverageFeatures,
  pointMarkersFeature,
  trackFeature,
} from './fieldGeometry';
import { colorizeTerrariumPixels, fieldMaskTileUrl } from './slopeTiles';

const DEFAULT_CENTER: [number, number] = [0, 0];
const SLOPE_TILE_CACHE_LIMIT = 48;
const slopeTileCache = new Map<string, ArrayBuffer>();
let slopeProtocolRegistered = false;
let copernicusProtocolRegistered = false;
let transparentSlopeTile: Promise<ArrayBuffer> | null = null;

function getTransparentSlopeTile(): Promise<ArrayBuffer> {
  if (!transparentSlopeTile) {
    transparentSlopeTile = new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      canvas.toBlob((blob) => {
        if (blob) void blob.arrayBuffer().then(resolve, reject);
        else reject(new Error('Nie udało się utworzyć pustego kafla nachylenia.'));
      }, 'image/png');
    });
  }
  return transparentSlopeTile;
}

function registerSlopeTileProtocol(): void {
  if (slopeProtocolRegistered) return;
  maplibregl.addProtocol('fms-slope', async (request, abortController) => {
    const requestUrl = new URL(request.url);
    const [, zoomValue, xValue, yFile] = requestUrl.pathname.split('/');
    const zoom = Number(zoomValue);
    const tileX = Number(xValue);
    const tileY = Number(yFile?.replace(/\.png$/, ''));
    const field = JSON.parse(requestUrl.searchParams.get('field') ?? '[]') as [number, number][];
    if (!Number.isInteger(zoom) || !Number.isInteger(tileX) || !Number.isInteger(tileY)) {
      throw new Error('Nieprawidłowy adres kafla nachylenia terenu.');
    }
    if (field.length === 0) return { data: (await getTransparentSlopeTile()).slice(0) };
    if (field.length < 3) throw new Error('Granica pola wymaga co najmniej trzech punktów.');

    const cacheKey = request.url;
    const cached = slopeTileCache.get(cacheKey);
    if (cached) {
      slopeTileCache.delete(cacheKey);
      slopeTileCache.set(cacheKey, cached);
      return { data: cached.slice(0) };
    }

    const demTile = await fetchCopernicusDemTile(zoom, tileX, tileY, abortController.signal);
    const bitmap = await createImageBitmap(new Blob([demTile], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      bitmap.close();
      throw new Error('Nie można utworzyć kontekstu Canvas do analizy DEM.');
    }
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const image = context.getImageData(0, 0, 256, 256);
    colorizeTerrariumPixels(image.data, zoom, tileX, tileY, field);
    context.putImageData(image, 0, 0);
    const colorizedBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Nie udało się wygenerować nakładki nachylenia.'));
      }, 'image/png');
    });
    const data = await colorizedBlob.arrayBuffer();
    slopeTileCache.set(cacheKey, data);
    if (slopeTileCache.size > SLOPE_TILE_CACHE_LIMIT) {
      const oldestKey = slopeTileCache.keys().next().value;
      if (oldestKey) slopeTileCache.delete(oldestKey);
    }
    return { data: data.slice(0) };
  });
  slopeProtocolRegistered = true;
}

function registerCopernicusDemProtocol(): void {
  if (copernicusProtocolRegistered) return;
  maplibregl.addProtocol('fms-copdem', async (request, abortController) => {
    const [, zoomValue, xValue, yFile] = new URL(request.url).pathname.split('/');
    const zoom = Number(zoomValue);
    const tileX = Number(xValue);
    const tileY = Number(yFile?.replace(/\.png$/, ''));
    if (!Number.isInteger(zoom) || !Number.isInteger(tileX) || !Number.isInteger(tileY)) {
      throw new Error('Nieprawidłowy adres kafla DEM Copernicus.');
    }
    return { data: await fetchCopernicusDemTile(zoom, tileX, tileY, abortController.signal) };
  });
  copernicusProtocolRegistered = true;
}

const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
  sources: {
    satellite: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '&copy; Esri, Maxar, Earthstar Geographics',
    },
    terrainDem: {
      type: 'raster-dem',
      tiles: ['fms-copdem://terrain/{z}/{x}/{y}.png'],
      tileSize: 256,
      minzoom: 9,
      maxzoom: 15,
      encoding: 'terrarium',
      attribution: 'Copernicus DEM GLO-30 &copy; European Union/Copernicus; tiles via Microsoft Planetary Computer',
    },
    slopeRelief: {
      type: 'raster',
      tiles: [fieldMaskTileUrl([])],
      tileSize: 256,
      minzoom: 10,
      maxzoom: 15,
      attribution: 'Copernicus DEM GLO-30 &copy; European Union/Copernicus; nachylenie obliczone z DEM',
    },
    selectedField: {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    },
    guidanceLines: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    guidanceLabels: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    fieldTrack: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    workingCoverage: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    vehicleHeading: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    abPoints: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
  },
  layers: [
    { id: 'satellite-imagery', type: 'raster', source: 'satellite' },
    {
      id: 'terrain-hillshade',
      type: 'hillshade',
      source: 'terrainDem',
      paint: {
        'hillshade-exaggeration': 0.25,
        'hillshade-shadow-color': '#16202a',
        'hillshade-highlight-color': '#fff7dc',
      },
    },
    {
      id: 'field-slope-relief',
      type: 'raster',
      source: 'slopeRelief',
      paint: { 'raster-opacity': 0.78, 'raster-fade-duration': 0 },
    },
    {
      id: 'field-fill',
      type: 'fill',
      source: 'selectedField',
      paint: {
        'fill-color': ['case', ['get', 'draft'], '#10b981', ['get', 'selected'], '#10b981', '#fbbf24'],
        'fill-opacity': ['case', ['get', 'selected'], 0.18, 0.1],
      },
    },
    {
      id: 'working-coverage',
      type: 'fill',
      source: 'workingCoverage',
      paint: {
        'fill-color': '#22c55e',
        'fill-opacity': 0.28,
        'fill-outline-color': '#86efac',
      },
    },
    {
      id: 'field-outline',
      type: 'line',
      source: 'selectedField',
      paint: {
        'line-color': ['case', ['get', 'draft'], '#10b981', ['get', 'selected'], '#10b981', '#fbbf24'],
        'line-width': ['case', ['get', 'selected'], 3, 2],
        'line-blur': 0.5,
      },
    },
    {
      id: 'field-labels',
      type: 'symbol',
      source: 'selectedField',
      layout: {
        'text-field': ['get', 'name'],
        'text-size': 13,
        'text-font': ['Open Sans Bold'],
        'text-allow-overlap': true,
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': '#0f172a',
        'text-halo-width': 2,
      },
    },
    {
      id: 'guidance-lines',
      type: 'line',
      source: 'guidanceLines',
      paint: {
        'line-color': ['case', ['get', 'active'], '#00ff78', ['get', 'done'], '#a8f4d3', '#ffffff'],
        'line-width': ['case', ['get', 'active'], 5, 2.4],
        'line-opacity': ['case', ['get', 'done'], 0.7, 0.95],
      },
    },
    {
      id: 'guidance-labels',
      type: 'symbol',
      source: 'guidanceLabels',
      minzoom: 14,
      layout: {
        'text-field': ['get', 'label'],
        'text-size': 12,
        'text-font': ['Open Sans Bold'],
        'text-offset': [0, -0.9],
        'text-allow-overlap': true,
      },
      paint: {
        'text-color': '#f8fafc',
        'text-halo-color': '#0f172a',
        'text-halo-width': 2,
      },
    },
    {
      id: 'field-track',
      type: 'line',
      source: 'fieldTrack',
      paint: { 'line-color': '#38bdf8', 'line-width': 4, 'line-opacity': 0.95 },
    },
    {
      id: 'vehicle-heading',
      type: 'line',
      source: 'vehicleHeading',
      paint: { 'line-color': '#fb923c', 'line-width': 4 },
    },
    {
      id: 'ab-point-circles',
      type: 'circle',
      source: 'abPoints',
      paint: {
        'circle-radius': 9,
        'circle-color': ['match', ['get', 'kind'], 'a', '#16a34a', 'b', '#dc2626', '#16a34a'],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
      },
    },
    {
      id: 'ab-point-labels',
      type: 'symbol',
      source: 'abPoints',
      layout: {
        'text-field': ['get', 'label'],
        'text-size': 11,
        'text-font': ['Open Sans Bold'],
      },
      paint: { 'text-color': '#ffffff' },
    },
  ],
};

function makeTractorMarker(): HTMLDivElement {
  const element = document.createElement('div');
  element.setAttribute('aria-label', 'Pozycja ciągnika');
  element.style.width = '48px';
  element.style.height = '58px';
  element.style.filter = 'drop-shadow(0 2px 4px rgba(0,0,0,.85))';
  element.innerHTML = `
    <svg viewBox="0 0 48 58" width="48" height="58" aria-hidden="true">
      <path d="M24 1v13" stroke="#afff47" stroke-width="3" stroke-linecap="round"/>
      <path d="M24 14 L17 27 L31 27 Z" fill="#afff47" fill-opacity=".22"/>
      <rect x="6" y="34" width="9" height="18" rx="4" fill="#17191c" stroke="#d7e0e3" stroke-width="1.2"/>
      <rect x="33" y="34" width="9" height="18" rx="4" fill="#17191c" stroke="#d7e0e3" stroke-width="1.2"/>
      <rect x="13" y="20" width="22" height="29" rx="5" fill="#69c918" stroke="#e4f2d6" stroke-width="1.5"/>
      <path d="M16 24 Q16 22 19 22h10q3 0 3 3v10H16Z" fill="#173f4d" stroke="#d7e0e3" stroke-width="1.2"/>
      <path d="M19 25h10v7H19z" fill="#8ad7ea" fill-opacity=".72"/>
      <path d="M18 41h12v5H18z" fill="#f5c634" stroke="#fff2bd" stroke-width="1"/>
      <rect x="8" y="49" width="32" height="3" rx="1.5" fill="#f4c22d"/>
      <circle cx="24" cy="18" r="2.4" fill="#fff"/>
    </svg>`;
  return element;
}

interface Props {
  field?: Field;
  fields?: Field[];
  selectedFieldId?: string;
  fieldGeo?: [number, number][];
  draftGeo?: [number, number][];
  center?: [number, number];
  onFieldClick?: (id: string) => void;
  geometry?: GuidanceGeometry | null;
  activeLabel?: string | null;
  doneLabels?: string[];
  position?: { lng: number; lat: number; heading: number | null } | null;
  track?: [number, number][];
  swaths?: [number, number][][];
  pointA?: [number, number] | null;
  pointB?: [number, number] | null;
  follow?: boolean;
  courseUp?: boolean;
  onMapClick?: (lat: number, lng: number) => void;
  onLineClick?: (label: string) => void;
  fullscreen?: boolean;
  exaggeration: number;
  cameraMode?: 'follow' | 'free' | 'north-up' | 'course-up' | 'top-down';
  onTerrainReadout?: (readout: { elevation: number | null; slopePercent: number | null }) => void;
}

class TerrainMapErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; errorMessage: string | null }
> {
  state = { hasError: false, errorMessage: null as string | null };

  static getDerivedStateFromError(error: Error): { hasError: boolean; errorMessage: string } {
    return { hasError: true, errorMessage: error.message };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div role="alert" className="flex min-h-[420px] flex-col items-center justify-center gap-2 rounded-xl border border-amber-500/40 bg-slate-950 p-6 text-center text-sm text-amber-200">
          <span>Widok 3D został wyłączony po błędzie renderowania.</span>
          {this.state.errorMessage && <span className="max-w-full break-words text-xs text-amber-100/80">{this.state.errorMessage}</span>}
          <span className="text-xs text-slate-400">Przełącz na 2D, aby kontynuować nawigację.</span>
        </div>
      );
    }
    return this.props.children;
  }
}

const RealisticTerrainMapRenderer = forwardRef<MapHandle, Props>(function RealisticTerrainMapRenderer({
  field,
  fields,
  selectedFieldId,
  fieldGeo,
  draftGeo = [],
  center,
  onFieldClick,
  geometry = null,
  activeLabel = null,
  doneLabels = [],
  position = null,
  track = [],
  swaths = [],
  pointA = null,
  pointB = null,
  follow = false,
  courseUp = false,
  onMapClick,
  onLineClick,
  fullscreen = false,
  exaggeration,
  cameraMode = 'follow',
  onTerrainReadout,
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const tractorMarkerRef = useRef<maplibregl.Marker | null>(null);
  const lastFittedFieldRef = useRef<string | null>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [demError, setDemError] = useState<string | null>(null);
  const [initializationError, setInitializationError] = useState<string | null>(null);
  const terrainReadoutCallbackRef = useRef(onTerrainReadout);
  terrainReadoutCallbackRef.current = onTerrainReadout;
  const validPosition = position
    && Number.isFinite(position.lng)
    && Number.isFinite(position.lat)
    && Math.abs(position.lng) <= 180
    && Math.abs(position.lat) <= 85.0511
    ? position
    : null;
  const validCenter = center
    && Number.isFinite(center[0])
    && Number.isFinite(center[1])
    && Math.abs(center[0]) <= 180
    && Math.abs(center[1]) <= 85.0511
    ? center
    : null;
  const mapCenter = validPosition
    ? [validPosition.lng, validPosition.lat] as [number, number]
    : fieldCenter(field, validCenter ?? DEFAULT_CENTER);

  useImperativeHandle(ref, () => ({
    zoomIn: () => map?.zoomIn(),
    zoomOut: () => map?.zoomOut(),
    center: () => {
      if (map && validPosition) map.easeTo({ center: [validPosition.lng, validPosition.lat], duration: 350 });
    },
    fitField: () => {
      if (!map || !fieldGeo || fieldGeo.length < 3) return;
      const validPoints = fieldGeo.filter((point) =>
        Array.isArray(point)
        && Number.isFinite(point[0])
        && Number.isFinite(point[1])
        && Math.abs(point[0]) <= 85.0511
        && Math.abs(point[1]) <= 180);
      if (validPoints.length < 3) return;
      const bounds = new maplibregl.LngLatBounds();
      validPoints.forEach(([lat, lng]) => bounds.extend([lng, lat]));
      map.fitBounds(bounds, { padding: 90, maxZoom: 17, duration: 700 });
    },
    invalidate: () => map?.resize(),
  }), [fieldGeo, map, validPosition]);

  useEffect(() => {
    if (!containerRef.current) return;

    registerCopernicusDemProtocol();
    registerSlopeTileProtocol();

    let instance: MapLibreMap;
    try {
      instance = new maplibregl.Map({
        container: containerRef.current,
        style: STYLE,
        center: mapCenter,
        zoom: field || validPosition ? 16 : validCenter ? 13 : fields?.length ? 6 : 2,
        pitch: 64,
        bearing: -18,
        maxPitch: 85,
        canvasContextAttributes: { antialias: true },
        attributionControl: { compact: true },
      });
    } catch (error) {
      setInitializationError(error instanceof Error ? error.message : 'Nie udało się uruchomić renderera mapy 3D.');
      setLoaded(true);
      return;
    }
    mapRef.current = instance;
    setMap(instance);
    instance.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    instance.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

    const onLoad = () => {
      try {
        instance.setTerrain({ source: 'terrainDem', exaggeration });
      } catch (error) {
        setDemError(error instanceof Error ? error.message : 'Przeglądarka nie obsługuje renderowania rzeźby terenu.');
      }
      setLoaded(true);
      mapRef.current = instance;
    };
    const onError = (event: maplibregl.ErrorEvent) => {
      const message = event.error?.message ?? 'Nieznany błąd mapy.';
      if (!instance.isStyleLoaded()) {
        setInitializationError(`Nie udało się załadować stylu mapy: ${message}`);
        setLoaded(true);
      } else {
        setDemError(`Błąd pobierania mapy lub danych wysokościowych: ${message}`);
      }
    };
    instance.on('load', onLoad);
    instance.on('error', onError);

    return () => {
      instance.off('load', onLoad);
      instance.off('error', onError);
      tractorMarkerRef.current?.remove();
      tractorMarkerRef.current = null;
      instance.remove();
      mapRef.current = null;
      setMap(null);
    };
    // The map instance owns its initial center; field and position updates are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!map || !loaded) return;
    map.setTerrain({ source: 'terrainDem', exaggeration });
  }, [exaggeration, loaded, map]);

  useEffect(() => {
    if (!map || !loaded || !validCenter || validPosition) return;
    map.easeTo({ center: validCenter, zoom: Math.max(map.getZoom(), 13), duration: 500 });
  }, [loaded, map, validCenter, validPosition]);

  useEffect(() => {
    if (!map || !loaded) return;
    const source = map.getSource('selectedField') as GeoJSONSource | undefined;
    const selectedField = fields?.find((item) => item.id === selectedFieldId) ?? field;
    const slopeField = selectedField;
    const boundarySource = Array.isArray(fieldGeo)
      ? fieldGeo
      : Array.isArray(selectedField?.geo) ? selectedField.geo : [];
    const boundary = boundarySource.filter((point) =>
      Array.isArray(point)
      && Number.isFinite(point[0])
      && Number.isFinite(point[1])
      && Math.abs(point[0]) <= 85.0511
      && Math.abs(point[1]) <= 180);
    source?.setData(fields
      ? fieldsFeature(fields, selectedFieldId, draftGeo)
      : field
        ? fieldsFeature([{ ...field, geo: boundary }], field.id)
        : fieldFeature(undefined));
    const slopeSource = map.getSource('slopeRelief') as maplibregl.RasterTileSource | undefined;
    const slopeBoundarySource = Array.isArray(slopeField?.geo) ? slopeField.geo : boundary;
    const slopeBoundary = slopeBoundarySource.filter((point) =>
      Array.isArray(point)
      && Number.isFinite(point[0])
      && Number.isFinite(point[1])
      && Math.abs(point[0]) <= 85.0511
      && Math.abs(point[1]) <= 180);
    slopeSource?.setTiles([fieldMaskTileUrl(slopeBoundary)]);
    const fitBoundary = Array.isArray(selectedField?.geo) ? selectedField.geo : boundary;
    const fitPoints = fitBoundary.filter((point) =>
      Array.isArray(point)
      && Number.isFinite(point[0])
      && Number.isFinite(point[1])
      && Math.abs(point[0]) <= 85.0511
      && Math.abs(point[1]) <= 180);
    const fitKey = selectedField?.id ?? field?.id ?? null;
    if (fitKey && fitPoints.length >= 3 && !center && lastFittedFieldRef.current !== fitKey) {
      const bounds = new maplibregl.LngLatBounds();
      fitPoints.forEach(([lat, lng]) => bounds.extend([lng, lat]));
      map.fitBounds(bounds, { padding: 90, maxZoom: 16, duration: 900 });
      lastFittedFieldRef.current = fitKey;
    }
  }, [center, draftGeo, field, fieldGeo, fields, loaded, map, selectedFieldId]);

  useEffect(() => {
    if (!map || !loaded) return;
    const lineSource = map.getSource('guidanceLines') as GeoJSONSource | undefined;
    const labelSource = map.getSource('guidanceLabels') as GeoJSONSource | undefined;
    lineSource?.setData(guidanceFeatures(geometry, activeLabel, doneLabels));
    labelSource?.setData(guidanceLabelFeatures(geometry));
  }, [activeLabel, doneLabels, geometry, loaded, map]);

  useEffect(() => {
    if (!map || !loaded) return;
    const source = map.getSource('fieldTrack') as GeoJSONSource | undefined;
    const frame = requestAnimationFrame(() => source?.setData(trackFeature(track)));
    return () => cancelAnimationFrame(frame);
  }, [loaded, map, track]);

  useEffect(() => {
    if (!map || !loaded) return;
    const source = map.getSource('workingCoverage') as GeoJSONSource | undefined;
    const frame = requestAnimationFrame(() => source?.setData(coverageFeatures(swaths)));
    return () => cancelAnimationFrame(frame);
  }, [loaded, map, swaths]);

  useEffect(() => {
    if (!map || !loaded) return;
    if (!validPosition) {
      tractorMarkerRef.current?.remove();
      tractorMarkerRef.current = null;
      return;
    }
    if (!tractorMarkerRef.current) {
      const marker = new maplibregl.Marker({
        element: makeTractorMarker(),
        anchor: 'center',
        pitchAlignment: 'map',
        rotationAlignment: 'map',
      })
        .setLngLat([validPosition.lng, validPosition.lat])
        .setRotation(Number.isFinite(validPosition.heading) ? validPosition.heading ?? 0 : 0);
      marker.addTo(map);
      tractorMarkerRef.current = marker;
      return;
    }
    tractorMarkerRef.current
      .setLngLat([validPosition.lng, validPosition.lat])
      .setRotation(Number.isFinite(validPosition.heading) ? validPosition.heading ?? 0 : 0);
  }, [loaded, map, validPosition]);

  useEffect(() => {
    if (!map || !loaded) return;
    const source = map.getSource('vehicleHeading') as GeoJSONSource | undefined;
    source?.setData(headingFeature(
      validPosition ? [validPosition.lng, validPosition.lat] : null,
      validPosition?.heading ?? null,
    ));
  }, [loaded, map, validPosition]);

  useEffect(() => {
    if (!map || !loaded) return;
    const source = map.getSource('abPoints') as GeoJSONSource | undefined;
    source?.setData(pointMarkersFeature(
      pointA ? { lat: pointA[0], lng: pointA[1] } : null,
      pointB ? { lat: pointB[0], lng: pointB[1] } : null,
    ));
  }, [loaded, map, pointA, pointB]);

  useEffect(() => {
    if (!map || !loaded || !validPosition || !follow) return;
    const offsetY = -map.getContainer().clientHeight * 0.1;
    map.easeTo({
      center: [validPosition.lng, validPosition.lat],
      bearing: courseUp ? validPosition.heading ?? 0 : map.getBearing(),
      offset: [0, offsetY],
      duration: 350,
    });
  }, [courseUp, follow, loaded, map, validPosition]);

  useEffect(() => {
    if (!map || !loaded) return;
    if (cameraMode === 'free') return;
    map.easeTo({
      pitch: cameraMode === 'top-down' ? 0 : 64,
      ...(cameraMode === 'follow' || cameraMode === 'north-up' || cameraMode === 'top-down' ? { bearing: 0 } : {}),
      duration: 400,
    });
  }, [cameraMode, loaded, map]);

  useEffect(() => {
    if (!map || !loaded || !validPosition) {
      terrainReadoutCallbackRef.current?.({ elevation: null, slopePercent: null });
      return;
    }

    const latitudeDelta = 10 / 111320;
    const longitudeDelta = 10 / (111320 * Math.max(0.01, Math.cos(validPosition.lat * Math.PI / 180)));
    const timer = window.setInterval(() => {
      const location: [number, number] = [validPosition.lng, validPosition.lat];
      const west = map.queryTerrainElevation([location[0] - longitudeDelta, location[1]]);
      const east = map.queryTerrainElevation([location[0] + longitudeDelta, location[1]]);
      const south = map.queryTerrainElevation([location[0], location[1] - latitudeDelta]);
      const north = map.queryTerrainElevation([location[0], location[1] + latitudeDelta]);
      const elevations = [west, east, south, north];
      const slopePercent = elevations.every((value) => value !== null)
        ? Math.hypot((east! - west!) / 20, (north! - south!) / 20) * 100
        : null;
      terrainReadoutCallbackRef.current?.({
        elevation: map.queryTerrainElevation(location),
        slopePercent,
      });
    }, 1500);
    return () => window.clearInterval(timer);
  }, [loaded, map, validPosition]);

  useEffect(() => {
    if (!map || !loaded) return;
    const onClick = (event: maplibregl.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(event.point, { layers: ['guidance-lines'] });
      const label = features[0]?.properties?.label;
      if (typeof label === 'string') {
        onLineClick?.(label);
      } else {
        const fieldFeatures = map.queryRenderedFeatures(event.point, { layers: ['field-fill', 'field-outline'] });
        const fieldId = fieldFeatures[0]?.properties?.id;
        if (typeof fieldId === 'string' && fieldId !== '__draft__' && onFieldClick) onFieldClick(fieldId);
        else onMapClick?.(event.lngLat.lat, event.lngLat.lng);
      }
    };
    map.on('click', onClick);
    return () => { map.off('click', onClick); };
  }, [loaded, map, onFieldClick, onLineClick, onMapClick]);

  return (
    <div className={`relative overflow-hidden bg-slate-950 ${fullscreen ? 'h-full w-full' : 'h-[68vh] min-h-[420px] rounded-xl border border-slate-700'}`}>
      {initializationError ? (
        <div className="absolute inset-0 flex flex-col">
          <div role="alert" className="z-10 border-b border-amber-500/50 bg-slate-950 px-3 py-2 text-sm text-amber-200">
            Widok 3D niedostępny: {initializationError} Wyświetlam mapę 2D.
          </div>
          <NavigationMap
            fieldGeo={fieldGeo ?? field?.geo ?? []}
            geometry={geometry}
            activeLabel={activeLabel}
            position={position ? { lat: position.lat, lng: position.lng, heading: position.heading ?? 0 } : null}
            track={track}
            contour={[]}
            pointA={pointA}
            pointB={pointB}
            night={false}
            layer="satellite"
            follow={follow}
            height="100%"
            onMapClick={onMapClick}
            onLineClick={onLineClick}
          />
        </div>
      ) : (
        <div ref={containerRef} className="absolute inset-0 h-full w-full" aria-label="Trójwymiarowa mapa satelitarna terenu" />
      )}
      {!loaded && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/70 text-sm text-slate-300" role="status">
          Ładowanie obrazu satelitarnego i rzeczywistych danych wysokościowych…
        </div>
      )}
      {demError && (
        <div role="alert" className="absolute left-3 top-3 z-20 max-w-md rounded-lg border border-amber-500/50 bg-slate-950/90 px-3 py-2 text-sm text-amber-200">
          {demError}
        </div>
      )}
      {!fullscreen && <div className="absolute bottom-3 right-3 z-10 rounded-lg border border-white/10 bg-slate-950/80 px-3 py-2 text-xs text-slate-200">
        Obraz satelitarny · rzeźba terenu DEM · {field?.name ?? 'obszar ogólny'}
      </div>}
    </div>
  );
});

export const RealisticTerrainMap = forwardRef<MapHandle, Props>(function RealisticTerrainMap(props, ref) {
  return (
    <TerrainMapErrorBoundary>
      <RealisticTerrainMapRenderer {...props} ref={ref} />
    </TerrainMapErrorBoundary>
  );
});

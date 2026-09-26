import type { Field } from '@/types';
import type { GuidanceGeometry, LL } from '@/geometry/guidance';

type FeatureCollection<G extends GeoJSON.Geometry> = GeoJSON.FeatureCollection<G>;

const emptyCollection = <G extends GeoJSON.Geometry>(): FeatureCollection<G> => ({
  type: 'FeatureCollection',
  features: [],
});

function validLatLng(point: unknown): point is [number, number] {
  return Array.isArray(point)
    && Number.isFinite(point[0])
    && Number.isFinite(point[1])
    && Math.abs(point[0]) <= 85.0511
    && Math.abs(point[1]) <= 180;
}

function validFieldRing(geo: [number, number][]): [number, number][] {
  if (!Array.isArray(geo)) return [];
  return geo.filter(validLatLng);
}

function polygonFeature(
  id: string,
  name: string,
  geo: [number, number][],
  selected = false,
  draft = false,
): GeoJSON.Feature<GeoJSON.Polygon> | null {
  const validGeo = validFieldRing(geo);
  if (validGeo.length < 3) return null;
  const ring = validGeo.map(([lat, lng]) => [lng, lat] as [number, number]);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
  return {
    type: 'Feature',
    properties: { id, name, selected, draft },
    geometry: { type: 'Polygon', coordinates: [ring] },
  };
}

export function fieldsFeature(
  fields: Field[],
  selectedId?: string,
  draftGeo: [number, number][] = [],
): GeoJSON.FeatureCollection<GeoJSON.Geometry> {
  const features = fields.flatMap((field) => {
    const feature = polygonFeature(field.id, field.name, field.geo, field.id === selectedId);
    return feature ? [feature] : [];
  });
  const draftFeature = polygonFeature('__draft__', 'Szkic pola', draftGeo, true, true);
  if (draftFeature) features.push(draftFeature);
  return { type: 'FeatureCollection', features };
}

export function fieldFeature(field?: Field): GeoJSON.FeatureCollection<GeoJSON.Geometry> {
  if (!field) return { type: 'FeatureCollection', features: [] };
  return fieldsFeature([field], field.id);
}

export function fieldCenter(
  field: Field | undefined,
  fallback: [number, number],
): [number, number] {
  const geo = field ? validFieldRing(field.geo) : [];
  if (geo.length === 0) return fallback;
  const [latSum, lngSum] = geo.reduce<[number, number]>(
    ([latTotal, lngTotal], [lat, lng]) => [latTotal + lat, lngTotal + lng],
    [0, 0],
  );
  return [lngSum / geo.length, latSum / geo.length];
}

export function guidanceFeatures(
  geometry: GuidanceGeometry | null,
  activeLabel: string | null,
  doneLabels: string[],
): FeatureCollection<GeoJSON.LineString> {
  if (!geometry) return emptyCollection();
  const done = new Set(doneLabels);
  return {
    type: 'FeatureCollection',
    features: (Array.isArray(geometry.lines) ? geometry.lines : []).flatMap((line) =>
      (Array.isArray(line.segments) ? line.segments : []).flatMap((segment) => {
        if (!Array.isArray(segment) || segment.length < 2 || !segment.every(validLatLng)) return [];
        return [{
          type: 'Feature' as const,
          properties: {
            label: line.label,
            active: line.label === activeLabel,
            done: line.label !== activeLabel && done.has(line.label),
          },
          geometry: {
            type: 'LineString' as const,
            coordinates: segment.map(([lat, lng]) => [lng, lat] as [number, number]),
          },
        }];
      })),
  };
}

export function guidanceLabelFeatures(geometry: GuidanceGeometry | null): FeatureCollection<GeoJSON.Point> {
  if (!geometry) return emptyCollection();
  return {
    type: 'FeatureCollection',
    features: (Array.isArray(geometry.lines) ? geometry.lines : []).flatMap((line) => {
      const firstPoint = Array.isArray(line.segments) ? line.segments[0]?.[0] : undefined;
      return validLatLng(firstPoint) ? [{
        type: 'Feature' as const,
        properties: { label: line.label },
        geometry: { type: 'Point' as const, coordinates: [firstPoint[1], firstPoint[0]] as [number, number] },
      }] : [];
    }),
  };
}

export function trackFeature(track: [number, number][]): FeatureCollection<GeoJSON.LineString> {
  const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];
  let coordinates: [number, number][] = [];
  const flush = () => {
    if (coordinates.length >= 2) {
      features.push({
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates },
      });
    }
    coordinates = [];
  };

  for (const point of Array.isArray(track) ? track : []) {
    if (validLatLng(point)) coordinates.push([point[1], point[0]]);
    else flush();
  }
  flush();
  if (features.length === 0) return emptyCollection();
  return {
    type: 'FeatureCollection',
    features,
  };
}

export function coverageFeatures(swaths: [number, number][][]): FeatureCollection<GeoJSON.Polygon> {
  return {
    type: 'FeatureCollection',
    features: (Array.isArray(swaths) ? swaths : []).flatMap((swath) => {
      const validSwath = validFieldRing(swath);
      if (validSwath.length < 3) return [];
      const ring = validSwath.map(([lat, lng]) => [lng, lat] as [number, number]);
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
      return [{
        type: 'Feature' as const,
        properties: {},
        geometry: { type: 'Polygon' as const, coordinates: [ring] },
      }];
    }),
  };
}

export function positionFeature(position: [number, number] | null): FeatureCollection<GeoJSON.Point> {
  if (!position || !validLatLng([position[1], position[0]])) return emptyCollection();
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: position },
    }],
  };
}

export function headingFeature(
  position: [number, number] | null,
  heading: number | null,
): FeatureCollection<GeoJSON.LineString> {
  if (!position || !validLatLng([position[1], position[0]]) || heading === null || !Number.isFinite(heading)) {
    return emptyCollection();
  }
  const [lng, lat] = position;
  const radians = heading * Math.PI / 180;
  const distanceDegrees = 0.00012;
  const endLat = lat + Math.cos(radians) * distanceDegrees;
  const endLng = lng + Math.sin(radians) * distanceDegrees / Math.max(0.01, Math.cos(lat * Math.PI / 180));
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: [position, [endLng, endLat]] },
    }],
  };
}

export function pointMarkersFeature(
  pointA: LL | null,
  pointB: LL | null,
): FeatureCollection<GeoJSON.Point> {
  const validPoint = (point: LL | null): point is LL =>
    point != null
    && Number.isFinite(point.lat)
    && Number.isFinite(point.lng)
    && Math.abs(point.lat) <= 85.0511
    && Math.abs(point.lng) <= 180;
  return {
    type: 'FeatureCollection',
    features: [
      ...(validPoint(pointA) ? [{
        type: 'Feature' as const,
        properties: { label: 'A', kind: 'a' },
        geometry: { type: 'Point' as const, coordinates: [pointA.lng, pointA.lat] as [number, number] },
      }] : []),
      ...(validPoint(pointB) ? [{
        type: 'Feature' as const,
        properties: { label: 'B', kind: 'b' },
        geometry: { type: 'Point' as const, coordinates: [pointB.lng, pointB.lat] as [number, number] },
      }] : []),
    ],
  };
}

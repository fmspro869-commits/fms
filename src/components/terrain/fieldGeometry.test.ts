import { describe, expect, it } from 'vitest';
import type { Field } from '@/types';
import {
  fieldCenter,
  fieldFeature,
  fieldsFeature,
  coverageFeatures,
  guidanceFeatures,
  guidanceLabelFeatures,
  headingFeature,
  pointMarkersFeature,
  positionFeature,
  trackFeature,
} from './fieldGeometry';
import type { GuidanceGeometry, LL } from '@/geometry/guidance';

const field: Field = {
  id: 'field-1',
  name: 'Pole A',
  area: 4,
  parcelNo: '1',
  district: 'Borek',
  soilType: 'IIIb',
  pH: 6,
  P: 'średnia',
  K: 'średnia',
  Mg: 'średnia',
  geo: [[52.1, 19.1], [52.1, 19.2], [52.2, 19.2], [52.2, 19.1]],
};

describe('terrain field geometry', () => {
  const incompleteCoordinate = [52.2] as unknown as [number, number];

  it('converts the farm latitude-longitude ring to a closed GeoJSON polygon', () => {
    const feature = fieldFeature(field);
    expect(feature.features[0].geometry).toEqual({
      type: 'Polygon',
      coordinates: [[[19.1, 52.1], [19.2, 52.1], [19.2, 52.2], [19.1, 52.2], [19.1, 52.1]]],
    });
  });

  it('returns the field center as longitude-latitude and uses the fallback without geometry', () => {
    expect(fieldCenter(field, [0, 0])[0]).toBeCloseTo(19.15);
    expect(fieldCenter(field, [0, 0])[1]).toBeCloseTo(52.15);
    expect(fieldCenter(undefined, [19, 52])).toEqual([19, 52]);
    expect(fieldCenter({ ...field, geo: [[Number.NaN, 19], [90, 19], [52, 200]] }, [19, 52])).toEqual([19, 52]);
  });

  it('creates a 3D-ready collection for all fields and a draft, skipping malformed coordinates', () => {
    const collection = fieldsFeature([
      field,
      { ...field, id: 'bad', name: 'Malformed', geo: [[Number.NaN, 19], [52, 19], [52, 20]] },
    ], field.id, [[52.3, 19.3], [52.3, 19.4], [52.4, 19.4]]);
    expect(collection.features).toHaveLength(2);
    expect(collection.features[0].properties).toMatchObject({ id: field.id, selected: true });
    expect(collection.features[1].properties).toMatchObject({ id: '__draft__', draft: true });
  });

  it('converts guidance lines and labels to map coordinates with active and completed states', () => {
    const geometry: GuidanceGeometry = {
      origin: { lat: 52.1, lng: 19.1 },
      dir: { x: 1, y: 0 },
      normal: { x: 0, y: 1 },
      headingDeg: 90,
      width: 3,
      shift: 0,
      lines: [
        { index: 0, label: 'L1', offset: 0, segments: [[[52.1, 19.1], [52.2, 19.2]]] },
        { index: 1, label: 'L2', offset: 3, segments: [[[52.2, 19.1], [52.3, 19.2]]] },
      ],
    };

    const lines = guidanceFeatures(geometry, 'L1', ['L2']);
    expect(lines.features[0].geometry).toEqual({
      type: 'LineString',
      coordinates: [[19.1, 52.1], [19.2, 52.2]],
    });
    expect(lines.features.map((feature) => feature.properties)).toEqual([
      { label: 'L1', active: true, done: false },
      { label: 'L2', active: false, done: true },
    ]);
    expect(guidanceLabelFeatures(geometry).features.map((feature) => feature.properties?.label)).toEqual(['L1', 'L2']);
  });

  it('converts the navigation track, vehicle, heading and A/B points to GeoJSON', () => {
    expect(trackFeature([[52.1, 19.1], [52.2, 19.2]]).features[0].geometry).toEqual({
      type: 'LineString',
      coordinates: [[19.1, 52.1], [19.2, 52.2]],
    });
    expect(positionFeature([19.1, 52.1]).features[0].geometry).toEqual({
      type: 'Point',
      coordinates: [19.1, 52.1],
    });
    expect(headingFeature([19.1, 52.1], 0).features[0].geometry.type).toBe('LineString');
    expect(pointMarkersFeature({ lat: 52.1, lng: 19.1 }, null).features[0].properties).toEqual({ label: 'A', kind: 'a' });
  });

  it('converts working swaths to field-aligned polygon features and ignores invalid swaths', () => {
    const coverage = coverageFeatures([
      [[52.1, 19.1], [52.2, 19.1], [52.2, 19.2], [52.1, 19.2]],
      [[Number.NaN, 19.1], [52.2, 19.1]],
    ]);
    expect(coverage.features).toHaveLength(1);
    expect(coverage.features[0].geometry).toEqual({
      type: 'Polygon',
      coordinates: [[[19.1, 52.1], [19.1, 52.2], [19.2, 52.2], [19.2, 52.1], [19.1, 52.1]]],
    });
  });

  it('drops invalid navigation fixes without joining separate track segments', () => {
    const track = trackFeature([
      [52.1, 19.1],
      incompleteCoordinate,
      [52.3, 19.3],
      [52.4, 19.4],
    ]);
    expect(track.features).toHaveLength(1);
    expect(track.features[0].geometry).toEqual({
      type: 'LineString',
      coordinates: [[19.3, 52.3], [19.4, 52.4]],
    });
  });

  it('ignores malformed guidance, vehicle, and A/B coordinates', () => {
    const malformedGeometry: GuidanceGeometry = {
      origin: { lat: 52.1, lng: 19.1 },
      dir: { x: 1, y: 0 },
      normal: { x: 0, y: 1 },
      headingDeg: 90,
      width: 3,
      shift: 0,
      lines: [{
        index: 0,
        label: 'L1',
        offset: 0,
        segments: [[[52.1, 19.1], incompleteCoordinate]],
      }],
    };

    expect(guidanceFeatures(malformedGeometry, null, []).features).toHaveLength(0);
    expect(guidanceLabelFeatures(malformedGeometry).features).toHaveLength(1);
    expect(pointMarkersFeature({ lat: 52.1, lng: Number.NaN }, null).features).toHaveLength(0);
    expect(pointMarkersFeature({ lat: 52.1 } as LL, null).features).toHaveLength(0);
    expect(positionFeature([Number.NaN, 52.1]).features).toHaveLength(0);
    expect(headingFeature([Number.NaN, 52.1], 0).features).toHaveLength(0);
  });
});

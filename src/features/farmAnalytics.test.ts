import { describe, expect, it } from 'vitest';
import type { CropHistory, Field } from '@/types';
import { toYieldRecords } from './farmAnalytics';

const history: CropHistory[] = [{
  id: 'crop-history-1',
  fieldId: 'field-1',
  season: 2025,
  crop: 'Pszenica ozima',
  variety: 'Odmiana A',
  yield: 8,
  costs: 4000,
  revenue: 6400,
  notes: '',
}];

const fields: Pick<Field, 'id' | 'name' | 'area'>[] = [
  { id: 'field-1', name: 'Pole A', area: 10 },
];

describe('toYieldRecords', () => {
  it('converts farm history into yield-analysis records using the linked field area', () => {
    const [record] = toYieldRecords(history, fields);

    expect(record).toMatchObject({
      fieldName: 'Pole A',
      year: 2025,
      yield_t_per_ha: 8,
      totalYield: 80,
      areaHa: 10,
      costPerHa: 400,
      revenuePerHa: 640,
      marginPerHa: 240,
    });
  });

  it('keeps history with deleted fields and reports missing field area as zero', () => {
    const [record] = toYieldRecords(history, []);

    expect(record.fieldName).toBe('Nieznane pole');
    expect(record.areaHa).toBe(0);
    expect(record.marginPerHa).toBe(0);
  });
});

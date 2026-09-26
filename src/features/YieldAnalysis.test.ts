import { describe, expect, it } from 'vitest';
import { analyzeYields, type YieldRecord } from './YieldAnalysis';

const record = (overrides: Partial<YieldRecord> = {}): YieldRecord => ({
  id: 'yield-1',
  fieldId: 'field-1',
  fieldName: 'Pole A',
  year: 2025,
  crop: 'Pszenica ozima',
  variety: 'Odmiana A',
  yield_t_per_ha: 8,
  totalYield: 80,
  areaHa: 10,
  moisture: 14,
  quality: {},
  treatments: [],
  totalCost: 40000,
  costPerHa: 4000,
  pricePerTon: 800,
  revenue: 64000,
  revenuePerHa: 6400,
  margin: 24000,
  marginPerHa: 2400,
  ...overrides,
});

describe('analyzeYields', () => {
  it('returns an empty report when no harvest data exists', () => {
    expect(() => analyzeYields([], 2025)).not.toThrow();
    expect(analyzeYields([], 2025).summary.totalFields).toBe(0);
    expect(analyzeYields([], 2025).recommendations).toEqual([]);
  });

  it('ranks varieties and analyzes field trends without reordering input data', () => {
    const records = [
      record({ id: 'older', year: 2024, yield_t_per_ha: 6 }),
      record({ id: 'current', year: 2025, yield_t_per_ha: 8 }),
      record({ id: 'other-field', fieldId: 'field-2', fieldName: 'Pole B', yield_t_per_ha: 9 }),
    ];
    const originalIds = records.map((item) => item.id);
    const report = analyzeYields(records, 2025);

    expect(report.summary.totalFields).toBe(2);
    expect(report.varietyRanking[0].avgYield).toBe(8.5);
    expect(report.fieldPerformance.find((field) => field.fieldId === 'field-1')?.trend).toBe('IMPROVING');
    expect(records.map((item) => item.id)).toEqual(originalIds);
  });
});

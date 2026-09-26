import { describe, expect, it } from 'vitest';
import type { FieldWorkSession, Machine } from '@/types';
import { generateCostFromSession, machineToCostParams } from './SessionCostIntegration';

const machine: Machine = {
  id: 'tractor-1',
  name: 'Ciągnik testowy',
  category: 'ciągnik',
  brand: 'Test',
  model: 'T1',
  year: 2020,
  regNo: '',
  mth: 3000,
  nextServiceMth: 3500,
  fuel: 'ON',
  consumption: 12,
  serviceHistory: [],
};

const session: FieldWorkSession = {
  id: 'session-1',
  fieldId: 'field-1',
  fieldName: 'Pole testowe',
  machineId: machine.id,
  treatmentType: 'siew',
  crop: 'Pszenica',
  operator: 'Operator',
  implementWidth: 3,
  mode: 'AB',
  pointA: null,
  pointB: null,
  shift: 0,
  offsetCorr: 0,
  contour: [],
  passes: 1,
  track: [],
  startedAt: '2026-08-06T08:00:00.000Z',
  endedAt: '2026-08-06T13:00:00.000Z',
  distance: 10000,
  areaCovered: 10,
  coveragePercent: 80,
  averageSpeed: 8,
  averageAccuracy: 0.1,
  totalLines: 4,
  status: 'completed',
  isDemo: false,
};

describe('machineToCostParams', () => {
  it('uses available farm machine data and safe defaults for missing cost data', () => {
    const params = machineToCostParams(machine);

    expect(params.fuelConsumption).toBe(12);
    expect(params.purchaseYear).toBe(2020);
    expect(params.purchasePrice).toBeGreaterThan(0);
  });
});

describe('generateCostFromSession', () => {
  it('calculates the cost from the repository FieldWorkSession model', () => {
    const cost = generateCostFromSession(session, machine);

    expect(cost.fieldId).toBe(session.fieldId);
    expect(cost.category).toBe('MACHINE_WORK');
    expect(cost.source).toBe('SESSION');
    expect(cost.sourceId).toBe(session.id);
    expect(cost.amount).toBeGreaterThan(0);
    expect(cost.breakdown?.costPerHa).toBeGreaterThan(0);
    expect(cost.amount).toBeCloseTo(815, 0);
  });

  it('rejects active sessions without an end time', () => {
    expect(() => generateCostFromSession({ ...session, endedAt: undefined }, machine))
      .toThrow('nie została zakończona');
  });

  it('rejects a machine that is not linked to the session', () => {
    expect(() => generateCostFromSession(session, { ...machine, id: 'other-machine' }))
      .toThrow('nie jest przypisana');
  });
});

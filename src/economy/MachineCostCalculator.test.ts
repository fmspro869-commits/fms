// FMS 3.0 — FARM OS
// ECONOMY MODULE — Machine Cost Calculator Tests

import { describe, it, expect } from 'vitest';
import {
  calculateSessionCost,
  calculateDepreciationPerHour,
  calculateServicePerHour,
  calculateTheoreticalCapacity,
  calculateCostPerHaTheoretical,
  calculateAnnualCost,
  compareMachines,
  formatPLN,
} from './MachineCostCalculator';
import type { MachineCostParams } from './types';
import { getDefaultCostParams } from './types';

// ============================================
// TEST DATA
// ============================================

const tractorParams: MachineCostParams = {
  ...getDefaultCostParams(),
  fuelConsumption: 12,        // l/h
  fuelPrice: 6.50,            // zł/l
  purchasePrice: 400000,      // zł
  purchaseYear: 2020,
  expectedLifetimeYears: 15,
  expectedLifetimeHours: 12000,
  salvageValue: 40000,
  annualServiceCost: 18000,
  operatorCostPerHour: 35,
  insurancePerYear: 6000,
  workingWidth: 3,
  averageSpeed: 8,
  fieldEfficiency: 0.85,
};

const sprayerParams: MachineCostParams = {
  ...getDefaultCostParams(),
  fuelConsumption: 8,
  fuelPrice: 6.50,
  purchasePrice: 250000,
  purchaseYear: 2022,
  expectedLifetimeYears: 12,
  expectedLifetimeHours: 8000,
  salvageValue: 25000,
  annualServiceCost: 12000,
  operatorCostPerHour: 35,
  insurancePerYear: 4000,
  workingWidth: 24,
  averageSpeed: 10,
  fieldEfficiency: 0.75,
};

// ============================================
// TESTS — DEPRECIATION
// ============================================

describe('calculateDepreciationPerHour', () => {
  it('should calculate linear depreciation from hours', () => {
    const dep = calculateDepreciationPerHour(tractorParams);
    // (400000 - 40000) / 12000 = 30 zł/h
    expect(dep).toBe(30);
  });

  it('should calculate from years if hours not provided', () => {
    const params = { ...tractorParams, expectedLifetimeHours: 0 };
    const dep = calculateDepreciationPerHour(params);
    // (400000 - 40000) / (15 * 2000) = 12 zł/h
    expect(dep).toBe(12);
  });

  it('should return 0 if no lifetime data', () => {
    const params = {
      ...tractorParams,
      expectedLifetimeHours: 0,
      expectedLifetimeYears: 0
    };
    expect(calculateDepreciationPerHour(params)).toBe(0);
  });
});

// ============================================
// TESTS — SERVICE COST
// ============================================

describe('calculateServicePerHour', () => {
  it('should use direct per-hour cost if provided', () => {
    const params = { ...tractorParams, serviceCostPerHour: 25 };
    expect(calculateServicePerHour(params)).toBe(25);
  });

  it('should calculate from annual cost', () => {
    const params = { ...tractorParams, serviceCostPerHour: 0 };
    const service = calculateServicePerHour(params);
    // 18000 / 2000 = 9 zł/h
    expect(service).toBe(9);
  });
});

// ============================================
// TESTS — CAPACITY
// ============================================

describe('calculateTheoreticalCapacity', () => {
  it('should calculate ha/h correctly', () => {
    const capacity = calculateTheoreticalCapacity(tractorParams);
    // (3 * 8 * 0.85) / 10 = 2.04 ha/h
    expect(capacity).toBeCloseTo(2.04, 2);
  });

  it('should return 0 for zero width', () => {
    const params = { ...tractorParams, workingWidth: 0 };
    expect(calculateTheoreticalCapacity(params)).toBe(0);
  });
});

// ============================================
// TESTS — SESSION COST
// ============================================

describe('calculateSessionCost', () => {
  it('should calculate complete session cost', () => {
    const result = calculateSessionCost(tractorParams, {
      sessionId: 'test-1',
      machineId: 'tractor-1',
      fieldId: 'field-17',
      durationHours: 5,
      areaHa: 10,
    });

    // Paliwo: 12 l/h × 5h × 6.50 zł/l = 390 zł
    expect(result.fuelCost).toBe(390);

    // Amortyzacja: 30 zł/h × 5h = 150 zł
    expect(result.depreciationCost).toBe(150);

    // Serwis: 9 zł/h × 5h = 45 zł
    expect(result.serviceCost).toBe(45);

    // Operator: 35 zł/h × 5h = 175 zł
    expect(result.operatorCost).toBe(175);

    // Ubezpieczenie: 6000/2000 × 5h = 15 zł
    expect(result.insuranceCost).toBe(15);

    // Razem: 390 + 150 + 45 + 175 + 15 = 775 zł
    expect(result.totalCost).toBe(775);

    // Na hektar: 775 / 10 = 77.50 zł/ha
    expect(result.costPerHa).toBe(77.50);

    // Na godzinę: 775 / 5 = 155 zł/h
    expect(result.costPerHour).toBe(155);
  });

  it('should use actual fuel if provided', () => {
    const result = calculateSessionCost(tractorParams, {
      sessionId: 'test-2',
      machineId: 'tractor-1',
      fieldId: 'field-17',
      durationHours: 5,
      areaHa: 10,
      fuelUsed: 50, // mniej niż teoretyczne 60l
    });

    // Paliwo: 50l × 6.50 = 325 zł (nie 390)
    expect(result.fuelCost).toBe(325);
  });

  it('should use fuel price override', () => {
    const result = calculateSessionCost(tractorParams, {
      sessionId: 'test-3',
      machineId: 'tractor-1',
      fieldId: 'field-17',
      durationHours: 1,
      areaHa: 2,
      fuelPriceOverride: 5.50, // tańsze paliwo
    });

    // Paliwo: 12 × 1 × 5.50 = 66 zł
    expect(result.fuelCost).toBe(66);
  });

  it('should handle zero area', () => {
    const result = calculateSessionCost(tractorParams, {
      sessionId: 'test-4',
      machineId: 'tractor-1',
      fieldId: 'field-17',
      durationHours: 2,
      areaHa: 0,
    });

    expect(result.costPerHa).toBe(0);
    expect(result.totalCost).toBeGreaterThan(0);
  });
});

// ============================================
// TESTS — THEORETICAL COST PER HA
// ============================================

describe('calculateCostPerHaTheoretical', () => {
  it('should calculate theoretical cost per ha', () => {
    const costHa = calculateCostPerHaTheoretical(tractorParams);

    // Koszt 1h: 12×6.50 + 30 + 9 + 35 + 3 = 78 + 30 + 9 + 35 + 3 = 155 zł/h
    // Wydajność: 2.04 ha/h
    // Koszt/ha: 155 / 2.04 ≈ 75.98 zł/ha
    expect(costHa).toBeCloseTo(75.98, 1);
  });
});

// ============================================
// TESTS — ANNUAL COST
// ============================================

describe('calculateAnnualCost', () => {
  it('should sum multiple sessions', () => {
    const result = calculateAnnualCost({
      machineId: 'tractor-1',
      year: 2026,
      params: tractorParams,
      sessions: [
        { durationHours: 10, areaHa: 20 },
        { durationHours: 8, areaHa: 16 },
        { durationHours: 12, areaHa: 24 },
      ],
    });

    expect(result.totalHours).toBe(30);
    expect(result.totalAreaHa).toBe(60);
    expect(result.totalCost).toBeGreaterThan(0);
    expect(result.avgCostPerHa).toBeCloseTo(result.totalCost / 60, 1);
  });

  it('should include annual insurance', () => {
    const result = calculateAnnualCost({
      machineId: 'tractor-1',
      year: 2026,
      params: tractorParams,
      sessions: [],
    });

    // Tylko ubezpieczenie
    expect(result.totalInsurance).toBe(6000);
    expect(result.totalCost).toBe(6000);
  });
});

// ============================================
// TESTS — MACHINE COMPARISON
// ============================================

describe('compareMachines', () => {
  it('should identify cheaper machine', () => {
    const result = compareMachines(
      'Tractor A',
      tractorParams,
      'Sprayer B',
      sprayerParams,
      50 // ha
    );

    // Sprayer ma większą szerokość (24m) → niższy koszt/ha
    expect(result.result.cheaperMachine).toBe('Sprayer B');
    expect(result.result.savingsPerHa).toBeGreaterThan(0);
  });

  it('should calculate total savings', () => {
    const result = compareMachines(
      'Tractor A',
      tractorParams,
      'Sprayer B',
      sprayerParams,
      100
    );

    expect(result.result.totalSavings).toBeCloseTo(
      result.result.savingsPerHa * 100,
      1
    );
  });
});

// ============================================
// TESTS — FORMATTING
// ============================================

describe('formatPLN', () => {
  it('should format Polish złoty', () => {
    const formatted = formatPLN(1234.56).replace(/[\u00a0\u202f]/g, ' ');
    expect(formatted).toContain('1234,56');
    expect(formatted).toContain('zł');
  });
});

// ============================================
// EDGE CASES
// ============================================

describe('edge cases', () => {
  it('should handle very short sessions', () => {
    const result = calculateSessionCost(tractorParams, {
      sessionId: 'edge-1',
      machineId: 't',
      fieldId: 'f',
      durationHours: 0.1,
      areaHa: 0.2,
    });

    expect(result.totalCost).toBeGreaterThan(0);
    expect(result.costPerHour).toBeGreaterThan(0);
  });

  it('should handle zero fuel price', () => {
    const params = { ...tractorParams, fuelPrice: 0 };
    const result = calculateSessionCost(params, {
      sessionId: 'edge-2',
      machineId: 't',
      fieldId: 'f',
      durationHours: 1,
      areaHa: 2,
    });

    expect(result.fuelCost).toBe(0);
    expect(result.totalCost).toBeGreaterThan(0);
  });
});

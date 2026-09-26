// FMS 3.0 — FARM OS
// ECONOMY MODULE — Machine Cost Calculator
// Liczy rzeczywiste koszty pracy maszyn na podstawie parametrów i sesji

import type {
  MachineCostParams,
  SessionCostBreakdown,
  SessionCostInput,
  AnnualMachineCost,
} from './types';
import { DEFAULT_FUEL_PRICES } from './types';

// ============================================
// KALKULATOR KOSZTÓW SESJI
// ============================================

export function calculateSessionCost(
  params: MachineCostParams,
  input: SessionCostInput
): SessionCostBreakdown {
  const {
    durationHours,
    areaHa,
    fuelUsed: actualFuelUsed,
    fuelPriceOverride,
    operatorCostOverride,
  } = input;

  // --- Paliwo ---
  const fuelPrice = fuelPriceOverride ?? params.fuelPrice ?? DEFAULT_FUEL_PRICES[params.fuelType];
  const fuelConsumed = actualFuelUsed ?? params.fuelConsumption * durationHours;
  const fuelCost = fuelConsumed * fuelPrice;

  // --- Amortyzacja ---
  const depreciationCost = calculateDepreciationPerHour(params) * durationHours;

  // --- Serwis ---
  const serviceCost = calculateServicePerHour(params) * durationHours;

  // --- Operator ---
  const operatorCost = (operatorCostOverride ?? params.operatorCostPerHour) * durationHours;

  // --- Ubezpieczenie ---
  const insuranceCost = (params.insurancePerYear / 2000) * durationHours; // ~2000h/rok

  // --- Sumy ---
  const totalCost = fuelCost + depreciationCost + serviceCost + operatorCost + insuranceCost;

  return {
    fuelCost: round2(fuelCost),
    depreciationCost: round2(depreciationCost),
    serviceCost: round2(serviceCost),
    operatorCost: round2(operatorCost),
    insuranceCost: round2(insuranceCost),
    totalCost: round2(totalCost),
    costPerHa: areaHa > 0 ? round2(totalCost / areaHa) : 0,
    costPerHour: durationHours > 0 ? round2(totalCost / durationHours) : 0,
    currency: 'PLN',
    calculatedAt: Date.now(),
    sessionId: input.sessionId,
  };
}

// ============================================
// KALKULACJE POMOCNICZE
// ============================================

/** Amortyzacja liniowa na godzinę */
export function calculateDepreciationPerHour(params: MachineCostParams): number {
  const depreciableAmount = params.purchasePrice - params.salvageValue;

  // Priorytet: godziny jeśli podane
  if (params.expectedLifetimeHours > 0) {
    return depreciableAmount / params.expectedLifetimeHours;
  }

  // Alternatywnie: lata × ~2000h/rok
  if (params.expectedLifetimeYears > 0) {
    return depreciableAmount / (params.expectedLifetimeYears * 2000);
  }

  return 0;
}

/** Koszt serwisu na godzinę */
export function calculateServicePerHour(params: MachineCostParams): number {
  // Jeśli podano bezpośrednio zł/h
  if (params.serviceCostPerHour > 0) {
    return params.serviceCostPerHour;
  }

  // Oblicz z rocznego kosztu
  if (params.annualServiceCost > 0) {
    return params.annualServiceCost / 2000; // ~2000h/rok
  }

  // Domyślnie: 5% wartości rocznej amortyzacji
  const depreciationPerHour = calculateDepreciationPerHour(params);
  return depreciationPerHour * 0.05;
}

/** Teoretyczna wydajność ha/h */
export function calculateTheoreticalCapacity(params: MachineCostParams): number {
  const widthM = params.workingWidth;
  const speedKmh = params.averageSpeed;
  const efficiency = params.fieldEfficiency;

  // ha/h = (szerokość m × prędkość km/h × efektywność) / 10
  return (widthM * speedKmh * efficiency) / 10;
}

/** Czas potrzebny na obsianie X ha */
export function calculateTimeForArea(params: MachineCostParams, areaHa: number): number {
  const capacity = calculateTheoreticalCapacity(params);
  return capacity > 0 ? areaHa / capacity : 0;
}

/** Koszt na ha przy danych parametrach (bez sesji) */
export function calculateCostPerHaTheoretical(params: MachineCostParams): number {
  const capacity = calculateTheoreticalCapacity(params);
  if (capacity <= 0) return 0;

  // Koszt 1h pracy
  const hourlyCost =
    params.fuelConsumption * params.fuelPrice +
    calculateDepreciationPerHour(params) +
    calculateServicePerHour(params) +
    params.operatorCostPerHour +
    (params.insurancePerYear / 2000);

  return hourlyCost / capacity;
}

// ============================================
// KOSZT ROCZNY MASZYNY
// ============================================

export interface AnnualCostInput {
  machineId: string;
  year: number;
  sessions: {
    durationHours: number;
    areaHa: number;
    fuelUsed?: number;
  }[];
  params: MachineCostParams;
}

export function calculateAnnualCost(input: AnnualCostInput): AnnualMachineCost {
  const { machineId, year, sessions, params } = input;

  let totalHours = 0;
  let totalAreaHa = 0;
  let totalFuelUsed = 0;
  let totalFuelCost = 0;
  let totalDepreciation = 0;
  let totalService = 0;
  let totalOperator = 0;

  for (const session of sessions) {
    const cost = calculateSessionCost(params, {
      sessionId: `${machineId}-${year}`,
      machineId,
      fieldId: '',
      durationHours: session.durationHours,
      areaHa: session.areaHa,
      fuelUsed: session.fuelUsed,
    });

    totalHours += session.durationHours;
    totalAreaHa += session.areaHa;
    totalFuelUsed += session.fuelUsed ?? params.fuelConsumption * session.durationHours;
    totalFuelCost += cost.fuelCost;
    totalDepreciation += cost.depreciationCost;
    totalService += cost.serviceCost;
    totalOperator += cost.operatorCost;
  }

  const insuranceCost = params.insurancePerYear;
  const totalCost = totalFuelCost + totalDepreciation + totalService + totalOperator + insuranceCost;

  return {
    machineId,
    year,
    totalHours: round2(totalHours),
    totalAreaHa: round2(totalAreaHa),
    totalFuelUsed: round2(totalFuelUsed),
    totalFuelCost: round2(totalFuelCost),
    totalDepreciation: round2(totalDepreciation),
    totalService: round2(totalService),
    totalOperator: round2(totalOperator),
    totalInsurance: round2(insuranceCost),
    totalCost: round2(totalCost),
    avgCostPerHa: totalAreaHa > 0 ? round2(totalCost / totalAreaHa) : 0,
    avgCostPerHour: totalHours > 0 ? round2(totalCost / totalHours) : 0,
    avgFuelPerHa: totalAreaHa > 0 ? round2(totalFuelUsed / totalAreaHa) : 0,
  };
}

// ============================================
// HELPERS
// ============================================

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Formatowanie waluty PLN */
export function formatPLN(amount: number): string {
  return new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency: 'PLN',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** Formatowanie ha */
export function formatHa(area: number): string {
  return `${area.toFixed(2)} ha`;
}

/** Formatowanie godzin */
export function formatHours(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

/** Formatowanie l/ha */
export function formatFuelPerHa(liters: number): string {
  return `${liters.toFixed(1)} l/ha`;
}

// ============================================
// WERSJA KALKULATORA Z PORÓWNYWANIEM
// ============================================

export interface CostComparison {
  machineA: string;
  machineB: string;
  paramsA: MachineCostParams;
  paramsB: MachineCostParams;
  areaHa: number;

  result: {
    costA: number;
    costB: number;
    difference: number;       // B - A (ujemne = A tańsze)
    percentDifference: number; // względem A
    cheaperMachine: string;
    savingsPerHa: number;
    totalSavings: number;     // dla areaHa
  };
}

export function compareMachines(
  machineA: string,
  paramsA: MachineCostParams,
  machineB: string,
  paramsB: MachineCostParams,
  areaHa: number
): CostComparison {
  const costAHa = calculateCostPerHaTheoretical(paramsA);
  const costBHa = calculateCostPerHaTheoretical(paramsB);

  const costA = costAHa * areaHa;
  const costB = costBHa * areaHa;
  const difference = costB - costA;
  const percentDifference = costA > 0 ? (difference / costA) * 100 : 0;

  return {
    machineA,
    machineB,
    paramsA,
    paramsB,
    areaHa,
    result: {
      costA: round2(costA),
      costB: round2(costB),
      difference: round2(difference),
      percentDifference: round2(percentDifference),
      cheaperMachine: difference > 0 ? machineA : machineB,
      savingsPerHa: round2(Math.abs(costAHa - costBHa)),
      totalSavings: round2(Math.abs(difference)),
    },
  };
}

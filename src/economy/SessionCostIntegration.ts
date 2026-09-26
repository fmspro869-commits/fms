// FMS 3.0 — FARM OS
// ECONOMY MODULE — Session Cost Integration
// Automatyczne generowanie kosztów z zakończonych sesji pracy

import type { FieldWorkSession, Machine } from '@/types';
import type { CostEntry } from './types';
import { calculateSessionCost } from './MachineCostCalculator';
import { getDefaultCostParams } from './types';
import type { MachineCostParams } from './types';

// ============================================
// KONWERSJA MASZYNY → PARAMETRY KOSZTOWE
// ============================================

export function machineToCostParams(machine: Machine): MachineCostParams {
  const defaults = getDefaultCostParams();
  const fuelType: MachineCostParams['fuelType'] = /electric|elektry/i.test(machine.fuel)
    ? 'ELECTRIC'
    : /petrol|benzyn/i.test(machine.fuel)
      ? 'PETROL'
      : /lpg|gaz/i.test(machine.fuel)
        ? 'LPG'
        : 'DIESEL';

  return {
    ...defaults,
    fuelType,
    fuelConsumption: machine.consumption > 0 ? machine.consumption : defaults.fuelConsumption,
    purchaseYear: machine.year > 0 ? machine.year : defaults.purchaseYear,
  };
}

// ============================================
// AUTOMATYCZNY KOSZT Z SESJI
// ============================================

export function generateCostFromSession(
  session: FieldWorkSession,
  machine: Machine,
  fuelPrice?: number
): CostEntry {
  const params = machineToCostParams(machine);
  if (!session.endedAt) {
    throw new Error(`Sesja ${session.id} nie została zakończona`);
  }

  const startedAt = Date.parse(session.startedAt);
  const endedAt = Date.parse(session.endedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt <= startedAt) {
    throw new Error(`Sesja ${session.id} ma nieprawidłowy czas rozpoczęcia lub zakończenia`);
  }

  const linkedMachineIds = [session.machineId, session.tractorId].filter(Boolean);
  if (linkedMachineIds.length > 0 && !linkedMachineIds.includes(machine.id)) {
    throw new Error(`Maszyna ${machine.id} nie jest przypisana do sesji ${session.id}`);
  }

  const durationMs = endedAt - startedAt;
  const durationHours = durationMs / (1000 * 60 * 60);
  if (!Number.isFinite(session.areaCovered) || session.areaCovered < 0) {
    throw new Error(`Sesja ${session.id} ma nieprawidłową powierzchnię`);
  }
  const areaHa = Math.max(0, session.areaCovered);

  const breakdown = calculateSessionCost(params, {
    sessionId: session.id,
    machineId: machine.id,
    fieldId: session.fieldId,
    durationHours,
    areaHa,
    fuelPriceOverride: fuelPrice,
  });

  return {
    id: `cost-${session.id}`,
    fieldId: session.fieldId,
    category: 'MACHINE_WORK',
    amount: breakdown.totalCost,
    date: endedAt,
    season: new Date(endedAt).getFullYear(),
    source: 'SESSION',
    sourceId: session.id,
    description: `Praca: ${machine.name} — ${session.treatmentType}`,
    machineId: machine.id,
    breakdown: {
      fuelCost: breakdown.fuelCost,
      depreciationCost: breakdown.depreciationCost,
      serviceCost: breakdown.serviceCost,
      operatorCost: breakdown.operatorCost,
      insuranceCost: breakdown.insuranceCost,
      totalCost: breakdown.totalCost,
      costPerHa: breakdown.costPerHa,
      costPerHour: breakdown.costPerHour,
    },
  };
}

// ============================================
// AGREGACJA KOSZTÓW POLA
// ============================================

export interface FieldCostAggregation {
  fieldId: string;
  season: number;
  totalCost: number;
  costPerHa: number;
  byCategory: Record<string, number>;
  entries: CostEntry[];
}

export function aggregateFieldCosts(
  fieldId: string,
  season: number,
  entries: CostEntry[],
  fieldAreaHa: number
): FieldCostAggregation {
  const fieldEntries = entries.filter(
    e => e.fieldId === fieldId && e.season === season
  );

  const byCategory: Record<string, number> = {};
  let totalCost = 0;

  for (const entry of fieldEntries) {
    totalCost += entry.amount;
    byCategory[entry.category] = (byCategory[entry.category] || 0) + entry.amount;
  }

  return {
    fieldId,
    season,
    totalCost: round2(totalCost),
    costPerHa: fieldAreaHa > 0 ? round2(totalCost / fieldAreaHa) : 0,
    byCategory,
    entries: fieldEntries,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

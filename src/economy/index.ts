// FMS 3.0 — FARM OS
// ECONOMY MODULE — Public API

// Types
export type {
  MachineCostParams,
  SessionCostBreakdown,
  SessionCostInput,
  AnnualMachineCost,
  FieldCostSummary,
  RevenueEntry,
  FieldMargin,
  CostCategory,
  CostEntry,
  FarmEconomySummary,
  FuelType,
} from './types';

export { DEFAULT_FUEL_PRICES, getDefaultCostParams } from './types';

// Calculator
export {
  calculateSessionCost,
  calculateDepreciationPerHour,
  calculateServicePerHour,
  calculateTheoreticalCapacity,
  calculateTimeForArea,
  calculateCostPerHaTheoretical,
  calculateAnnualCost,
  compareMachines,
  formatPLN,
  formatHa,
  formatHours,
  formatFuelPerHa,
} from './MachineCostCalculator';

export type { CostComparison, AnnualCostInput } from './MachineCostCalculator';

// Session Cost Integration
export {
  machineToCostParams,
  generateCostFromSession,
  aggregateFieldCosts,
} from './SessionCostIntegration';

export type { FieldCostAggregation } from './SessionCostIntegration';

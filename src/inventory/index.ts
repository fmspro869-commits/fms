// FMS 3.0 — FARM OS
// INVENTORY INTELLIGENCE — Public API

// Types
export type {
  InventoryItem,
  InventoryTransaction,
  Reservation,
  StockForecast,
  InventoryAlert,
  TaskWithInventory,
  TaskItemRequirement,
  InventoryCategory,
  UnitType,
  TransactionType,
  ReservationStatus,
  AlertSeverity,
  InventoryValuation,
  UsageReport,
} from './types';

// Engine
export {
  calculateStockForecast,
  generateInventoryAlerts,
  verifyTaskInventory,
  calculateAllForecasts,
  generateAllAlerts,
  calculateInventoryValuation,
  formatQuantity,
  formatDays,
} from './InventoryIntelligence';

export type { ForecastInput, AlertInput, VerifyTaskInput } from './InventoryIntelligence';

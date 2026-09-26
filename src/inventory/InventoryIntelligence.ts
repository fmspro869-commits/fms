// FMS 3.0 — FARM OS
// INVENTORY INTELLIGENCE — Core Engine
// Prognozy, rezerwacje, alerty, optymalizacja stanów

import type {
  InventoryItem,
  InventoryTransaction,
  Reservation,
  StockForecast,
  InventoryAlert,
  TaskWithInventory,
  TaskItemRequirement,
  InventoryCategory,
  AlertSeverity,
} from './types';

// ============================================
// KONFIGURACJA
// ============================================

const DEFAULT_LEAD_TIME_DAYS = 7;
const EXPIRY_WARNING_DAYS = 30;

// ============================================
// OBLICZANIE PROGNOZY
// ============================================

export interface ForecastInput {
  item: InventoryItem;
  activeReservations: Reservation[];
  plannedTasks: TaskWithInventory[];
  recentTransactions: InventoryTransaction[];
  averageDailyUsage?: number; // opcjonalnie — z historii
}

export function calculateStockForecast(input: ForecastInput): StockForecast {
  const { item, activeReservations, plannedTasks, recentTransactions } = input;

  // --- Aktualny stan ---
  const currentStock = item.currentStock;
  const reservedStock = activeReservations
    .filter(r => r.status === 'ACTIVE')
    .reduce((sum, r) => sum + r.quantity, 0);
  const availableStock = currentStock - reservedStock;

  // --- Planowane zużycie ---
  const plannedUsage = plannedTasks
    .filter(t => t.status === 'PLANNED')
    .reduce((sum, t) => {
      const req = t.items.find(i => i.itemId === item.id);
      return sum + (req?.quantity ?? 0);
    }, 0);

  // --- Prognoza AI/historyczna ---
  const forecastUsage = input.averageDailyUsage
    ? input.averageDailyUsage * 30 // na 30 dni
    : estimateUsageFromHistory(item, recentTransactions);

  // --- Wynik ---
  const projectedStock = availableStock - plannedUsage;
  const shortage = Math.max(0, plannedUsage - availableStock);
  const surplus = Math.max(0, availableStock - plannedUsage);

  // --- Czas ---
  const dailyUsageRate = input.averageDailyUsage ?? calculateDailyUsageRate(item, recentTransactions);
  const daysUntilShortage = dailyUsageRate > 0 && availableStock > 0
    ? Math.floor(availableStock / dailyUsageRate)
    : null;
  const daysOfSupply = dailyUsageRate > 0
    ? Math.floor(currentStock / dailyUsageRate)
    : null;

  // --- Zadania dotknięte ---
  const affectedTaskIds = shortage > 0
    ? plannedTasks
        .filter(t => t.status === 'PLANNED' && t.items.some(i => i.itemId === item.id))
        .map(t => t.taskId)
    : [];

  // --- Rekomendacja ---
  const leadTime = item.leadTimeDays ?? DEFAULT_LEAD_TIME_DAYS;
  const recommendation = determineRecommendation({
    availableStock,
    plannedUsage,
    shortage,
    daysUntilShortage,
    leadTime,
    reorderPoint: item.reorderPoint,
    minimumStock: item.minimumStock,
    targetStock: item.targetStock,
  });

  const suggestedOrderQuantity = calculateSuggestedOrder({
    targetStock: item.targetStock,
    currentStock,
    plannedUsage,
    shortage,
  });

  return {
    itemId: item.id,
    itemName: item.name,
    category: item.category,
    unit: item.unit,
    currentStock,
    reservedStock,
    availableStock,
    plannedUsage,
    forecastUsage,
    projectedStock,
    shortage,
    surplus,
    daysUntilShortage,
    daysOfSupply,
    affectedTaskIds,
    recommendation,
    suggestedOrderQuantity,
    calculatedAt: Date.now(),
  };
}

// ============================================
// REKOMENDACJE
// ============================================

interface RecommendationInput {
  availableStock: number;
  plannedUsage: number;
  shortage: number;
  daysUntilShortage: number | null;
  leadTime: number;
  reorderPoint: number;
  minimumStock: number;
  targetStock: number;
}

function determineRecommendation(input: RecommendationInput): StockForecast['recommendation'] {
  const { availableStock, shortage, daysUntilShortage, leadTime, reorderPoint, minimumStock, targetStock } = input;

  // Brak — pilne
  if (availableStock <= 0 || shortage > 0) {
    return 'URGENT';
  }

  // Za dużo
  if (targetStock > 0 && availableStock > targetStock * 1.5) {
    return 'OVERSTOCK';
  }

  // Zamów teraz — jeśli zabraknie przed dostawą
  if (daysUntilShortage !== null && daysUntilShortage <= leadTime) {
    return 'ORDER_NOW';
  }

  // Zamów wkrótce — poniżej punktu zamówienia
  if (reorderPoint > 0 && availableStock <= reorderPoint) {
    return 'ORDER_SOON';
  }

  // Niski stan — poniżej minimum
  if (minimumStock > 0 && availableStock <= minimumStock) {
    return 'ORDER_SOON';
  }

  return 'OK';
}

function calculateSuggestedOrder(input: {
  targetStock: number;
  currentStock: number;
  plannedUsage: number;
  shortage: number;
}): number {
  const { targetStock, currentStock, plannedUsage, shortage } = input;

  // Jeśli brak — pokryj brak + bufor
  if (shortage > 0) {
    return Math.ceil(shortage * 1.2); // 20% bufor
  }

  // Standardowo — do poziomu docelowego
  if (targetStock > 0) {
    const needed = targetStock - currentStock + plannedUsage;
    return Math.max(0, Math.ceil(needed));
  }

  return 0;
}

// ============================================
// ESTYMACJA Z HISTORII
// ============================================

function estimateUsageFromHistory(
  item: InventoryItem,
  transactions: InventoryTransaction[]
): number {
  // Weź zużycie z ostatnich 30 dni
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

  const recentUsage = transactions
    .filter(t =>
      t.itemId === item.id &&
      t.type === 'USAGE' &&
      t.date >= thirtyDaysAgo &&
      t.quantity < 0 // rozchód
    )
    .reduce((sum, t) => sum + Math.abs(t.quantity), 0);

  return recentUsage;
}

function calculateDailyUsageRate(
  item: InventoryItem,
  transactions: InventoryTransaction[]
): number {
  const usage = estimateUsageFromHistory(item, transactions);
  return usage / 30; // na dzień
}

// ============================================
// GENEROWANIE ALERTÓW
// ============================================

export interface AlertInput {
  item: InventoryItem;
  forecast: StockForecast;
  now?: number;
}

export function generateInventoryAlerts(input: AlertInput): InventoryAlert[] {
  const { item, forecast } = input;
  const now = input.now ?? Date.now();
  const alerts: InventoryAlert[] = [];

  // --- OUT OF STOCK ---
  if (forecast.availableStock <= 0) {
    alerts.push({
      id: `alert-oos-${item.id}`,
      itemId: item.id,
      itemName: item.name,
      severity: 'CRITICAL',
      type: 'OUT_OF_STOCK',
      title: `Brak w magazynie: ${item.name}`,
      message: `Dostępny stan: 0 ${item.unit}. Wymagane: ${forecast.plannedUsage} ${item.unit}.`,
      currentStock: 0,
      threshold: 0,
      suggestedAction: 'ZAMÓW NATYCHMIAST',
      actionRoute: '/inventory',
      createdAt: now,
    });
  }

  // --- LOW STOCK ---
  else if (item.minimumStock > 0 && forecast.availableStock <= item.minimumStock) {
    const severity: AlertSeverity = forecast.availableStock <= item.minimumStock * 0.5
      ? 'CRITICAL'
      : 'WARNING';

    alerts.push({
      id: `alert-low-${item.id}`,
      itemId: item.id,
      itemName: item.name,
      severity,
      type: 'LOW_STOCK',
      title: `Niski stan: ${item.name}`,
      message: `Dostępne: ${forecast.availableStock} ${item.unit}, minimum: ${item.minimumStock} ${item.unit}.`,
      currentStock: forecast.availableStock,
      threshold: item.minimumStock,
      suggestedAction: forecast.recommendation === 'URGENT' ? 'ZAMÓW NATYCHMIAST' : 'ZAPLANUJ ZAKUP',
      actionRoute: '/inventory',
      createdAt: now,
    });
  }

  // --- SHORTAGE FOR TASKS ---
  if (forecast.shortage > 0 && forecast.affectedTaskIds.length > 0) {
    alerts.push({
      id: `alert-shortage-${item.id}`,
      itemId: item.id,
      itemName: item.name,
      severity: 'CRITICAL',
      type: 'SHORTAGE_FOR_TASKS',
      title: `Brak dla zadań: ${item.name}`,
      message: `Brakuje ${forecast.shortage} ${item.unit} dla ${forecast.affectedTaskIds.length} zaplanowanych zadań.`,
      currentStock: forecast.availableStock,
      threshold: forecast.plannedUsage,
      suggestedAction: 'SPRAWDŹ ZADANIA',
      actionRoute: '/tasks',
      createdAt: now,
    });
  }

  // --- EXPIRING SOON ---
  if (item.expiryDate) {
    const daysToExpiry = Math.floor((item.expiryDate - now) / (24 * 60 * 60 * 1000));
    if (daysToExpiry <= EXPIRY_WARNING_DAYS && daysToExpiry > 0) {
      alerts.push({
        id: `alert-expiry-${item.id}`,
        itemId: item.id,
        itemName: item.name,
        severity: daysToExpiry <= 7 ? 'CRITICAL' : 'WARNING',
        type: 'EXPIRING_SOON',
        title: `Wygasa: ${item.name}`,
        message: `Pozostało ${daysToExpiry} dni do wygaśnięcia. Stan: ${forecast.currentStock} ${item.unit}.`,
        currentStock: forecast.currentStock,
        threshold: 0,
        suggestedAction: 'UŻYJ LUB SPRZEDAJ',
        createdAt: now,
      });
    }
  }

  // --- OVERSTOCK ---
  if (forecast.recommendation === 'OVERSTOCK') {
    alerts.push({
      id: `alert-overstock-${item.id}`,
      itemId: item.id,
      itemName: item.name,
      severity: 'INFO',
      type: 'OVERSTOCK',
      title: `Nadmiar: ${item.name}`,
      message: `Stan ${forecast.availableStock} ${item.unit} przekracza docelowy ${item.targetStock} ${item.unit}.`,
      currentStock: forecast.availableStock,
      threshold: item.targetStock,
      suggestedAction: 'ROZWAŻ SPRZEDAŻ',
      createdAt: now,
    });
  }

  return alerts;
}

// ============================================
// WERYFIKACJA ZADAŃ
// ============================================

export interface VerifyTaskInput {
  taskId: string;
  title: string;
  fieldId: string;
  fieldName: string;
  treatmentType: string;
  plannedDate: number;
  status: TaskWithInventory['status'];
  items: TaskItemRequirement[];
  inventory: InventoryItem[];
}

export function verifyTaskInventory(input: VerifyTaskInput): TaskWithInventory {
  const { items, inventory } = input;

  let totalEstimatedCost = 0;
  const missingItems: TaskWithInventory['missingItems'] = [];
  let inventoryReady = true;

  for (const req of items) {
    const item = inventory.find(i => i.id === req.itemId);
    if (!item) {
      missingItems.push({
        itemId: req.itemId,
        itemName: 'Nieznany produkt',
        shortage: req.quantity,
        unit: req.unit,
      });
      inventoryReady = false;
      continue;
    }

    // Sprawdź dostępność (stan - zarezerwowane)
    const available = item.currentStock - item.reservedStock;
    const shortage = Math.max(0, req.quantity - available);

    if (shortage > 0) {
      missingItems.push({
        itemId: item.id,
        itemName: item.name,
        shortage,
        unit: item.unit,
      });
      inventoryReady = false;
    }

    // Koszt
    const cost = (item.unitCost || item.lastPurchasePrice || 0) * req.quantity;
    totalEstimatedCost += cost;
  }

  return {
    taskId: input.taskId,
    title: input.title,
    fieldId: input.fieldId,
    fieldName: input.fieldName,
    treatmentType: input.treatmentType,
    plannedDate: input.plannedDate,
    status: input.status,
    items,
    totalEstimatedCost,
    inventoryReady,
    missingItems,
  };
}

// ============================================
// AGREGACJA — wiele itemów
// ============================================

export function calculateAllForecasts(
  items: InventoryItem[],
  reservations: Reservation[],
  tasks: TaskWithInventory[],
  transactions: InventoryTransaction[]
): StockForecast[] {
  return items.map(item => {
    const itemReservations = reservations.filter(r => r.itemId === item.id);
    const itemTasks = tasks.filter(t => t.items.some(i => i.itemId === item.id));
    const itemTransactions = transactions.filter(t => t.itemId === item.id);

    return calculateStockForecast({
      item,
      activeReservations: itemReservations,
      plannedTasks: itemTasks,
      recentTransactions: itemTransactions,
    });
  });
}

export function generateAllAlerts(
  items: InventoryItem[],
  forecasts: StockForecast[]
): InventoryAlert[] {
  const alerts: InventoryAlert[] = [];

  for (const forecast of forecasts) {
    const item = items.find(i => i.id === forecast.itemId);
    if (!item) continue;

    const itemAlerts = generateInventoryAlerts({ item, forecast });
    alerts.push(...itemAlerts);
  }

  // Sortuj po severity
  const severityOrder = { CRITICAL: 0, WARNING: 1, INFO: 2 };
  return alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
}

// ============================================
// WYCENA MAGAZYNU
// ============================================

export function calculateInventoryValuation(items: InventoryItem[]): {
  totalValue: number;
  byCategory: Record<InventoryCategory, number>;
  topValueItems: { itemId: string; name: string; value: number }[];
} {
  let totalValue = 0;
  const byCategory: Record<string, number> = {};
  const itemValues: { itemId: string; name: string; value: number }[] = [];

  for (const item of items) {
    const value = item.currentStock * (item.unitCost || item.lastPurchasePrice || 0);
    totalValue += value;

    byCategory[item.category] = (byCategory[item.category] || 0) + value;

    itemValues.push({
      itemId: item.id,
      name: item.name,
      value,
    });
  }

  const topValueItems = itemValues
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  return {
    totalValue: round2(totalValue),
    byCategory: byCategory as Record<InventoryCategory, number>,
    topValueItems,
  };
}

// ============================================
// HELPERS
// ============================================

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function formatQuantity(quantity: number, unit: string): string {
  if (quantity >= 1000 && (unit === 'L' || unit === 'KG')) {
    return `${(quantity / 1000).toFixed(2)} ${unit === 'L' ? 'kL' : 't'}`;
  }
  return `${quantity} ${unit}`;
}

export function formatDays(days: number | null): string {
  if (days === null) return '—';
  if (days === 0) return 'dziś';
  if (days === 1) return '1 dzień';
  if (days < 7) return `${days} dni`;
  if (days < 30) return `${Math.floor(days / 7)} tyg.`;
  return `${Math.floor(days / 30)} mies.`;
}

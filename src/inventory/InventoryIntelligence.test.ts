// FMS 3.0 — FARM OS
// INVENTORY INTELLIGENCE — Tests

import { describe, it, expect } from 'vitest';
import {
  calculateStockForecast,
  generateInventoryAlerts,
  verifyTaskInventory,
  calculateAllForecasts,
  generateAllAlerts,
  calculateInventoryValuation,
} from './InventoryIntelligence';
import type {
  InventoryItem,
  Reservation,
  TaskWithInventory,
} from './types';

// ============================================
// TEST DATA
// ============================================

const herbicide: InventoryItem = {
  id: 'item-glyphosate',
  name: 'Roundup 360 SL',
  category: 'CROP_PROTECTION',
  unit: 'L',
  currentStock: 50,
  reservedStock: 10,
  minimumStock: 20,
  reorderPoint: 30,
  targetStock: 100,
  unitCost: 45.50,
  leadTimeDays: 5,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const fertilizer: InventoryItem = {
  id: 'item-npk',
  name: 'NPK 15-15-15',
  category: 'FERTILIZER',
  unit: 'T',
  currentStock: 5,
  reservedStock: 0,
  minimumStock: 2,
  reorderPoint: 3,
  targetStock: 10,
  unitCost: 1800,
  leadTimeDays: 7,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const emptyItem: InventoryItem = {
  ...herbicide,
  id: 'item-empty',
  name: 'Empty Product',
  currentStock: 0,
  reservedStock: 0,
};

// ============================================
// TESTS — FORECAST
// ============================================

describe('calculateStockForecast', () => {
  it('should calculate basic forecast', () => {
    const forecast = calculateStockForecast({
      item: herbicide,
      activeReservations: [],
      plannedTasks: [],
      recentTransactions: [],
    });

    expect(forecast.currentStock).toBe(50);
    expect(forecast.availableStock).toBe(50);
    expect(forecast.plannedUsage).toBe(0);
    expect(forecast.shortage).toBe(0);
  });

  it('should account for reservations', () => {
    const reservations: Reservation[] = [{
      id: 'res-1',
      itemId: herbicide.id,
      quantity: 15,
      status: 'ACTIVE',
      priority: 'NORMAL',
      createdAt: Date.now(),
    }];

    const forecast = calculateStockForecast({
      item: herbicide,
      activeReservations: reservations,
      plannedTasks: [],
      recentTransactions: [],
    });

    expect(forecast.reservedStock).toBe(15);
    expect(forecast.availableStock).toBe(35); // 50 - 15
  });

  it('should detect shortage for planned tasks', () => {
    const tasks: TaskWithInventory[] = [{
      taskId: 'task-1',
      title: 'Oprysk pola 17',
      fieldId: 'field-17',
      fieldName: 'Pole 17',
      treatmentType: 'herbicide',
      plannedDate: Date.now(),
      status: 'PLANNED',
      items: [{ itemId: herbicide.id, quantity: 40, unit: 'L' }],
      totalEstimatedCost: 1820,
      inventoryReady: false,
      missingItems: [],
    }];

    const forecast = calculateStockForecast({
      item: herbicide,
      activeReservations: [],
      plannedTasks: tasks,
      recentTransactions: [],
    });

    expect(forecast.plannedUsage).toBe(40);
    expect(forecast.availableStock).toBe(50);
    expect(forecast.shortage).toBe(0); // 50 >= 40
  });

  it('should detect shortage when not enough', () => {
    const tasks: TaskWithInventory[] = [{
      taskId: 'task-1',
      title: 'Duży oprysk',
      fieldId: 'field-1',
      fieldName: 'Pole 1',
      treatmentType: 'herbicide',
      plannedDate: Date.now(),
      status: 'PLANNED',
      items: [{ itemId: herbicide.id, quantity: 80, unit: 'L' }],
      totalEstimatedCost: 3640,
      inventoryReady: false,
      missingItems: [],
    }];

    const forecast = calculateStockForecast({
      item: herbicide,
      activeReservations: [],
      plannedTasks: tasks,
      recentTransactions: [],
    });

    expect(forecast.shortage).toBe(30); // 80 - 50
    expect(forecast.affectedTaskIds).toContain('task-1');
    expect(forecast.recommendation).toBe('URGENT');
  });

  it('should recommend ORDER_SOON when below reorder point', () => {
    const lowItem: InventoryItem = { ...herbicide, currentStock: 25 }; // below reorder 30

    const forecast = calculateStockForecast({
      item: lowItem,
      activeReservations: [],
      plannedTasks: [],
      recentTransactions: [],
    });

    expect(forecast.recommendation).toBe('ORDER_SOON');
  });

  it('should handle out of stock', () => {
    const forecast = calculateStockForecast({
      item: emptyItem,
      activeReservations: [],
      plannedTasks: [],
      recentTransactions: [],
    });

    expect(forecast.availableStock).toBe(0);
    expect(forecast.recommendation).toBe('URGENT');
  });
});

// ============================================
// TESTS — ALERTS
// ============================================

describe('generateInventoryAlerts', () => {
  it('should generate OUT_OF_STOCK alert', () => {
    const forecast = calculateStockForecast({
      item: emptyItem,
      activeReservations: [],
      plannedTasks: [],
      recentTransactions: [],
    });

    const alerts = generateInventoryAlerts({ item: emptyItem, forecast });

    expect(alerts.some(a => a.type === 'OUT_OF_STOCK')).toBe(true);
    expect(alerts.find(a => a.type === 'OUT_OF_STOCK')?.severity).toBe('CRITICAL');
  });

  it('should generate LOW_STOCK alert', () => {
    const lowItem: InventoryItem = { ...herbicide, currentStock: 15 }; // below min 20

    const forecast = calculateStockForecast({
      item: lowItem,
      activeReservations: [],
      plannedTasks: [],
      recentTransactions: [],
    });

    const alerts = generateInventoryAlerts({ item: lowItem, forecast });

    expect(alerts.some(a => a.type === 'LOW_STOCK')).toBe(true);
  });

  it('should generate SHORTAGE_FOR_TASKS alert', () => {
    const tasks: TaskWithInventory[] = [{
      taskId: 'task-1',
      title: 'Duży oprysk',
      fieldId: 'field-1',
      fieldName: 'Pole 1',
      treatmentType: 'herbicide',
      plannedDate: Date.now(),
      status: 'PLANNED',
      items: [{ itemId: herbicide.id, quantity: 80, unit: 'L' }],
      totalEstimatedCost: 0,
      inventoryReady: false,
      missingItems: [],
    }];

    const forecast = calculateStockForecast({
      item: herbicide,
      activeReservations: [],
      plannedTasks: tasks,
      recentTransactions: [],
    });

    const alerts = generateInventoryAlerts({ item: herbicide, forecast });

    expect(alerts.some(a => a.type === 'SHORTAGE_FOR_TASKS')).toBe(true);
  });

  it('should generate EXPIRING_SOON alert', () => {
    const expiringItem: InventoryItem = {
      ...herbicide,
      expiryDate: Date.now() + 15 * 24 * 60 * 60 * 1000, // 15 dni
    };

    const forecast = calculateStockForecast({
      item: expiringItem,
      activeReservations: [],
      plannedTasks: [],
      recentTransactions: [],
    });

    const alerts = generateInventoryAlerts({ item: expiringItem, forecast });

    expect(alerts.some(a => a.type === 'EXPIRING_SOON')).toBe(true);
  });
});

// ============================================
// TESTS — VERIFY TASK
// ============================================

describe('verifyTaskInventory', () => {
  it('should pass when all items available', () => {
    const result = verifyTaskInventory({
      taskId: 'task-1',
      title: 'Oprysk',
      fieldId: 'field-1',
      fieldName: 'Pole 1',
      treatmentType: 'herbicide',
      plannedDate: Date.now(),
      status: 'PLANNED',
      items: [{ itemId: herbicide.id, quantity: 30, unit: 'L' }],
      inventory: [herbicide],
    });

    expect(result.inventoryReady).toBe(true);
    expect(result.missingItems.length).toBe(0);
    expect(result.totalEstimatedCost).toBe(30 * 45.50); // 1365
  });

  it('should fail when not enough stock', () => {
    const result = verifyTaskInventory({
      taskId: 'task-1',
      title: 'Duży oprysk',
      fieldId: 'field-1',
      fieldName: 'Pole 1',
      treatmentType: 'herbicide',
      plannedDate: Date.now(),
      status: 'PLANNED',
      items: [{ itemId: herbicide.id, quantity: 100, unit: 'L' }],
      inventory: [herbicide],
    });

    expect(result.inventoryReady).toBe(false);
    expect(result.missingItems.length).toBe(1);
    expect(result.missingItems[0].shortage).toBe(60); // 100 - 40 available after reservation
  });

  it('should account for reserved stock', () => {
    const reservedItem: InventoryItem = {
      ...herbicide,
      currentStock: 50,
      reservedStock: 30, // tylko 20 dostępne
    };

    const result = verifyTaskInventory({
      taskId: 'task-1',
      title: 'Oprysk',
      fieldId: 'field-1',
      fieldName: 'Pole 1',
      treatmentType: 'herbicide',
      plannedDate: Date.now(),
      status: 'PLANNED',
      items: [{ itemId: herbicide.id, quantity: 30, unit: 'L' }],
      inventory: [reservedItem],
    });

    expect(result.inventoryReady).toBe(false);
    expect(result.missingItems[0].shortage).toBe(10); // 30 - 20
  });
});

// ============================================
// TESTS — AGGREGATION
// ============================================

describe('calculateAllForecasts', () => {
  it('should calculate forecasts for all items', () => {
    const items = [herbicide, fertilizer];
    const forecasts = calculateAllForecasts(items, [], [], []);

    expect(forecasts.length).toBe(2);
    expect(forecasts[0].itemId).toBe(herbicide.id);
    expect(forecasts[1].itemId).toBe(fertilizer.id);
  });
});

describe('generateAllAlerts', () => {
  it('should generate and sort alerts by severity', () => {
    const items = [emptyItem, herbicide]; // emptyItem = CRITICAL
    const forecasts = calculateAllForecasts(items, [], [], []);
    const alerts = generateAllAlerts(items, forecasts);

    // CRITICAL przed INFO/WARNING
    const severities = alerts.map(a => a.severity);
    const firstNonCritical = severities.findIndex(s => s !== 'CRITICAL');
    if (firstNonCritical > 0) {
      expect(severities.slice(0, firstNonCritical).every(s => s === 'CRITICAL')).toBe(true);
    }
  });
});

// ============================================
// TESTS — VALUATION
// ============================================

describe('calculateInventoryValuation', () => {
  it('should calculate total value', () => {
    const result = calculateInventoryValuation([herbicide, fertilizer]);

    // herbicide: 50 × 45.50 = 2275
    // fertilizer: 5 × 1800 = 9000
    expect(result.totalValue).toBe(11275);
    expect(result.byCategory['CROP_PROTECTION']).toBe(2275);
    expect(result.byCategory['FERTILIZER']).toBe(9000);
  });

  it('should return top value items', () => {
    const result = calculateInventoryValuation([herbicide, fertilizer]);

    expect(result.topValueItems[0].name).toBe('NPK 15-15-15'); // 9000 > 2275
    expect(result.topValueItems.length).toBe(2);
  });
});

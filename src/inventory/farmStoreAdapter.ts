import type { WarehouseItem } from '@/types';
import type { InventoryItem, InventoryTransaction } from './types';

const CATEGORY_MAP: Record<string, InventoryItem['category']> = {
  nasiona: 'SEED',
  nawozy: 'FERTILIZER',
  'ŚOR': 'CROP_PROTECTION',
  paliwo: 'FUEL',
  części: 'SPARE_PARTS',
};

function mapUnit(unit: string): InventoryItem['unit'] {
  switch (unit.toLocaleLowerCase('pl-PL')) {
    case 'l': return 'L';
    case 'kg': return 'KG';
    case 't': return 'T';
    default: return 'PCS';
  }
}

export function toInventoryItem(item: WarehouseItem): InventoryItem {
  return {
    id: item.id,
    name: item.name,
    category: CATEGORY_MAP[item.category] ?? 'OTHER',
    unit: mapUnit(item.unit),
    currentStock: item.stock,
    reservedStock: 0,
    minimumStock: item.minStock,
    reorderPoint: item.minStock,
    targetStock: item.minStock > 0 ? item.minStock * 2 : 0,
    unitCost: item.price,
    lastPurchasePrice: item.price,
    supplierName: item.supplier,
    leadTimeDays: 7,
    storageLocation: undefined,
    createdAt: Date.parse(`${item.purchaseDate}T12:00:00`) || 0,
    updatedAt: Date.now(),
  };
}

export function toInventoryItems(items: WarehouseItem[]): InventoryItem[] {
  return items.map(toInventoryItem);
}

export function toInventoryTransactions(items: WarehouseItem[]): InventoryTransaction[] {
  return items.flatMap((item) =>
    item.history.flatMap((entry) => {
      if (entry.type === 'korekta') return [];
      const date = Date.parse(`${entry.date}T12:00:00`);
      if (!Number.isFinite(date)) return [];

      return [{
        id: entry.id,
        itemId: item.id,
        type: entry.type === 'przyjęcie' ? 'PURCHASE' : 'USAGE',
        quantity: entry.type === 'przyjęcie' ? Math.abs(entry.qty) : -Math.abs(entry.qty),
        date,
        unitCost: item.price,
        totalCost: Math.abs(entry.qty) * item.price,
        notes: entry.note,
      }];
    }),
  );
}

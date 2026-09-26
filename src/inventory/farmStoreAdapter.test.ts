import { describe, expect, it } from 'vitest';
import type { WarehouseItem } from '@/types';
import { toInventoryItem, toInventoryTransactions } from './farmStoreAdapter';

const item: WarehouseItem = {
  id: 'fertilizer-1',
  name: 'Saletra',
  category: 'nawozy',
  producer: 'Producent',
  unit: 'kg',
  stock: 850,
  minStock: 200,
  price: 2,
  supplier: 'Dostawca',
  purchaseDate: '2026-01-10',
  history: [
    { id: 'purchase-1', date: '2026-01-10', type: 'przyjęcie', qty: 1000, note: 'Zakup' },
    { id: 'usage-1', date: '2026-02-10', type: 'rozchód', qty: 150, note: 'Nawożenie' },
    { id: 'adjustment-1', date: '2026-02-11', type: 'korekta', qty: 850, note: 'Spis' },
  ],
};

describe('warehouse store adapter', () => {
  it('maps the current product model into inventory forecast inputs', () => {
    expect(toInventoryItem(item)).toMatchObject({
      id: item.id,
      category: 'FERTILIZER',
      unit: 'KG',
      currentStock: 850,
      minimumStock: 200,
      reorderPoint: 200,
      targetStock: 400,
      unitCost: 2,
    });
  });

  it('converts stock movements into signed transactions and excludes absolute corrections', () => {
    const transactions = toInventoryTransactions([item]);

    expect(transactions).toHaveLength(2);
    expect(transactions[0]).toMatchObject({ type: 'PURCHASE', quantity: 1000 });
    expect(transactions[1]).toMatchObject({ type: 'USAGE', quantity: -150 });
  });
});

import { useMemo } from 'react';
import { Card, fmtNum, fmtPLN } from '@/components/common';
import { calculateAllForecasts, calculateInventoryValuation, generateAllAlerts } from '@/inventory';
import { toInventoryItems, toInventoryTransactions } from '@/inventory/farmStoreAdapter';
import type { WarehouseItem } from '@/types';

const RECOMMENDATION_LABELS = {
  OK: 'Stan prawidłowy',
  ORDER_SOON: 'Zaplanuj zamówienie',
  ORDER_NOW: 'Zamów przed kolejnym zużyciem',
  URGENT: 'Pilny brak / niedobór',
  OVERSTOCK: 'Stan ponad docelowy',
} as const;

export function InventoryInsights({ items }: { items: WarehouseItem[] }) {
  const { forecasts, alerts, valuation } = useMemo(() => {
    const inventoryItems = toInventoryItems(items);
    const transactions = toInventoryTransactions(items);
    const stockForecasts = calculateAllForecasts(inventoryItems, [], [], transactions);

    return {
      forecasts: stockForecasts,
      alerts: generateAllAlerts(inventoryItems, stockForecasts),
      valuation: calculateInventoryValuation(inventoryItems),
    };
  }, [items]);

  return (
    <div className="space-y-3" data-testid="inventory-insights">
      <div className="grid sm:grid-cols-3 gap-3">
        <Card className="!p-3">
          <div className="text-xs text-slate-400">Wartość zapasu</div>
          <div className="text-xl font-bold text-emerald-300">{fmtPLN(valuation.totalValue)}</div>
        </Card>
        <Card className="!p-3">
          <div className="text-xs text-slate-400">Pozycje wymagające uwagi</div>
          <div className="text-xl font-bold text-amber-300">{alerts.length}</div>
        </Card>
        <Card className="!p-3">
          <div className="text-xs text-slate-400">Asortyment</div>
          <div className="text-xl font-bold text-slate-100">{items.length} pozycji</div>
        </Card>
      </div>

      <Card>
        <h3 className="font-semibold text-slate-100 mb-1">Prognoza zapasów</h3>
        <p className="text-xs text-slate-500 mb-3">
          Zużycie szacowane z historii rozchodów. Rezerwacje i zapotrzebowanie zadań nie są obecnie zapisane w modelu magazynu.
        </p>
        {forecasts.length === 0 ? (
          <p className="text-sm text-slate-400">Brak produktów do analizy.</p>
        ) : (
          <div className="space-y-2">
            {forecasts.map((forecast) => (
              <div key={forecast.itemId} className="rounded-lg border border-slate-700/60 bg-slate-900/40 p-3">
                <div className="flex flex-wrap justify-between gap-2">
                  <strong className="text-sm text-slate-100">{forecast.itemName}</strong>
                  <span className={`text-xs ${forecast.recommendation === 'OK' ? 'text-emerald-400' : 'text-amber-300'}`}>
                    {RECOMMENDATION_LABELS[forecast.recommendation]}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                  <span>Dostępne: {fmtNum(forecast.availableStock, 0)} {forecast.unit}</span>
                  <span>Wartość: {fmtPLN(forecast.currentStock * (items.find((item) => item.id === forecast.itemId)?.price ?? 0))}</span>
                  <span>Dni zapasu: {forecast.daysOfSupply === null ? 'brak historii zużycia' : forecast.daysOfSupply}</span>
                  {forecast.suggestedOrderQuantity > 0 && (
                    <span className="text-amber-300">Sugerowane zamówienie: {fmtNum(forecast.suggestedOrderQuantity, 0)} {forecast.unit}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

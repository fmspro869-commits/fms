// FMS 3.0 — FARM OS
// INVENTORY INTELLIGENCE — Types
// Inteligentny magazyn: prognozy, rezerwacje, alerty

// ============================================
// ROZSZERZONY MODEL MAGAZYNU
// ============================================

export type InventoryCategory =
  | 'SEED'              // materiał siewny
  | 'FERTILIZER'        // nawozy
  | 'CROP_PROTECTION'   // środki ochrony roślin
  | 'FUEL'              // paliwo
  | 'LUBRICANT'         // oleje, smary
  | 'SPARE_PARTS'       // części zamienne
  | 'TOOLS'             // narzędzia
  | 'OTHER';

export type UnitType =
  | 'L'        // litry
  | 'KG'       // kilogramy
  | 'T'        // tony
  | 'PCS'      // sztuki
  | 'M3'       // metry sześcienne
  | 'HA'       // hektary (np. folia)
  | 'PACK'     // opakowania
  | 'BAG';     // worki

export interface InventoryItem {
  id: string;
  name: string;
  category: InventoryCategory;
  unit: UnitType;

  // Aktualny stan
  currentStock: number;
  reservedStock: number;

  // Progi
  minimumStock: number;       // alert przy spadku poniżej
  reorderPoint: number;       // punkt zamówienia
  targetStock: number;        // docelowy stan

  // Koszty
  unitCost: number;           // zł/jednostka
  lastPurchasePrice?: number;
  averagePurchasePrice?: number;

  // Dostawca
  supplierId?: string;
  supplierName?: string;
  leadTimeDays?: number;      // czas dostawy

  // Metadane
  expiryDate?: number;        // data ważności
  batchNumber?: string;
  storageLocation?: string;
  notes?: string;

  // Agronomiczne
  activeSubstance?: string;   // substancja czynna (np. glyphosate)
  concentration?: number;     // stężenie %

  // System
  createdAt: number;
  updatedAt: number;
}

// ============================================
// TRANSAKCJE
// ============================================

export type TransactionType =
  | 'PURCHASE'      // zakup
  | 'USAGE'         // zużycie w polu
  | 'TRANSFER_IN'   // przesunięcie między magazynami
  | 'TRANSFER_OUT'
  | 'ADJUSTMENT'    // korekta inwentarzowa
  | 'RESERVATION'   // rezerwacja dla zadania
  | 'RELEASE';      // zwolnienie rezerwacji

export interface InventoryTransaction {
  id: string;
  itemId: string;
  type: TransactionType;

  quantity: number;           // dodatnia = przychód, ujemna = rozchód

  // Kontekst
  date: number;
  fieldId?: string;
  taskId?: string;
  sessionId?: string;
  machineId?: string;

  // Dokument
  documentNumber?: string;
  supplierInvoice?: string;

  // Koszt
  unitCost?: number;
  totalCost?: number;

  // Kto
  userId?: string;
  operatorId?: string;

  notes?: string;
}

// ============================================
// REZERWACJE
// ============================================

export type ReservationStatus =
  | 'ACTIVE'        // aktywna
  | 'FULFILLED'     // zrealizowana (zużyta)
  | 'CANCELLED'     // anulowana
  | 'EXPIRED';      // wygasła

export interface Reservation {
  id: string;
  itemId: string;
  quantity: number;
  status: ReservationStatus;

  // Dla czego
  taskId?: string;
  fieldId?: string;
  treatmentType?: string;

  // Kiedy
  createdAt: number;
  neededBy?: number;          // deadline
  fulfilledAt?: number;

  // Priorytet
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';

  notes?: string;
}

// ============================================
// PROGNOZY I ALERTY
// ============================================

export interface StockForecast {
  itemId: string;
  itemName: string;
  category: InventoryCategory;
  unit: UnitType;

  // Stany
  currentStock: number;
  reservedStock: number;
  availableStock: number;     // current - reserved

  // Zapotrzebowanie
  plannedUsage: number;       // z zaplanowanych zadań
  forecastUsage: number;      // z prognozy AI/historycznej

  // Wynik
  projectedStock: number;     // available - plannedUsage
  shortage: number;           // max(0, plannedUsage - available)
  surplus: number;            // max(0, available - plannedUsage)

  // Czas
  daysUntilShortage: number | null;  // kiedy zabraknie przy temp zużycia
  daysOfSupply: number | null;       // ile dni wystarczy

  // Zadania dotknięte brakiem
  affectedTaskIds: string[];

  // Rekomendacja
  recommendation: 'OK' | 'ORDER_SOON' | 'ORDER_NOW' | 'URGENT' | 'OVERSTOCK';
  suggestedOrderQuantity: number;

  calculatedAt: number;
}

export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface InventoryAlert {
  id: string;
  itemId: string;
  itemName: string;
  severity: AlertSeverity;
  type:
    | 'LOW_STOCK'
    | 'OUT_OF_STOCK'
    | 'EXPIRING_SOON'
    | 'OVERSTOCK'
    | 'SHORTAGE_FOR_TASKS'
    | 'SUPPLIER_DELAY';

  title: string;
  message: string;

  // Dane
  currentStock: number;
  threshold: number;

  // Akcja
  suggestedAction?: string;
  actionRoute?: string;

  createdAt: number;
  readAt?: number;
  resolvedAt?: number;
}

// ============================================
// ZADANIA Z POTRZEBAMI MAGAZYNOWYMI
// ============================================

export interface TaskItemRequirement {
  itemId: string;
  quantity: number;
  unit: UnitType;

  // Opcjonalnie — obliczone z dawki
  dosePerHa?: number;
  areaHa?: number;
}

export interface TaskWithInventory {
  taskId: string;
  title: string;
  fieldId: string;
  fieldName: string;
  treatmentType: string;
  plannedDate: number;
  status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

  items: TaskItemRequirement[];
  totalEstimatedCost: number;

  // Czy wszystko dostępne
  inventoryReady: boolean;
  missingItems: { itemId: string; itemName: string; shortage: number; unit: UnitType }[];
}

// ============================================
// RAPORTY
// ============================================

export interface InventoryValuation {
  totalValue: number;
  byCategory: Record<InventoryCategory, number>;
  byLocation: Record<string, number>;
  topValueItems: { itemId: string; name: string; value: number }[];
  slowMovingItems: { itemId: string; name: string; daysSinceMovement: number }[];
}

export interface UsageReport {
  period: { start: number; end: number };
  byItem: {
    itemId: string;
    itemName: string;
    category: InventoryCategory;
    totalUsed: number;
    unit: UnitType;
    totalCost: number;
    usedInFields: string[];
  }[];
  byCategory: Record<InventoryCategory, { quantity: number; cost: number }>;
}

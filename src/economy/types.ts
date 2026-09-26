// FMS 3.0 — FARM OS
// ECONOMY MODULE — Types
// Jednolity model kosztów dla maszyn, pracy i gospodarstwa

// ============================================
// MASZYNY — Parametry kosztowe
// ============================================

export type FuelType = 'DIESEL' | 'PETROL' | 'ELECTRIC' | 'LPG' | 'HYBRID';

export interface MachineCostParams {
  // Paliwo
  fuelType: FuelType;
  fuelConsumption: number;        // l/h lub kWh/h
  fuelPrice: number;              // zł/l lub zł/kWh

  // Amortyzacja
  purchasePrice: number;          // zł
  purchaseYear: number;           // rok zakupu
  expectedLifetimeYears: number;  // lata
  expectedLifetimeHours: number;  // roboczogodziny
  salvageValue: number;           // wartość końcowa zł

  // Serwis i utrzymanie
  annualServiceCost: number;      // zł/rok
  serviceCostPerHour: number;     // zł/h (alternatywnie)

  // Praca
  operatorCostPerHour: number;    // zł/h
  insurancePerYear: number;       // zł/rok

  // Parametry pracy
  workingWidth: number;           // m
  averageSpeed: number;           // km/h
  fieldEfficiency: number;        // 0-1 (np. 0.85 = 85%)
}

// ============================================
// KOSZT SESJI PRACY
// ============================================

export interface SessionCostBreakdown {
  // Składowe kosztu
  fuelCost: number;
  depreciationCost: number;
  serviceCost: number;
  operatorCost: number;
  insuranceCost: number;

  // Sumy
  totalCost: number;
  costPerHa: number;
  costPerHour: number;
  costPerTon?: number;            // jeśli znany plon

  // Metadane
  currency: string;               // 'PLN'
  calculatedAt: number;           // timestamp
  sessionId: string;
}

export interface SessionCostInput {
  sessionId: string;
  machineId: string;
  fieldId: string;
  durationHours: number;          // rzeczywisty czas pracy
  areaHa: number;                 // rzeczywista powierzchnia
  fuelUsed?: number;              // opcjonalnie — jeśli znane rzeczywiste zużycie
  fuelPriceOverride?: number;     // opcjonalnie — inna cena paliwa
  operatorCostOverride?: number;  // opcjonalnie — inny koszt operatora
}

// ============================================
// KOSZT ROK / SEZON
// ============================================

export interface AnnualMachineCost {
  machineId: string;
  year: number;

  // Sumy z sesji
  totalHours: number;
  totalAreaHa: number;
  totalFuelUsed: number;
  totalFuelCost: number;
  totalDepreciation: number;
  totalService: number;
  totalOperator: number;
  totalInsurance: number;
  totalCost: number;

  // Średnie
  avgCostPerHa: number;
  avgCostPerHour: number;
  avgFuelPerHa: number;

  // Porównanie z planem
  plannedCost?: number;
  variance?: number;              // różnica plan vs rzeczywiste
}

// ============================================
// KOSZT POLA / UPRAWY
// ============================================

export interface FieldCostSummary {
  fieldId: string;
  season: number;                 // rok

  // Wszystkie koszty
  totalCost: number;
  costPerHa: number;

  // Rozbicie na kategorie
  byCategory: {
    SEED: number;
    FERTILIZER: number;
    CROP_PROTECTION: number;
    MACHINE_WORK: number;
    FUEL: number;
    LABOR: number;
    SERVICES: number;
    OTHER: number;
  };

  // Źródła
  sessions: string[];             // ID sesji
  treatments: string[];           // ID zabiegów
}

// ============================================
// PRZYCHODY I MARŻA
// ============================================

export interface RevenueEntry {
  id: string;
  fieldId: string;
  season: number;
  type: 'CROP_SALE' | 'SUBSIDY' | 'OTHER';
  amount: number;
  quantity?: number;              // tony
  pricePerTon?: number;           // zł/t
  date: number;
  notes?: string;
}

export interface FieldMargin {
  fieldId: string;
  season: number;
  revenue: number;
  costs: number;
  margin: number;
  marginPerHa: number;
  marginPercent: number;
}

// ============================================
// KATEGORIE KOSZTÓW
// ============================================

export type CostCategory =
  | 'SEED'                    // materiał siewny
  | 'FERTILIZER'              // nawozy
  | 'CROP_PROTECTION'         // ochrona roślin
  | 'MACHINE_WORK'            // praca maszyn
  | 'FUEL'                    // paliwo (bezpośrednie)
  | 'LABOR'                   // robocizna
  | 'SERVICES'                // usługi zewnętrzne
  | 'TRANSPORT'               // transport
  | 'DRYING'                  // suszenie
  | 'STORAGE'                 // magazynowanie
  | 'INSURANCE'               // ubezpieczenie
  | 'TAXES'                   // podatki i opłaty
  | 'LAND_RENT'               // dzierżawa
  | 'DEPRECIATION'            // amortyzacja
  | 'INTEREST'                // odsetki
  | 'OTHER';

export interface CostEntry {
  id: string;
  fieldId?: string;             // opcjonalnie — koszt ogólny
  category: CostCategory;
  amount: number;
  date: number;
  season: number;

  // Źródło
  source: 'MANUAL' | 'SESSION' | 'TREATMENT' | 'INVENTORY' | 'IMPORT';
  sourceId?: string;            // ID sesji/zabiegu/transakcji

  // Szczegóły
  description: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number;

  // Maszyna (jeśli dotyczy)
  machineId?: string;

  // Rozbicie (opcjonalnie)
  breakdown?: Partial<SessionCostBreakdown>;
}

// ============================================
// EKONOMIA GOSPODARSTWA
// ============================================

export interface FarmEconomySummary {
  season: number;

  // Przychody
  totalRevenue: number;
  revenueBySource: Record<string, number>;

  // Koszty
  totalCosts: number;
  costsByCategory: Record<CostCategory, number>;
  costsByField: Record<string, number>;

  // Wynik
  grossMargin: number;
  grossMarginPerHa: number;

  // Struktura
  totalAreaHa: number;
  costStructure: {
    direct: number;             // koszty bezpośrednie
    fixed: number;              // koszty stałe
    variable: number;           // koszty zmienne
  };
}

// ============================================
// HELPERS
// ============================================

export const DEFAULT_FUEL_PRICES: Record<FuelType, number> = {
  DIESEL: 6.50,      // zł/l
  PETROL: 6.80,
  ELECTRIC: 1.20,    // zł/kWh
  LPG: 3.50,
  HYBRID: 5.50,
};

export function getDefaultCostParams(): MachineCostParams {
  return {
    fuelType: 'DIESEL',
    fuelConsumption: 15,          // l/h
    fuelPrice: DEFAULT_FUEL_PRICES.DIESEL,
    purchasePrice: 500000,
    purchaseYear: new Date().getFullYear(),
    expectedLifetimeYears: 15,
    expectedLifetimeHours: 10000,
    salvageValue: 50000,
    annualServiceCost: 15000,
    serviceCostPerHour: 0,        // obliczane z annualServiceCost
    operatorCostPerHour: 30,
    insurancePerYear: 5000,
    workingWidth: 3,
    averageSpeed: 8,
    fieldEfficiency: 0.85,
  };
}

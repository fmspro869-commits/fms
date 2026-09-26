// FMS 3.0 — FARM OS
// FEATURE 3: YIELD ANALYSIS
// Analiza plonów i porównanie

// ============================================
// TYPES
// ============================================

export interface YieldRecord {
  id: string;
  fieldId: string;
  fieldName: string;
  year: number;

  // Uprawa
  crop: string;
  variety: string;

  // Plon
  yield_t_per_ha: number;      // t/ha
  totalYield: number;          // t
  areaHa: number;
  moisture: number;            // %

  // Jakość
  quality: {
    protein?: number;          // %
    gluten?: number;           // %
    oil?: number;              // %
    starch?: number;           // %
    fallingNumber?: number;
    testWeight?: number;       // kg/hl
  };

  // Zabiegi
  treatments: {
    type: string;
    product: string;
    date: number;
    cost: number;
  }[];

  // Koszty
  totalCost: number;
  costPerHa: number;

  // Przychód
  pricePerTon: number;
  revenue: number;
  revenuePerHa: number;

  // Marża
  margin: number;
  marginPerHa: number;
}

export interface VarietyComparison {
  variety: string;
  crop: string;

  // Statystyki
  fields: number;
  avgYield: number;
  minYield: number;
  maxYield: number;
  stdDev: number;

  // Stabilność
  stability: number;           // 0-100 (niższe odchylenie = wyższa stabilność)

  // Jakość
  avgQuality: {
    protein?: number;
    oil?: number;
  };

  // Dochodowość
  avgMarginPerHa: number;
  avgRevenuePerHa: number;

  // Ranking
  rank: number;
}

export interface FieldPerformance {
  fieldId: string;
  fieldName: string;

  // Historia
  years: number;
  avgYield: number;
  trend: 'IMPROVING' | 'DECLINING' | 'STABLE';

  // Najlepsze/najgorsze
  bestCrop?: { crop: string; year: number; yield: number };
  worstCrop?: { crop: string; year: number; yield: number };

  // Dochodowość
  avgMarginPerHa: number;

  // Potencjał
  potential: number;           // 0-100
  recommendation: string;
}

export interface YieldAnalysisReport {
  generatedAt: number;
  season: number;

  // Podsumowanie
  summary: {
    totalFields: number;
    totalArea: number;
    avgYield: number;
    totalRevenue: number;
    totalMargin: number;
  };

  // Ranking odmian
  varietyRanking: VarietyComparison[];

  // Wydajność pól
  fieldPerformance: FieldPerformance[];

  // Rekomendacje
  recommendations: string[];
}

// ============================================
// YIELD ANALYSIS ENGINE
// ============================================

export function analyzeYields(
  records: YieldRecord[],
  season: number
): YieldAnalysisReport {
  // Filtruj rekordy z sezonu
  const seasonRecords = records.filter(r => r.year === season);

  // Analiza odmian
  const varietyRanking = analyzeVarieties(seasonRecords);

  // Analiza pól
  const fieldPerformance = analyzeFields(records);

  // Podsumowanie
  const summary = {
    totalFields: new Set(seasonRecords.map(r => r.fieldId)).size,
    totalArea: seasonRecords.reduce((sum, r) => sum + r.areaHa, 0),
    avgYield: seasonRecords.length > 0
      ? seasonRecords.reduce((sum, r) => sum + r.yield_t_per_ha, 0) / seasonRecords.length
      : 0,
    totalRevenue: seasonRecords.reduce((sum, r) => sum + r.revenue, 0),
    totalMargin: seasonRecords.reduce((sum, r) => sum + r.margin, 0),
  };

  // Rekomendacje
  const recommendations = generateRecommendations(varietyRanking, fieldPerformance);

  return {
    generatedAt: Date.now(),
    season,
    summary,
    varietyRanking,
    fieldPerformance,
    recommendations,
  };
}

function analyzeVarieties(records: YieldRecord[]): VarietyComparison[] {
  // Grupuj po odmianach
  const byVariety = new Map<string, YieldRecord[]>();

  for (const r of records) {
    const key = `${r.crop}-${r.variety}`;
    if (!byVariety.has(key)) byVariety.set(key, []);
    byVariety.get(key)!.push(r);
  }

  // Analizuj każdą odmianę
  const comparisons: VarietyComparison[] = [];

  for (const varietyRecords of byVariety.values()) {
    const yields = varietyRecords.map(r => r.yield_t_per_ha);
    const avgYield = yields.reduce((a, b) => a + b, 0) / yields.length;
    const minYield = Math.min(...yields);
    const maxYield = Math.max(...yields);

    // Odchylenie standardowe
    const variance = yields.reduce((sum, y) => sum + Math.pow(y - avgYield, 2), 0) / yields.length;
    const stdDev = Math.sqrt(variance);

    // Stabilność (odwrotność wariancji)
    const stability = avgYield > 0 ? Math.max(0, 100 - (stdDev / avgYield) * 100) : 0;

    // Jakość
    const avgProtein = varietyRecords
      .filter(r => r.quality.protein)
      .reduce((sum, r, _, arr) => sum + (r.quality.protein || 0) / arr.length, 0);

    const avgOil = varietyRecords
      .filter(r => r.quality.oil)
      .reduce((sum, r, _, arr) => sum + (r.quality.oil || 0) / arr.length, 0);

    // Dochodowość
    const avgMarginPerHa = varietyRecords
      .reduce((sum, r) => sum + r.marginPerHa, 0) / varietyRecords.length;

    const avgRevenuePerHa = varietyRecords
      .reduce((sum, r) => sum + r.revenuePerHa, 0) / varietyRecords.length;

    const crop = varietyRecords[0].crop;
    const variety = varietyRecords[0].variety;

    comparisons.push({
      variety,
      crop,
      fields: varietyRecords.length,
      avgYield: round2(avgYield),
      minYield: round2(minYield),
      maxYield: round2(maxYield),
      stdDev: round2(stdDev),
      stability: round2(stability),
      avgQuality: {
        protein: avgProtein > 0 ? round2(avgProtein) : undefined,
        oil: avgOil > 0 ? round2(avgOil) : undefined,
      },
      avgMarginPerHa: round2(avgMarginPerHa),
      avgRevenuePerHa: round2(avgRevenuePerHa),
      rank: 0, // wypełnione później
    });
  }

  // Ranking (po plonie)
  comparisons.sort((a, b) => b.avgYield - a.avgYield);
  comparisons.forEach((c, i) => c.rank = i + 1);

  return comparisons;
}

function analyzeFields(allRecords: YieldRecord[]): FieldPerformance[] {
  // Grupuj po polach
  const byField = new Map<string, YieldRecord[]>();

  for (const r of allRecords) {
    if (!byField.has(r.fieldId)) byField.set(r.fieldId, []);
    byField.get(r.fieldId)!.push(r);
  }

  const performance: FieldPerformance[] = [];

  for (const [fieldId, records] of byField) {
    // Sortuj po roku
    const sorted = [...records].sort((a, b) => a.year - b.year);

    // Trend (regresja liniowa uproszczona)
    const firstHalf = sorted.slice(0, Math.floor(sorted.length / 2));
    const secondHalf = sorted.slice(Math.floor(sorted.length / 2));

    const firstAvg = firstHalf.reduce((s, r) => s + r.yield_t_per_ha, 0) / (firstHalf.length || 1);
    const secondAvg = secondHalf.reduce((s, r) => s + r.yield_t_per_ha, 0) / (secondHalf.length || 1);

    let trend: 'IMPROVING' | 'DECLINING' | 'STABLE' = 'STABLE';
    if (secondAvg > firstAvg * 1.05) trend = 'IMPROVING';
    else if (secondAvg < firstAvg * 0.95) trend = 'DECLINING';

    // Najlepsze/najgorsze
    const best = sorted.reduce((a, b) => a.yield_t_per_ha > b.yield_t_per_ha ? a : b);
    const worst = sorted.reduce((a, b) => a.yield_t_per_ha < b.yield_t_per_ha ? a : b);

    // Średnia marża
    const avgMargin = sorted.reduce((s, r) => s + r.marginPerHa, 0) / sorted.length;

    // Potencjał (na podstawie trendu i stabilności)
    const potential = Math.min(100, Math.max(0,
      50 + (trend === 'IMPROVING' ? 20 : trend === 'DECLINING' ? -20 : 0) +
      (secondAvg - firstAvg) * 10
    ));

    // Rekomendacja
    let recommendation = '';
    if (trend === 'DECLINING') {
      recommendation = 'Pole wymaga uwagi — analiza gleby i nawożenia';
    } else if (trend === 'IMPROVING') {
      recommendation = 'Dobre zarządzanie — kontynuuj praktyki';
    } else {
      recommendation = 'Stabilne plony — rozważ intensyfikację';
    }

    performance.push({
      fieldId,
      fieldName: records[0].fieldName,
      years: sorted.length,
      avgYield: round2(sorted.reduce((s, r) => s + r.yield_t_per_ha, 0) / sorted.length),
      trend,
      bestCrop: { crop: best.crop, year: best.year, yield: best.yield_t_per_ha },
      worstCrop: { crop: worst.crop, year: worst.year, yield: worst.yield_t_per_ha },
      avgMarginPerHa: round2(avgMargin),
      potential: round2(potential),
      recommendation,
    });
  }

  // Sortuj po średniej marży
  performance.sort((a, b) => b.avgMarginPerHa - a.avgMarginPerHa);

  return performance;
}

function generateRecommendations(
  varieties: VarietyComparison[],
  fields: FieldPerformance[]
): string[] {
  const recs: string[] = [];

  // Najlepsza odmiana
  if (varieties.length > 0) {
    const best = varieties[0];
    recs.push(`🏆 Najlepsza odmiana: ${best.variety} (${best.avgYield} t/ha, marża ${best.avgMarginPerHa} zł/ha)`);
  }

  // Najbardziej stabilna
  const mostStable = varieties.reduce<VarietyComparison | undefined>(
    (best, current) => !best || current.stability > best.stability ? current : best,
    undefined,
  );
  if (mostStable) {
    recs.push(`📊 Najbardziej stabilna: ${mostStable.variety} (stabilność ${mostStable.stability}%)`);
  }

  // Pole z problemem
  const declining = fields.filter(f => f.trend === 'DECLINING');
  if (declining.length > 0) {
    recs.push(`⚠️ ${declining.length} pól ze spadkiem plonów — wymagają analizy`);
  }

  // Pole z największym potencjałem
  const highPotential = fields.filter(f => f.potential > 70);
  if (highPotential.length > 0) {
    recs.push(`💡 ${highPotential.length} pól z wysokim potencjałem — rozważ inwestycje`);
  }

  return recs;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ============================================
// HELPERS
// ============================================

export function formatYield(t_per_ha: number): string {
  return `${t_per_ha.toFixed(2)} t/ha`;
}

export function formatMargin(zl_per_ha: number): string {
  return `${zl_per_ha.toFixed(0)} zł/ha`;
}

export function getTrendIcon(trend: 'IMPROVING' | 'DECLINING' | 'STABLE'): string {
  switch (trend) {
    case 'IMPROVING': return '📈';
    case 'DECLINING': return '📉';
    case 'STABLE': return '➡️';
  }
}

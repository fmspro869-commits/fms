import type { CropHistory, Field, Treatment } from '@/types';
import type { YieldRecord } from './YieldAnalysis';

export function toYieldRecords(
  history: CropHistory[],
  fields: Pick<Field, 'id' | 'name' | 'area'>[],
  treatments: Pick<Treatment, 'fieldId' | 'season' | 'date' | 'type' | 'productName' | 'cost'>[] = [],
): YieldRecord[] {
  const fieldsById = new Map(fields.map((field) => [field.id, field]));

  return history.map((record) => {
    const field = fieldsById.get(record.fieldId);
    const areaHa = field?.area ?? 0;
    const totalYield = record.yield * areaHa;
    const margin = record.revenue - record.costs;

    return {
      id: record.id,
      fieldId: record.fieldId,
      fieldName: field?.name ?? 'Nieznane pole',
      year: record.season,
      crop: record.crop,
      variety: record.variety,
      yield_t_per_ha: record.yield,
      totalYield,
      areaHa,
      moisture: 0,
      quality: {},
      treatments: treatments
        .filter((treatment) => treatment.fieldId === record.fieldId && treatment.season === record.season)
        .map((treatment) => ({
          type: treatment.type,
          product: treatment.productName ?? '',
          date: Date.parse(`${treatment.date}T12:00:00`) || 0,
          cost: treatment.cost,
        })),
      totalCost: record.costs,
      costPerHa: areaHa > 0 ? record.costs / areaHa : 0,
      pricePerTon: totalYield > 0 ? record.revenue / totalYield : 0,
      revenue: record.revenue,
      revenuePerHa: areaHa > 0 ? record.revenue / areaHa : 0,
      margin,
      marginPerHa: areaHa > 0 ? margin / areaHa : 0,
    };
  });
}

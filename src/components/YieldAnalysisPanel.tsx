import { useMemo, useState } from 'react';
import { Badge, Card, fmtNum, fmtPLN, Select } from '@/components/common';
import { toYieldRecords } from '@/features/farmAnalytics';
import { analyzeYields, getTrendIcon } from '@/features/YieldAnalysis';
import type { CropHistory, Field, Treatment } from '@/types';

interface Props {
  history: CropHistory[];
  fields: Pick<Field, 'id' | 'name' | 'area'>[];
  treatments: Pick<Treatment, 'fieldId' | 'season' | 'date' | 'type' | 'productName' | 'cost'>[];
}

export function YieldAnalysisPanel({ history, fields, treatments }: Props) {
  const records = useMemo(() => toYieldRecords(history, fields, treatments), [history, fields, treatments]);
  const seasons = useMemo(() => [...new Set(records.map((record) => record.year))].sort((a, b) => b - a), [records]);
  const [selectedSeason, setSelectedSeason] = useState('');
  const season = Number(selectedSeason) || seasons[0] || new Date().getFullYear();
  const report = useMemo(() => analyzeYields(records, season), [records, season]);

  return (
    <div className="space-y-3" data-testid="yield-analysis">
      <Card className="!p-3">
        <Select label="Sezon zbioru" value={String(season)} onChange={(event) => setSelectedSeason(event.target.value)}>
          {seasons.map((year) => <option key={year} value={year}>{year}</option>)}
        </Select>
      </Card>
      {report.summary.totalFields === 0 ? (
        <Card><p className="text-sm text-slate-400">Brak zapisanych danych zbiorów w sezonie {season}.</p></Card>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
            <Metric label="Pola ze zbiorem" value={String(report.summary.totalFields)} />
            <Metric label="Powierzchnia" value={`${fmtNum(report.summary.totalArea)} ha`} />
            <Metric label="Średni plon" value={`${fmtNum(report.summary.avgYield)} t/ha`} />
            <Metric label="Przychód" value={fmtPLN(report.summary.totalRevenue)} />
          </div>
          <Card>
            <h3 className="font-semibold text-slate-100 mb-3">🏆 Odmiany — ranking według plonu</h3>
            {report.varietyRanking.length === 0 ? (
              <p className="text-sm text-slate-400">Brak danych odmian dla tego sezonu.</p>
            ) : (
              <div className="space-y-2">
                {report.varietyRanking.map((variety) => (
                  <div key={`${variety.crop}-${variety.variety}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-slate-900/40 p-2 text-sm">
                    <span className="w-6 text-slate-500">#{variety.rank}</span>
                    <span className="flex-1 text-slate-100">{variety.crop} · {variety.variety}</span>
                    <span className="text-emerald-300">{fmtNum(variety.avgYield)} t/ha</span>
                    <span className="text-slate-400">marża {fmtPLN(variety.avgMarginPerHa)}/ha</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card>
            <h3 className="font-semibold text-slate-100 mb-3">Pola i trend plonowania</h3>
            <div className="space-y-2">
              {report.fieldPerformance.map((field) => (
                <div key={field.fieldId} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="flex-1 text-slate-100">{field.fieldName}</span>
                  <span className="text-slate-300">{fmtNum(field.avgYield)} t/ha</span>
                  <Badge tone={field.trend === 'IMPROVING' ? 'ok' : field.trend === 'DECLINING' ? 'warn' : 'muted'}>
                    {getTrendIcon(field.trend)} {field.trend}
                  </Badge>
                  <span className="w-full text-xs text-slate-500">{field.recommendation}</span>
                </div>
              ))}
            </div>
          </Card>
          {report.recommendations.length > 0 && (
            <Card>
              <h3 className="font-semibold text-slate-100 mb-2">Wnioski</h3>
              <ul className="space-y-1 text-sm text-slate-300">
                {report.recommendations.map((recommendation) => <li key={recommendation}>{recommendation}</li>)}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card className="!p-3">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-xl font-bold text-slate-100">{value}</div>
    </Card>
  );
}

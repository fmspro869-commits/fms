import { useMemo } from 'react';
import { useFarm } from '@/store/FarmContext';
import { Card, fmtNum, fmtPLN } from '@/components/common';
import { generateCostFromSession } from '@/economy';
import type { CostEntry } from '@/economy';
import type { FieldWorkSession } from '@/types';

export function MachineSessionCosts() {
  const { state } = useFarm();
  const { estimates, errors } = useMemo(() => {
    const rows: { session: FieldWorkSession; cost: CostEntry }[] = [];
    const messages: string[] = [];

    for (const session of state.sessions) {
      if (session.status !== 'completed' || !session.endedAt) continue;
      const machineId = session.machineId || session.tractorId;
      const machine = state.machines.find((candidate) => candidate.id === machineId);
      if (!machine) continue;

      try {
        rows.push({ session, cost: generateCostFromSession(session, machine) });
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        messages.push(`${session.fieldName}: ${error.message}`);
      }
    }

    return { estimates: rows, errors: messages };
  }, [state.sessions, state.machines]);

  return (
    <Card data-testid="machine-session-costs">
      <h3 className="font-semibold text-slate-100">🚜 Szacowany koszt zakończonych sesji Field Pilot</h3>
      <p className="text-xs text-slate-500 mt-1 mb-3">
        Kalkulacja obejmuje paliwo, amortyzację, serwis, operatora i ubezpieczenie. Brakujące parametry maszyny są szacowane wartościami domyślnymi.
      </p>
      {errors.length > 0 && (
        <div role="alert" className="mb-3 rounded-lg border border-amber-500/40 bg-amber-900/20 p-2 text-xs text-amber-200">
          Nie udało się policzyć {errors.length} sesji: {errors.join(' · ')}
        </div>
      )}
      {estimates.length === 0 ? (
        <p className="text-sm text-slate-400">Brak zakończonych sesji z przypisaną maszyną.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-700">
                <th className="py-2 pr-3">Pole / zabieg</th>
                <th className="pr-3">Maszyna</th>
                <th className="pr-3 text-right">Obszar</th>
                <th className="pr-3 text-right">Koszt</th>
                <th className="text-right">Koszt/ha</th>
              </tr>
            </thead>
            <tbody>
              {estimates.map(({ session, cost }) => (
                <tr key={session.id} className="border-b border-slate-800">
                  <td className="py-2 pr-3 text-slate-200">{session.fieldName} · {session.treatmentType}</td>
                  <td className="pr-3 text-slate-400">{state.machines.find((machine) => machine.id === cost.machineId)?.name}</td>
                  <td className="pr-3 text-right text-slate-300">{fmtNum(session.areaCovered)} ha</td>
                  <td className="pr-3 text-right text-emerald-300">{fmtPLN(cost.amount)}</td>
                  <td className="text-right text-slate-300">{fmtPLN(cost.breakdown?.costPerHa ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

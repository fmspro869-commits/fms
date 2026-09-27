import type { GuidanceInfo } from '@/hooks/useFieldGuidance';

export function GuidanceBar({ info, night }: { info: GuidanceInfo; night: boolean }) {
  const { xte, steer, quality, activeLine } = info;
  const cells = 11;
  const center = Math.floor(cells / 2);
  // pozycja na lewo/prawo od linii; jesteś na +normal (lewo) gdy xte>0 → kropka po lewej
  const devCells = Math.max(-center, Math.min(center, Math.round(-xte / 0.2)));
  const dotIndex = center + devCells;

  const qColor = (active: boolean, dist: number) => {
    if (!active) return night ? 'bg-[#1a0505]' : 'bg-slate-800';
    if (dist === 0) return night ? 'bg-[#ff5a52]' : 'bg-emerald-400';
    if (dist <= 1) return night ? 'bg-[#ff3b30]' : 'bg-lime-400';
    if (dist <= 2) return night ? 'bg-[#ff3b30]' : 'bg-amber-400';
    return night ? 'bg-[#b00000]' : 'bg-red-500';
  };

  const qText = night ? 'text-[#ff5a52]' : quality === 'ideal' ? 'text-emerald-400' : quality === 'good' ? 'text-lime-400' : quality === 'correct' ? 'text-amber-400' : 'text-red-400';

  return (
    <div className="flex w-full select-none items-center gap-2" data-testid="guidance-lightbar" aria-label={`Odchylenie ${Math.abs(xte).toFixed(2)} m, ${steer === 'left' ? 'w lewo' : steer === 'right' ? 'w prawo' : 'na linii'}`}>
      <span className={`w-10 shrink-0 text-right text-xs font-bold tabular-nums ${xte > 0.05 ? (Math.abs(xte) >= 1 ? 'text-red-400' : 'text-amber-300') : xte < -0.05 ? (Math.abs(xte) >= 1 ? 'text-red-400' : 'text-amber-300') : qText}`} data-testid="xte-value">
        {Math.abs(xte).toFixed(2)} m
      </span>
      <div className="flex min-w-0 flex-1 items-center justify-center gap-1" aria-hidden="true">
        <span className={`text-xs font-black ${steer === 'left' ? (Math.abs(xte) >= 1 ? 'text-red-400' : 'text-amber-300') : 'text-white/20'}`}>◀</span>
        {Array.from({ length: cells }).map((_, i) => {
          const dist = Math.abs(i - center);
          const active = i === dotIndex || (dotIndex > center && i > center && i <= dotIndex) || (dotIndex < center && i < center && i >= dotIndex) || (dotIndex === center && i === center);
          const isCenterCell = i === center;
          return (
            <div
              key={i}
              className={`h-2.5 min-w-1 flex-1 max-w-7 rounded-full transition-colors duration-150 ${qColor(active, dist)} ${isCenterCell ? (night ? 'ring-1 ring-[#ff5a52]/60' : 'ring-1 ring-emerald-300/60') : ''}`}
            />
          );
        })}
        <span className={`text-xs font-black ${steer === 'right' ? (Math.abs(xte) >= 1 ? 'text-red-400' : 'text-amber-300') : 'text-white/20'}`}>▶</span>
      </div>
      <span className={`w-12 shrink-0 text-[9px] font-bold uppercase tracking-wide ${night ? 'text-[#ff5a52]/70' : 'text-slate-400'}`}>{activeLine?.label ?? 'CENTER'}</span>
    </div>
  );
}

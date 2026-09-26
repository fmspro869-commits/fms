import type { GNSSStatus, FixType } from '@/precision/gnss/PositionData';
import { fixTypeToLabel } from '@/precision/gnss/PositionData';

interface StatusConfig {
  dot: string;
  label: string;
  colorClass: string;
  bgClass: string;
  textClass: string;
}

const STATUS_CONFIG: Record<FixType, StatusConfig> = {
  RTK_FIX: {
    dot: '🟢',
    label: 'RTK FIX',
    colorClass: 'text-emerald-400',
    bgClass: 'bg-emerald-500/20 border-emerald-500/50',
    textClass: 'text-emerald-300',
  },
  RTK_FLOAT: {
    dot: '🟡',
    label: 'RTK FLOAT',
    colorClass: 'text-amber-400',
    bgClass: 'bg-amber-500/20 border-amber-500/50',
    textClass: 'text-amber-300',
  },
  GNSS: {
    dot: '🔵',
    label: 'GNSS',
    colorClass: 'text-sky-400',
    bgClass: 'bg-sky-500/20 border-sky-500/50',
    textClass: 'text-sky-300',
  },
  GPS: {
    dot: '⚪',
    label: 'PHONE GPS',
    colorClass: 'text-slate-300',
    bgClass: 'bg-slate-500/20 border-slate-500/50',
    textClass: 'text-slate-300',
  },
  NONE: {
    dot: '🔴',
    label: 'NO SIGNAL',
    colorClass: 'text-red-400',
    bgClass: 'bg-red-500/20 border-red-500/50',
    textClass: 'text-red-300',
  },
};

interface GpsStatusProps {
  status: GNSSStatus;
  accuracy: number | null;
  satellites?: number | null;
  compact?: boolean;
  night?: boolean;
}

export function GpsStatus({ status, accuracy, satellites, compact = false, night = false }: GpsStatusProps) {
  const cfg = STATUS_CONFIG[status.fixType];
  const isDemo = status.isDemo;

  if (compact) {
    return (
      <span 
        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-xs font-bold ${cfg.bgClass}`}
        data-testid="gps-status-compact"
      >
        <span>{isDemo ? '🧪' : cfg.dot}</span>
        <span className={cfg.colorClass}>
          {isDemo ? 'DEMO' : cfg.label}
        </span>
        {accuracy !== null && (
          <span className="text-slate-400 tabular-nums">
            ±{accuracy.toFixed(1)}m
          </span>
        )}
      </span>
    );
  }

  return (
    <div 
      className={`inline-flex flex-wrap items-center gap-2 px-3 py-2 rounded-xl border ${cfg.bgClass} ${night ? 'bg-black/50' : ''}`}
      data-testid="gps-status"
    >
      {/* Główny status */}
      <div className="flex items-center gap-2">
        <span className="text-lg">{isDemo ? '🧪' : cfg.dot}</span>
        <div>
          <div className={`text-sm font-bold ${cfg.colorClass}`}>
            {isDemo ? '🧪 DEMO MODE' : cfg.label}
          </div>
          <div className="text-[10px] text-slate-500 uppercase tracking-wide">
            {status.source === 'PHONE' ? 'GPS urządzenia' :
             status.source === 'EXTERNAL_GNSS' ? 'Odbiornik zewnętrzny' :
             status.source === 'DEMO' ? 'Symulacja' :
             status.source === 'NTRIP' ? 'NTRIP' : status.source}
          </div>
        </div>
      </div>

      {/* Dokładność */}
      {accuracy !== null && (
        <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-black/30">
          <span className="text-[10px] text-slate-500">ACC</span>
          <span className={`text-sm font-bold tabular-nums ${cfg.textClass}`}>
            ±{accuracy.toFixed(2)} m
          </span>
        </div>
      )}

      {/* Satelity */}
      {satellites != null && satellites > 0 && (
        <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-black/30">
          <span className="text-[10px] text-slate-500">SAT</span>
          <span className={`text-sm font-bold tabular-nums ${cfg.textClass}`}>
            {satellites}
          </span>
        </div>
      )}

      {/* HDOP */}
      {status.correctionStatus !== 'NONE' && status.correctionStatus !== 'UNKNOWN' && (
        <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-black/30">
          <span className="text-[10px] text-slate-500">CORR</span>
          <span className={`text-sm font-bold ${cfg.textClass}`}>
            {status.correctionStatus}
          </span>
        </div>
      )}
    </div>
  );
}

// ============================================
// WERSJA MINIMALNA — tylko kropka + label
// ============================================

export function GpsStatusDot({ status }: { status: GNSSStatus }) {
  const cfg = STATUS_CONFIG[status.fixType];
  return (
    <span 
      className={`inline-flex items-center gap-1 text-xs font-bold ${cfg.colorClass}`}
      title={isDemoLabel(status)}
    >
      <span>{status.isDemo ? '🧪' : cfg.dot}</span>
      {!status.isDemo && <span>{cfg.label}</span>}
    </span>
  );
}

function isDemoLabel(status: GNSSStatus): string {
  if (status.isDemo) return 'DEMO — symulacja GPS';
  return `${fixTypeToLabel(status.fixType)} — ${status.signalQuality}`;
}

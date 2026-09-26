// FMS PRECISION 3.0 — GNSS/RTK ENGINE
// Jednolity model danych pozycji dla wszystkich zrodel GNSS/RTK
// Nie falszujemy danych — null gdy urzadzenie nie dostarcza wartosci

export type FixType = 'NONE' | 'GPS' | 'GNSS' | 'RTK_FLOAT' | 'RTK_FIX';
export type PositionSource = 'PHONE' | 'EXTERNAL_GNSS' | 'DEMO' | 'NTRIP' | 'BLUETOOTH';

export type SignalQuality = 'excellent' | 'good' | 'fair' | 'poor' | 'none';
export type CorrectionStatus = 'NONE' | 'SBAS' | 'RTK_FLOAT' | 'RTK_FIX' | 'UNKNOWN';

export interface PositionData {
  // Podstawowe (zawsze obecne)
  latitude: number;
  longitude: number;
  timestamp: number; // ms od epoch

  // Jakość pozycji (null gdy nieznane)
  altitude: number | null; // m npm
  accuracy: number | null; // m (68% confidence)
  speed: number | null; // m/s
  heading: number | null; // deg [0..360)

  // Szczegóły GNSS (null gdy nie dostępne)
  fixType: FixType;
  satellites: number | null; // użyte satelity
  satellitesInView: number | null;
  hdop: number | null;
  vdop: number | null;
  pdop: number | null;
  ageOfCorrection: number | null; // sekundy od ostatniej korekty

  // Źródło
  source: PositionSource;
  isDemo: boolean; // 🧪 flaga demo — zawsze widoczna w UI
}

export interface GNSSStatus {
  fixType: FixType;
  signalQuality: SignalQuality;
  correctionStatus: CorrectionStatus;
  correctionAge: number | null;
  source: PositionSource;
  isDemo: boolean;
}

// ============================================
// KONWERSJE — kompatybilność wsteczna z GpsFix
// ============================================

export interface GpsFix {
  lat: number;
  lng: number;
  accuracy: number; // m
  speed: number; // m/s, -1 gdy brak
  heading: number; // deg lub NaN
  altitude?: number | null;
  timestamp: number;
}

/** Konwersja istniejącego GpsFix na PositionData */
export function gpsFixToPosition(fix: GpsFix, source: PositionSource = 'PHONE'): PositionData {
  return {
    latitude: fix.lat,
    longitude: fix.lng,
    timestamp: fix.timestamp,
    altitude: fix.altitude ?? null,
    accuracy: fix.accuracy >= 0 ? fix.accuracy : null,
    speed: fix.speed >= 0 ? fix.speed : null,
    heading: !Number.isNaN(fix.heading) ? fix.heading : null,
    fixType: source === 'PHONE' ? 'GPS' : 'GNSS',
    satellites: null,
    satellitesInView: null,
    hdop: null,
    vdop: null,
    pdop: null,
    ageOfCorrection: null,
    source,
    isDemo: source === 'DEMO',
  };
}

/** Konwersja PositionData na GpsFix (dla istniejących komponentów) */
export function positionToGpsFix(p: PositionData): GpsFix {
  return {
    lat: p.latitude,
    lng: p.longitude,
    accuracy: p.accuracy ?? 999,
    speed: p.speed ?? -1,
    heading: p.heading ?? NaN,
    altitude: p.altitude,
    timestamp: p.timestamp,
  };
}

// ============================================
// STATUS HELPERS
// ============================================

export function accuracyToSignalQuality(accuracy: number | null): SignalQuality {
  if (accuracy === null) return 'none';
  if (accuracy <= 0.05) return 'excellent'; // RTK FIX
  if (accuracy <= 0.3) return 'excellent'; // RTK FLOAT
  if (accuracy <= 1) return 'good'; // DGPS/GNSS
  if (accuracy <= 5) return 'good'; // dobry GPS
  if (accuracy <= 10) return 'fair';
  if (accuracy <= 30) return 'poor';
  return 'none';
}

export function fixTypeToLabel(fixType: FixType): string {
  switch (fixType) {
    case 'RTK_FIX': return 'RTK FIX';
    case 'RTK_FLOAT': return 'RTK FLOAT';
    case 'GNSS': return 'GNSS';
    case 'GPS': return 'PHONE GPS';
    case 'NONE': return 'NO SIGNAL';
  }
}

export function fixTypeToColor(fixType: FixType): string {
  switch (fixType) {
    case 'RTK_FIX': return '#22c55e'; // zielony
    case 'RTK_FLOAT': return '#eab308'; // żółty
    case 'GNSS': return '#3b82f6'; // niebieski
    case 'GPS': return '#9ca3af'; // szary
    case 'NONE': return '#ef4444'; // czerwony
  }
}

/** Czy pozycja jest wystarczająco dokładna do precyzyjnego prowadzenia */
export function isPrecisionGuidanceReady(status: GNSSStatus): boolean {
  return status.fixType === 'RTK_FIX' || status.fixType === 'RTK_FLOAT';
}

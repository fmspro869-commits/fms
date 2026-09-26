import { useEffect, useRef, useState } from 'react';

export interface GpsFix {
  lat: number;
  lng: number;
  accuracy: number; // m
  speed: number; // m/s (>=0, -1 gdy brak)
  heading: number; // deg lub NaN gdy brak
  altitude?: number | null; // m npm (jeśli dostępne)
  timestamp: number;
}

export type GpsStatusKind = 'none' | 'weak' | 'fix';

export interface GpsState {
  fix: GpsFix | null;
  status: GpsStatusKind;
  error: string | null;
  supported: boolean;
}

const ERR: Record<number, string> = {
  1: 'Brak zgody na dostęp do lokalizacji. Włącz lokalizację dla tej strony.',
  2: 'Pozycja GPS niedostępna. Sprawdź sygnał / ustawienia lokalizacji.',
  3: 'Przekroczono czas oczekiwania na pozycję GPS.',
};

/** Ciągły monitoring pozycji GNSS przez watchPosition. */
export function useGps(enabled: boolean): GpsState {
  const [fix, setFix] = useState<GpsFix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const supported = typeof navigator !== 'undefined' && 'geolocation' in navigator;
  const watchId = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (!supported) {
      setError('Ten przeglądarka/urządzenie nie udostępnia GPS.');
      return;
    }
    setError(null);
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const c = pos.coords;
        setFix({
          lat: c.latitude,
          lng: c.longitude,
          accuracy: c.accuracy ?? 999,
          speed: typeof c.speed === 'number' && c.speed >= 0 ? c.speed : -1,
          heading: typeof c.heading === 'number' && !Number.isNaN(c.heading) ? c.heading : NaN,
          altitude: typeof c.altitude === 'number' && !Number.isNaN(c.altitude) ? c.altitude : null,
          timestamp: pos.timestamp,
        });
        setError(null);
      },
      (err) => {
        setError(ERR[err.code] || 'Nieznany błąd GPS.');
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );
    return () => {
      if (watchId.current !== null) {
        navigator.geolocation.clearWatch(watchId.current);
        watchId.current = null;
      }
    };
  }, [enabled, supported]);

  let status: GpsStatusKind = 'none';
  if (fix) status = fix.accuracy <= 5 ? 'fix' : 'weak';

  return { fix, status, error, supported };
}

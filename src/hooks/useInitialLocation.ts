import { useCallback, useEffect, useState } from 'react';

interface LocationResult {
  center: [number, number] | null;
  error: string | null;
  loading: boolean;
}

interface InitialLocationState extends LocationResult {
  requestLocation: () => void;
}

export function useInitialLocation(): InitialLocationState {
  const [location, setLocation] = useState<LocationResult>(() => ({
    center: null,
    error: typeof navigator !== 'undefined' && !('geolocation' in navigator)
      ? 'Ta przeglądarka nie udostępnia lokalizacji.'
      : null,
    loading: false,
  }));

  const requestLocation = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setLocation({
        center: null,
        error: 'Ta przeglądarka nie udostępnia lokalizacji.',
        loading: false,
      });
      return;
    }
    if (!window.isSecureContext) {
      setLocation({
        center: null,
        error: 'Lokalizacja wymaga bezpiecznego połączenia HTTPS.',
        loading: false,
      });
      return;
    }

    setLocation((current) => ({ ...current, error: null, loading: true }));
    try {
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => setLocation({
          center: [coords.longitude, coords.latitude],
          error: null,
          loading: false,
        }),
        (error) => setLocation({
          center: null,
          error: error.code === error.PERMISSION_DENIED
            ? 'Dostęp do lokalizacji został zablokowany. Zezwól na lokalizację w ustawieniach przeglądarki i spróbuj ponownie.'
            : error.code === error.POSITION_UNAVAILABLE
              ? 'Urządzenie nie udostępniło pozycji. Sprawdź ustawienia GPS i spróbuj ponownie.'
              : 'Przekroczono czas oczekiwania na GPS. Spróbuj ponownie na zewnątrz.',
          loading: false,
        }),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
      );
    } catch (error) {
      setLocation({
        center: null,
        error: error instanceof Error ? error.message : 'Nie można uruchomić lokalizacji.',
        loading: false,
      });
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(requestLocation, 0);
    return () => window.clearTimeout(timer);
  }, [requestLocation]);

  return { ...location, requestLocation };
}

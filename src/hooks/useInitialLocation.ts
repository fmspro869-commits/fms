import { useEffect, useState } from 'react';

interface InitialLocationState {
  center: [number, number] | null;
  error: string | null;
}

export function useInitialLocation(): InitialLocationState {
  const [location, setLocation] = useState<InitialLocationState>(() => ({
    center: null,
    error: typeof navigator !== 'undefined' && !('geolocation' in navigator)
      ? 'Ta przeglądarka nie udostępnia lokalizacji.'
      : null,
  }));

  useEffect(() => {
    if (!('geolocation' in navigator)) return;

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => setLocation({
        center: [coords.longitude, coords.latitude],
        error: null,
      }),
      (error) => setLocation({
        center: null,
        error: error.code === error.PERMISSION_DENIED
          ? 'Dostęp do lokalizacji został zablokowany. Możesz go włączyć w ustawieniach przeglądarki.'
          : 'Nie udało się pobrać lokalizacji. Mapa pozostaje w widoku ogólnym.',
      }),
      { enableHighAccuracy: true, maximumAge: 60_000, timeout: 15_000 },
    );
  }, []);

  return location;
}
